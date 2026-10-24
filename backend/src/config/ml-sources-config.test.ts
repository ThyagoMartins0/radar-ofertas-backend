import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { env } from './env.js';
import {
  buildMlCategoryRows,
  getActiveMlCategories,
  getActiveMlCategoriesForChannel,
  getChannelsForCategory,
  setEnvFlagsCacheForTest,
  setMlSourcesCacheForTest,
} from './ml-sources-config.js';

const RELAMPAGO =
  'https://www.mercadolivre.com.br/ofertas?container_id=MLB779362-1&promotion_type=lightning';
const MODA = 'https://www.mercadolivre.com.br/ofertas?container_id=MLB773331-2';

describe('ml-sources-config', () => {
  it('combines env categories with sources feeding any channel', () => {
    setMlSourcesCacheForTest([
      { id: 'custom-1', label: 'Relâmpago', url: RELAMPAGO, channels: ['whatsapp', 'telegram'] },
      { id: 'custom-2', label: 'Só Telegram', url: MODA, channels: ['telegram'] },
      {
        id: 'custom-3',
        label: 'Inativa',
        url: 'https://www.mercadolivre.com.br/ofertas?container_id=MLB000000-9',
        channels: [],
      },
    ]);

    const active = getActiveMlCategories();
    assert.ok(active.includes(RELAMPAGO));
    assert.ok(active.includes(MODA));
    assert.equal(
      active.includes('https://www.mercadolivre.com.br/ofertas?container_id=MLB000000-9'),
      false,
    );

    setMlSourcesCacheForTest(null);
  });

  it('filters sources by channel', () => {
    setMlSourcesCacheForTest([
      { id: 'c1', label: 'Ambos', url: RELAMPAGO, channels: ['whatsapp', 'telegram'] },
      { id: 'c2', label: 'Só Telegram', url: MODA, channels: ['telegram'] },
    ]);

    const wpp = getActiveMlCategoriesForChannel('whatsapp');
    assert.ok(wpp.includes(RELAMPAGO));
    assert.equal(wpp.includes(MODA), false);

    const tg = getActiveMlCategoriesForChannel('telegram');
    assert.ok(tg.includes(RELAMPAGO));
    assert.ok(tg.includes(MODA));

    setMlSourcesCacheForTest(null);
  });

  it('getChannelsForCategory returns the channels a source feeds', () => {
    setMlSourcesCacheForTest([
      { id: 'c1', label: 'Só Telegram', url: MODA, channels: ['telegram'] },
    ]);

    assert.deepEqual(getChannelsForCategory(MODA), ['telegram']);
    assert.deepEqual(getChannelsForCategory('https://desconhecido.com'), []);

    setMlSourcesCacheForTest(null);
  });

  it('buildMlCategoryRows marks env rows active for all channels by default', () => {
    setMlSourcesCacheForTest([]);
    setEnvFlagsCacheForTest(null);

    const envRow = buildMlCategoryRows().find((row) => row.fromEnv);
    assert.ok(envRow);
    assert.deepEqual(envRow.channels, ['whatsapp', 'telegram']);
    assert.equal(envRow.fromEnv, true);

    setMlSourcesCacheForTest(null);
  });

  it('respects env source flags when a channel is removed', () => {
    setMlSourcesCacheForTest([]);
    // Categorias do .env só alimentam o Telegram (WhatsApp removido).
    const flags = Object.fromEntries(env.ML_CATEGORIES.map((c) => [c, ['telegram']]));
    setEnvFlagsCacheForTest(flags as never);

    const wpp = getActiveMlCategoriesForChannel('whatsapp');
    for (const category of env.ML_CATEGORIES) {
      assert.equal(wpp.includes(category), false);
    }

    const envRow = buildMlCategoryRows().find((row) => row.fromEnv);
    assert.ok(envRow);
    assert.deepEqual(envRow.channels, ['telegram']);

    setEnvFlagsCacheForTest(null);
    setMlSourcesCacheForTest(null);
  });
});
