import { env } from './env.js';
import { prisma } from '../database/client.js';

export interface ScoreTier {
  enabled: boolean;
  threshold: number;
  points: number;
}

export interface ScoreCategory {
  enabled: boolean;
  /** Se true, soma todos os tiers que baterem (ex.: preço). */
  cumulative: boolean;
  tiers: ScoreTier[];
}

export interface ScoreConfig {
  minScore: number;
  discount: ScoreCategory;
  rating: ScoreCategory;
  soldQuantity: ScoreCategory;
  price: ScoreCategory;
}

export const SCORE_CATEGORY_KEYS = ['discount', 'rating', 'soldQuantity', 'price'] as const;
export type ScoreCategoryKey = (typeof SCORE_CATEGORY_KEYS)[number];

export const SCORE_CATEGORY_LABELS: Record<ScoreCategoryKey, string> = {
  discount: 'Desconto',
  rating: 'Avaliação',
  soldQuantity: 'Quantidade de vendas',
  price: 'Preço',
};

function defaultMinScore(): number {
  return env.QUEUE_CONFIG.minScore;
}

function buildDefaultScoreConfig(): ScoreConfig {
  return {
    minScore: defaultMinScore(),
    discount: {
      enabled: true,
      cumulative: false,
      tiers: [
        { enabled: true, threshold: 30, points: 30 },
        { enabled: true, threshold: 20, points: 20 },
        { enabled: true, threshold: 10, points: 10 },
      ],
    },
    rating: {
      enabled: true,
      cumulative: false,
      tiers: [
        { enabled: true, threshold: 4.5, points: 20 },
        { enabled: true, threshold: 4.0, points: 10 },
      ],
    },
    soldQuantity: {
      enabled: true,
      cumulative: false,
      tiers: [
        { enabled: true, threshold: 100, points: 20 },
        { enabled: true, threshold: 50, points: 10 },
      ],
    },
    price: {
      enabled: true,
      cumulative: true,
      tiers: [
        { enabled: true, threshold: 5000, points: 15 },
        { enabled: true, threshold: 2500, points: 10 },
      ],
    },
  };
}

export function getDefaultScoreConfig(): ScoreConfig {
  return buildDefaultScoreConfig();
}

/** @deprecated Use getDefaultScoreConfig() para acesso lazy. */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = new Proxy({} as ScoreConfig, {
  get(_, prop) {
    return (buildDefaultScoreConfig() as unknown as Record<string | symbol, unknown>)[prop];
  },
  has(_, prop) {
    return prop in buildDefaultScoreConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(buildDefaultScoreConfig());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Object.getOwnPropertyDescriptor(buildDefaultScoreConfig(), prop);
  },
});

const SETTING_KEY = 'scoreConfig';
let scoreCache: ScoreConfig | null = null;

export function invalidateScoreConfigCache(): void {
  scoreCache = null;
}

function mergeTier(defaultTier: ScoreTier, override?: Partial<ScoreTier>): ScoreTier {
  return {
    enabled: override?.enabled ?? defaultTier.enabled,
    threshold: override?.threshold ?? defaultTier.threshold,
    points: override?.points ?? defaultTier.points,
  };
}

function mergeCategory(
  defaultCategory: ScoreCategory,
  override?: Partial<ScoreCategory>,
): ScoreCategory {
  const tiers = defaultCategory.tiers.map((tier, index) =>
    mergeTier(tier, override?.tiers?.[index]),
  );
  return {
    enabled: override?.enabled ?? defaultCategory.enabled,
    cumulative: override?.cumulative ?? defaultCategory.cumulative,
    tiers,
  };
}

function mergeScoreConfig(override: Partial<ScoreConfig>): ScoreConfig {
  const defaults = buildDefaultScoreConfig();
  return {
    minScore: override.minScore ?? defaults.minScore,
    discount: mergeCategory(defaults.discount, override.discount),
    rating: mergeCategory(defaults.rating, override.rating),
    soldQuantity: mergeCategory(defaults.soldQuantity, override.soldQuantity),
    price: mergeCategory(defaults.price, override.price),
  };
}

async function loadFromDb(): Promise<Partial<ScoreConfig>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return {};
    return JSON.parse(row.value) as Partial<ScoreConfig>;
  } catch {
    return {};
  }
}

export function getRuntimeScoreConfig(): ScoreConfig {
  if (scoreCache) return scoreCache;
  return { ...DEFAULT_SCORE_CONFIG, minScore: defaultMinScore() };
}

export async function getRuntimeScoreConfigAsync(): Promise<ScoreConfig> {
  if (scoreCache) return scoreCache;
  const override = await loadFromDb();
  scoreCache = mergeScoreConfig(override);
  return scoreCache;
}

export async function hydrateScoreConfigCache(): Promise<void> {
  const override = await loadFromDb();
  scoreCache = mergeScoreConfig(override);
}

function parseBool(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

function parseNumber(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Valor inválido em ${label}`);
  }
  return parsed;
}

function parseTierFromForm(
  form: Record<string, string>,
  category: ScoreCategoryKey,
  index: number,
): ScoreTier {
  const prefix = `${category}Tier${index}`;
  const threshold = parseNumber(
    form[`${prefix}Threshold`],
    `${SCORE_CATEGORY_LABELS[category]} — faixa ${index + 1}`,
  );
  const points = parseNumber(
    form[`${prefix}Points`],
    `${SCORE_CATEGORY_LABELS[category]} — pontos ${index + 1}`,
  );

  if (points < 0 || !Number.isInteger(points)) {
    throw new Error(`Pontos devem ser um inteiro ≥ 0 (${SCORE_CATEGORY_LABELS[category]})`);
  }

  if (category === 'discount' && (threshold < 0 || threshold > 100)) {
    throw new Error('Desconto deve estar entre 0% e 100%');
  }

  if (category === 'rating' && (threshold < 0 || threshold > 5)) {
    throw new Error('Avaliação deve estar entre 0 e 5');
  }

  if ((category === 'soldQuantity' || category === 'price') && threshold < 0) {
    throw new Error(`${SCORE_CATEGORY_LABELS[category]} deve ser ≥ 0`);
  }

  return {
    enabled: parseBool(form[`${prefix}Enabled`]),
    threshold,
    points: Math.trunc(points),
  };
}

export function parseScoreConfigFromForm(form: Record<string, string>): ScoreConfig {
  const current = getRuntimeScoreConfig();
  const minScore = parseNumber(form.minScore, 'Score mínimo');

  if (minScore < 0 || !Number.isInteger(minScore)) {
    throw new Error('Score mínimo deve ser um inteiro ≥ 0');
  }

  const categories = {} as Record<ScoreCategoryKey, ScoreCategory>;

  for (const key of SCORE_CATEGORY_KEYS) {
    const defaultCategory = current[key];
    const tiers = defaultCategory.tiers.map((_tier, index) => parseTierFromForm(form, key, index));
    categories[key] = {
      enabled: parseBool(form[`${key}Enabled`]),
      cumulative: defaultCategory.cumulative,
      tiers,
    };
  }

  return {
    minScore: Math.trunc(minScore),
    discount: categories.discount,
    rating: categories.rating,
    soldQuantity: categories.soldQuantity,
    price: categories.price,
  };
}

export async function saveScoreConfig(config: ScoreConfig): Promise<void> {
  const json = JSON.stringify(config);
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: json },
    create: { key: SETTING_KEY, value: json },
  });
  scoreCache = config;
  const { notifyConfigCacheChange } = await import('../utils/config-cache-sync.js');
  await notifyConfigCacheChange('score-config');
}

export function calculateOfferScore(
  offer: {
    discount: number | null;
    rating: number | null;
    soldQuantity: number | null;
    price: number;
  },
  config: ScoreConfig = getRuntimeScoreConfig(),
): number {
  let score = 0;

  if (config.discount.enabled && offer.discount !== null) {
    score += applyTiers(offer.discount, config.discount, (value, threshold) => value >= threshold);
  }

  if (config.rating.enabled && offer.rating !== null) {
    score += applyTiers(offer.rating, config.rating, (value, threshold) => value >= threshold);
  }

  if (config.soldQuantity.enabled && offer.soldQuantity !== null) {
    score += applyTiers(
      offer.soldQuantity,
      config.soldQuantity,
      (value, threshold) => value >= threshold,
    );
  }

  if (config.price.enabled) {
    score += applyTiers(offer.price, config.price, (value, threshold) => value <= threshold);
  }

  return score;
}

function applyTiers(
  value: number,
  category: ScoreCategory,
  matches: (value: number, threshold: number) => boolean,
): number {
  let points = 0;

  for (const tier of category.tiers) {
    if (!tier.enabled || !matches(value, tier.threshold)) continue;

    points += tier.points;
    if (!category.cumulative) break;
  }

  return points;
}

function formatThreshold(category: ScoreCategoryKey, threshold: number): string {
  if (category === 'discount') return `≥ ${threshold}%`;
  if (category === 'rating')
    return `≥ ${threshold.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  if (category === 'soldQuantity') return `≥ ${threshold} un.`;
  return `≤ R$ ${threshold.toLocaleString('pt-BR')}`;
}

export function describeScoreRules(config: ScoreConfig = getRuntimeScoreConfig()): string[] {
  const lines: string[] = [];

  for (const key of SCORE_CATEGORY_KEYS) {
    const category = config[key];
    if (!category.enabled) continue;

    const activeTiers = category.tiers.filter((tier) => tier.enabled);
    if (activeTiers.length === 0) continue;

    const tierLines = activeTiers
      .map((tier) => `${formatThreshold(key, tier.threshold)} → +${tier.points} pts`)
      .join(' · ');

    lines.push(`${SCORE_CATEGORY_LABELS[key]}: ${tierLines}`);
  }

  return lines;
}
