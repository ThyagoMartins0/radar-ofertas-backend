import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAmazonAffiliateLink } from './affiliate-link.js';
import { EXAMPLE_AMAZON_ASIN, EXAMPLE_AMAZON_PRODUCT_URL } from './types.js';
import { extractAmazonAsin } from './url.js';

describe('extractAmazonAsin', () => {
  it('extrai ASIN de URL /dp/', () => {
    assert.equal(extractAmazonAsin(EXAMPLE_AMAZON_PRODUCT_URL), EXAMPLE_AMAZON_ASIN);
  });

  it('aceita ASIN puro', () => {
    assert.equal(extractAmazonAsin('B08A3I0FA9'), 'B08A3I0FA9');
  });

  it('extrai de link.amazon (legado inválido)', () => {
    assert.equal(extractAmazonAsin('https://link.amazon/B08A3I0FA9'), 'B08A3I0FA9');
  });
});

describe('buildAmazonAffiliateLink', () => {
  it('monta link com tag da loja a partir da URL do produto', () => {
    const result = buildAmazonAffiliateLink(EXAMPLE_AMAZON_PRODUCT_URL, {
      affiliateLinkPrefix: '',
      baseUrl: 'https://www.amazon.com.br/',
      storeId: 'mercadaodasfa-20',
    });
    assert.equal(result.asin, EXAMPLE_AMAZON_ASIN);
    assert.equal(
      result.url,
      `https://www.amazon.com.br/dp/${EXAMPLE_AMAZON_ASIN}?tag=mercadaodasfa-20`,
    );
    assert.equal(result.source, 'store_tag');
  });

  it('prioriza tag da loja mesmo com prefixo link.amazon configurado', () => {
    const result = buildAmazonAffiliateLink(EXAMPLE_AMAZON_PRODUCT_URL, {
      affiliateLinkPrefix: 'https://link.amazon/',
      baseUrl: 'https://www.amazon.com.br/',
      storeId: 'mercadaodasfa-20',
    });
    assert.equal(result.asin, EXAMPLE_AMAZON_ASIN);
    assert.equal(
      result.url,
      `https://www.amazon.com.br/dp/${EXAMPLE_AMAZON_ASIN}?tag=mercadaodasfa-20`,
    );
    assert.equal(result.source, 'store_tag');
  });

  it('usa prefixo customizado apenas quando não há storeId', () => {
    const result = buildAmazonAffiliateLink(EXAMPLE_AMAZON_PRODUCT_URL, {
      affiliateLinkPrefix: 'https://go.minhaloja.com/',
      baseUrl: 'https://www.amazon.com.br/',
      storeId: '',
    });
    assert.equal(result.url, `https://go.minhaloja.com/${EXAMPLE_AMAZON_ASIN}`);
    assert.equal(result.source, 'prefix');
  });

  it('falha sem storeId e sem prefixo válido', () => {
    assert.throws(
      () =>
        buildAmazonAffiliateLink(EXAMPLE_AMAZON_PRODUCT_URL, {
          affiliateLinkPrefix: 'https://link.amazon/',
          baseUrl: 'https://www.amazon.com.br/',
          storeId: '',
        }),
      /ID da loja Amazon/,
    );
  });
});
