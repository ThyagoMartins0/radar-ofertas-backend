import { isMysqlError } from '../database/client.js';

export function toUserErrorMessage(error: unknown): string {
  if (isMysqlError(error)) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return 'Tabela não encontrada no banco. Rode npm run migrate:deploy.';
    }
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      return 'O banco precisa ser atualizado. Rode npm run migrate:deploy e reinicie.';
    }
    return `Erro no banco (${error.code}). Tente novamente ou confira os logs.`;
  }

  if (error instanceof Error) {
    const msg = error.message.trim();
    if (msg.length > 280) {
      const firstLine = msg
        .split('\n')
        .find((line) => line.trim())
        ?.trim();
      return firstLine && firstLine.length < 200
        ? firstLine
        : 'Ocorreu um erro inesperado. Tente novamente.';
    }
    return msg || 'Ocorreu um erro inesperado. Tente novamente.';
  }

  return 'Ocorreu um erro inesperado. Tente novamente.';
}
