import type { LogEntry } from '../../../src/utils/log-store.js';

export interface ClassifiedLogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  meta: Record<string, unknown>;
  module: string;
  action: string;
  metaTrail: string;
  chip: string;
  chipClass: string;
  searchBlob: string;
}

export interface ClassifiedMlScrapeEntry {
  timestamp: string;
  level: string;
  message: string;
  meta: Record<string, unknown>;
  detail: string;
  status: string;
  statusClass: string;
  method: string;
}

export function inferLogModule(entry: LogEntry): string {
  const meta = entry.meta;
  if (typeof meta.jobId === 'string') return 'jobs.collector';
  if (typeof meta.offerId === 'string') return 'offers.service';
  if (typeof meta.permalink === 'string' || typeof meta.endpoint === 'string')
    return 'mercado-livre.affiliate';
  if (typeof meta.category === 'string') return 'mercado-livre.scraper';
  if (typeof meta.channelId === 'string') return 'whatsapp.channel';
  if (typeof meta.path === 'string') return 'manager.http';
  if (entry.source === 'worker') return 'jobs.sender';
  if (entry.source === 'api') return 'backend.api';
  if (entry.source === 'manager') return 'manager.app';
  if (entry.source === 'collector') return 'jobs.collector';
  return 'app.runtime';
}

export function inferLogAction(entry: LogEntry): string {
  const msg = entry.message.toLowerCase();
  if (msg.includes('failed') || msg.includes('error') || msg.includes('expired')) return 'FAIL';
  if (msg.includes('completed') || msg.includes('generated') || msg.includes('saved')) return 'OK';
  if (msg.includes('starting') || msg.includes('collection')) return 'RUN';
  if (msg.includes('delay') || msg.includes('skipping')) return 'WAIT';
  if (msg.includes('enqueue') || msg.includes('enqueued')) return 'POST';
  return 'LOG';
}

export function formatLogMetaTrail(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';

  return keys
    .slice(0, 4)
    .map((key) => {
      const value = meta[key];
      const rendered =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
      const trimmed = rendered.length > 56 ? `${rendered.slice(0, 56)}…` : rendered;
      return `${key}=${trimmed}`;
    })
    .join(' ');
}

export const LOG_LEVEL_CHIP_MAP: Record<string, string> = {
  info: 'INFO',
  debug: 'OK',
  trace: 'SEC',
  warn: 'WARN',
  error: 'ERROR',
  fatal: 'ERROR',
};

export function logLevelChipClass(level: string): string {
  const chip = LOG_LEVEL_CHIP_MAP[level] ?? 'INFO';
  return `audit-chip-${chip.toLowerCase()}`;
}

export function formatMlScrapeDetail(entry: LogEntry): string {
  const { meta, message } = entry;
  if (typeof meta.url === 'string') {
    try {
      const parsed = new URL(meta.url);
      return parsed.pathname + parsed.search;
    } catch {
      return meta.url;
    }
  }

  const parts: string[] = [];
  if (typeof meta.category === 'string') parts.push(meta.category);
  if (meta.page != null) parts.push(`pág. ${meta.page}`);
  if (meta.scraped != null) parts.push(`${meta.scraped} itens`);
  if (meta.method != null) parts.push(String(meta.method));
  if (parts.length > 0) return parts.join(' · ');
  return message;
}

export function mlScrapeStatusLabel(entry: LogEntry): string {
  if (entry.level === 'error' || entry.level === 'fatal') return 'ERRO';
  if (entry.level === 'warn') return 'RETRY';
  if (entry.message === 'ML site visit') return 'VISITA';
  return 'OK';
}

export function mlScrapeStatusClass(entry: LogEntry): string {
  if (entry.level === 'error' || entry.level === 'fatal') return 'ml-status-error';
  if (entry.level === 'warn') return 'ml-status-warn';
  return 'ml-status-ok';
}

export function classifyLogEntry(entry: LogEntry): ClassifiedLogEntry {
  const module = inferLogModule(entry);
  const action = inferLogAction(entry);
  const metaTrail = formatLogMetaTrail(entry.meta);
  const chip = LOG_LEVEL_CHIP_MAP[entry.level] ?? entry.level.toUpperCase();

  return {
    timestamp: entry.timestamp,
    level: entry.level,
    source: entry.source,
    message: entry.message,
    meta: entry.meta,
    module,
    action,
    metaTrail,
    chip,
    chipClass: logLevelChipClass(entry.level),
    searchBlob: `${entry.message} ${module} ${metaTrail} ${entry.source}`.toLowerCase(),
  };
}

export function classifyMlScrapeEntry(entry: LogEntry): ClassifiedMlScrapeEntry {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    meta: entry.meta,
    detail: formatMlScrapeDetail(entry),
    status: mlScrapeStatusLabel(entry),
    statusClass: mlScrapeStatusClass(entry),
    method: typeof entry.meta.method === 'string' ? entry.meta.method.toUpperCase() : 'HTTP',
  };
}
