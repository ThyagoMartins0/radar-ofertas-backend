import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stubEnv } from '../test/env-stub.js';

stubEnv({
  AFFILIATE_CONFIG: { tag: '', baseUrl: 'https://www.mercadolivre.com.br' },
  REDIS_ENABLED: false,
});

describe('validateOfferCollectionReady', () => {
  it('falha quando Redis está desabilitado', async () => {
    const { validateOfferCollectionReady } = await import('./service.js');
    const message = await validateOfferCollectionReady();
    assert.match(message ?? '', /Redis desabilitado/i);
  });
});

describe('collectFromSource — guarda ML sem tag', () => {
  it('ignora fonte ML quando tag de afiliado não está configurada', async () => {
    const { collectFromSource } = await import('./service.js');
    const result = await collectFromSource('whatsapp', 'MLB1648', 10);
    assert.deepEqual(result, { total: 0, enqueued: 0 });
  });
});
