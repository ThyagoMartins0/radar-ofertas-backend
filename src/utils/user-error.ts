import { Prisma } from '@prisma/client';

export function toUserErrorMessage(error: unknown): string {
  if (error instanceof Prisma.PrismaClientValidationError) {
    if (error.message.includes('dailyMinute') || error.message.includes('daily_minute')) {
      return 'O banco precisa ser atualizado. Rode npm run migrate:deploy && npm run prisma:generate e reinicie o manager.';
    }
    if (error.message.includes('autoMessage') || error.message.includes('auto_messages')) {
      return 'Erro ao acessar mensagens automáticas. Verifique se as migrations foram aplicadas (npm run migrate:deploy).';
    }
    return 'Erro de validação no banco de dados. Confira as migrations e rode npm run prisma:generate.';
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021') {
      return 'Tabela não encontrada no banco. Rode npm run migrate:deploy.';
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
