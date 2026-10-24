import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import makeWASocket, {
  DisconnectReason,
  areJidsSameUser,
  isJidGroup,
  isJidNewsletter,
  type WASocket,
  type WAMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { DEFAULT_ACCOUNT_ID } from '../accounts/types.js';
import { logger } from '../utils/logger.js';
import { publishWhatsAppConnectState } from '../utils/redis-state.js';

const LIBSIGNAL_NOISE = [
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
];

function suppressLibsignalConsoleNoise(): void {
  const wrap =
    (original: typeof console.warn) =>
    (...args: unknown[]) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (LIBSIGNAL_NOISE.some((noise) => message.includes(noise))) return;
      original(...args);
    };

  console.warn = wrap(console.warn.bind(console));
  console.info = wrap(console.info.bind(console));
}

suppressLibsignalConsoleNoise();

interface WhatsAppSession {
  authPath: string;
  accountId: string;
  socket?: WASocket;
  isConnecting: boolean;
  allowReconnect: boolean;
  qrListener?: (qr: string) => void;
  ownerHeartbeatTimer?: NodeJS.Timeout;
  /** Renova TTL do QR no Redis enquanto aguarda leitura. */
  connectStateRefreshTimer?: NodeJS.Timeout;
  lastQr?: string;
}

const sessions = new Map<string, WhatsAppSession>();
let defaultAuthPath = env.WHATSAPP_AUTH_PATH;

function resolveSession(options?: { authPath?: string; accountId?: string }): WhatsAppSession {
  const authPath = options?.authPath ?? defaultAuthPath;
  const accountId = options?.accountId ?? DEFAULT_ACCOUNT_ID;
  let session = sessions.get(authPath);
  if (!session) {
    session = { authPath, accountId, isConnecting: false, allowReconnect: true };
    sessions.set(authPath, session);
  } else if (options?.accountId) {
    session.accountId = options.accountId;
  }
  return session;
}

/** Auth path padrão (conta default / wa:login). */
export function getWhatsAppAuthPath(): string {
  return defaultAuthPath;
}

export function setWhatsAppAuthPath(authPath: string): void {
  defaultAuthPath = authPath;
}

function syncConnectStateToRedis(
  session: WhatsAppSession,
  status: 'idle' | 'connecting' | 'qr' | 'connected' | 'error',
  qr: string | null = null,
  error: string | null = null,
): void {
  if (status === 'qr' && qr) {
    session.lastQr = qr;
  }
  if (status !== 'qr') {
    session.lastQr = undefined;
  }
  void publishWhatsAppConnectState(session.accountId, { status, qr, error });
}

const CONNECT_STATE_REFRESH_MS = 30_000;

function startConnectStateRefresh(
  session: WhatsAppSession,
  status: 'connecting' | 'qr',
): void {
  stopConnectStateRefresh(session);
  session.connectStateRefreshTimer = setInterval(() => {
    const qr = status === 'qr' ? (session.lastQr ?? null) : null;
    void publishWhatsAppConnectState(session.accountId, {
      status,
      qr,
      error: null,
    });
  }, CONNECT_STATE_REFRESH_MS);
  session.connectStateRefreshTimer.unref?.();
}

function stopConnectStateRefresh(session: WhatsAppSession): void {
  if (session.connectStateRefreshTimer) {
    clearInterval(session.connectStateRefreshTimer);
    session.connectStateRefreshTimer = undefined;
  }
}

// --- Dono único da sessão (lock entre processos) -----------------------------
// Só um processo pode manter o socket do WhatsApp aberto ao mesmo tempo; dois
// sockets com as mesmas credenciais causam connectionReplaced em loop (ping-pong).
// Como processos não compartilham memória, coordenamos via um arquivo de lock com
// heartbeat na pasta de auth: quem está conectado renova o lock; quem for tentar
// conectar e encontrar um lock recente de OUTRO processo apenas se recolhe e
// reporta que já está logado em outro lugar, sem brigar pela sessão.
const OWNER_LOCK_STALE_MS = 30_000;
const OWNER_HEARTBEAT_MS = 10_000;

// Chamado quando detectamos que outro processo já é dono da sessão (no login) ou
// quando perdemos a sessão para outro processo (connectionReplaced). O worker
// registra aqui um handler que encerra o processo — assim, se já existe um dono,
// o processo duplicado que estava tentando conectar simplesmente morre. O painel
// não registra nada (não deve morrer nem virar dono).
let onOwnerConflict: (() => void) | undefined;

/** Registra o que fazer quando a sessão já pertence a outro processo. */
export function setWhatsAppOwnerConflictHandler(handler: () => void): void {
  onOwnerConflict = handler;
}

/** Lançado quando a sessão já está ativa em outro processo. */
export class WhatsAppOwnedElsewhereError extends Error {
  constructor() {
    super('A sessão do WhatsApp já está ativa em outro processo.');
    this.name = 'WhatsAppOwnedElsewhereError';
  }
}

interface OwnerLock {
  pid: number;
  host: string;
  heartbeat: string;
}

function ownerLockPathFor(authPath: string): string {
  return path.join(authPath, 'owner.lock');
}

async function readOwnerLockAt(authPath: string): Promise<OwnerLock | null> {
  try {
    const parsed = JSON.parse(await readFile(ownerLockPathFor(authPath), 'utf8')) as OwnerLock;
    if (typeof parsed?.pid === 'number' && typeof parsed?.heartbeat === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

function isOwnLock(lock: OwnerLock): boolean {
  return lock.pid === process.pid && lock.host === hostname();
}

function isLockFresh(lock: OwnerLock): boolean {
  const age = Date.now() - new Date(lock.heartbeat).getTime();
  return Number.isFinite(age) && age >= 0 && age < OWNER_LOCK_STALE_MS;
}

/** O processo com esse PID (no mesmo host) ainda está rodando? */
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function anotherOwnerAlive(authPath: string): Promise<boolean> {
  const owner = await getWhatsAppOwnerStatusAtPath(authPath);
  return owner.active && !owner.isCurrentProcess;
}

export interface WhatsAppOwnerStatus {
  active: boolean;
  pid: number | null;
  host: string | null;
  isCurrentProcess: boolean;
}

/** Estado do dono da sessão WhatsApp em um auth path (multi-conta no painel). */
export async function getWhatsAppOwnerStatusAtPath(authPath: string): Promise<WhatsAppOwnerStatus> {
  const lock = await readOwnerLockAt(authPath);
  if (!lock || !isLockFresh(lock)) {
    return { active: false, pid: null, host: null, isCurrentProcess: false };
  }
  if (lock.host === hostname() && !isPidRunning(lock.pid)) {
    return { active: false, pid: lock.pid, host: lock.host, isCurrentProcess: false };
  }
  return {
    active: true,
    pid: lock.pid,
    host: lock.host,
    isCurrentProcess: isOwnLock(lock),
  };
}

/** Estado do dono da sessão WhatsApp (auth path padrão). */
export async function getWhatsAppOwnerStatus(): Promise<WhatsAppOwnerStatus> {
  return getWhatsAppOwnerStatusAtPath(defaultAuthPath);
}

async function writeOwnerLock(session: WhatsAppSession): Promise<void> {
  const payload: OwnerLock = {
    pid: process.pid,
    host: hostname(),
    heartbeat: new Date().toISOString(),
  };
  await mkdir(session.authPath, { recursive: true }).catch(() => {});
  await writeFile(ownerLockPathFor(session.authPath), JSON.stringify(payload)).catch(() => {});
}

function startOwnerHeartbeat(session: WhatsAppSession): void {
  if (session.ownerHeartbeatTimer) return;
  session.ownerHeartbeatTimer = setInterval(() => {
    if (session.socket) void writeOwnerLock(session);
  }, OWNER_HEARTBEAT_MS);
  session.ownerHeartbeatTimer.unref?.();
}

function stopOwnerHeartbeat(session: WhatsAppSession): void {
  if (session.ownerHeartbeatTimer) {
    clearInterval(session.ownerHeartbeatTimer);
    session.ownerHeartbeatTimer = undefined;
  }
}

async function releaseOwnerLock(session: WhatsAppSession): Promise<void> {
  stopOwnerHeartbeat(session);
  const lock = await readOwnerLockAt(session.authPath);
  if (lock && isOwnLock(lock)) {
    await rm(ownerLockPathFor(session.authPath), { force: true }).catch(() => {});
  }
}

export interface ConnectWhatsAppOptions {
  authPath?: string;
  accountId?: string;
  onQr?: (qr: string) => void;
}

const PLACEHOLDER_CHANNEL_PATTERN = /1203630{6,}@newsletter$/;

function printQrCode(qr: string): void {
  console.log('\nEscaneie o QR code abaixo com o WhatsApp (Aparelhos conectados):\n');
  qrcode.generate(qr, { small: true });
  console.log('\nSe o QR não aparecer, abra este link no navegador e escaneie a imagem:\n');
  console.log(
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}\n`,
  );
}

export function isPlaceholderChannelId(channelId: string): boolean {
  return PLACEHOLDER_CHANNEL_PATTERN.test(channelId);
}

export function isNewsletterChannelId(channelId: string): boolean {
  return isJidNewsletter(channelId) === true;
}

export async function hasWhatsAppCredentials(authPath = defaultAuthPath): Promise<boolean> {
  try {
    await access(path.join(authPath, 'creds.json'));
    return true;
  } catch {
    return false;
  }
}

export async function clearWhatsAppCredentials(authPath = defaultAuthPath): Promise<void> {
  const session = resolveSession({ authPath });
  session.socket = undefined;
  session.isConnecting = false;
  session.qrListener = undefined;
  await rm(authPath, { recursive: true, force: true });
  sessions.delete(authPath);
  logger.warn({ path: authPath }, 'Credenciais do WhatsApp removidas — escaneie um novo QR');
}

function resolveNewsletterName(name: unknown): string | undefined {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object' && 'text' in name && typeof name.text === 'string') {
    return name.text;
  }
  return undefined;
}

function collectJids(...ids: Array<string | null | undefined>): string[] {
  return ids.filter((id): id is string => !!id?.trim());
}

function isSameWhatsAppUser(left: string, right: string): boolean {
  return areJidsSameUser(left, right);
}

async function isCurrentUserInGroup(
  sock: WASocket,
  meta: Awaited<ReturnType<WASocket['groupMetadata']>>,
): Promise<boolean> {
  const me = sock.user;
  if (!me) return false;

  const mine = collectJids(me.id, me.lid, me.phoneNumber);
  return (meta.participants ?? []).some((participant) => {
    const theirs = collectJids(participant.id, participant.lid, participant.phoneNumber);
    return theirs.some((participantId) =>
      mine.some((myId) => isSameWhatsAppUser(participantId, myId)),
    );
  });
}

export async function validateWhatsAppGroup(
  sock: WASocket,
  groupJid: string,
  inviteLink?: string | null,
): Promise<{ valid: boolean; name?: string; reason?: string }> {
  if (!isJidGroup(groupJid)) {
    return { valid: false, reason: 'ID do grupo deve terminar com @g.us' };
  }

  try {
    const participating = await sock.groupFetchAllParticipating();
    const fromList = participating[groupJid];
    if (fromList) {
      return { valid: true, name: fromList.subject };
    }

    let meta = await sock.groupMetadata(groupJid);
    if (!meta?.id) {
      return { valid: false, reason: 'Grupo não encontrado' };
    }

    if (!(await isCurrentUserInGroup(sock, meta)) && inviteLink?.trim()) {
      const { joinWhatsAppGroupFromInvite } = await import('./invite.js');
      await joinWhatsAppGroupFromInvite(sock, inviteLink);
      meta = await sock.groupMetadata(groupJid);
    }

    if (await isCurrentUserInGroup(sock, meta)) {
      return { valid: true, name: meta.subject };
    }

    return {
      valid: false,
      reason:
        'O número conectado não participa deste grupo — entre pelo link no celular ou use Pausar no destino',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: message };
  }
}

export async function validateWhatsAppDestination(
  sock: WASocket,
  destinationJid: string,
  options?: { inviteLink?: string | null },
): Promise<{ valid: boolean; name?: string; reason?: string }> {
  if (isJidNewsletter(destinationJid)) {
    return validateWhatsAppChannel(sock, destinationJid);
  }

  if (isJidGroup(destinationJid)) {
    return validateWhatsAppGroup(sock, destinationJid, options?.inviteLink);
  }

  return {
    valid: false,
    reason: 'Destino deve ser canal (@newsletter) ou grupo (@g.us)',
  };
}

export async function validateWhatsAppChannel(
  sock: WASocket,
  channelId: string,
): Promise<{ valid: boolean; name?: string; reason?: string }> {
  if (!isJidNewsletter(channelId)) {
    return { valid: false, reason: 'WHATSAPP_CHANNEL_ID deve terminar com @newsletter' };
  }

  if (isPlaceholderChannelId(channelId)) {
    return {
      valid: false,
      reason: 'WHATSAPP_CHANNEL_ID parece placeholder — use o ID real do seu canal',
    };
  }

  try {
    const meta = await sock.newsletterMetadata('jid', channelId);
    if (!meta?.id) {
      return { valid: false, reason: 'Canal não encontrado ou sem permissão de admin' };
    }

    return {
      valid: true,
      name: resolveNewsletterName(meta.name) ?? resolveNewsletterName(meta.thread_metadata?.name),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, reason: message };
  }
}

/**
 * Preferência pela versão atual do WhatsApp Web.
 * `fetchLatestBaileysVersion` pode ficar defasado e o WA responde 405 (client_too_old)
 * antes de emitir QR — o painel fica em "connecting" sem código.
 */
async function resolveWhatsAppVersion(): Promise<[number, number, number]> {
  try {
    const waWeb = await fetchLatestWaWebVersion();
    if (waWeb.version?.length === 3) {
      logger.info({ version: waWeb.version, source: 'wa-web' }, 'Versão WhatsApp resolvida');
      return waWeb.version as [number, number, number];
    }
  } catch (error) {
    logger.warn({ error }, 'Falha ao buscar versão do WhatsApp Web — usando fallback Baileys');
  }

  const baileys = await fetchLatestBaileysVersion();
  logger.info({ version: baileys.version, source: 'baileys' }, 'Versão WhatsApp resolvida');
  return baileys.version as [number, number, number];
}

const CLIENT_TOO_OLD_STATUS = 405;

async function createSocket(
  session: WhatsAppSession,
  authState: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'],
  saveCreds: () => Promise<void>,
): Promise<WASocket> {
  const version = await resolveWhatsAppVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, P({ level: 'silent' })),
    },
    logger: P({ level: env.NODE_ENV === 'production' ? 'warn' : 'silent' }),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info({ authPath: session.authPath }, 'Aguardando leitura do QR code WhatsApp');
      session.qrListener?.(qr);
      syncConnectStateToRedis(session, 'qr', qr);
      startConnectStateRefresh(session, 'qr');
      printQrCode(qr);
    }

    if (connection === 'open') {
      session.socket = sock;
      session.isConnecting = false;
      session.qrListener = undefined;
      stopConnectStateRefresh(session);
      // Persiste credenciais antes de publicar "connected" — senão o painel notifica
      // login e o GET /accounts ainda vê creds.json ausente (race no volume).
      void (async () => {
        try {
          await saveCreds();
        } catch (error) {
          logger.warn({ error, authPath: session.authPath }, 'Falha ao persistir credenciais WhatsApp');
        }
        void writeOwnerLock(session);
        startOwnerHeartbeat(session);
        syncConnectStateToRedis(session, 'connected');
        logger.info({ authPath: session.authPath }, 'WhatsApp connected');
      })();
    }

    if (connection === 'close') {
      session.socket = undefined;
      session.isConnecting = false;
      stopOwnerHeartbeat(session);
      stopConnectStateRefresh(session);

      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const disconnectMessage = boom?.message ?? String(lastDisconnect?.error ?? 'unknown');

      if (statusCode === DisconnectReason.loggedOut) {
        logger.error({ authPath: session.authPath }, 'WhatsApp logged out — limpando credenciais');
        syncConnectStateToRedis(session, 'error', null, 'Sessão encerrada — escaneie um novo QR');
        void releaseOwnerLock(session);
        void clearWhatsAppCredentials(session.authPath);
        return;
      }

      if (statusCode === DisconnectReason.connectionReplaced) {
        session.allowReconnect = false;
        logger.warn(
          { authPath: session.authPath },
          'WhatsApp: sessão assumida por outro processo.',
        );
        onOwnerConflict?.();
        return;
      }

      if (statusCode === CLIENT_TOO_OLD_STATUS) {
        logger.error(
          { authPath: session.authPath, statusCode, version, disconnectMessage },
          'WhatsApp rejeitou o cliente (405) — versão provavelmente desatualizada',
        );
        syncConnectStateToRedis(
          session,
          'error',
          null,
          'WhatsApp rejeitou a conexão (cliente desatualizado). Reinicie o worker e tente Logar de novo.',
        );
      }

      if (session.allowReconnect) {
        const delayMs = statusCode === CLIENT_TOO_OLD_STATUS ? 15_000 : 3_000;
        logger.warn(
          { authPath: session.authPath, statusCode, disconnectMessage, delayMs },
          'WhatsApp disconnected, reconnecting...',
        );
        setTimeout(
          () => void connectWhatsApp({ authPath: session.authPath, accountId: session.accountId }).catch(() => {}),
          delayMs,
        );
      }
    }
  });

  sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
      logger.debug({ update }, 'Message status updated');
    }
  });

  return sock;
}

export async function connectWhatsApp(options?: ConnectWhatsAppOptions): Promise<WASocket> {
  const session = resolveSession(options);
  if (options?.onQr) session.qrListener = options.onQr;
  if (session.socket) return session.socket;

  if (session.isConnecting) {
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (session.socket || !session.isConnecting) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
    if (session.socket) return session.socket;
  }

  if (await anotherOwnerAlive(session.authPath)) {
    logger.warn(
      { authPath: session.authPath },
      'WhatsApp já conectado em outro processo — ignorando novo login.',
    );
    session.allowReconnect = false;
    throw new WhatsAppOwnedElsewhereError();
  }

  session.isConnecting = true;
  session.allowReconnect = true;
  syncConnectStateToRedis(session, 'connecting');
  startConnectStateRefresh(session, 'connecting');
  const { state, saveCreds } = await useMultiFileAuthState(session.authPath);
  const sock = await createSocket(session, state, saveCreds);

  return new Promise((resolve, reject) => {
    const PAIRING_TIMEOUT_MS = 10 * 60_000;
    const CONNECT_TIMEOUT_MS = 120_000;
    let settled = false;
    let timeout = setTimeout(onTimeout, CONNECT_TIMEOUT_MS);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    }

    function onTimeout(): void {
      settle(() => reject(new Error('WhatsApp connection timeout')));
    }

    function refreshTimeout(ms: number): void {
      if (settled) return;
      clearTimeout(timeout);
      timeout = setTimeout(onTimeout, ms);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        // QR renovado: usuário ainda pode escanear — não derruba o worker em 2 min.
        refreshTimeout(PAIRING_TIMEOUT_MS);
        return;
      }

      if (connection === 'open') {
        settle(() => resolve(sock));
        return;
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          settle(() =>
            reject(new Error('WhatsApp logged out — credenciais inválidas, reconecte para novo QR')),
          );
        }
      }
    });
  });
}

export async function disconnectWhatsApp(authPath = defaultAuthPath): Promise<void> {
  const session = resolveSession({ authPath });
  session.allowReconnect = false;
  const sock = session.socket;
  session.socket = undefined;
  session.isConnecting = false;
  stopConnectStateRefresh(session);

  await releaseOwnerLock(session);

  if (sock) {
    sock.ev.removeAllListeners('connection.update');
    sock.ev.removeAllListeners('creds.update');
    sock.ev.removeAllListeners('messages.update');
    await sock.ws.close();
    logger.info({ authPath }, 'WhatsApp disconnected');
  }
}

/** Socket vivo para um auth path (ou undefined). */
export function getWhatsAppSocket(authPath = defaultAuthPath): WASocket | undefined {
  return sessions.get(authPath)?.socket;
}

export async function requireWhatsAppSocket(
  authPath = defaultAuthPath,
  timeoutMs = 45_000,
): Promise<WASocket> {
  const session = resolveSession({ authPath });
  if (session.socket) return session.socket;

  if (await anotherOwnerAlive(session.authPath)) {
    throw new Error('WhatsApp conectado em outro processo — o envio será tentado novamente.');
  }

  if (session.allowReconnect && !session.isConnecting) {
    void connectWhatsApp({ authPath: session.authPath, accountId: session.accountId }).catch(() => {});
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.socket) return session.socket;
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (session.socket) return session.socket;
    if (await anotherOwnerAlive(session.authPath)) {
      throw new Error('WhatsApp conectado em outro processo — o envio será tentado novamente.');
    }
    if (session.allowReconnect && !session.isConnecting) {
      void connectWhatsApp({ authPath: session.authPath, accountId: session.accountId }).catch(() => {});
    }
  }

  throw new Error(
    'WhatsApp indisponível: sem sessão ativa (reconectando). O envio será tentado novamente.',
  );
}

export async function sendOffer(
  sock: WASocket,
  channelId: string,
  imageUrl: string | null,
  caption: string,
): Promise<WAMessage> {
  const validation = await validateWhatsAppDestination(sock, channelId);
  if (!validation.valid) {
    throw new Error(`Destino WhatsApp inválido: ${validation.reason}`);
  }

  const channelName = validation.name;

  if (imageUrl) {
    try {
      const response = await fetch(imageUrl, {
        headers: { 'User-Agent': env.ML_SCRAPER_USER_AGENT },
      });
      if (response.ok) {
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const result = await sock.sendMessage(channelId, { image: imageBuffer, caption });
        if (result?.key?.id) {
          logger.info(
            { channelId, channelName, messageId: result.key.id, mode: 'image' },
            'Offer sent to WhatsApp destination',
          );
          return result;
        }
      }
      logger.warn(
        { imageUrl, status: response.status },
        'Falha ao baixar imagem — enviando só texto',
      );
    } catch (error) {
      logger.warn({ error, imageUrl }, 'Erro no envio com imagem — enviando só texto');
    }
  }

  const result = await sock.sendMessage(channelId, { text: caption });
  if (!result?.key?.id) {
    throw new Error('WhatsApp não confirmou o envio da mensagem');
  }

  logger.info(
    { channelId, channelName, messageId: result.key.id, mode: 'text' },
    'Offer sent to WhatsApp destination',
  );
  return result;
}
