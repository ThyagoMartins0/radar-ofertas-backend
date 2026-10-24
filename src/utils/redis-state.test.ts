import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWorkerHeartbeatFresh } from './redis-state.js';

describe('isWorkerHeartbeatFresh', () => {
  it('aceita heartbeat recente', () => {
    const fresh = isWorkerHeartbeatFresh({
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: null,
      pid: 1,
      host: 'local',
      updatedAt: new Date().toISOString(),
    });
    assert.equal(fresh, true);
  });

  it('rejeita heartbeat expirado', () => {
    const stale = isWorkerHeartbeatFresh({
      status: 'running',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      detail: null,
      pid: 1,
      host: 'local',
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(stale, false);
  });
});
