import { randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';

import { env } from '../../src/config/env.js';

const REFRESH_TOKEN_PREFIX = 'radar:auth:refresh:';

let redisClient: Redis | null = null;
let redisFailed = false;

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

async function ensureConnected(redis: Redis): Promise<boolean> {
  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    return true;
  } catch {
    redisFailed = true;
    return false;
  }
}

export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

export async function storeRefreshToken(
  token: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) {
    throw new Error('Redis indisponível — refresh token exige REDIS_ENABLED=true');
  }
  await redis.set(`${REFRESH_TOKEN_PREFIX}${token}`, userId, 'EX', ttlSeconds);
}

export async function consumeRefreshToken(token: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) {
    return null;
  }

  const key = `${REFRESH_TOKEN_PREFIX}${token}`;
  const userId = await redis.get(key);
  if (!userId) return null;

  await redis.del(key);
  return userId;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !(await ensureConnected(redis))) return;
  await redis.del(`${REFRESH_TOKEN_PREFIX}${token}`);
}

export async function closeRefreshTokenStore(): Promise<void> {
  if (!redisClient) return;
  await redisClient.quit().catch(() => undefined);
  redisClient = null;
  redisFailed = false;
}

/** Converte strings como 1h, 15m, 30s em segundos. */
export function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Duração JWT inválida: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
  };

  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`Unidade de duração JWT inválida: ${unit}`);
  }

  return Math.max(1, Math.round(amount * multiplier));
}

export function getRefreshTokenTtlSeconds(): number {
  return parseDurationToSeconds(env.JWT_REFRESH_EXPIRES_IN);
}
