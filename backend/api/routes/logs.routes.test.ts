import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setEnvForTest } from '../../src/config/env.js';
import { appendLog, type LogEntry } from '../../src/utils/log-store.js';
import { buildApiApp } from '../app.js';
import { buildTestEnv, issueTestAccessToken } from '../test/test-env.js';

function sampleLog(message: string): LogEntry {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'api',
    message,
    pid: process.pid,
    hostname: 'test',
    meta: {},
  };
}

describe('logs routes', () => {
  it('GET /logs exige autenticação', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/logs',
    });

    assert.equal(response.statusCode, 401);

    await app.close();
    setEnvForTest(undefined);
  });

  it('GET /logs retorna payload tipado com token', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();
    const token = await issueTestAccessToken(buildTestEnv());

    await appendLog(sampleLog('integration-test-log'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/logs?limit=50',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      logs: unknown[];
      total: number;
      mlScrapeCount: number;
      mlScrapeLogs: unknown[];
      redisEnabled: boolean;
    };
    assert.ok(Array.isArray(body.logs));
    assert.ok(typeof body.total === 'number');
    assert.ok(typeof body.mlScrapeCount === 'number');
    assert.equal(body.redisEnabled, false);

    await app.close();
    setEnvForTest(undefined);
  });

  it('GET /logs/stream exige autenticação', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/logs/stream',
    });

    assert.equal(response.statusCode, 401);

    await app.close();
    setEnvForTest(undefined);
  });

  it('GET /logs/stream envia evento ready via SSE', async () => {
    setEnvForTest(buildTestEnv());
    const app = await buildApiApp();
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Endereço do servidor indisponível');
    }

    const token = await issueTestAccessToken(buildTestEnv());
    const controller = new AbortController();

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/logs/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const reader = response.body?.getReader();
    assert.ok(reader);

    const decoder = new TextDecoder();
    let buffer = '';
    let sawReady = false;

    const deadline = Date.now() + 5_000;

    while (!sawReady && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('event: ready')) {
        sawReady = true;
      }
    }

    controller.abort();
    await reader.cancel().catch(() => undefined);
    await app.close();
    setEnvForTest(undefined);

    assert.equal(sawReady, true);
  });
});
