import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProductSearchSources, slugifyMlProductQuery } from './product-search.js';

describe('slugifyMlProductQuery', () => {
  it('normaliza acentos e espaços', () => {
    assert.equal(slugifyMlProductQuery('  iPhone 15 Pro  '), 'iphone-15-pro');
    assert.equal(slugifyMlProductQuery('Café expresso'), 'cafe-expresso');
  });
});

describe('buildProductSearchSources', () => {
  it('retorna vazio para termo em branco', () => {
    assert.deepEqual(buildProductSearchSources('   '), []);
  });

  it('monta URLs ML e Amazon', () => {
    const sources = buildProductSearchSources('notebook gamer');
    assert.equal(sources.length, 2);
    assert.equal(sources[0], 'https://lista.mercadolivre.com.br/notebook-gamer');
    assert.match(sources[1] ?? '', /amazon\.com\.br\/s\?k=notebook(\+|%20)gamer/);
  });
});
