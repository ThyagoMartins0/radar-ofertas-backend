import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveJobAccountId } from './sender.js';

describe('resolveJobAccountId', () => {
  it('prioriza accountId do job', () => {
    assert.equal(
      resolveJobAccountId({ offerId: 'o1', accountId: 'conta-a' }, 'worker-b'),
      'conta-a',
    );
  });

  it('usa worker quando job não tem accountId', () => {
    assert.equal(resolveJobAccountId({ offerId: 'o1' }, 'worker-b'), 'worker-b');
  });

  it('cai para default quando ambos ausentes', () => {
    assert.equal(resolveJobAccountId({ offerId: 'o1' }, ''), 'default');
  });
});
