import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stubEnv } from '../test/env-stub.js';
import { acquireSenderPacingSlot } from './sender-pacing.js';

stubEnv();

describe('acquireSenderPacingSlot', () => {
  it('não espera quando delay é zero ou negativo', async () => {
    assert.equal(await acquireSenderPacingSlot('whatsapp', 'acc-1', 0), 0);
    assert.equal(await acquireSenderPacingSlot('whatsapp', 'acc-1', -5), 0);
  });

  it('serializa slots in-process para o mesmo canal/conta', async () => {
    const delayMs = 80;
    const startedAt = Date.now();
    await acquireSenderPacingSlot('telegram', 'acc-serial', delayMs);
    await acquireSenderPacingSlot('telegram', 'acc-serial', delayMs);
    assert.ok(Date.now() - startedAt >= delayMs);
  });
});
