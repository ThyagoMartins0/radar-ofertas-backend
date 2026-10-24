import { findAccount, resolveAccountAuthPath } from '../../src/accounts/repository.js';
import {
  closeAffiliateLoginSession,
  isAffiliatePortalReady,
  MercadoLivrePanelLoginUnavailableError,
  openAffiliateLoginSession,
  persistAffiliateSession,
  type AffiliateLoginSession,
} from '../../src/mercado-livre/auth.js';
import { setMlAuthPath } from '../../src/mercado-livre/session.js';
import { DEFAULT_ACCOUNT_ID } from '../../src/accounts/types.js';
import { resolveNovncPort } from '../../src/config/novnc.js';
import { getWhatsAppConnectFromRedis } from '../../src/utils/redis-state.js';
import { logger } from '../../src/utils/logger.js';
import { canManagerSpawnWorkers, getSenderWorkerState, startWorker } from './process-model.js';

// --- WhatsApp connection flow -------------------------------------------------
// Em produção o worker é dono da sessão e publica QR/status no Redis.
// O painel apenas lê e renderiza (stateless, replicável).

export type WhatsAppConnectStatus = 'idle' | 'connecting' | 'qr' | 'connected' | 'error';

export interface WhatsAppConnectState {
  status: WhatsAppConnectStatus;
  qr: string | null;
  error: string | null;
}

function resolveAccountId(accountId?: string): string {
  return accountId?.trim() || DEFAULT_ACCOUNT_ID;
}

let activeWaAccountId = DEFAULT_ACCOUNT_ID;
let activeMlAccountId = DEFAULT_ACCOUNT_ID;

export async function getWhatsAppConnectionState(accountId?: string): Promise<WhatsAppConnectState> {
  const resolvedAccountId = resolveAccountId(accountId ?? activeWaAccountId);
  const redisState = await getWhatsAppConnectFromRedis(resolvedAccountId);
  if (redisState) {
    return { status: redisState.status, qr: redisState.qr, error: redisState.error };
  }

  return { status: 'idle', qr: null, error: null };
}

export async function startWhatsAppConnection(accountId?: string): Promise<WhatsAppConnectState> {
  activeWaAccountId = resolveAccountId(accountId);
  const current = await getWhatsAppConnectionState(activeWaAccountId);
  if (
    current.status === 'connecting' ||
    current.status === 'qr' ||
    current.status === 'connected'
  ) {
    return current;
  }

  if (canManagerSpawnWorkers()) {
    const worker = await getSenderWorkerState();
    if (worker.status !== 'running' && worker.status !== 'starting') {
      await startWorker();
    }
    const after = await getWhatsAppConnectionState(activeWaAccountId);
    return after.status === 'idle' ? { status: 'connecting', qr: null, error: null } : after;
  }

  const worker = await getSenderWorkerState();
  if (worker.status !== 'running') {
    // Em Docker o heartbeat só existe com o worker no ar. Se o Redis ainda não
    // tem QR, devolvemos connecting para o painel continuar o poll — o erro duro
    // impedia ver o QR que o worker publicava segundos depois.
    return {
      status: 'connecting',
      qr: null,
      error: 'Aguardando worker de envio… Se persistir, confira o serviço worker no Docker.',
    };
  }

  return { status: 'connecting', qr: null, error: null };
}

// --- Mercado Livre connection flow -------------------------------------------
// Fluxo stateful com Playwright — operação single-node/dev. Não replicável.

export type MercadoLivreConnectStatus =
  'idle' | 'opening' | 'awaiting-login' | 'saving' | 'connected' | 'error';

export interface MercadoLivreConnectState {
  status: MercadoLivreConnectStatus;
  error: string | null;
  novncPort: number | null;
}

let mlStatus: MercadoLivreConnectStatus = 'idle';
let mlError: string | null = null;
let mlSession: AffiliateLoginSession | undefined;

async function resolveMercadoLivreAuthPath(accountId: string): Promise<string> {
  const account = await findAccount(accountId, 'mercado_livre');
  if (account?.platform === 'mercado_livre') {
    return account.config.authPath;
  }
  return resolveAccountAuthPath(accountId, 'mercado_livre');
}

export function getMercadoLivreConnectionState(): MercadoLivreConnectState {
  return { status: mlStatus, error: mlError, novncPort: resolveNovncPort() };
}

async function closeMlSession(): Promise<void> {
  const session = mlSession;
  mlSession = undefined;
  if (session) {
    await closeAffiliateLoginSession(session).catch(() => {});
  }
}

export async function startMercadoLivreConnection(accountId?: string): Promise<MercadoLivreConnectState> {
  activeMlAccountId = resolveAccountId(accountId);

  if (mlStatus === 'opening' || mlStatus === 'awaiting-login' || mlStatus === 'saving') {
    return getMercadoLivreConnectionState();
  }

  mlStatus = 'opening';
  mlError = null;

  void (async () => {
    try {
      await closeMlSession();
      setMlAuthPath(await resolveMercadoLivreAuthPath(activeMlAccountId));
      mlSession = await openAffiliateLoginSession();
      mlStatus = 'awaiting-login';
    } catch (error: unknown) {
      mlStatus = 'error';
      if (error instanceof MercadoLivrePanelLoginUnavailableError) {
        mlError = error.userMessage;
      } else {
        mlError =
          error instanceof Error ? error.message : 'Falha ao abrir navegador do Mercado Livre';
      }
      logger.error({ error }, 'Mercado Livre login browser failed to open');
    }
  })();

  return getMercadoLivreConnectionState();
}

export async function finishMercadoLivreConnection(): Promise<MercadoLivreConnectState> {
  if (mlStatus !== 'awaiting-login' || !mlSession) {
    return getMercadoLivreConnectionState();
  }

  mlStatus = 'saving';
  mlError = null;

  try {
    const ready = await isAffiliatePortalReady(mlSession.page);
    if (!ready) {
      mlStatus = 'awaiting-login';
      mlError = 'Login ainda não detectado — conclua o login no navegador e tente novamente.';
      return getMercadoLivreConnectionState();
    }

    await persistAffiliateSession(mlSession.context);
    await closeMlSession();
    mlStatus = 'connected';
    mlError = null;
  } catch (error: unknown) {
    await closeMlSession();
    mlStatus = 'error';
    mlError = error instanceof Error ? error.message : 'Falha ao salvar sessão do Mercado Livre';
    logger.error({ error }, 'Mercado Livre session save failed');
  }

  return getMercadoLivreConnectionState();
}

export async function cancelMercadoLivreConnection(): Promise<void> {
  await closeMlSession();
  mlStatus = 'idle';
  mlError = null;
}
