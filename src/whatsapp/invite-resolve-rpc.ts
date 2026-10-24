import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';

import { resolveAccountAuthPath } from '../accounts/repository.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  getWorkerHeartbeat,
  isWorkerHeartbeatFresh,
  resolveWorkerAccountId,
} from '../utils/redis-state.js';
import { requireWhatsAppSocket } from './index.js';
import { resolveWhatsAppInvite, type ResolvedWhatsAppInvite } from './invite.js';

const RESOLVE_QUEUE = 'radar:wa:resolve:queue';
const RESOLVE_REQ_PREFIX = 'radar:wa:resolve:req:';
const RESOLVE_RES_PREFIX = 'radar:wa:resolve:res:';
const RESOLVE_TTL_SEC = 120;
const DEFAULT_TIMEOUT_MS = 25_000;

let redisClient: Redis | null = null;
let connectPromise: Promise<boolean> | null = null;
let listenerRunning = false;
let stopListener: (() => void) | null = null;

function getRedis(): Redis | null {
  if (!env.REDIS_ENABLED) return null;
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (error) => {
      logger.warn({ error }, 'Redis client error (invite-resolve)');
    });
  }
  return redisClient;
}

async function ensureConnected(redis: Redis): Promise<boolean> {
  if (redis.status === 'ready') return true;

  if (!connectPromise) {
    connectPromise = redis
      .connect()
      .then(() => true)
      .catch((error: unknown) => {
        logger.warn({ error }, 'Falha ao conectar no Redis (invite-resolve)');
        return false;
      })
      .finally(() => {
        connectPromise = null;
      });
  }

  return connectPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isWhatsAppWorkerActive(accountId?: string): Promise<boolean> {
  const heartbeat = await getWorkerHeartbeat('whatsapp', resolveWorkerAccountId(accountId));
  return heartbeat !== null && isWorkerHeartbeatFresh(heartbeat);
}

function parseResolvedInvite(raw: Record<string, string>): ResolvedWhatsAppInvite {
  return {
    jid: raw.jid ?? '',
    kind: raw.kind === 'group' ? 'group' : 'newsletter',
    label: raw.label?.trim() ? raw.label : null,
    inviteLink: raw.inviteLink?.trim() ? raw.inviteLink : null,
  };
}

/**
 * Resolve link de convite usando o socket Baileys do worker (sem abrir segunda sessão).
 */
export async function requestWhatsAppInviteResolve(
  accountId: string,
  invite: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ResolvedWhatsAppInvite> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) {
    throw new Error('Redis indisponível — não foi possível consultar o worker');
  }

  const requestId = randomBytes(12).toString('hex');
  const reqKey = `${RESOLVE_REQ_PREFIX}${requestId}`;
  const resKey = `${RESOLVE_RES_PREFIX}${requestId}`;

  await redis
    .multi()
    .hset(reqKey, {
      accountId: resolveWorkerAccountId(accountId),
      invite: invite.trim(),
      createdAt: new Date().toISOString(),
    })
    .expire(reqKey, RESOLVE_TTL_SEC)
    .del(resKey)
    .lpush(RESOLVE_QUEUE, requestId)
    .exec();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await redis.hgetall(resKey);
    if (raw.status === 'ok' && raw.jid) {
      return parseResolvedInvite(raw);
    }
    if (raw.status === 'error') {
      throw new Error(raw.error?.trim() || 'Falha ao resolver link no worker');
    }
    await sleep(200);
  }

  throw new Error('Worker não respondeu a tempo — tente novamente em alguns segundos');
}

async function handleResolveRequest(requestId: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return;

  const reqKey = `${RESOLVE_REQ_PREFIX}${requestId}`;
  const resKey = `${RESOLVE_RES_PREFIX}${requestId}`;
  const raw = await redis.hgetall(reqKey);
  const accountId = resolveWorkerAccountId(raw.accountId);
  const invite = raw.invite?.trim();

  if (!invite) {
    await redis
      .multi()
      .hset(resKey, { status: 'error', error: 'Pedido inválido — link ausente' })
      .expire(resKey, RESOLVE_TTL_SEC)
      .exec();
    return;
  }

  try {
    const authPath = resolveAccountAuthPath(accountId, 'whatsapp');
    const sock = await requireWhatsAppSocket(authPath, 20_000);
    const resolved = await resolveWhatsAppInvite(sock, invite);

    await redis
      .multi()
      .hset(resKey, {
        status: 'ok',
        jid: resolved.jid,
        kind: resolved.kind,
        label: resolved.label ?? '',
        inviteLink: resolved.inviteLink ?? '',
      })
      .expire(resKey, RESOLVE_TTL_SEC)
      .exec();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error, accountId, requestId }, 'Falha ao resolver convite WhatsApp via worker');
    await redis
      .multi()
      .hset(resKey, { status: 'error', error: message })
      .expire(resKey, RESOLVE_TTL_SEC)
      .exec();
  }
}

async function runResolveListenerLoop(): Promise<void> {
  while (listenerRunning) {
    const redis = getRedis();
    if (!redis || !(await ensureConnected(redis))) {
      await sleep(1000);
      continue;
    }

    try {
      const result = await redis.brpop(RESOLVE_QUEUE, 2);
      if (!result || !listenerRunning) continue;
      const requestId = result[1];
      await handleResolveRequest(requestId);
    } catch (error) {
      logger.warn({ error }, 'Loop de resolução de convites WhatsApp falhou — retentando');
      await sleep(500);
    }
  }
}

/** Worker consome pedidos do painel para resolver links sem disputar a sessão Baileys. */
export function startWhatsAppInviteResolveListener(): () => void {
  if (listenerRunning) {
    return stopListener ?? (() => undefined);
  }

  listenerRunning = true;
  void runResolveListenerLoop();

  stopListener = () => {
    listenerRunning = false;
  };

  return stopListener;
}

export async function closeWhatsAppInviteResolveRpc(): Promise<void> {
  listenerRunning = false;
  stopListener = null;
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
}
