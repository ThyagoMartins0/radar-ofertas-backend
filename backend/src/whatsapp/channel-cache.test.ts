import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeWhatsAppInviteLink } from './invite.js';

describe('normalizeWhatsAppInviteLink (channel cache)', () => {
  it('retorna null para input em branco', () => {
    assert.equal(normalizeWhatsAppInviteLink('   ', 'newsletter'), null);
  });

  it('monta URL completa a partir do código do canal', () => {
    assert.equal(
      normalizeWhatsAppInviteLink('AbCdEfGhIjKlMn', 'newsletter'),
      'https://whatsapp.com/channel/AbCdEfGhIjKlMn',
    );
  });

  it('preserva URL já completa', () => {
    const url = 'https://whatsapp.com/channel/AbCdEfGhIjKlMn';
    assert.equal(normalizeWhatsAppInviteLink(url, 'newsletter'), url);
  });

  it('extrai código de URL parcial sem protocolo', () => {
    assert.equal(
      normalizeWhatsAppInviteLink('whatsapp.com/channel/XyZ123', 'newsletter'),
      'https://whatsapp.com/channel/XyZ123',
    );
  });
});
