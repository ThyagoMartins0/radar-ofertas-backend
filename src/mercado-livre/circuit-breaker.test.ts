import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCircuitBreaker } from './circuit-breaker.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('circuit-breaker', () => {
  it('starts closed and allows attempts', () => {
    const cb = createCircuitBreaker();
    assert.equal(cb.canAttempt(), true);
    assert.equal(cb.getState().status, 'closed');
  });

  it('stays closed below threshold', () => {
    const cb = createCircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.canAttempt(), true);
    assert.equal(cb.getState().failures, 2);
  });

  it('opens after reaching threshold', () => {
    const cb = createCircuitBreaker({ threshold: 3, cooldownMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.canAttempt(), false);
    assert.equal(cb.getState().status, 'open');
  });

  it('transitions to half-open after cooldown expires', async () => {
    const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 10 });
    cb.recordFailure();
    assert.equal(cb.getState().status, 'open');

    await sleep(20);

    assert.equal(cb.getState().status, 'half-open');
    assert.equal(cb.canAttempt(), true);
  });

  it('resets to closed on success after half-open', async () => {
    const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 10 });
    cb.recordFailure();

    await sleep(20);

    cb.getState();
    cb.recordSuccess();

    assert.equal(cb.getState().status, 'closed');
    assert.equal(cb.getState().failures, 0);
  });

  it('doubles cooldown on half-open failure', async () => {
    const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 100, maxCooldownMs: 1000 });
    cb.recordFailure();

    await sleep(110);

    cb.getState();
    cb.recordFailure();

    assert.equal(cb.getState().status, 'open');
    assert.equal(cb.getState().currentCooldownMs, 200);
  });

  it('respects maxCooldownMs cap', async () => {
    const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 600, maxCooldownMs: 1000 });
    cb.recordFailure();

    await sleep(610);

    cb.getState();
    cb.recordFailure();

    assert.equal(cb.getState().currentCooldownMs, 1000);
  });

  it('reset clears all state', () => {
    const cb = createCircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    cb.recordFailure();
    assert.equal(cb.getState().status, 'open');

    cb.reset();
    assert.equal(cb.getState().status, 'closed');
    assert.equal(cb.getState().failures, 0);
    assert.equal(cb.canAttempt(), true);
  });
});
