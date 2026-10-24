import { ConflictError, NotFoundError, ValidationError } from '../errors/api-errors.js';

/**
 * SaveResult do manager é erro de negócio esperado — nunca vira 500 genérico.
 * (mapServiceError re-lança Error cru e o error-handler mascara a mensagem.)
 */
export function assertOkResult<T extends { ok: boolean; error?: string }>(
  result: T,
): asserts result is T & { ok: true } {
  if (result.ok) return;

  const message = result.error?.trim() || 'Operação falhou';
  if (/não encontrad/i.test(message)) {
    throw new NotFoundError(message);
  }
  if (/já está configurado|já foi enviad|não pode ser removida/i.test(message)) {
    throw new ConflictError(message);
  }
  throw new ValidationError(message);
}
