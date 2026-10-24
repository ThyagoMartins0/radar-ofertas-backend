import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

import { Redis } from 'ioredis';

import { env } from '../config/env.js';

const REDIS_KEY = 'radar:app-logs';
const SCRAPE_COUNT_KEY = 'radar:ml-scrape-count';
const MAX_LOGS = 1000;

const ML_SCRAPE_LOG_MESSAGES = new Set([
  'ML site visit',
  'HTTP scrape retry',
  'Blocked HTML — retrying',
  'HTTP fetch retry',
  'HTTP scrape failed',
  'HTTP scrape failed — trying browser fallback',
  'Category page scraped',
  'Offers page scraped',
  'Category scraped',
]);

const LEVEL_NAMES: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const KNOWN_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'v', 'name']);

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogSource = 'collector' | 'worker' | 'api' | 'manager' | 'unknown';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  pid: number;
  hostname: string;
  meta: Record<string, unknown>;
}

export interface LogFilters {
  level?: LogLevel | 'all';
  source?: LogSource | 'all';
  limit?: number;
  since?: string;
}

const memoryBuffer: LogEntry[] = [];
let memoryScrapeCount = 0;
let redisClient: Redis | null = null;
let redisFailed = false;

const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

export function subscribeLogAppended(listener: (entry: LogEntry) => void): () => void {
  logEmitter.on('append', listener);
  return () => logEmitter.off('append', listener);
}

export function isMlScrapeLogEntry(entry: LogEntry): boolean {
  return ML_SCRAPE_LOG_MESSAGES.has(entry.message);
}

function isMlScrapeCountEntry(entry: LogEntry): boolean {
  if (entry.message === 'ML site visit') return true;
  if (
    entry.message === 'HTTP scrape retry' ||
    entry.message === 'Blocked HTML — retrying' ||
    entry.message === 'HTTP fetch retry'
  ) {
    return true;
  }
  return (
    entry.message === 'Category page scraped' ||
    entry.message === 'Offers page scraped' ||
    entry.message === 'Category scraped'
  );
}

function detectProcessSource(): LogSource {
  const entry = process.argv[1]?.replace(/\\/g, '/') ?? '';
  if (entry.includes('/backend/api/')) return 'api';
  if (entry.includes('/manager/')) return 'manager';
  if (entry.includes('worker')) return 'worker';
  if (entry.includes('app.ts') || entry.includes('app.js')) return 'collector';
  return 'unknown';
}

const processSource = detectProcessSource();

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

function extractMeta(record: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_FIELDS.has(key)) meta[key] = value;
  }
  return meta;
}

function normalizePinoRecord(record: Record<string, unknown>): LogEntry {
  const levelNum = typeof record.level === 'number' ? record.level : 30;
  const time = typeof record.time === 'number' ? record.time : Date.now();
  const pid = typeof record.pid === 'number' ? record.pid : process.pid;
  const hostname = typeof record.hostname === 'string' ? record.hostname : 'local';
  const message = typeof record.msg === 'string' ? record.msg : '';

  return {
    id: `${time}-${pid}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(time).toISOString(),
    level: LEVEL_NAMES[levelNum] ?? 'info',
    source: processSource,
    message,
    pid,
    hostname,
    meta: extractMeta(record),
  };
}

function pushToMemory(entry: LogEntry): void {
  memoryBuffer.unshift(entry);
  if (memoryBuffer.length > MAX_LOGS) {
    memoryBuffer.length = MAX_LOGS;
  }
}

async function pushToRedis(entry: LogEntry): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const payload = JSON.stringify(entry);
    await redis
      .multi()
      .lpush(REDIS_KEY, payload)
      .ltrim(REDIS_KEY, 0, MAX_LOGS - 1)
      .exec();
  } catch {
    redisFailed = true;
  }
}

async function incrementMlScrapeCount(): Promise<void> {
  memoryScrapeCount++;

  const redis = getRedis();
  if (!redis) return;

  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    await redis.incr(SCRAPE_COUNT_KEY);
  } catch {
    redisFailed = true;
  }
}

export async function appendLog(entry: LogEntry): Promise<void> {
  pushToMemory(entry);
  logEmitter.emit('append', entry);
  if (isMlScrapeCountEntry(entry)) {
    await incrementMlScrapeCount();
  }
  await pushToRedis(entry);
}

export function ingestPinoRecord(record: Record<string, unknown>): void {
  const entry = normalizePinoRecord(record);
  void appendLog(entry);
}

function matchesFilters(entry: LogEntry, filters: LogFilters): boolean {
  if (filters.level && filters.level !== 'all' && entry.level !== filters.level) return false;
  if (filters.source && filters.source !== 'all' && entry.source !== filters.source) return false;
  if (filters.since) {
    const sinceMs = Date.parse(filters.since);
    if (!Number.isNaN(sinceMs) && Date.parse(entry.timestamp) <= sinceMs) return false;
  }
  return true;
}

async function readFromRedis(limit: number): Promise<LogEntry[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const raw = await redis.lrange(REDIS_KEY, 0, limit - 1);
    return raw
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is LogEntry => entry != null);
  } catch {
    redisFailed = true;
    return [];
  }
}

async function getMergedLogs(): Promise<LogEntry[]> {
  const redisEntries = await readFromRedis(MAX_LOGS);
  const merged = new Map<string, LogEntry>();

  for (const entry of redisEntries) {
    merged.set(entry.id, entry);
  }
  for (const entry of memoryBuffer) {
    merged.set(entry.id, entry);
  }

  return [...merged.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export async function getLogTotalCount(): Promise<number> {
  const all = await getMergedLogs();
  return all.length;
}

export async function countMlScrapeLogs(): Promise<number> {
  const all = await getMergedLogs();
  const fromLogs = all.filter(isMlScrapeCountEntry).length;
  let redisCount: number | null = null;

  const redis = getRedis();
  if (redis) {
    try {
      if (redis.status !== 'ready') {
        await redis.connect();
      }
      const raw = await redis.get(SCRAPE_COUNT_KEY);
      if (raw != null) {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isNaN(parsed)) redisCount = parsed;
      }
    } catch {
      redisFailed = true;
    }
  }

  return Math.max(redisCount ?? 0, memoryScrapeCount, fromLogs);
}

export async function getRecentLogs(filters: LogFilters = {}): Promise<LogEntry[]> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), MAX_LOGS);
  const all = await getMergedLogs();

  return all.filter((entry) => matchesFilters(entry, filters)).slice(-limit);
}

export interface MlScrapeLogFilters {
  since?: string;
  limit?: number;
}

export async function getMlScrapeLogs(filters: MlScrapeLogFilters = {}): Promise<LogEntry[]> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), MAX_LOGS);
  const all = await getMergedLogs();

  return all
    .filter((entry) => isMlScrapeLogEntry(entry))
    .filter((entry) => {
      if (!filters.since) return true;
      const sinceMs = Date.parse(filters.since);
      if (Number.isNaN(sinceMs)) return true;
      return Date.parse(entry.timestamp) > sinceMs;
    })
    .slice(-limit);
}

export function createLogCaptureStream(): Writable {
  let pending = '';

  return new Writable({
    write(chunk, _encoding, callback) {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          ingestPinoRecord(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          ingestPinoRecord({
            level: 30,
            time: Date.now(),
            pid: process.pid,
            hostname: 'local',
            msg: trimmed,
          });
        }
      }

      callback();
    },
  });
}

export async function closeLogStore(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
}
