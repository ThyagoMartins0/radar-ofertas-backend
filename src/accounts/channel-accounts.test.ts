import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveWorkerAccountIds } from './channel-accounts.js';
import { DEFAULT_ACCOUNT_ID, type Account } from './types.js';

describe('resolveWorkerAccountIds', () => {
  it('inclui conta WhatsApp default desabilitada para pareamento', () => {
    const accounts: Account[] = [
      {
        id: DEFAULT_ACCOUNT_ID,
        platform: 'whatsapp',
        label: 'WhatsApp principal',
        enabled: false,
        config: { channelId: '', authPath: './data/auth' },
      },
    ];

    assert.deepEqual(resolveWorkerAccountIds('whatsapp', accounts), [DEFAULT_ACCOUNT_ID]);
  });

  it('prioriza contas WhatsApp habilitadas', () => {
    const accounts: Account[] = [
      {
        id: DEFAULT_ACCOUNT_ID,
        platform: 'whatsapp',
        label: 'Principal',
        enabled: false,
        config: { channelId: '', authPath: './data/a' },
      },
      {
        id: 'loja-b',
        platform: 'whatsapp',
        label: 'Loja B',
        enabled: true,
        config: { channelId: '120363120768375741@newsletter', authPath: './data/b' },
      },
    ];

    assert.deepEqual(resolveWorkerAccountIds('whatsapp', accounts), ['loja-b']);
  });

  it('ignora Telegram sem credenciais', () => {
    const accounts: Account[] = [
      {
        id: DEFAULT_ACCOUNT_ID,
        platform: 'telegram',
        label: 'Telegram',
        enabled: true,
        config: { botToken: '', chatId: '' },
      },
    ];

    assert.deepEqual(resolveWorkerAccountIds('telegram', accounts), []);
  });

  it('inclui Telegram habilitado com token e chat', () => {
    const accounts: Account[] = [
      {
        id: DEFAULT_ACCOUNT_ID,
        platform: 'telegram',
        label: 'Telegram',
        enabled: true,
        config: { botToken: '123:abc', chatId: '@canal' },
      },
    ];

    assert.deepEqual(resolveWorkerAccountIds('telegram', accounts), [DEFAULT_ACCOUNT_ID]);
  });
});
