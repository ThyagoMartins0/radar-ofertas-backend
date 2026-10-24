import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { applyRuntimeEnv } from './runtime-env.js';

describe('applyRuntimeEnv', () => {
  const keys = [
    'RUNNING_IN_DOCKER',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_PORT',
    'MYSQL_DOCKER_HOST',
    'DATABASE_URL',
    'NODE_ENV',
  ] as const;
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      snapshot[key] = process.env[key];
    }
    process.env.RUNNING_IN_DOCKER = '1';
    process.env.MYSQL_USER = 'u';
    process.env.MYSQL_PASSWORD = 'p';
    process.env.MYSQL_DATABASE = 'db';
    process.env.MYSQL_PORT = '3360';
    process.env.MYSQL_DOCKER_HOST = 'host.docker.internal';
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    for (const key of keys) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  });

  it('monta DATABASE_URL com MYSQL_DOCKER_HOST no container', () => {
    applyRuntimeEnv();
    assert.equal(
      process.env.DATABASE_URL,
      'mysql://u:p@host.docker.internal:3360/db',
    );
  });

  it('normaliza NODE_ENV=development para local', () => {
    process.env.NODE_ENV = 'development';
    applyRuntimeEnv();
    assert.equal(process.env.NODE_ENV, 'local');
  });
});
