import { DEFAULT_AMAZON_BASE_URL } from '../amazon/types.js';

/** Normaliza o termo para path de busca do Mercado Livre. */
export function slugifyMlProductQuery(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Monta URLs de listagem ML + Amazon a partir do nome do produto.
 * Usado na coleta manual do painel quando o usuário informa um termo.
 */
export function buildProductSearchSources(
  productName: string,
  amazonBaseUrl = DEFAULT_AMAZON_BASE_URL,
): string[] {
  const trimmed = productName.trim();
  if (!trimmed) return [];

  const sources: string[] = [];
  const mlSlug = slugifyMlProductQuery(trimmed);
  if (mlSlug) {
    sources.push(`https://lista.mercadolivre.com.br/${mlSlug}`);
  }

  try {
    const base = new URL(amazonBaseUrl);
    base.pathname = '/s';
    base.search = '';
    base.hash = '';
    base.searchParams.set('k', trimmed);
    sources.push(base.toString());
  } catch {
    sources.push(
      `https://www.amazon.com.br/s?k=${encodeURIComponent(trimmed)}`,
    );
  }

  return sources;
}
