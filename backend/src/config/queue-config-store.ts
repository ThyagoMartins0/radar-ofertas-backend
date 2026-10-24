import { env } from './env.js';
import { prisma } from '../database/client.js';

const KEYS = {
  senderDelay: 'senderDelayMinutes',
  collectorInterval: 'collectorIntervalMinutes',
  opHoursStart: 'operatingHoursStart',
  opHoursEnd: 'operatingHoursEnd',
  searchLimit: 'searchLimit',
  affiliateLinkDelayMs: 'affiliateLinkDelayMs',
  affiliateLinkBacklogDelayMinutes: 'affiliateLinkBacklogDelayMinutes',
  affiliateLinkBacklogThreshold: 'affiliateLinkBacklogThreshold',
} as const;

interface QueueConfigCache {
  senderDelayMinutes: number | null;
  collectorIntervalMinutes: number | null;
  operatingHoursStart: number | null;
  operatingHoursEnd: number | null;
  searchLimit: number | null;
  affiliateLinkDelayMs: number | null;
  affiliateLinkBacklogDelayMinutes: number | null;
  affiliateLinkBacklogThreshold: number | null;
}

const cache: QueueConfigCache = {
  senderDelayMinutes: null,
  collectorIntervalMinutes: null,
  operatingHoursStart: null,
  operatingHoursEnd: null,
  searchLimit: null,
  affiliateLinkDelayMs: null,
  affiliateLinkBacklogDelayMinutes: null,
  affiliateLinkBacklogThreshold: null,
};

async function loadIntSetting(key: string): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function saveIntSetting(key: string, value: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

export function invalidateQueueConfigCache(): void {
  cache.senderDelayMinutes = null;
  cache.collectorIntervalMinutes = null;
  cache.operatingHoursStart = null;
  cache.operatingHoursEnd = null;
  cache.searchLimit = null;
  cache.affiliateLinkDelayMs = null;
  cache.affiliateLinkBacklogDelayMinutes = null;
  cache.affiliateLinkBacklogThreshold = null;
}

async function notifyQueueConfigChange(): Promise<void> {
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('queue-config');
}

export async function hydrateQueueConfigCache(): Promise<void> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });

  for (const row of rows) {
    const val = Number.parseInt(row.value, 10);
    if (Number.isNaN(val)) continue;

    if (row.key === KEYS.senderDelay) cache.senderDelayMinutes = val;
    if (row.key === KEYS.collectorInterval) cache.collectorIntervalMinutes = val;
    if (row.key === KEYS.opHoursStart) cache.operatingHoursStart = val;
    if (row.key === KEYS.opHoursEnd) cache.operatingHoursEnd = val;
    if (row.key === KEYS.searchLimit) cache.searchLimit = val;
    if (row.key === KEYS.affiliateLinkDelayMs) cache.affiliateLinkDelayMs = val;
    if (row.key === KEYS.affiliateLinkBacklogDelayMinutes)
      cache.affiliateLinkBacklogDelayMinutes = val;
    if (row.key === KEYS.affiliateLinkBacklogThreshold) cache.affiliateLinkBacklogThreshold = val;
  }
}

// --- Sender Delay ---

export async function getSenderDelayMinutesFromDb(): Promise<number> {
  if (cache.senderDelayMinutes != null) return cache.senderDelayMinutes;
  const val = await loadIntSetting(KEYS.senderDelay);
  if (val != null && val >= 0) {
    cache.senderDelayMinutes = val;
    return val;
  }
  return env.QUEUE_CONFIG.senderDelayMinutes;
}

export function getSenderDelayMinutesCached(): number {
  return cache.senderDelayMinutes ?? env.QUEUE_CONFIG.senderDelayMinutes;
}

export async function saveSenderDelayMinutes(minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw new Error('Informe um intervalo entre 0 e 1440 minutos');
  }
  await saveIntSetting(KEYS.senderDelay, minutes);
  cache.senderDelayMinutes = minutes;
  await notifyQueueConfigChange();
}

// --- Collector Interval ---

export function getCollectorIntervalMinutes(): number {
  return cache.collectorIntervalMinutes ?? env.QUEUE_CONFIG.collectorIntervalMinutes;
}

export async function saveCollectorIntervalMinutes(minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('Informe um intervalo entre 1 e 1440 minutos');
  }
  await saveIntSetting(KEYS.collectorInterval, minutes);
  cache.collectorIntervalMinutes = minutes;
  await notifyQueueConfigChange();
}

// --- Operating Hours ---

export function getOperatingHoursStart(): number {
  return cache.operatingHoursStart ?? env.QUEUE_CONFIG.operatingHoursStart;
}

export function getOperatingHoursEnd(): number {
  return cache.operatingHoursEnd ?? env.QUEUE_CONFIG.operatingHoursEnd;
}

// --- Search Limit ---

export function getSearchLimit(): number {
  return cache.searchLimit ?? env.ML_SEARCH_LIMIT;
}

export async function saveSearchLimit(limit: number): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Informe um limite entre 1 e 500');
  }
  await saveIntSetting(KEYS.searchLimit, limit);
  cache.searchLimit = limit;
  await notifyQueueConfigChange();
}

// --- Affiliate link delay ---

export async function getAffiliateLinkDelayMsFromDb(): Promise<number> {
  if (cache.affiliateLinkDelayMs != null) return cache.affiliateLinkDelayMs;
  const val = await loadIntSetting(KEYS.affiliateLinkDelayMs);
  if (val != null && val >= 0) {
    cache.affiliateLinkDelayMs = val;
    return val;
  }
  return env.QUEUE_CONFIG.affiliateLinkDelayMs;
}

export function getAffiliateLinkDelayMsCached(): number {
  return cache.affiliateLinkDelayMs ?? env.QUEUE_CONFIG.affiliateLinkDelayMs;
}

export async function getAffiliateLinkBacklogDelayMinutesFromDb(): Promise<number> {
  if (cache.affiliateLinkBacklogDelayMinutes != null) return cache.affiliateLinkBacklogDelayMinutes;
  const val = await loadIntSetting(KEYS.affiliateLinkBacklogDelayMinutes);
  if (val != null && val >= 1) {
    cache.affiliateLinkBacklogDelayMinutes = val;
    return val;
  }
  return env.QUEUE_CONFIG.affiliateLinkBacklogDelayMinutes;
}

export function getAffiliateLinkBacklogDelayMinutesCached(): number {
  return (
    cache.affiliateLinkBacklogDelayMinutes ?? env.QUEUE_CONFIG.affiliateLinkBacklogDelayMinutes
  );
}

export async function getAffiliateLinkBacklogThresholdFromDb(): Promise<number> {
  if (cache.affiliateLinkBacklogThreshold != null) return cache.affiliateLinkBacklogThreshold;
  const val = await loadIntSetting(KEYS.affiliateLinkBacklogThreshold);
  if (val != null && val >= 1) {
    cache.affiliateLinkBacklogThreshold = val;
    return val;
  }
  return env.QUEUE_CONFIG.affiliateLinkBacklogThreshold;
}

export function getAffiliateLinkBacklogThresholdCached(): number {
  return cache.affiliateLinkBacklogThreshold ?? env.QUEUE_CONFIG.affiliateLinkBacklogThreshold;
}

export async function saveAffiliateLinkDelaySettings(
  delayMs: number,
  backlogDelayMinutes: number,
  backlogThreshold: number,
): Promise<void> {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new Error('Informe um delay normal entre 0 e 60000 ms');
  }
  if (
    !Number.isInteger(backlogDelayMinutes) ||
    backlogDelayMinutes < 1 ||
    backlogDelayMinutes > 60
  ) {
    throw new Error('Informe um delay de backlog entre 1 e 60 minutos');
  }
  if (!Number.isInteger(backlogThreshold) || backlogThreshold < 1 || backlogThreshold > 100) {
    throw new Error('Informe um limite de pendentes entre 1 e 100');
  }

  await Promise.all([
    saveIntSetting(KEYS.affiliateLinkDelayMs, delayMs),
    saveIntSetting(KEYS.affiliateLinkBacklogDelayMinutes, backlogDelayMinutes),
    saveIntSetting(KEYS.affiliateLinkBacklogThreshold, backlogThreshold),
  ]);

  cache.affiliateLinkDelayMs = delayMs;
  cache.affiliateLinkBacklogDelayMinutes = backlogDelayMinutes;
  cache.affiliateLinkBacklogThreshold = backlogThreshold;
  await notifyQueueConfigChange();
}

// --- Operating Hours ---

export async function saveOperatingHours(startHour: number, endHour: number): Promise<void> {
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new Error('Início deve ser uma hora entre 00:00 e 23:00');
  }
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 24) {
    throw new Error('Fim deve ser uma hora entre 01:00 e 24:00');
  }

  const storedEnd = endHour === 24 ? 0 : endHour;

  if (storedEnd !== 0 && startHour >= storedEnd) {
    throw new Error('Início deve ser anterior ao fim');
  }

  await saveIntSetting(KEYS.opHoursStart, startHour);
  await saveIntSetting(KEYS.opHoursEnd, storedEnd);
  cache.operatingHoursStart = startHour;
  cache.operatingHoursEnd = storedEnd;
  await notifyQueueConfigChange();
}
