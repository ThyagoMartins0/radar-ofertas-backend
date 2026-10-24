import { env } from '../../src/config/env.js';
import {
  countMlScrapeLogs,
  getLogTotalCount,
  getMlScrapeLogs,
  getRecentLogs,
  type LogFilters,
  type LogLevel,
  type LogSource,
} from '../../src/utils/log-store.js';
import {
  classifyLogEntry,
  classifyMlScrapeEntry,
  type ClassifiedLogEntry,
  type ClassifiedMlScrapeEntry,
} from './logs/log-classifier.js';

export type { ClassifiedLogEntry, ClassifiedMlScrapeEntry };

export interface LogsPageData {
  logs: ClassifiedLogEntry[];
  total: number;
  mlScrapeCount: number;
  mlScrapeLogs: ClassifiedMlScrapeEntry[];
  filters: Required<Pick<LogFilters, 'level' | 'source' | 'limit'>>;
  redisEnabled: boolean;
}

const LEVELS: Array<LogLevel | 'all'> = ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const SOURCES: Array<LogSource | 'all'> = ['all', 'collector', 'worker', 'api', 'manager'];

export function parseLogLevel(value: string | null): LogLevel | 'all' {
  if (value && LEVELS.includes(value as LogLevel | 'all')) {
    return value as LogLevel | 'all';
  }
  return 'all';
}

export function parseLogSource(value: string | null): LogSource | 'all' {
  if (value && SOURCES.includes(value as LogSource | 'all')) {
    return value as LogSource | 'all';
  }
  return 'all';
}

export function parseLogLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '200', 10);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(Math.max(parsed, 50), 1000);
}

export async function loadLogsPage(searchParams: URLSearchParams): Promise<LogsPageData> {
  const filters = {
    level: parseLogLevel(searchParams.get('level')),
    source: parseLogSource(searchParams.get('source')),
    limit: parseLogLimit(searchParams.get('limit')),
  };

  const [logs, total, mlScrapeCount, mlScrapeLogs] = await Promise.all([
    getRecentLogs(filters),
    getLogTotalCount(),
    countMlScrapeLogs(),
    getMlScrapeLogs({ limit: 200 }),
  ]);

  return {
    logs: logs.map(classifyLogEntry),
    total,
    mlScrapeCount,
    mlScrapeLogs: mlScrapeLogs.map(classifyMlScrapeEntry),
    filters,
    redisEnabled: env.REDIS_ENABLED,
  };
}

export interface LogsApiData {
  logs: ClassifiedLogEntry[];
  total: number;
  mlScrapeCount: number;
  mlScrapeLogs: ClassifiedMlScrapeEntry[];
}

export async function loadLogsApi(searchParams: URLSearchParams): Promise<LogsApiData> {
  const filters = {
    level: parseLogLevel(searchParams.get('level')),
    source: parseLogSource(searchParams.get('source')),
    limit: parseLogLimit(searchParams.get('limit')),
    since: searchParams.get('since') ?? undefined,
  };

  const mlSince = searchParams.get('mlSince') ?? undefined;

  const [logs, total, mlScrapeCount, mlScrapeLogs] = await Promise.all([
    getRecentLogs(filters),
    getLogTotalCount(),
    countMlScrapeLogs(),
    getMlScrapeLogs({ since: mlSince, limit: 200 }),
  ]);
  return {
    logs: logs.map(classifyLogEntry),
    total,
    mlScrapeCount,
    mlScrapeLogs: mlScrapeLogs.map(classifyMlScrapeEntry),
  };
}
