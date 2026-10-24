/**
 * Carregado via --import antes de qualquer teste.
 * Garante que process.env tem os valores mínimos para o Zod parse
 * em config/env.ts passar, mesmo sem .env real.
 */
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.WHATSAPP_CHANNEL_ID ??= 'test-channel-id';
process.env.REDIS_ENABLED ??= 'false';
process.env.ML_SESSION_STORE ??= 'file';
