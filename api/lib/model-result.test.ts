import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConflictError, NotFoundError, ValidationError } from '../errors/api-errors.js';
import { assertOkResult } from './model-result.js';

describe('assertOkResult', () => {
  it('não lança quando ok', () => {
    assert.doesNotThrow(() => assertOkResult({ ok: true }));
  });

  it('mapeia erro de negócio para ValidationError (não 500)', () => {
    assert.throws(
      () =>
        assertOkResult({
          ok: false,
          error: 'Não foi possível resolver o link do canal. Confira o link.',
        }),
      (error: unknown) => error instanceof ValidationError,
    );
  });

  it('mapeia "não encontrado" para NotFoundError', () => {
    assert.throws(
      () => assertOkResult({ ok: false, error: 'Conta WhatsApp não encontrada' }),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  it('mapeia destino duplicado para ConflictError', () => {
    assert.throws(
      () => assertOkResult({ ok: false, error: 'Este destino já está configurado' }),
      (error: unknown) => error instanceof ConflictError,
    );
  });
});
