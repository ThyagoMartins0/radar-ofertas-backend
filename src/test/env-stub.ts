import { setEnvForTest } from '../config/env.js';
import type { Env } from '../config/env.js';

/**
 * Env mínimo para testes que não precisam de DB/Redis real.
 * Cada teste pode sobrescrever campos específicos com overrides.
 */
export function stubEnv(overrides: Partial<Env> = {}): Env {
  const base: Env = {
    NODE_ENV: 'local',
    APP_TIMEZONE: 'America/Sao_Paulo',
    DATABASE_URL: 'mysql://test:test@localhost:3306/test',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_ENABLED: false,
    WHATSAPP_CHANNEL_ID: 'test-channel-id',
    WHATSAPP_AUTH_PATH: './data/auth_info_baileys',
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_API_TIMEOUT_MS: 20_000,
    ML_AUTH_PATH: './data/ml_auth',
    ML_CATEGORIES: ['MLB1648'],
    ML_SEARCH_LIMIT: 50,
    ML_SCRAPER_USER_AGENT: 'test-agent',
    ML_USE_BROWSER_FALLBACK: false,
    ML_BROWSER_HEADLESS: true,
    ML_LOGIN_CDP_URL: '',
    ML_HTTP_TIMEOUT_MS: 30_000,
    ML_COUPONS_URL: 'https://www.mercadolivre.com.br/afiliados/coupons#hub',
    AMAZON_BASE_URL: 'https://www.amazon.com.br/',
    AMAZON_AFFILIATE_LINK_PREFIX: '',
    AMAZON_AFFILIATE_STORE_ID: '',
    AMAZON_SOURCES: ['https://www.amazon.com.br/b/node/122326793011'],
    AMAZON_SCRAPER_USER_AGENT: 'test-agent',
    AMAZON_USE_BROWSER_FALLBACK: false,
    AMAZON_HTTP_TIMEOUT_MS: 30_000,
    AFFILIATE_CONFIG: { tag: '', baseUrl: 'https://www.mercadolivre.com.br' },
    QUEUE_CONFIG: {
      collectorIntervalMinutes: 15,
      minScore: 50,
      senderConcurrency: 1,
      senderDelayMinutes: 15,
      senderDelayMs: undefined,
      maxPrice: 5000,
      minSoldQuantity: 100,
      operatingHoursStart: 9,
      operatingHoursEnd: 0,
      affiliateLinkDelayMs: 500,
      affiliateLinkBacklogDelayMinutes: 2,
      affiliateLinkBacklogThreshold: 5,
    },
    MANAGER_CAN_SPAWN_WORKERS: true,
    MANAGER_VNC_ENABLED: false,
    MANAGER_NOVNC_PORT: 6080,
    API_PORT: 3001,
    JWT_SECRET: 'test-secret-with-at-least-32-characters-long',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '1h',
    API_ADMIN_USERNAME: 'admin',
    API_ADMIN_PASSWORD: 'admin12345',
    API_CORS_ORIGINS: [],
    ...overrides,
  };

  setEnvForTest(base);
  return base;
}

export function restoreEnv(): void {
  setEnvForTest(undefined);
}
