import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  buildCreateLinkBodies,
  extractLinkFromResponse,
  generateAffiliateLink,
} from './affiliate-link.js';
import { saveStorageState, setMlAuthPath } from './session.js';

const originalFetch = globalThis.fetch;
const originalAuthPath = process.env.ML_AUTH_PATH;
let tempAuthDir = '';

beforeEach(async () => {
  tempAuthDir = await mkdtemp(path.join(tmpdir(), 'ml-auth-test-'));
  setMlAuthPath(tempAuthDir);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalAuthPath) {
    setMlAuthPath(originalAuthPath);
  }
  if (tempAuthDir) {
    await rm(tempAuthDir, { recursive: true, force: true });
  }
});

describe('extractLinkFromResponse', () => {
  it('extrai short_url de item único', () => {
    const result = extractLinkFromResponse({
      short_url: 'https://mercadolivre.com/sec/abc123',
      url: 'https://produto.mercadolivre.com.br/MLB123',
    });
    assert.ok(result);
    assert.equal(result.shortUrl, 'https://mercadolivre.com/sec/abc123');
    assert.equal(result.source, 'http');
  });

  it('extrai de array urls ignorando erros', () => {
    const result = extractLinkFromResponse({
      urls: [
        { error_code: 'NOT_ALLOWED', message: 'not allowed' },
        { shortUrl: 'https://meli.la/xyz' },
      ],
    });
    assert.ok(result);
    assert.equal(result.shortUrl, 'https://meli.la/xyz');
  });

  it('retorna null quando não há link', () => {
    assert.equal(extractLinkFromResponse({ urls: [{ error_code: 'X' }] }), null);
    assert.equal(extractLinkFromResponse({}), null);
  });
});

describe('buildCreateLinkBodies', () => {
  it('gera variações de payload createLink', () => {
    const bodies = buildCreateLinkBodies('https://produto.mercadolivre.com.br/MLB1', 'minha-tag');
    assert.ok(bodies.length >= 3);
    assert.ok(bodies.some((body) => body.url === 'https://produto.mercadolivre.com.br/MLB1'));
    assert.ok(bodies.every((body) => body.tag === 'minha-tag'));
  });
});

describe('generateAffiliateLink', () => {
  it('usa fallback quando sessão ausente', async () => {
    const link = await generateAffiliateLink(
      'https://www.mercadolivre.com.br/MLB-FALLBACK-1',
      'MLB-FALLBACK-1',
      0,
      { allowBrowser: false, tag: 'tag-fallback' },
    );
    assert.match(link, /matt_tool=tag-fallback/);
    assert.match(link, /MLB-FALLBACK-1/);
  });

  it('gera link via HTTP createLink quando sessão válida', async () => {
    await saveStorageState({
      cookies: [
        {
          name: 'ssid',
          value: 'test-session',
          domain: '.mercadolivre.com.br',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    });

    globalThis.fetch = async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
      if (url.includes('createLink')) {
        return new Response(
          JSON.stringify({ short_url: 'https://mercadolivre.com/sec/http-generated' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('link-builder')) {
        return new Response('<html></html>', { status: 200 });
      }
      return originalFetch(input);
    };

    const link = await generateAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-HTTP-1',
      'MLB-HTTP-1',
      0,
      { allowBrowser: false, tag: 'tag-teste' },
    );

    assert.equal(link, 'https://mercadolivre.com/sec/http-generated');
  });
});
