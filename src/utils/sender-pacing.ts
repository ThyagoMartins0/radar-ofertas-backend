import { Redis } from 'ioredis';

import type { Channel } from '../channels/types.js';
import { env } from '../config/env.js';

const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local delay = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local last = tonumber(redis.call('GET', key) or '0')
local earliest = last + delay
if now < earliest then
  return earliest - now
end
redis.call('SET', key, tostring(now))
return 0
`;

/** Encadeia slots futuros no enqueue — evita vários jobs com o mesmo delay de pacing. */
const RESERVE_NEXT_SLOT_SCRIPT = `
local key = KEYS[1]
local gap = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local last = tonumber(redis.call('GET', key) or '0')
if last == 0 then
  redis.call('SET', key, tostring(now))
  return 0
end
local base = math.max(last, now)
local scheduled = base + gap
redis.call('SET', key, tostring(scheduled))
return scheduled - now
`;

let redisClient: Redis | null = null;
let redisFailed = false;

const memoryLastByKey = new Map<string, number>();
const memoryChains = new Map<string, Promise<void>>();

function pacingKey(channel: Channel, accountId: string): string {
  return `radar:pacing:${channel}:${accountId}`;
}

function getRedis(): Redis | null {
  if (!env.REDIS_ENABLED || redisFailed) return null;
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    redisClient.on('error', () => {
      redisFailed = true;
    });
  }
  return redisClient;
}

async function acquireInProcess(key: string, delayMs: number): Promise<number> {
  const prev = memoryChains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  memoryChains.set(
    key,
    prev.then(() => gate),
  );

  await prev;

  try {
    const now = Date.now();
    const last = memoryLastByKey.get(key) ?? 0;
    const waitMs = last + delayMs - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    memoryLastByKey.set(key, Date.now());
    return 0;
  } finally {
    release();
  }
}

/**
 * Reserva um slot de envio com espaçamento mínimo. Retorna ms a aguardar (0 = pode enviar).
 * Com Redis: atômico entre jobs concorrentes. Sem Redis: fila in-process por canal/conta.
 */
/** Reserva próximo slot na fila de pacing (enqueue). Retorna ms de delay a partir de agora. */
export async function reserveNextSenderPacingDelayMs(
  channel: Channel,
  accountId: string,
  gapMs: number,
): Promise<number> {
  if (gapMs <= 0) return 0;

  const key = pacingKey(channel, accountId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      if (redis.status !== 'ready') await redis.connect();
      const waitMs = await redis.eval(RESERVE_NEXT_SLOT_SCRIPT, 1, key, String(gapMs), String(now));
      const parsed = Number(waitMs);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      redisFailed = true;
    }
  }

  return acquireInProcess(key, gapMs);
}

export async function acquireSenderPacingSlot(
  channel: Channel,
  accountId: string,
  delayMs: number,
): Promise<number> {
  if (delayMs <= 0) return 0;

  const key = pacingKey(channel, accountId);
  const now = Date.now();
  const redis = getRedis();

  if (redis) {
    try {
      if (redis.status !== 'ready') await redis.connect();
      const waitMs = await redis.eval(RESERVE_SLOT_SCRIPT, 1, key, String(delayMs), String(now));
      const parsed = Number(waitMs);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      redisFailed = true;
    }
  }

  return acquireInProcess(key, delayMs);
}

export async function clearSenderPacingSlot(channel: Channel, accountId: string): Promise<void> {
  const key = pacingKey(channel, accountId);
  const redis = getRedis();
  if (redis) {
    try {
      if (redis.status !== 'ready') await redis.connect();
      await redis.del(key);
    } catch {
      redisFailed = true;
    }
  }
  memoryLastByKey.delete(key);
}

export async function closeSenderPacingRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
  redisFailed = false;
}
