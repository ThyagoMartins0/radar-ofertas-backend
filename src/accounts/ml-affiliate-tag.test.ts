import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveMercadoLivreAffiliateTagFromConfig } from './ml-affiliate-tag.js';
import { stubEnv, restoreEnv } from '../test/env-stub.js';

describe('resolveMercadoLivreAffiliateTagFromConfig', () => {
  it('prioriza tag da conta sobre AFFILIATE_CONFIG', () => {
    stubEnv({ AFFILIATE_CONFIG: { tag: 'env-tag', baseUrl: 'https://www.mercadolivre.com.br' } });
    assert.equal(
      resolveMercadoLivreAffiliateTagFromConfig({
        authPath: './data/ml_auth',
        affiliateTag: 'conta-tag',
      }),
      'conta-tag',
    );
    restoreEnv();
  });

  it('usa AFFILIATE_CONFIG quando conta não tem tag', () => {
    stubEnv({ AFFILIATE_CONFIG: { tag: 'env-tag', baseUrl: 'https://www.mercadolivre.com.br' } });
    assert.equal(
      resolveMercadoLivreAffiliateTagFromConfig({ authPath: './data/ml_auth', affiliateTag: '' }),
      'env-tag',
    );
    restoreEnv();
  });
});

describe('isMercadoLivreAffiliateTagConfigured', () => {
  it('retorna false sem tag na conta nem no env', async () => {
    stubEnv({ AFFILIATE_CONFIG: { tag: '', baseUrl: 'https://www.mercadolivre.com.br' } });
    const { isMercadoLivreAffiliateTagConfigured } = await import('./ml-affiliate-tag.js');
    assert.equal(await isMercadoLivreAffiliateTagConfigured('conta-sem-db'), false);
    restoreEnv();
  });
});
