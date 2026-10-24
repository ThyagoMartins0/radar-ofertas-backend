import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectOfferPlatform, offerPlatformLabel } from './platform.js';

describe('detectOfferPlatform', () => {
  it('identifica Mercado Livre pelo ID', () => {
    assert.equal(
      detectOfferPlatform({
        mercadoLivreId: 'MLB1234567890',
        permalink: 'https://www.mercadolivre.com.br/produto',
      }),
      'mercado_livre',
    );
  });

  it('identifica Amazon pelo ASIN', () => {
    assert.equal(
      detectOfferPlatform({
        mercadoLivreId: 'B01LKZ0Q20',
        permalink: 'https://www.amazon.com.br/dp/B01LKZ0Q20',
      }),
      'amazon',
    );
  });

  it('identifica Amazon só pelo permalink', () => {
    assert.equal(
      detectOfferPlatform({
        mercadoLivreId: 'B01LKZ0Q20',
        permalink: null,
      }),
      'amazon',
    );
  });

  it('rotula plataformas', () => {
    assert.equal(offerPlatformLabel('amazon'), 'Amazon');
    assert.equal(offerPlatformLabel('mercado_livre'), 'Mercado Livre');
  });
});
