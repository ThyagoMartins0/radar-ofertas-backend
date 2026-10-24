import { DEFAULT_AMAZON_BASE_URL } from './types.js';
import { extractAmazonAsin, isAmazonHostname } from './url.js';

export type AmazonSourceKind = 'browse_node' | 'search' | 'product' | 'unknown';

export interface AmazonSourceValidation {
  valid: boolean;
  url: string;
  kind: AmazonSourceKind;
  reason?: string;
}

function normalizeAmazonUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = DEFAULT_AMAZON_BASE_URL.replace(/\/$/, '');
  if (trimmed.startsWith('/')) return `${base}${trimmed}`;
  return `${base}/${trimmed}`;
}

function detectKind(parsed: URL): AmazonSourceKind {
  if (/\/b\/node\/\d+/i.test(parsed.pathname)) return 'browse_node';
  if (/\/s\?/i.test(`${parsed.pathname}${parsed.search}`) || parsed.pathname === '/s')
    return 'search';
  if (extractAmazonAsin(parsed.toString())) return 'product';
  return 'unknown';
}

export function isAmazonSourceUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  if (extractAmazonAsin(trimmed)) return true;

  try {
    const url = normalizeAmazonUrl(trimmed);
    const parsed = new URL(url);
    return isAmazonHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateAmazonSourceConfig(input: string): AmazonSourceValidation {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, url: '', kind: 'unknown', reason: 'Informe um link Amazon' };
  }

  const asin = extractAmazonAsin(trimmed);
  if (asin) {
    const url = normalizeAmazonUrl(trimmed);
    return { valid: true, url, kind: 'product' };
  }

  let url: string;
  try {
    url = normalizeAmazonUrl(trimmed);
    const parsed = new URL(url);
    if (!isAmazonHostname(parsed.hostname)) {
      return { valid: false, url: '', kind: 'unknown', reason: 'Domínio não é Amazon' };
    }

    const kind = detectKind(parsed);
    if (kind === 'unknown') {
      return {
        valid: false,
        url,
        kind,
        reason: 'Link Amazon não suportado — use browse node (/b/node/), busca (/s?) ou produto (/dp/)',
      };
    }

    return { valid: true, url, kind };
  } catch {
    return { valid: false, url: '', kind: 'unknown', reason: 'URL inválida' };
  }
}

export function buildAmazonPaginatedUrl(baseUrl: string, page: number): string {
  if (page <= 1) return baseUrl;

  const parsed = new URL(baseUrl);
  parsed.searchParams.set('page', String(page));
  return parsed.toString();
}

export function normalizeAmazonSourceKey(source: string): string {
  const validation = validateAmazonSourceConfig(source);
  if (!validation.valid) return source.trim();

  if (validation.kind === 'product') {
    const asin = extractAmazonAsin(validation.url);
    if (asin) return `https://www.amazon.com.br/dp/${asin}`;
  }

  const parsed = new URL(validation.url);
  parsed.hash = '';
  const page = parsed.searchParams.get('page');
  if (page === '1') parsed.searchParams.delete('page');
  return parsed.toString();
}

export function amazonSourceJobKey(source: string): string {
  return normalizeAmazonSourceKey(source)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 120);
}
