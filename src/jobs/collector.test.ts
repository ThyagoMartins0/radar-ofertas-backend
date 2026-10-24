import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Job } from 'bullmq';
import { resolveTriggeredAt } from './collector.js';
import type { CollectorJobData } from '../queue/index.js';

describe('resolveTriggeredAt', () => {
  it('retorna triggeredAt do payload', () => {
    const job = {
      data: { kind: 'orchestrate', triggeredAt: '2026-07-23T12:00:00.000Z' },
    } as Job<CollectorJobData>;

    assert.equal(resolveTriggeredAt(job), '2026-07-23T12:00:00.000Z');
  });
});
