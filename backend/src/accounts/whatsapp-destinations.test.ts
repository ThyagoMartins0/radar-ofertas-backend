import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getEnabledWhatsAppDestinations,
  listWhatsAppDestinations,
  syncLegacyWhatsAppChannelFields,
} from './whatsapp-destinations.js';

describe('listWhatsAppDestinations', () => {
  it('faz fallback para channelId legado', () => {
    const destinations = listWhatsAppDestinations({
      channelId: '120363427488623422@newsletter',
      authPath: './data/auth',
      channelName: 'Canal principal',
      inviteLink: 'https://whatsapp.com/channel/abc',
    });

    assert.equal(destinations.length, 1);
    assert.equal(destinations[0]?.jid, '120363427488623422@newsletter');
    assert.equal(destinations[0]?.kind, 'newsletter');
    assert.equal(destinations[0]?.enabled, true);
  });
});

describe('syncLegacyWhatsAppChannelFields', () => {
  it('mantém channelId alinhado ao primeiro destino ativo', () => {
    const synced = syncLegacyWhatsAppChannelFields({
      channelId: 'old@newsletter',
      authPath: './data/auth',
      destinations: [
        {
          id: 'a',
          jid: '120363111@g.us',
          kind: 'group',
          label: 'Grupo teste',
          inviteLink: 'https://chat.whatsapp.com/abc',
          enabled: true,
        },
      ],
    });

    assert.equal(synced.channelId, '120363111@g.us');
    assert.equal(synced.channelName, 'Grupo teste');
  });
});

describe('getEnabledWhatsAppDestinations', () => {
  it('ignora destinos pausados', () => {
    const enabled = getEnabledWhatsAppDestinations({
      channelId: '',
      authPath: './data/auth',
      destinations: [
        {
          id: 'a',
          jid: '120363111@g.us',
          kind: 'group',
          enabled: false,
        },
        {
          id: 'b',
          jid: '120363222@newsletter',
          kind: 'newsletter',
          enabled: true,
        },
      ],
    });

    assert.equal(enabled.length, 1);
    assert.equal(enabled[0]?.jid, '120363222@newsletter');
  });
});
