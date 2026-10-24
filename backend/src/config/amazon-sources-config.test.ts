import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { env } from './env.js';
import {
  buildAmazonSourceRows,
  getActiveAmazonSources,
  getActiveAmazonSourcesForChannel,
  getChannelsForAmazonSource,
  setAmazonEnvFlagsCacheForTest,
  setAmazonSourcesCacheForTest,
} from './amazon-sources-config.js';

const NODE = 'https://www.amazon.com.br/b/node/122326793011';
const PRODUCT = 'https://www.amazon.com.br/dp/B01LKZ0Q20';

describe('amazon-sources-config', () => {
  it('combina fontes do env com extras ativas', () => {
    setAmazonSourcesCacheForTest([
      {
        id: 'custom-1',
        label: 'Produto',
        url: PRODUCT,
        channels: ['whatsapp', 'telegram'],
      },
      {
        id: 'custom-2',
        label: 'Inativa',
        url: 'https://www.amazon.com.br/dp/B000000000',
        channels: [],
      },
    ]);

    const active = getActiveAmazonSources();
    assert.ok(active.includes(NODE));
    assert.ok(active.includes(PRODUCT));
    assert.equal(active.includes('https://www.amazon.com.br/dp/B000000000'), false);

    setAmazonSourcesCacheForTest(null);
  });

  it('filtra fontes por canal', () => {
    setAmazonSourcesCacheForTest([
      { id: 'c1', label: 'Ambos', url: PRODUCT, channels: ['whatsapp', 'telegram'] },
      {
        id: 'c2',
        label: 'Só Telegram',
        url: 'https://www.amazon.com.br/dp/B000000001',
        channels: ['telegram'],
      },
    ]);

    const wpp = getActiveAmazonSourcesForChannel('whatsapp');
    assert.ok(wpp.includes(NODE));
    assert.ok(wpp.includes(PRODUCT));
    assert.equal(wpp.includes('https://www.amazon.com.br/dp/B000000001'), false);

    setAmazonSourcesCacheForTest(null);
  });

  it('getChannelsForAmazonSource retorna canais da fonte', () => {
    setAmazonSourcesCacheForTest([
      {
        id: 'c1',
        label: 'Só Telegram',
        url: 'https://www.amazon.com.br/dp/B000000002',
        channels: ['telegram'],
      },
    ]);

    assert.deepEqual(getChannelsForAmazonSource('https://www.amazon.com.br/dp/B000000002'), [
      'telegram',
    ]);
    assert.deepEqual(getChannelsForAmazonSource('https://desconhecido.com'), []);

    setAmazonSourcesCacheForTest(null);
  });

  it('buildAmazonSourceRows marca env ativo por padrão', () => {
    setAmazonSourcesCacheForTest([]);
    setAmazonEnvFlagsCacheForTest(null);

    const envRow = buildAmazonSourceRows().find((row) => row.fromEnv);
    assert.ok(envRow);
    assert.deepEqual(envRow.channels, ['whatsapp', 'telegram']);
    assert.equal(envRow.valid, true);
    assert.equal(envRow.kind, 'browse_node');

    setAmazonSourcesCacheForTest(null);
  });

  it('env AMAZON_SOURCES inclui browse node padrão', () => {
    assert.ok(env.AMAZON_SOURCES.includes(NODE));
  });
});
