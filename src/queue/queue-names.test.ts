import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stubEnv } from '../test/env-stub.js';
import { collectorSourceJobId, getSenderQueueName, senderJobId } from './index.js';

stubEnv();

describe('getSenderQueueName', () => {
  it('mantém nome legado para conta default no WhatsApp', () => {
    assert.equal(getSenderQueueName('whatsapp', 'default'), 'offer-sender');
  });

  it('sufixa fila por accountId', () => {
    assert.equal(getSenderQueueName('whatsapp', 'loja-1'), 'offer-sender-loja-1');
    assert.equal(getSenderQueueName('telegram', 'bot-2'), 'offer-sender-telegram-bot-2');
  });
});

describe('senderJobId', () => {
  it('gera id determinístico por canal e oferta', () => {
    assert.equal(senderJobId('telegram', 'offer-42', 'default'), 'send-offer-telegram-offer-42');
    assert.equal(
      senderJobId('whatsapp', 'offer-42', 'loja-1'),
      'send-offer-whatsapp-loja-1-offer-42',
    );
  });
});

describe('collectorSourceJobId', () => {
  it('inclui canal, categoria e timestamp do ciclo', () => {
    const id = collectorSourceJobId('whatsapp', 'eletronicos', '2026-07-23T12:00:00.000Z');
    assert.match(id, /^collect-source-whatsapp-eletronicos-2026-07-23T12:00:00\.000Z$/);
  });
});
