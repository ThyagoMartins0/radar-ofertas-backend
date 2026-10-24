import { randomUUID } from 'node:crypto';

import { CHANNELS, type Channel } from '../channels/types.js';
import { env } from './env.js';
import { prisma } from '../database/client.js';
import {
  validateCategoryConfig,
  type CategoryListingKind,
  type CategoryValidation,
} from '../mercado-livre/category-url.js';

export interface MlCustomSource {
  id: string;
  label: string;
  url: string;
  /** Canais que esta fonte alimenta. Vazio = fonte inativa (não é coletada). */
  channels: Channel[];
}

export interface MlCategoryRow {
  id: string;
  label: string;
  category: string;
  channels: Channel[];
  fromEnv: boolean;
  valid: boolean;
  type: CategoryValidation['type'];
  listingKind: CategoryListingKind;
  reason?: string;
}

const SETTING_KEY = 'mlCustomSources';
const ENV_FLAGS_KEY = 'mlEnvSourceFlags';
let sourcesCache: MlCustomSource[] | null = null;
let envFlagsCache: Record<string, Channel[]> | null = null;

export function invalidateMlSourcesCache(): void {
  sourcesCache = null;
  envFlagsCache = null;
}

/** Só canais conhecidos, na ordem canônica (evita lixo salvo no settings). */
function sanitizeChannels(values: readonly unknown[]): Channel[] {
  return CHANNELS.filter((channel) => values.includes(channel));
}

/** Adiciona/remove um canal preservando a ordem canônica. */
function withChannel(channels: readonly Channel[], channel: Channel, include: boolean): Channel[] {
  const set = new Set(channels);
  if (include) set.add(channel);
  else set.delete(channel);
  return CHANNELS.filter((c) => set.has(c));
}

/**
 * Converte o valor salvo em uma lista de canais, aceitando o formato antigo
 * (`enabled: boolean` / flag booleana): true → todos os canais, false → nenhum.
 * Assim configs gravadas antes da separação por canal continuam válidas.
 */
function coerceChannels(value: unknown): Channel[] {
  if (Array.isArray(value)) return sanitizeChannels(value);
  // Formato legado: booleano. undefined também cai aqui e vira "todos" (default ativo).
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

/** Canais de uma categoria do .env. Sem flag salva, alimenta todos por padrão. */
function getEnvCategoryChannels(category: string): Channel[] {
  const flags = envFlagsCache ?? {};
  return category in flags ? flags[category]! : [...CHANNELS];
}

function parseSourcesFromJson(raw: string): MlCustomSource[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];

  const sources: MlCustomSource[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!url) continue;

    // channels novo tem precedência; senão cai no enabled legado.
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

function deriveLabel(category: string): string {
  const validation = validateCategoryConfig(category);
  if (validation.listingKind === 'offers') {
    try {
      const parsed = new URL(category);
      const containerId = parsed.searchParams.get('container_id');
      if (containerId) return `Ofertas ${containerId}`;
      const dealIds = parsed.searchParams.get('deal_ids');
      if (dealIds) return `Ofertas ${dealIds}`;
      return 'Ofertas ML';
    } catch {
      return 'Ofertas ML';
    }
  }

  return category;
}

function normalizeCategoryKey(category: string): string {
  const validation = validateCategoryConfig(category);
  return validation.valid && validation.url ? validation.url : category.trim();
}

export function categoryJobKey(category: string): string {
  return normalizeCategoryKey(category)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 120);
}

export function getCustomMlSources(): MlCustomSource[] {
  return sourcesCache ?? [];
}

export function getEnvMlCategories(): string[] {
  return env.ML_CATEGORIES;
}

/** Fontes que alimentam pelo menos um canal — o que o collector precisa raspar. */
export function getActiveMlCategories(): string[] {
  const envActive = env.ML_CATEGORIES.filter(
    (category) => getEnvCategoryChannels(category).length > 0,
  );
  const custom = getCustomMlSources()
    .filter((source) => source.channels.length > 0)
    .map((source) => source.url.trim());
  return [...envActive, ...custom];
}

/** Fontes que alimentam um canal específico. */
export function getActiveMlCategoriesForChannel(channel: Channel): string[] {
  const envActive = env.ML_CATEGORIES.filter((category) =>
    getEnvCategoryChannels(category).includes(channel),
  );
  const custom = getCustomMlSources()
    .filter((source) => source.channels.includes(channel))
    .map((source) => source.url.trim());
  return [...envActive, ...custom];
}

/** União das fontes ativas nos canais dados — evita raspar fonte de canal desligado. */
export function getActiveMlCategoriesForChannels(channels: readonly Channel[]): string[] {
  const seen = new Set<string>();
  for (const channel of channels) {
    for (const category of getActiveMlCategoriesForChannel(channel)) {
      seen.add(category);
    }
  }
  return [...seen];
}

/**
 * Canais que uma categoria alimenta — usado no dispatch para saber para onde
 * enviar cada oferta com base na fonte de onde ela veio.
 */
export function getChannelsForCategory(category: string): Channel[] {
  const key = normalizeCategoryKey(category);

  for (const envCategory of env.ML_CATEGORIES) {
    if (normalizeCategoryKey(envCategory) === key) return getEnvCategoryChannels(envCategory);
  }

  const custom = getCustomMlSources().find((source) => normalizeCategoryKey(source.url) === key);
  return custom ? custom.channels : [];
}

export function buildMlCategoryRows(): MlCategoryRow[] {
  const envRows: MlCategoryRow[] = env.ML_CATEGORIES.map((category, index) => {
    const validation = validateCategoryConfig(category);
    return {
      id: `env:${index}`,
      label: category,
      category,
      channels: getEnvCategoryChannels(category),
      fromEnv: true,
      valid: validation.valid,
      type: validation.type,
      listingKind: validation.listingKind,
      reason: validation.reason,
    };
  });

  const customRows: MlCategoryRow[] = getCustomMlSources().map((source) => {
    const validation = validateCategoryConfig(source.url);
    return {
      id: source.id,
      label: source.label,
      category: source.url,
      channels: source.channels,
      fromEnv: false,
      valid: validation.valid,
      type: validation.type,
      listingKind: validation.listingKind,
      reason: validation.reason,
    };
  });

  return [...envRows, ...customRows];
}

export async function hydrateMlSourcesCache(): Promise<void> {
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

async function persistCustomSources(sources: MlCustomSource[]): Promise<void> {
  const json = JSON.stringify(sources);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: json },
    create: { key: SETTING_KEY, value: json },
  });
  sourcesCache = sources;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('ml-sources');
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
  await notifyConfigCacheChange('ml-sources');
}

export async function addCustomMlSource(
  url: string,
  label?: string,
  channels: Channel[] = [...CHANNELS],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe um link ou ID de categoria' };
  }

  const validation = validateCategoryConfig(trimmed);
  if (!validation.valid) {
    return { ok: false, error: validation.reason ?? 'Link ou categoria inválida' };
  }

  const normalized = validation.url || trimmed;
  const key = normalizeCategoryKey(normalized);
  const envKeys = new Set(env.ML_CATEGORIES.map((category) => normalizeCategoryKey(category)));
  if (envKeys.has(key)) {
    return { ok: false, error: 'Este link já está configurado no .env (ML_CATEGORIES)' };
  }

  const sources = [...getCustomMlSources()];
  if (sources.some((source) => normalizeCategoryKey(source.url) === key)) {
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

export async function removeCustomMlSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sources = getCustomMlSources();
  const next = sources.filter((source) => source.id !== id);
  if (next.length === sources.length) {
    return { ok: false, error: 'Link não encontrado' };
  }

  await persistCustomSources(next);
  return { ok: true };
}

/**
 * Salva a seleção de fontes de UM canal (página por canal). Só mexe na
 * pertinência daquele canal — a seleção dos outros canais é preservada, tanto
 * nas fontes extras quanto nas categorias do .env.
 */
export async function saveMlSourceChannelsFromForm(
  channel: Channel,
  form: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sources = getCustomMlSources().map((source) => ({
    ...source,
    channels: withChannel(source.channels, channel, form[`coletar_${source.id}`] === '1'),
  }));

  const flags: Record<string, Channel[]> = { ...(envFlagsCache ?? {}) };
  env.ML_CATEGORIES.forEach((category, index) => {
    const current = category in flags ? flags[category]! : [...CHANNELS];
    flags[category] = withChannel(current, channel, form[`coletar_env:${index}`] === '1');
  });

  await Promise.all([persistCustomSources(sources), persistEnvFlags(flags)]);
  return { ok: true };
}

/** Apenas para testes unitários. */
export function setMlSourcesCacheForTest(sources: MlCustomSource[] | null): void {
  sourcesCache = sources;
}

/** Apenas para testes unitários. */
export function setEnvFlagsCacheForTest(flags: Record<string, Channel[]> | null): void {
  envFlagsCache = flags;
}
