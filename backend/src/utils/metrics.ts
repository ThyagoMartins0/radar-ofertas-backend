import { Redis } from 'ioredis';

import { env } from '../config/env.js';

export interface MetricSnapshot {
  sendSuccess: Record<string, number>;
  sendFailure: Record<string, number>;
  scrapeLatencyMs: number[];
  scrapeFailures: number;
  circuitBreakerOpens: number;
  startedAt: string;
}

const MAX_LATENCY_SAMPLES = 100;

const KEYS = {
  sendSuccess: 'radar:metrics:sendSuccess',
  sendFailure: 'radar:metrics:sendFailure',
  scrapeLatency: 'radar:metrics:scrapeLatency',
  scrapeFailures: 'radar:metrics:scrapeFailures',
  circuitBreakerOpens: 'radar:metrics:circuitBreakerOpens',
  startedAt: 'radar:metrics:startedAt',
} as const;

const counters = {
  sendSuccess: {} as Record<string, number>,
  sendFailure: {} as Record<string, number>,
  scrapeLatencyMs: [] as number[],
  scrapeFailures: 0,
  circuitBreakerOpens: 0,
  startedAt: new Date().toISOString(),
};

let redisClient: Redis | null = null;
let redisFailed = false;

function channelKey(channel: string, accountId = 'default'): string {
  return `${channel}:${accountId}`;
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

async function withRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== 'ready') await redis.connect();
    return await fn(redis);
  } catch {
    redisFailed = true;
    return null;
  }
}

function parseHashCounts(raw: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) result[key] = parsed;
  }
  return result;
}

export function recordSendSuccess(channel: string, accountId?: string): void {
  const key = channelKey(channel, accountId);
  counters.sendSuccess[key] = (counters.sendSuccess[key] ?? 0) + 1;
  void withRedis((redis) => redis.hincrby(KEYS.sendSuccess, key, 1));
}

export function recordSendFailure(channel: string, accountId?: string): void {
  const key = channelKey(channel, accountId);
  counters.sendFailure[key] = (counters.sendFailure[key] ?? 0) + 1;
  void withRedis((redis) => redis.hincrby(KEYS.sendFailure, key, 1));
}

export function recordScrapeLatency(ms: number): void {
  counters.scrapeLatencyMs.push(ms);
  if (counters.scrapeLatencyMs.length > MAX_LATENCY_SAMPLES) {
    counters.scrapeLatencyMs.shift();
  }
  void withRedis(async (redis) => {
    await redis.lpush(KEYS.scrapeLatency, String(ms));
    await redis.ltrim(KEYS.scrapeLatency, 0, MAX_LATENCY_SAMPLES - 1);
  });
}

export function recordScrapeFailure(): void {
  counters.scrapeFailures++;
  void withRedis((redis) => redis.incr(KEYS.scrapeFailures));
}

export function recordCircuitBreakerOpen(): void {
  counters.circuitBreakerOpens++;
  void withRedis((redis) => redis.incr(KEYS.circuitBreakerOpens));
}

function localSnapshot(): MetricSnapshot {
  return {
    sendSuccess: { ...counters.sendSuccess },
    sendFailure: { ...counters.sendFailure },
    scrapeLatencyMs: [...counters.scrapeLatencyMs],
    scrapeFailures: counters.scrapeFailures,
    circuitBreakerOpens: counters.circuitBreakerOpens,
    startedAt: counters.startedAt,
  };
}

export async function getMetrics(): Promise<MetricSnapshot> {
  const local = localSnapshot();
  const remote = await withRedis(async (redis) => {
    const [
      sendSuccess,
      sendFailure,
      scrapeLatency,
      scrapeFailures,
      circuitBreakerOpens,
      startedAt,
    ] = await Promise.all([
      redis.hgetall(KEYS.sendSuccess),
      redis.hgetall(KEYS.sendFailure),
      redis.lrange(KEYS.scrapeLatency, 0, MAX_LATENCY_SAMPLES - 1),
      redis.get(KEYS.scrapeFailures),
      redis.get(KEYS.circuitBreakerOpens),
      redis.get(KEYS.startedAt),
    ]);

    return {
      sendSuccess: parseHashCounts(sendSuccess),
      sendFailure: parseHashCounts(sendFailure),
      scrapeLatencyMs: scrapeLatency
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value)),
      scrapeFailures: Number.parseInt(scrapeFailures ?? '0', 10) || 0,
      circuitBreakerOpens: Number.parseInt(circuitBreakerOpens ?? '0', 10) || 0,
      startedAt: startedAt || local.startedAt,
    };
  });

  if (!remote) return local;

  return {
    sendSuccess: remote.sendSuccess,
    sendFailure: remote.sendFailure,
    scrapeLatencyMs:
      remote.scrapeLatencyMs.length > 0 ? remote.scrapeLatencyMs : local.scrapeLatencyMs,
    scrapeFailures: remote.scrapeFailures,
    circuitBreakerOpens: remote.circuitBreakerOpens,
    startedAt: remote.startedAt,
  };
}

export async function resetMetrics(): Promise<void> {
  counters.sendSuccess = {};
  counters.sendFailure = {};
  counters.scrapeLatencyMs = [];
  counters.scrapeFailures = 0;
  counters.circuitBreakerOpens = 0;
  counters.startedAt = new Date().toISOString();

  await withRedis(async (redis) => {
    await redis.del(
      KEYS.sendSuccess,
      KEYS.sendFailure,
      KEYS.scrapeLatency,
      KEYS.scrapeFailures,
      KEYS.circuitBreakerOpens,
      KEYS.startedAt,
    );
    await redis.set(KEYS.startedAt, counters.startedAt);
  });
}

export async function closeMetricsRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
  redisFailed = false;
}

// Garante startedAt compartilhado na primeira escrita com Redis ligado.
void withRedis(async (redis) => {
  const existing = await redis.get(KEYS.startedAt);
  if (!existing) {
    await redis.set(KEYS.startedAt, counters.startedAt);
    return;
  }
  counters.startedAt = existing;
});
