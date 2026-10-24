import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it, mock } from 'node:test';

import { stubEnv } from '../test/env-stub.js';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const listingHtml = readFileSync(join(fixtureDir, 'fixtures/ofertas-card.html'), 'utf8');

stubEnv({
  AFFILIATE_CONFIG: { tag: 'test-tag', baseUrl: 'https://www.mercadolivre.com.br' },
  ML_USE_BROWSER_FALLBACK: false,
});

const originalFetch = globalThis.fetch;

describe('http-scraper — integração com fetch mockado', () => {
  before(() => {
    mock.method(globalThis, 'fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('mercadolivre.com.br')) {
        return new Response(listingHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return originalFetch(input);
    });
  });

  after(() => {
    mock.restoreAll();
  });

  it('fetchCategoryViaHttp parseia produtos do HTML fixture', async () => {
    const { fetchCategoryViaHttp } = await import('./http-scraper.js');
    const items = await fetchCategoryViaHttp('MLB1648');

    assert.ok(items.length >= 1);
    assert.equal(items[0]?.id, 'MLB32396130');
    assert.ok(items[0]?.price > 0);
    assert.ok(items[0]?.title.length > 0);
  });

  it('fetchSingleCategoryPage retorna itens da primeira página', async () => {
    const { fetchSingleCategoryPage } = await import('./http-scraper.js');
    const { validateCategoryConfig } = await import('./category-url.js');
    const validation = validateCategoryConfig('MLB1648');
    assert.equal(validation.valid, true);
    if (!validation.valid) return;

    const items = await fetchSingleCategoryPage(validation.url, 0);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, 'MLB32396130');
  });
});
