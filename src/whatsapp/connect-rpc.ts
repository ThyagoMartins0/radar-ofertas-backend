import { Redis } from 'ioredis';

import { resolveAccountAuthPath } from '../accounts/repository.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { resolveWorkerAccountId } from '../utils/redis-state.js';
import { connectWhatsApp, WhatsAppOwnedElsewhereError } from './index.js';

const CONNECT_QUEUE = 'radar:wa:connect:queue';

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
      logger.warn({ error }, 'Redis client error (wa-connect-rpc)');
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
        logger.warn({ error }, 'Falha ao conectar no Redis (wa-connect-rpc)');
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

/** Painel/API pede pareamento — o worker dono da sessão Baileys consome a fila. */
export async function requestWhatsAppConnect(accountId?: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return false;

  const id = resolveWorkerAccountId(accountId);
  try {
    await redis.lpush(CONNECT_QUEUE, id);
    return true;
  } catch (error) {
    logger.warn({ error, accountId: id }, 'Falha ao enfileirar pedido de pareamento WhatsApp');
    return false;
  }
}

async function handleConnectRequest(accountId: string): Promise<void> {
  const id = resolveWorkerAccountId(accountId);
  const authPath = resolveAccountAuthPath(id, 'whatsapp');

  try {
    await connectWhatsApp({ authPath, accountId: id });
  } catch (error) {
    if (error instanceof WhatsAppOwnedElsewhereError) return;
    logger.warn({ error, accountId: id }, 'Pareamento WhatsApp solicitado pelo painel falhou');
  }
}

async function runConnectListenerLoop(): Promise<void> {
  while (listenerRunning) {
    const redis = getRedis();
    if (!redis || !(await ensureConnected(redis))) {
      await sleep(1000);
      continue;
    }

    try {
      const result = await redis.brpop(CONNECT_QUEUE, 2);
      if (!result || !listenerRunning) continue;
      await handleConnectRequest(result[1]);
    } catch (error) {
      logger.warn({ error }, 'Loop de pareamento WhatsApp falhou — retentando');
      await sleep(500);
    }
  }
}

export function startWhatsAppConnectListener(): () => void {
  if (listenerRunning) {
    return stopListener ?? (() => undefined);
  }

  listenerRunning = true;
  void runConnectListenerLoop();

  stopListener = () => {
    listenerRunning = false;
  };

  return stopListener;
}

export async function closeWhatsAppConnectRpc(): Promise<void> {
  listenerRunning = false;
  stopListener = null;
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
}
