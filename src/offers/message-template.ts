import { getBrandName } from '../config/brand-config.js';
import { prisma } from '../database/client.js';
import { detectOfferPlatform } from './platform.js';
import type { OfferRecord } from './types.js';
import type { OfferPlatform } from './platform.js';

export const MESSAGE_PLACEHOLDERS = [
  { key: 'brand', label: 'Nome do seu canal', example: 'Radar Ofertas' },
  { key: 'name', label: 'Nome do produto', example: 'Fone Bluetooth XYZ' },
  { key: 'price', label: 'Preço formatado', example: 'R$ 89,90 (de R$ 129,90)' },
  { key: 'discount', label: 'Desconto anunciado', example: '41% OFF' },
  { key: 'avalia', label: 'Avaliação', example: '4.8 ⭐' },
  { key: 'qty_sold', label: 'Quantidade vendida', example: '1.234 vendidos' },
  { key: 'best_seller', label: 'Selo de mais vendido', example: '🏆 MAIS VENDIDO' },
  { key: 'top_sold', label: 'Ranking de vendas', example: '4º em Impressoras' },
  { key: 'store', label: 'Vendedor no Mercado Livre', example: 'Mega Mamute ✅ Loja oficial' },
  {
    key: 'product_link',
    label: 'Link de compra (afiliado)',
    example: 'https://mercadolivre.com/sec/abc123',
  },
] as const;

export type MessagePlaceholderKey = (typeof MESSAGE_PLACEHOLDERS)[number]['key'];

export type PlaceholderVisibility = Record<MessagePlaceholderKey, boolean>;

export const DEFAULT_PLACEHOLDER_VISIBILITY: PlaceholderVisibility = {
  brand: true,
  name: true,
  price: true,
  discount: true,
  avalia: true,
  qty_sold: true,
  best_seller: true,
  top_sold: true,
  store: true,
  product_link: true,
};

export const DEFAULT_MESSAGE_TEMPLATE = `🔥 OFERTA IMPERDÍVEL! - 🏪 {{brand}}

{{name}}

💰 {{price}}  🏷️ {{discount}}

⭐ {{avalia}}

📦 {{qty_sold}}{{top_sold}}

{{best_seller}}

🏬 {{store}}

🛒 Compre aqui:
{{product_link}}`;

const KEYS = {
  template: 'messageTemplate',
  placeholders: 'messageTemplatePlaceholders',
} as const;

let templateCache: string | null = null;
let placeholderCache: PlaceholderVisibility | null = null;

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatOfferPrice(offer: Pick<OfferRecord, 'price' | 'oldPrice'>): string {
  const oldPrice = offer.oldPrice;
  const showOldPrice = oldPrice != null && oldPrice > offer.price;
  if (showOldPrice) {
    return `${formatCurrency(offer.price)} (de ${formatCurrency(oldPrice)})`;
  }
  return formatCurrency(offer.price);
}

export function formatOfferRating(
  rating: number | null,
  platform: OfferPlatform = 'unknown',
  reviewsCount: number | null = null,
): string {
  if (rating === null) return 'Sem avaliação';

  if (platform === 'amazon') {
    const ratingText = `${rating.toFixed(1).replace('.', ',')} de 5 estrelas`;
    if (reviewsCount !== null && reviewsCount > 0) {
      return `${ratingText} (${reviewsCount.toLocaleString('pt-BR')})`;
    }
    return ratingText;
  }

  return `${rating.toFixed(1)} ⭐`;
}

export function parseAmazonReviewsCount(salesRank: string | null): number | null {
  if (!salesRank?.trim()) return null;
  const digits = salesRank.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function formatSoldQuantity(
  soldQuantity: number | null,
  platform: OfferPlatform = 'unknown',
): string {
  if (soldQuantity === null || soldQuantity <= 0) return 'Sem dados de vendas';

  if (platform === 'amazon') {
    if (soldQuantity >= 1000) {
      const thousands = soldQuantity / 1000;
      const label = Number.isInteger(thousands)
        ? `${thousands} mil`
        : `${thousands.toFixed(1).replace('.', ',')} mil`;
      return `Mais de ${label} compras no mês passado`;
    }
    return `Mais de ${soldQuantity.toLocaleString('pt-BR')} compras no mês passado`;
  }

  return `${soldQuantity.toLocaleString('pt-BR')} vendidos`;
}

/** Percentual anunciado pelo ML ("41% OFF"). Vazio quando a oferta não tem desconto. */
export function formatDiscount(discount: number | null): string {
  if (discount === null || discount <= 0) return '';
  return `${discount}% OFF`;
}

/** Vazio quando o card não traz vendedor — a linha some via cleanupRenderedMessage. */
export function formatSeller(seller: string | null, officialStore = false): string {
  const name = seller?.trim();
  if (!name) return '';
  return officialStore ? `${name} ✅ Loja oficial` : name;
}

export function formatBestSeller(bestSeller: boolean): string {
  return bestSeller ? '🏆 MAIS VENDIDO' : '';
}

export function formatTopSoldLabel(salesRank: string | null): string {
  if (!salesRank?.trim()) return '';

  const raw = salesRank.trim();
  if (raw.includes(' - ')) return raw;

  const parts: string[] = [];

  const rankMatch = raw.match(
    /(\d{1,3}\s*[ºª°]\s*em\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s/&+-]*?)(?=Chegará|Disponível|$)/i,
  );
  if (rankMatch?.[1]) {
    parts.push(rankMatch[1].trim());
  }

  const shippingMatch = raw.match(/Chegará grátis\s+(?:amanhã|hoje|em\s+\d+\s+dias?)/i);
  if (shippingMatch) parts.push(shippingMatch[0].trim());

  const installmentMatch = raw.match(/Disponível em\s+\d+/i);
  if (installmentMatch) {
    parts.push(`${installmentMatch[0].trim()}x`);
  }

  if (parts.length > 0) return parts.join(' - ');

  return raw;
}

export interface MessageTemplateValues {
  brand: string;
  name: string;
  price: string;
  discount: string;
  avalia: string;
  qty_sold: string;
  best_seller: string;
  top_sold: string;
  store: string;
  product_link: string;
}

export function buildTemplateValues(offer: OfferRecord): MessageTemplateValues {
  const platform = detectOfferPlatform(offer);
  const reviewsCount =
    platform === 'amazon' ? parseAmazonReviewsCount(offer.salesRank) : null;

  return {
    brand: getBrandName(),
    name: offer.title,
    price: formatOfferPrice(offer),
    discount: formatDiscount(offer.discount),
    avalia: formatOfferRating(offer.rating, platform, reviewsCount),
    qty_sold: formatSoldQuantity(offer.soldQuantity, platform),
    best_seller: formatBestSeller(offer.bestSeller),
    top_sold: platform === 'amazon' ? '' : formatTopSoldLabel(offer.salesRank),
    store: formatSeller(offer.seller, offer.officialStore),
    product_link: offer.affiliateLink ?? '',
  };
}

export function cleanupRenderedMessage(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return true;
      return /[A-Za-z0-9À-ÿ$]/.test(trimmed);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderMessageTemplate(
  template: string,
  values: MessageTemplateValues,
  visibility: PlaceholderVisibility = DEFAULT_PLACEHOLDER_VISIBILITY,
): string {
  const rendered = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    if (!(key in values)) return match;

    const placeholderKey = key as MessagePlaceholderKey;
    if (!visibility[placeholderKey]) return '';

    return values[placeholderKey];
  });

  return cleanupRenderedMessage(rendered);
}

export function formatOfferMessageFromTemplate(
  template: string,
  offer: OfferRecord,
  visibility: PlaceholderVisibility = DEFAULT_PLACEHOLDER_VISIBILITY,
): string {
  return renderMessageTemplate(template, buildTemplateValues(offer), visibility);
}

// --- Placeholder Visibility ---

function mergePlaceholderVisibility(
  override: Partial<PlaceholderVisibility> | undefined,
): PlaceholderVisibility {
  const merged = { ...DEFAULT_PLACEHOLDER_VISIBILITY };
  if (!override) return merged;

  for (const placeholder of MESSAGE_PLACEHOLDERS) {
    if (override[placeholder.key] !== undefined) {
      merged[placeholder.key] = override[placeholder.key]!;
    }
  }

  return merged;
}

export function loadPlaceholderVisibilitySync(): PlaceholderVisibility {
  return placeholderCache ?? { ...DEFAULT_PLACEHOLDER_VISIBILITY };
}

export async function loadPlaceholderVisibility(): Promise<PlaceholderVisibility> {
  if (placeholderCache) return placeholderCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEYS.placeholders } });
    if (row) {
      const parsed = JSON.parse(row.value) as Partial<PlaceholderVisibility>;
      placeholderCache = mergePlaceholderVisibility(parsed);
      return placeholderCache;
    }
  } catch {
    /* fallback */
  }
  return { ...DEFAULT_PLACEHOLDER_VISIBILITY };
}

export async function savePlaceholderVisibility(visibility: PlaceholderVisibility): Promise<void> {
  const json = JSON.stringify(visibility);
  await prisma.setting.upsert({
    where: { key: KEYS.placeholders },
    update: { value: json },
    create: { key: KEYS.placeholders, value: json },
  });
  placeholderCache = visibility;
}

export function parsePlaceholderVisibilityFromForm(
  form: Record<string, string>,
): PlaceholderVisibility {
  const visibility = {} as PlaceholderVisibility;

  for (const placeholder of MESSAGE_PLACEHOLDERS) {
    const enabled = form[`placeholder_${placeholder.key}`] === '1';
    visibility[placeholder.key] = enabled;
  }

  return visibility;
}

// --- Message Template ---

export async function loadMessageTemplate(): Promise<string> {
  if (templateCache) return templateCache;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEYS.template } });
    if (row) {
      const trimmed = row.value.trim();
      if (trimmed) {
        templateCache = trimmed;
        return trimmed;
      }
    }
  } catch {
    /* fallback */
  }
  return DEFAULT_MESSAGE_TEMPLATE;
}

export async function saveMessageTemplate(template: string): Promise<void> {
  const trimmed = template.trim();
  if (!trimmed) {
    throw new Error('O template não pode ficar vazio');
  }

  await prisma.setting.upsert({
    where: { key: KEYS.template },
    update: { value: trimmed },
    create: { key: KEYS.template, value: trimmed },
  });
  templateCache = trimmed;
}

export async function hydrateTemplateCache(): Promise<void> {
  await Promise.all([loadMessageTemplate(), loadPlaceholderVisibility()]);
}

export function sampleTemplateValues(): MessageTemplateValues {
  return {
    brand: getBrandName(),
    name: 'Fone Bluetooth XYZ Pro',
    price: 'R$ 89,90 (de R$ 129,90)',
    discount: '31% OFF',
    avalia: '4.8 ⭐',
    qty_sold: '1.234 vendidos',
    best_seller: '🏆 MAIS VENDIDO',
    top_sold: '4º em Impressoras',
    store: 'Mega Mamute ✅ Loja oficial',
    product_link: 'https://mercadolivre.com/sec/exemplo123',
  };
}
