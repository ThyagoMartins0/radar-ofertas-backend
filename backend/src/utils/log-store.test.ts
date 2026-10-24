import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  appendLog,
  subscribeLogAppended,
  type LogEntry,
} from './log-store.js';

function sampleEntry(message: string): LogEntry {
  return {
    id: `id-${message}`,
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'api',
    message,
    pid: 1,
    hostname: 'test',
    meta: {},
  };
}

describe('log-store subscriptions', () => {
  it('subscribeLogAppended notifica novos logs', async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLogAppended((entry) => {
      seen.push(entry.message);
    });

    await appendLog(sampleEntry('event-a'));
    await appendLog(sampleEntry('event-b'));

    unsubscribe();

    assert.deepEqual(seen, ['event-a', 'event-b']);
  });
});
