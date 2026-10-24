import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AFFILIATE_PLATFORM_DEFINITIONS,
  affiliatePlatformLabel,
  getAffiliatePlatformDefinition,
} from './index.js';

describe('affiliate registry', () => {
  it('lista ML, Shopee e Amazon', () => {
    assert.deepEqual(
      AFFILIATE_PLATFORM_DEFINITIONS.map((item) => item.id),
      ['mercado_livre', 'shopee', 'amazon'],
    );
  });

  it('rotula plataformas', () => {
    assert.equal(affiliatePlatformLabel('mercado_livre'), 'Mercado Livre');
    assert.equal(affiliatePlatformLabel('shopee'), 'Shopee');
    assert.equal(affiliatePlatformLabel('amazon'), 'Amazon');
  });

  it('resolve definição por id', () => {
    const ml = getAffiliatePlatformDefinition('mercado_livre');
    assert.equal(ml.status, 'active');
    assert.equal(getAffiliatePlatformDefinition('shopee').status, 'coming_soon');
    assert.equal(getAffiliatePlatformDefinition('amazon').status, 'active');
  });
});
