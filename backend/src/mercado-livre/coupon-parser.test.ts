import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLoginHtml, parseCouponsHtml, parseCouponsJson } from './coupon-parser.js';

describe('coupon-parser', () => {
  it('extrai cupons de JSON embutido', () => {
    const html = `
      <script>window.__PRELOADED_STATE__ = ${JSON.stringify({
        coupons: [
          {
            id: 'c1',
            title: 'Cupom Moda',
            discount_label: '20% OFF',
            code: 'MODA20',
            status: 'available',
            valid_until: '31/12/2026',
          },
        ],
      })};</script>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.title, 'Cupom Moda');
    assert.equal(coupons[0]?.code, 'MODA20');
    assert.equal(coupons[0]?.status, 'available');
  });

  it('extrai cupons do hub de afiliados embutido no HTML', () => {
    const html = `
      <html><body>
        <script>window.__STATE__ = {"coupons":[
          {"in_use":false,"id":13969808,"title":"5% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01T02:59:59","seller":"Lojaoficialcasasbahia"},
          {"in_use":false,"id":13246587,"title":"R$ 20 OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01T02:59:59","seller":"Darklab"}
        ],"page":1}</script>
      </body></html>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 2);
    assert.equal(coupons[0]?.storeName, 'Lojaoficialcasasbahia');
    assert.equal(coupons[0]?.title, 'Lojaoficialcasasbahia');
    assert.equal(coupons[0]?.discountLabel, '5% OFF');
    assert.equal(coupons[1]?.storeName, 'Darklab');
  });

  it('ignora menu do usuário com porcentagem no HTML', () => {
    const html = `
      <html><body>
        <li>!function(){new UserMenuWidget({ data: {"variation":{"label":"- 0,20%"}} });}();</li>
        <script>"coupons":[{"id":1,"title":"10% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01","seller":"Loja X"}]</script>
      </body></html>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.title, 'Loja X');
    assert.equal(coupons[0]?.discountLabel, '10% OFF');
  });

  it('prioriza cupom com código quando o mesmo id aparece duas vezes', () => {
    const html = `
      <script>
        "coupons":[
          {"id":99,"title":"7% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-18","seller":"Lucas-home","in_use":true},
          {"id":99,"title":"7% OFF","alias":"#PROMOAGRALUCASHOME","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-18","status":"AVAILABLE"}
        ]
      </script>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.code, '#PROMOAGRALUCASHOME');
    assert.equal(coupons[0]?.storeName, 'Lucas-home');
    assert.equal(coupons[0]?.status, 'available');
  });

  it('extrai link escapado no JSON próximo ao cupom', () => {
    const containerUrl =
      'https://lista.mercadolivre.com.br/_Container_pega-mais-5-off-seller-1784313015';
    const html = `
      <script>"coupons":[
        {"id":13969808,"title":"5% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01T02:59:59","seller":"Lojaoficialcasasbahia","seller_id":1784313015,"alias":"#PROMOAGRACASASBAHI","status":"AVAILABLE","landing":"https:\\/\\/lista.mercadolivre.com.br\\/ _Container_pega-mais-5-off-seller-1784313015"}
      ]</script>
    `.replace(' _Container_', '/_Container_');

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.storeName, 'Lojaoficialcasasbahia');
    assert.equal(coupons[0]?.storeUrl, containerUrl);
  });

  it('extrai link Ver produtos do JSON e do HTML', () => {
    const containerUrl =
      'https://lista.mercadolivre.com.br/_Container_pega-mais-21-off-seller-1784313015';
    const html = `
      <html><body>
        <article>
          <div>21% OFF Em produtos de Lucas-home Ver produtos Condições do cupom</div>
          <a href="${containerUrl}">Ver produtos</a>
        </article>
        <script>"coupons":[
          {"id":99,"title":"21% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-18","seller":"Lucas-home","products_url":"${containerUrl}","alias":"#PROMOAGRALUCASHOME","status":"AVAILABLE"}
        ]</script>
      </body></html>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.storeName, 'Lucas-home');
    assert.equal(coupons[0]?.storeUrl, containerUrl);
  });

  it('associa link _Container_ ao cupom por seller_id', () => {
    const containerUrl =
      'https://lista.mercadolivre.com.br/_Container_pega-mais-5-off-seller-1784313015';
    const html = `
      <script>"coupons":[
        {"id":13969808,"title":"5% OFF","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01T02:59:59","seller":"Lojaoficialcasasbahia","seller_id":1784313015,"alias":"#PROMOAGRACASASBAHI","status":"AVAILABLE"}
      ]</script>
      <a href="${containerUrl}">Ver produtos</a>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.storeUrl, containerUrl);
  });

  it('marca cupom com alias como disponível', () => {
    const html = `
      <script>"coupons":[{"id":1,"title":"10% OFF","alias":"#PROMO10","category":"PRODUCT_DISCOUNT","expiration_date":"2026-08-01"}]</script>
    `;

    const coupons = parseCouponsHtml(html);
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.status, 'available');
    assert.equal(coupons[0]?.code, '#PROMO10');
  });

  it('não confunde página de afiliados com login só por conter "login" no bundle', () => {
    const html = `
      <html><head><title>Cupons de afiliados</title></head>
      <body><script>window.config={loginUrl:"https://www.mercadolivre.com.br/login"};</script></body></html>
    `;
    assert.equal(isLoginHtml(html), false);
  });

  it('detecta página de login real', () => {
    const html =
      '<html><head><title>Entrar</title></head><body>Digite seu e-mail ou telefone para iniciar sessão</body></html>';
    assert.equal(isLoginHtml(html), true);
  });

  it('extrai cupons de resposta JSON direta', () => {
    const coupons = parseCouponsJson({
      results: [{ coupon_name: 'Frete grátis', benefit: 'R$ 30 OFF', coupon_code: 'FRETE30' }],
    });

    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]?.code, 'FRETE30');
  });
});
