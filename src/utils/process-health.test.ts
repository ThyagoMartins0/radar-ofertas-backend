import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stubEnv } from '../test/env-stub.js';
import {
  getCollectorHealthSnapshot,
  getWorkerHealthSnapshot,
  processHealthHttpStatus,
} from './process-health.js';

stubEnv({ REDIS_ENABLED: false });

describe('process-health', () => {
  it('retorna unavailable quando Redis está desabilitado', async () => {
    const collector = await getCollectorHealthSnapshot();
    const worker = await getWorkerHealthSnapshot();

    assert.equal(collector.status, 'unavailable');
    assert.equal(worker.status, 'unavailable');
    assert.equal(processHealthHttpStatus(collector), 503);
  });
});
