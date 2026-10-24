import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import { ValidationError } from '../errors/api-errors.js';
import { parseBody, parseQuery } from './validate.js';

describe('parseBody', () => {
  const schema = z.object({
    name: z.string().min(1),
  });

  it('retorna dados válidos', () => {
    assert.deepEqual(parseBody(schema, { name: 'Radar' }), { name: 'Radar' });
  });

  it('lança ValidationError para corpo inválido', () => {
    assert.throws(
      () => parseBody(schema, { name: '' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
  });
});

describe('parseQuery', () => {
  const schema = z.object({
    page: z.coerce.number().int().positive().default(1),
  });

  it('aplica defaults do schema', () => {
    assert.deepEqual(parseQuery(schema, {}), { page: 1 });
  });

  it('lança ValidationError para query inválida', () => {
    assert.throws(
      () => parseQuery(schema, { page: '0' }),
      (error: unknown) => error instanceof ValidationError,
    );
  });
});
