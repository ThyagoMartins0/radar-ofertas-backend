import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { stubEnv } from '../test/env-stub.js';
import type { RawOffer } from './types.js';
import type { ServiceDeps } from './service.js';

stubEnv();

const { processOffer, dispatchOffer } = await import('./service.js');

type MockFn = ReturnType<typeof mock.fn>;
function calls(fn: unknown): number {
  return (fn as MockFn).mock.callCount();
}

function makeRawOffer(overrides: Partial<RawOffer> = {}): RawOffer {
  return {
    mercadoLivreId: 'MLB-' + Math.random().toString(36).slice(2, 10),
    title: 'Test Offer',
    price: 100,
    oldPrice: 200,
    discount: 50,
    image: null,
    rating: 4.5,
    soldQuantity: 500,
    salesRank: null,
    seller: 'Test Seller',
    officialStore: false,
    bestSeller: false,
    permalink: 'https://mercadolivre.com.br/test',
    ...overrides,
  };
}

const fakeOffer = {
  id: 'test-offer-id',
  mercadoLivreId: 'MLB-TEST',
  title: 'Test Offer',
  price: 100,
  oldPrice: 200,
  discount: 50,
  image: null,
  permalink: 'https://mercadolivre.com.br/test',
  affiliateLink: null,
  rating: 4.5,
  soldQuantity: 500,
  salesRank: null,
  seller: 'Test Seller',
  officialStore: false,
  bestSeller: false,
  score: 80,
  sentAt: null,
  createdAt: new Date(),
};

const scoreConfig = {
  minScore: 50,
  discount: {
    enabled: true,
    cumulative: false,
    tiers: [{ enabled: true, threshold: 30, points: 30 }],
  },
  rating: {
    enabled: true,
    cumulative: false,
    tiers: [{ enabled: true, threshold: 4.0, points: 20 }],
  },
  soldQuantity: {
    enabled: true,
    cumulative: false,
    tiers: [{ enabled: true, threshold: 100, points: 20 }],
  },
  price: {
    enabled: true,
    cumulative: true,
    tiers: [{ enabled: true, threshold: 500, points: 10 }],
  },
};

function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    getRuntimeScoreConfig: mock.fn(() => scoreConfig),
    calculateOfferScore: mock.fn(() => 80),
    getEnabledChannels: mock.fn(() => ['whatsapp', 'telegram'] as never[]),
    isChannelEnabled: mock.fn(() => true),
    getChannelsForSource: mock.fn(() => ['whatsapp', 'telegram'] as never[]),
    findOfferIdByMercadoLivreId: mock.fn(async () => null),
    findExistingDeliveryChannels: mock.fn(async () => []),
    sentOfferExistsByTitleAndPrice: mock.fn(async () => false),
    createOffer: mock.fn(async () => ({ ...fakeOffer })),
    openOfferDelivery: mock.fn(async () => {}),
    enqueueOfferSend: mock.fn(async () => {}),
    findAccountsByPlatform: mock.fn(async () => []),
    ...overrides,
  } as unknown as ServiceDeps;
}

describe('processOffer', () => {
  it('cria oferta e faz dispatch quando score está acima do mínimo', async () => {
    const deps = makeDeps();
    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, fakeOffer.id);
    assert.equal(calls(deps.createOffer), 1);
    assert.equal(calls(deps.openOfferDelivery), 2);
    assert.equal(calls(deps.enqueueOfferSend), 2);
  });

  it('retorna null quando score está abaixo do mínimo', async () => {
    const deps = makeDeps({
      calculateOfferScore: mock.fn(() => 10),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, null);
    assert.equal(calls(deps.createOffer), 0);
  });

  it('não duplica quando mercadoLivreId já existe com todos os canais enviados', async () => {
    const deps = makeDeps({
      findOfferIdByMercadoLivreId: mock.fn(async () => 'existing-id'),
      findExistingDeliveryChannels: mock.fn(async (): Promise<('whatsapp' | 'telegram')[]> => [
        'whatsapp',
        'telegram',
      ]),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, null);
    assert.equal(calls(deps.createOffer), 0);
  });

  it('reenfileira canal com entrega pendente quando mercadoLivreId já existe', async () => {
    const deps = makeDeps({
      findOfferIdByMercadoLivreId: mock.fn(async () => 'existing-id'),
      findExistingDeliveryChannels: mock.fn(async (): Promise<('whatsapp' | 'telegram')[]> => []),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, 'existing-id');
    assert.equal(calls(deps.openOfferDelivery), 2);
    assert.equal(calls(deps.enqueueOfferSend), 2);
  });

  it('faz dispatch para canal faltante quando mercadoLivreId já existe', async () => {
    const deps = makeDeps({
      findOfferIdByMercadoLivreId: mock.fn(async () => 'existing-id'),
      findExistingDeliveryChannels: mock.fn(async (): Promise<('whatsapp' | 'telegram')[]> => [
        'whatsapp',
      ]),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, 'existing-id');
    assert.equal(calls(deps.openOfferDelivery), 1);
    assert.equal(calls(deps.enqueueOfferSend), 1);
  });

  it('rejeita duplicata por título+preço já enviada', async () => {
    const deps = makeDeps({
      sentOfferExistsByTitleAndPrice: mock.fn(async () => true),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, null);
    assert.equal(calls(deps.createOffer), 0);
  });

  it('filtra canais por sourceCategory quando presente', async () => {
    const deps = makeDeps({
      getChannelsForSource: mock.fn(() => ['telegram'] as never[]),
    });

    const result = await processOffer(makeRawOffer({ sourceCategory: 'MLB1648' }), deps);

    assert.equal(result, fakeOffer.id);
    assert.equal(calls(deps.openOfferDelivery), 1);
  });

  it('entrega em todos os canais ligados quando a fonte é ad-hoc', async () => {
    const deps = makeDeps({
      getChannelsForSource: mock.fn(() => [] as never[]),
    });

    const result = await processOffer(
      makeRawOffer({ sourceCategory: 'https://lista.mercadolivre.com.br/notebook' }),
      deps,
    );

    assert.equal(result, fakeOffer.id);
    assert.equal(calls(deps.openOfferDelivery), 2);
  });

  it('retorna null quando nenhum canal alvo está habilitado', async () => {
    const deps = makeDeps({
      getEnabledChannels: mock.fn(() => []),
    });

    const result = await processOffer(makeRawOffer(), deps);

    assert.equal(result, null);
  });
});

describe('dispatchOffer', () => {
  it('faz fan-out para múltiplos canais', async () => {
    const deps = makeDeps();
    const channels = await dispatchOffer('offer-1', ['whatsapp', 'telegram'] as never[], deps);

    assert.deepEqual(channels, ['whatsapp', 'telegram']);
    assert.equal(calls(deps.openOfferDelivery), 2);
    assert.equal(calls(deps.enqueueOfferSend), 2);
  });

  it('falha em um canal não impede o outro', async () => {
    let callCount = 0;
    const deps = makeDeps({
      enqueueOfferSend: mock.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Redis down');
      }),
    });

    const channels = await dispatchOffer('offer-1', ['whatsapp', 'telegram'] as never[], deps);

    assert.equal(channels.length, 1);
    assert.equal(channels[0], 'telegram');
  });

  it('usa canais habilitados quando channels não é informado', async () => {
    const deps = makeDeps();
    const channels = await dispatchOffer('offer-1', undefined, deps);

    assert.deepEqual(channels, ['whatsapp', 'telegram']);
    assert.equal(calls(deps.openOfferDelivery), 2);
  });
});
