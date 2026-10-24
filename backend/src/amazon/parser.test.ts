import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { formatAmazonCouponLabel, parseAmazonListingHtml, parseAmazonProductHtml } from './parser.js';
import { validateAmazonSourceConfig } from './source-url.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('amazon parser', () => {
  it('extrai produtos de listagem', () => {
    const html = readFileSync(join(fixturesDir, 'listing-page.html'), 'utf8');
    const items = parseAmazonListingHtml(html);

    assert.equal(items.length, 2);
    assert.equal(items[0]?.asin, 'B01LKZ0Q20');
    assert.equal(items[0]?.title, 'Kérastase Densifique Bain Densité Shampoo 250ml');
    assert.equal(items[0]?.price, 285.9);
    assert.equal(items[0]?.originalPrice, 349.9);
    assert.equal(items[0]?.rating, 4.8);
    assert.equal(items[0]?.reviewsCount, null);
    assert.equal(items[0]?.soldQuantity, null);
    assert.equal(items[0]?.bestSeller, true);
    assert.ok(items[0]?.permalink.includes('/dp/B01LKZ0Q20'));
  });

  it('extrai produto da PDP', () => {
    const html = readFileSync(join(fixturesDir, 'product-page.html'), 'utf8');
    const item = parseAmazonProductHtml(html);

    assert.ok(item);
    assert.equal(item.asin, 'B01LKZ0Q20');
    assert.equal(item.title, 'Kérastase Densifique Bain Densité Shampoo 250ml');
    assert.equal(item.price, 285.9);
    assert.equal(item.originalPrice, 349.9);
    assert.equal(item.rating, 4.8);
    assert.equal(item.reviewsCount, 5024);
    assert.equal(item.soldQuantity, 2000);
    assert.equal(item.seller, 'Eos no Amazon');
    assert.equal(item.coupon, 'R$20 off - VEMNOAPP');
    assert.equal(item.thumbnail, 'https://m.media-amazon.com/images/I/41abc._AC_SL1500_.jpg');
  });

  it('formata avaliação e vendas no estilo Amazon', () => {
    const html = readFileSync(join(fixturesDir, 'product-page.html'), 'utf8');
    const item = parseAmazonProductHtml(html);

    assert.ok(item);
    const ratingLine = `${item.rating?.toFixed(1).replace('.', ',')} de 5 estrelas (${item.reviewsCount?.toLocaleString('pt-BR')})`;
    assert.equal(ratingLine, '4,8 de 5 estrelas (5.024)');
    assert.equal(item.soldQuantity, 2000);
  });

  it('extrai produtos de browse node DCL (sem data-asin)', () => {
    const html = readFileSync(join(fixturesDir, 'browse-node-http.html'), 'utf8');
    const items = parseAmazonListingHtml(html);

    assert.ok(items.length >= 20);
    assert.ok(items.some((item) => item.asin === 'B0B8MCB6KK'));
    assert.ok(items.every((item) => item.price !== null && item.title.length > 0));
  });

  it('formata cupom Amazon de forma resumida', () => {
    const messy =
      'Faça login para resgatar. R$20 off. Insira o código COMPRANOAPP na finalização da compra. Válido na sua primeira compra na Amazon, pelo App Termos [data-selector="cxcwPopoverLink"] { padding-left: 6px; } off. O cupom de desconto COMPRANOAPP foi salvo na sua conta. Desconto da Amazon.';
    assert.equal(formatAmazonCouponLabel(messy), 'R$20 off - COMPRANOAPP');
  });
});

describe('amazon source-url', () => {
  it('valida browse node padrão', () => {
    const result = validateAmazonSourceConfig('https://www.amazon.com.br/b/node/122326793011');
    assert.equal(result.valid, true);
    assert.equal(result.kind, 'browse_node');
  });

  it('valida produto por /dp/', () => {
    const result = validateAmazonSourceConfig(
      'https://www.amazon.com.br/Densifique/dp/B01LKZ0Q20?ref_=abc',
    );
    assert.equal(result.valid, true);
    assert.equal(result.kind, 'product');
  });
});
