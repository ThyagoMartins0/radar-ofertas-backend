import { randomUUID } from 'node:crypto';

import { CHANNELS, type Channel } from '../channels/types.js';
import { env } from './env.js';
import { prisma } from '../database/client.js';
import {
  normalizeAmazonSourceKey,
  validateAmazonSourceConfig,
  type AmazonSourceKind,
} from '../amazon/source-url.js';
import { DEFAULT_AMAZON_RECOMMENDATIONS_URL } from '../amazon/types.js';

export interface AmazonCustomSource {
  id: string;
  label: string;
  url: string;
  channels: Channel[];
}

export interface AmazonSourceRow {
  id: string;
  label: string;
  source: string;
  channels: Channel[];
  fromEnv: boolean;
  valid: boolean;
  kind: AmazonSourceKind;
  reason?: string;
}

const SETTING_KEY = 'amazonCustomSources';
const ENV_FLAGS_KEY = 'amazonEnvSourceFlags';
let sourcesCache: AmazonCustomSource[] | null = null;
let envFlagsCache: Record<string, Channel[]> | null = null;

export function invalidateAmazonSourcesCache(): void {
  sourcesCache = null;
  envFlagsCache = null;
}

function sanitizeChannels(values: readonly unknown[]): Channel[] {
  return CHANNELS.filter((channel) => values.includes(channel));
}

function withChannel(channels: readonly Channel[], channel: Channel, include: boolean): Channel[] {
  const set = new Set(channels);
  if (include) set.add(channel);
  else set.delete(channel);
  return CHANNELS.filter((c) => set.has(c));
}

function coerceChannels(value: unknown): Channel[] {
  if (Array.isArray(value)) return sanitizeChannels(value);
  return value === false ? [] : [...CHANNELS];
}

function parseEnvFlagsFromJson(raw: string): Record<string, Channel[]> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const flags: Record<string, Channel[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      flags[key] = coerceChannels(value);
    }
    return flags;
  } catch {
    return {};
  }
}

function getEnvSourceChannels(source: string): Channel[] {
  const flags = envFlagsCache ?? {};
  return source in flags ? flags[source]! : [...CHANNELS];
}

function parseSourcesFromJson(raw: string): AmazonCustomSource[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const sources: AmazonCustomSource[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!url) continue;

    const channels = 'channels' in row ? coerceChannels(row.channels) : coerceChannels(row.enabled);

    sources.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : randomUUID(),
      label:
        typeof row.label === 'string' && row.label.trim() ? row.label.trim() : deriveLabel(url),
      url,
      channels,
    });
  }

  return sources;
}

function deriveLabel(source: string): string {
  const validation = validateAmazonSourceConfig(source);
  if (!validation.valid) return source;

  if (validation.kind === 'browse_node') {
    const match = validation.url.match(/\/b\/node\/(\d+)/i);
    return match?.[1] ? `Amazon node ${match[1]}` : 'Amazon recomendações';
  }

  if (validation.kind === 'search') return 'Amazon busca';
  if (validation.kind === 'product') return 'Amazon produto';
  return source;
}

export function getEnvAmazonSources(): string[] {
  return env.AMAZON_SOURCES;
}

export function getCustomAmazonSources(): AmazonCustomSource[] {
  return sourcesCache ?? [];
}

export function getActiveAmazonSources(): string[] {
  const envActive = env.AMAZON_SOURCES.filter(
    (source) => getEnvSourceChannels(source).length > 0,
  );
  const custom = getCustomAmazonSources()
    .filter((source) => source.channels.length > 0)
    .map((source) => source.url.trim());
  return [...envActive, ...custom];
}

export function getActiveAmazonSourcesForChannel(channel: Channel): string[] {
  const envActive = env.AMAZON_SOURCES.filter((source) =>
    getEnvSourceChannels(source).includes(channel),
  );
  const custom = getCustomAmazonSources()
    .filter((source) => source.channels.includes(channel))
    .map((source) => source.url.trim());
  return [...envActive, ...custom];
}

export function getChannelsForAmazonSource(source: string): Channel[] {
  const key = normalizeAmazonSourceKey(source);

  for (const envSource of env.AMAZON_SOURCES) {
    if (normalizeAmazonSourceKey(envSource) === key) return getEnvSourceChannels(envSource);
  }

  const custom = getCustomAmazonSources().find(
    (row) => normalizeAmazonSourceKey(row.url) === key,
  );
  return custom ? custom.channels : [];
}

export function buildAmazonSourceRows(): AmazonSourceRow[] {
  const envRows: AmazonSourceRow[] = env.AMAZON_SOURCES.map((source, index) => {
    const validation = validateAmazonSourceConfig(source);
    return {
      id: `env:${index}`,
      label: source,
      source,
      channels: getEnvSourceChannels(source),
      fromEnv: true,
      valid: validation.valid,
      kind: validation.kind,
      reason: validation.reason,
    };
  });

  const customRows: AmazonSourceRow[] = getCustomAmazonSources().map((row) => {
    const validation = validateAmazonSourceConfig(row.url);
    return {
      id: row.id,
      label: row.label,
      source: row.url,
      channels: row.channels,
      fromEnv: false,
      valid: validation.valid,
      kind: validation.kind,
      reason: validation.reason,
    };
  });

  return [...envRows, ...customRows];
}

export async function hydrateAmazonSourcesCache(): Promise<void> {
  try {
    const [sourcesRow, flagsRow] = await Promise.all([
      prisma.setting.findUnique({ where: { key: SETTING_KEY } }),
      prisma.setting.findUnique({ where: { key: ENV_FLAGS_KEY } }),
    ]);
    sourcesCache = sourcesRow ? parseSourcesFromJson(sourcesRow.value) : [];
    envFlagsCache = flagsRow ? parseEnvFlagsFromJson(flagsRow.value) : {};
  } catch {
    sourcesCache = [];
    envFlagsCache = {};
  }
}

async function persistCustomSources(sources: AmazonCustomSource[]): Promise<void> {
  const json = JSON.stringify(sources);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: json },
    create: { key: SETTING_KEY, value: json },
  });
  sourcesCache = sources;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('amazon-sources');
}

async function persistEnvFlags(flags: Record<string, Channel[]>): Promise<void> {
  const json = JSON.stringify(flags);
  await prisma.setting.upsert({
    where: { key: ENV_FLAGS_KEY },
    update: { value: json },
    create: { key: ENV_FLAGS_KEY, value: json },
  });
  envFlagsCache = flags;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('amazon-sources');
}

export async function addCustomAmazonSource(
  url: string,
  label?: string,
  channels: Channel[] = [...CHANNELS],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe um link Amazon' };
  }

  const validation = validateAmazonSourceConfig(trimmed);
  if (!validation.valid) {
    return { ok: false, error: validation.reason ?? 'Link Amazon inválido' };
  }

  const normalized = validation.url || trimmed;
  const key = normalizeAmazonSourceKey(normalized);
  const envKeys = new Set(env.AMAZON_SOURCES.map((source) => normalizeAmazonSourceKey(source)));
  if (envKeys.has(key)) {
    return { ok: false, error: 'Este link já está configurado no .env (AMAZON_SOURCES)' };
  }

  const sources = [...getCustomAmazonSources()];
  if (sources.some((source) => normalizeAmazonSourceKey(source.url) === key)) {
    return { ok: false, error: 'Este link já está cadastrado' };
  }

  sources.push({
    id: randomUUID(),
    label: label?.trim() || deriveLabel(trimmed),
    url: normalized,
    channels: sanitizeChannels(channels),
  });

  await persistCustomSources(sources);
  return { ok: true };
}

export async function removeCustomAmazonSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sources = getCustomAmazonSources();
  const next = sources.filter((source) => source.id !== id);
  if (next.length === sources.length) {
    return { ok: false, error: 'Link não encontrado' };
  }

  await persistCustomSources(next);
  return { ok: true };
}

export async function saveAmazonSourceChannelsFromForm(
  channel: Channel,
  form: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sources = getCustomAmazonSources().map((source) => ({
    ...source,
    channels: withChannel(source.channels, channel, form[`coletar_amazon_${source.id}`] === '1'),
  }));

  const flags: Record<string, Channel[]> = { ...(envFlagsCache ?? {}) };
  env.AMAZON_SOURCES.forEach((source, index) => {
    const current = source in flags ? flags[source]! : [...CHANNELS];
    flags[source] = withChannel(current, channel, form[`coletar_amazon_env:${index}`] === '1');
  });

  await Promise.all([persistCustomSources(sources), persistEnvFlags(flags)]);
  return { ok: true };
}

/** Apenas para testes unitários. */
export function setAmazonSourcesCacheForTest(sources: AmazonCustomSource[] | null): void {
  sourcesCache = sources;
}

/** Apenas para testes unitários. */
export function setAmazonEnvFlagsCacheForTest(flags: Record<string, Channel[]> | null): void {
  envFlagsCache = flags;
}

export { DEFAULT_AMAZON_RECOMMENDATIONS_URL };
