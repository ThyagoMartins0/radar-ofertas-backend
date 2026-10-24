const ASIN_PATTERN = /\b([A-Z0-9]{10})\b/i;

const PRODUCT_PATH_PATTERNS = [
  /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
];

function normalizeAsinCandidate(value: string): string | null {
  const upper = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(upper) ? upper : null;
}

/** Extrai o ASIN de uma URL de produto Amazon (.com.br ou outros TLDs). */
export function extractAmazonAsin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = normalizeAsinCandidate(trimmed);
  if (direct) return direct;

  for (const pattern of PRODUCT_PATH_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }

  const pathAsin = trimmed.match(ASIN_PATTERN);
  if (pathAsin?.[1] && /\/dp\/|\/gp\/product\/|\/product\//i.test(trimmed)) {
    return pathAsin[1].toUpperCase();
  }

  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://www.amazon.com.br${url.startsWith('/') ? '' : '/'}${url}`;
  }

  try {
    const parsed = new URL(url);

    if (/^link\.amazon$/i.test(parsed.hostname)) {
      const segment = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
      return normalizeAsinCandidate(segment);
    }

    if (!/amazon\./i.test(parsed.hostname)) {
      return null;
    }

    for (const pattern of PRODUCT_PATH_PATTERNS) {
      const match = parsed.pathname.match(pattern);
      if (match?.[1]) return match[1].toUpperCase();
    }

    const pathnameMatch = parsed.pathname.match(ASIN_PATTERN);
    if (pathnameMatch?.[1]) return pathnameMatch[1].toUpperCase();
  } catch {
    return null;
  }

  return null;
}

export function isAmazonProductUrl(input: string): boolean {
  return extractAmazonAsin(input) !== null;
}

/** ASIN de 10 caracteres alfanuméricos (sem URL). */
export function isAmazonAsin(productId: string): boolean {
  return normalizeAsinCandidate(productId) !== null;
}

export function isAmazonHostname(hostname: string): boolean {
  return /(^|\.)amazon\./i.test(hostname);
}
