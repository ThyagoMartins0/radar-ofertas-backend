import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOffersPaginatedUrl,
  isOffersListingUrl,
  normalizeOffersListingUrl,
  validateCategoryConfig,
} from './category-url.js';

describe('category-url — ofertas', () => {
  it('detects offers listing URL', () => {
    assert.equal(isOffersListingUrl('https://www.mercadolivre.com.br/ofertas'), true);
    assert.equal(isOffersListingUrl('https://www.mercadolivre.com.br/ofertas?page=2'), true);
    assert.equal(
      isOffersListingUrl('https://lista.mercadolivre.com.br/_CategoryId_MLB1648'),
      false,
    );
  });

  it('validates ofertas config with listingKind offers', () => {
    const result = validateCategoryConfig('https://www.mercadolivre.com.br/ofertas');
    assert.equal(result.valid, true);
    assert.equal(result.listingKind, 'offers');
    assert.equal(result.url, 'https://www.mercadolivre.com.br/ofertas');
  });

  it('normalizes offers URL removing page and hash', () => {
    assert.equal(
      normalizeOffersListingUrl('https://www.mercadolivre.com.br/ofertas?page=3#nav-header'),
      'https://www.mercadolivre.com.br/ofertas',
    );
  });

  it('builds offers pagination with ?page=', () => {
    const base = 'https://www.mercadolivre.com.br/ofertas';
    assert.equal(buildOffersPaginatedUrl(base, 0), base);
    assert.equal(
      buildOffersPaginatedUrl(base, 2),
      'https://www.mercadolivre.com.br/ofertas?page=2',
    );
  });

  it('keeps category ID as listingKind category', () => {
    const result = validateCategoryConfig('MLB1648');
    assert.equal(result.valid, true);
    assert.equal(result.listingKind, 'category');
  });
});
