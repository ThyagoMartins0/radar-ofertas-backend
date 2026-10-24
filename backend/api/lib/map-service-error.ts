import { ConflictError, NotFoundError, ValidationError } from '../errors/api-errors.js';

/** Erros de domínio conhecidos → 4xx. Demais erros de negócio em português → 400. */
export function mapServiceError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Operação falhou';

  if (message.includes('não encontrad')) {
    throw new NotFoundError(message);
  }
  if (
    message.includes('já foi enviad') ||
    message.includes('não pode ser removida') ||
    message.includes('já está configurado')
  ) {
    throw new ConflictError(message);
  }
  if (
    message.includes('Informe') ||
    message.includes('inválid') ||
    message.includes('desabilitado') ||
    message.includes('Nenhum canal') ||
    message.includes('Worker') ||
    message.includes('WhatsApp') ||
    message.includes('Redis') ||
    message.includes('Link') ||
    message.includes('Canal') ||
    message.includes('Grupo') ||
    message.includes('destino')
  ) {
    throw new ValidationError(message);
  }

  throw error instanceof Error ? error : new Error(message);
}
