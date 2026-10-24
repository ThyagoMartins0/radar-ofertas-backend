import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isIntegrationConfigured, resolveIntegrationDisplayStatus } from './accounts-model.js';
import type { AccountCardData } from './accounts-model.js';

describe('resolveIntegrationDisplayStatus', () => {
  it('marca WhatsApp inativo sem canal configurado mesmo com enabled true', () => {
    const card: AccountCardData = {
      account: {
        id: 'default',
        platform: 'whatsapp',
        label: 'WhatsApp principal',
        enabled: true,
        config: { channelId: '', authPath: './data/auth' },
      },
      whatsapp: {
        destinations: [],
        channelId: '',
        channelName: null,
        channelInviteLink: '',
        channelConfigured: false,
      },
    };

    assert.equal(isIntegrationConfigured(card), false);
    assert.equal(resolveIntegrationDisplayStatus(card), 'inactive');
  });

  it('marca WhatsApp inativo sem login mesmo configurado', () => {
    const card: AccountCardData = {
      account: {
        id: 'default',
        platform: 'whatsapp',
        label: 'WhatsApp principal',
        enabled: true,
        config: { channelId: '120363120768375741@newsletter', authPath: './data/auth' },
      },
      whatsapp: {
        destinations: [],
        channelId: '120363120768375741@newsletter',
        channelName: 'Promoções',
        channelInviteLink: '',
        channelConfigured: true,
      },
      connection: { loggedIn: false, detail: 'Não logado' },
    };

    assert.equal(resolveIntegrationDisplayStatus(card), 'inactive');
  });

  it('marca WhatsApp ativo com canal, login e conta habilitada', () => {
    const card: AccountCardData = {
      account: {
        id: 'default',
        platform: 'whatsapp',
        label: 'WhatsApp principal',
        enabled: true,
        config: { channelId: '120363120768375741@newsletter', authPath: './data/auth' },
      },
      whatsapp: {
        destinations: [],
        channelId: '120363120768375741@newsletter',
        channelName: 'Promoções',
        channelInviteLink: '',
        channelConfigured: true,
      },
      connection: { loggedIn: true, detail: 'Sessão WhatsApp salva' },
    };

    assert.equal(resolveIntegrationDisplayStatus(card), 'active');
  });

  it('marca Telegram inativo sem token ou canal', () => {
    const card: AccountCardData = {
      account: {
        id: 'default',
        platform: 'telegram',
        label: 'Telegram principal',
        enabled: true,
        config: { botToken: '', chatId: '' },
      },
      telegram: { chatId: '', hasBotToken: false },
    };

    assert.equal(resolveIntegrationDisplayStatus(card), 'inactive');
  });

  it('marca Telegram ativo com credenciais e conta habilitada', () => {
    const card: AccountCardData = {
      account: {
        id: 'default',
        platform: 'telegram',
        label: 'Telegram principal',
        enabled: true,
        config: { botToken: 'token', chatId: '-100123' },
      },
      telegram: { chatId: '-100123', hasBotToken: true },
      connection: { loggedIn: true, detail: 'Bot ok' },
    };

    assert.equal(resolveIntegrationDisplayStatus(card), 'active');
  });
});
