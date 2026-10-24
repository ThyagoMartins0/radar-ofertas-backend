import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAccountConfig, parseAccountRecord } from './account-config.js';

describe('parseAccountConfig', () => {
  it('valida config WhatsApp', () => {
    const config = parseAccountConfig('whatsapp', {
      channelId: '120363@newsletter',
      authPath: './data/auth',
    });
    assert.equal((config as { channelId: string }).channelId, '120363@newsletter');
  });

  it('rejeita config Telegram incompleta', () => {
    assert.throws(() => parseAccountConfig('telegram', { botToken: 'x' }));
  });

  it('valida config Mercado Livre com tag de afiliado', () => {
    const config = parseAccountConfig('mercado_livre', {
      authPath: './data/ml_auth',
      affiliateTag: 'minha-tag',
    });
    assert.equal((config as { affiliateTag: string }).affiliateTag, 'minha-tag');
  });
});

describe('parseAccountRecord', () => {
  it('valida conta completa', () => {
    const account = parseAccountRecord({
      id: 'wa-1',
      platform: 'whatsapp',
      label: 'Principal',
      enabled: true,
      config: { channelId: 'jid', authPath: './data/auth' },
    });
    assert.equal(account.id, 'wa-1');
    assert.equal(account.platform, 'whatsapp');
  });
});
