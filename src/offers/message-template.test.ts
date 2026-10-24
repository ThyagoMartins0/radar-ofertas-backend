import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_PLACEHOLDER_VISIBILITY,
  formatOfferMessageFromTemplate,
  formatOfferRating,
  formatSoldQuantity,
  formatTopSoldLabel,
  renderMessageTemplate,
  sampleTemplateValues,
} from './message-template.js';
import type { OfferRecord } from './types.js';

const sampleOffer: OfferRecord = {
  id: 'test',
  mercadoLivreId: 'MLB123',
  title: 'Mouse Gamer RGB',
  price: 99.9,
  oldPrice: 149.9,
  discount: 33,
  image: null,
  permalink: 'https://www.mercadolivre.com.br/p/MLB123',
  affiliateLink: 'https://mercadolivre.com/sec/abc',
  rating: 4.5,
  soldQuantity: 200,
  salesRank: '4º em Mouses Gamer',
  seller: 'Mega Mamute',
  officialStore: true,
  bestSeller: true,
  score: 80,
  sentAt: null,
  createdAt: new Date('2026-01-01'),
};

describe('message-template', () => {
  it('substitui todos os placeholders', () => {
    const template =
      '{{brand}}\n{{name}}\n{{price}}\n{{avalia}}\n{{qty_sold}}\n{{top_sold}}\n{{store}}\n{{best_seller}}\n{{product_link}}';
    const result = formatOfferMessageFromTemplate(template, sampleOffer);

    assert.match(result, /Mouse Gamer RGB/);
    assert.match(result, /R\$\s*99,90/);
    assert.match(result, /4\.5 ⭐/);
    assert.match(result, /200 vendidos/);
    assert.match(result, /4º em Mouses Gamer/);
    assert.match(result, /https:\/\/mercadolivre\.com\/sec\/abc/);
  });

  it('{{store}} traz o vendedor do ML e {{brand}} a marca do canal', () => {
    const result = formatOfferMessageFromTemplate('{{brand}} | {{store}}', sampleOffer);
    assert.equal(result, 'Radar Ofertas | Mega Mamute ✅ Loja oficial');
  });

  it('{{store}} omite o selo quando não é loja oficial', () => {
    const offer = { ...sampleOffer, officialStore: false };
    assert.equal(formatOfferMessageFromTemplate('{{store}}', offer), 'Mega Mamute');
  });

  it('linha do vendedor some quando o card não traz seller', () => {
    const offer = { ...sampleOffer, seller: null, officialStore: false };
    const result = formatOfferMessageFromTemplate('{{name}}\n🏬 {{store}}\n{{price}}', offer);
    assert.doesNotMatch(result, /🏬/);
    assert.match(result, /Mouse Gamer RGB/);
  });

  it('{{discount}} traz o percentual anunciado pelo ML', () => {
    assert.equal(formatOfferMessageFromTemplate('{{discount}}', sampleOffer), '33% OFF');
  });

  it('linha do desconto some quando a oferta não tem desconto', () => {
    const semDesconto = { ...sampleOffer, discount: null };
    const result = formatOfferMessageFromTemplate(
      '{{name}}\n🏷️ {{discount}}\n{{price}}',
      semDesconto,
    );
    assert.doesNotMatch(result, /🏷️/);
    assert.match(result, /Mouse Gamer RGB/);
  });

  it('{{best_seller}} só aparece com o selo MAIS VENDIDO', () => {
    assert.equal(formatOfferMessageFromTemplate('{{best_seller}}', sampleOffer), '🏆 MAIS VENDIDO');

    const semSelo = { ...sampleOffer, bestSeller: false };
    assert.equal(
      formatOfferMessageFromTemplate('📦 {{qty_sold}}\n{{best_seller}}', semSelo),
      '📦 200 vendidos',
    );
  });

  it('top_sold fica vazio sem ranking', () => {
    const noRank = { ...sampleOffer, salesRank: null };
    const result = formatOfferMessageFromTemplate('{{top_sold}}\n{{qty_sold}}', noRank);
    assert.doesNotMatch(result, /º em/);
    assert.match(result, /200 vendidos/);
  });

  it('formata ranking com frete e parcelamento', () => {
    const formatted = formatTopSoldLabel(
      '419º em outros meiosChegará grátis amanhãDisponível em 12',
    );
    assert.equal(formatted, '419º em outros meios - Chegará grátis amanhã - Disponível em 12x');
  });

  it('preserva linhas em branco no template', () => {
    const template = 'Linha 1\n\nLinha 2';
    const result = renderMessageTemplate(template, sampleTemplateValues());
    assert.equal(result, 'Linha 1\n\nLinha 2');
  });

  it('omite placeholders desativados', () => {
    const template = '{{name}}\n⭐ {{avalia}}\n{{price}}';
    const visibility = { ...DEFAULT_PLACEHOLDER_VISIBILITY, avalia: false };
    const result = renderMessageTemplate(template, sampleTemplateValues(), visibility);

    assert.match(result, /Fone Bluetooth/);
    assert.doesNotMatch(result, /⭐/);
    assert.doesNotMatch(result, /4\.8/);
  });

  it('mantém placeholders desconhecidos no texto', () => {
    const result = renderMessageTemplate('Olá {{foo}}', sampleTemplateValues());
    assert.equal(result, 'Olá {{foo}}');
  });

  it('usa template padrão com estrutura esperada', () => {
    const result = formatOfferMessageFromTemplate(DEFAULT_MESSAGE_TEMPLATE, sampleOffer);
    assert.match(result, /Mouse Gamer RGB/);
    assert.match(result, /Compre aqui/);
  });

  it('formata avaliação e vendas no estilo Amazon', () => {
    assert.equal(
      formatOfferRating(4.8, 'amazon', 5024),
      '4,8 de 5 estrelas (5.024)',
    );
    assert.equal(formatSoldQuantity(2000, 'amazon'), 'Mais de 2 mil compras no mês passado');

    const amazonOffer: OfferRecord = {
      ...sampleOffer,
      mercadoLivreId: 'B07JFTS6BS',
      permalink: 'https://www.amazon.com.br/dp/B07JFTS6BS',
      affiliateLink: 'https://www.amazon.com.br/dp/B07JFTS6BS?tag=mercadaodasfa-20',
      rating: 4.8,
      soldQuantity: 2000,
      salesRank: '5024',
      seller: null,
      officialStore: false,
      bestSeller: false,
    };

    const result = formatOfferMessageFromTemplate(
      '{{avalia}}\n{{qty_sold}}\n{{product_link}}',
      amazonOffer,
    );
    assert.match(result, /4,8 de 5 estrelas \(5\.024\)/);
    assert.match(result, /Mais de 2 mil compras no mês passado/);
    assert.match(result, /https:\/\/www\.amazon\.com\.br\/dp\/B07JFTS6BS\?tag=mercadaodasfa-20/);
  });
});
