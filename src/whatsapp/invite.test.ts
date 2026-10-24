import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractGroupInviteCode,
  extractNewsletterInviteCode,
  normalizeWhatsAppInviteLink,
} from './invite.js';

describe('extractGroupInviteCode', () => {
  it('extrai código de chat.whatsapp.com', () => {
    assert.equal(
      extractGroupInviteCode('https://chat.whatsapp.com/EhpeRLvoDsYJgl33UzwW8G'),
      'EhpeRLvoDsYJgl33UzwW8G',
    );
  });
});

describe('extractNewsletterInviteCode', () => {
  it('extrai código de whatsapp.com/channel', () => {
    assert.equal(
      extractNewsletterInviteCode('https://whatsapp.com/channel/AbCdEfGhIjKlMn'),
      'AbCdEfGhIjKlMn',
    );
  });
});

describe('normalizeWhatsAppInviteLink', () => {
  it('normaliza link de grupo', () => {
    assert.equal(
      normalizeWhatsAppInviteLink('EhpeRLvoDsYJgl33UzwW8G', 'group'),
      'https://chat.whatsapp.com/EhpeRLvoDsYJgl33UzwW8G',
    );
  });
});
