import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UnauthorizedError } from '../errors/api-errors.js';
import {
  parseDurationToSeconds,
  generateRefreshTokenValue,
} from './refresh-token-store.js';
import { verifyAccessToken } from './auth.service.js';
import { setEnvForTest, type Env } from '../../src/config/env.js';

function buildTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'local',
    APP_TIMEZONE: 'America/Sao_Paulo',
    DATABASE_URL: 'mysql://radar:radar_secret@localhost:3306/radar_ofertas',
    REDIS_URL: 'redis://localhost:6379',
    WHATSAPP_CHANNEL_ID: '',
    WHATSAPP_AUTH_PATH: './data/auth_info_baileys',
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: '',
    TELEGRAM_API_TIMEOUT_MS: 20_000,
    ML_AUTH_PATH: './data/ml_auth',
    ML_CATEGORIES: ['MLB1648'],
    ML_SEARCH_LIMIT: 50,
    ML_SCRAPER_USER_AGENT: 'test',
    ML_USE_BROWSER_FALLBACK: true,
    ML_BROWSER_HEADLESS: true,
    ML_LOGIN_CDP_URL: '',
    ML_HTTP_TIMEOUT_MS: 30_000,
    ML_COUPONS_URL: 'https://www.mercadolivre.com.br/afiliados/coupons#hub',
    AMAZON_BASE_URL: 'https://www.amazon.com.br/',
    AMAZON_AFFILIATE_LINK_PREFIX: '',
    AMAZON_AFFILIATE_STORE_ID: '',
    AMAZON_SOURCES: [],
    AMAZON_SCRAPER_USER_AGENT: 'test',
    AMAZON_USE_BROWSER_FALLBACK: true,
    AMAZON_HTTP_TIMEOUT_MS: 30_000,
    AFFILIATE_CONFIG: { tag: '', baseUrl: 'https://www.mercadolivre.com.br' },
    QUEUE_CONFIG: {
      collectorIntervalMinutes: 15,
      minScore: 50,
      senderConcurrency: 1,
      senderDelayMinutes: 15,
      maxPrice: 5000,
      minSoldQuantity: 100,
      operatingHoursStart: 9,
      operatingHoursEnd: 0,
      affiliateLinkDelayMs: 500,
      affiliateLinkBacklogDelayMinutes: 2,
      affiliateLinkBacklogThreshold: 5,
    },
    REDIS_ENABLED: true,
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
}

describe('refresh-token-store', () => {
  it('parseDurationToSeconds converte 1h para 3600', () => {
    assert.equal(parseDurationToSeconds('1h'), 3600);
    assert.equal(parseDurationToSeconds('15m'), 900);
    assert.equal(parseDurationToSeconds('30s'), 30);
  });

  it('generateRefreshTokenValue retorna token opaco', () => {
    const token = generateRefreshTokenValue();
    assert.ok(token.length >= 32);
    assert.notEqual(token, generateRefreshTokenValue());
  });
});

describe('auth.service verifyAccessToken', () => {
  it('rejeita token inválido', async () => {
    setEnvForTest(buildTestEnv());
    await assert.rejects(
      () => verifyAccessToken('token-invalido'),
      (error: unknown) => error instanceof UnauthorizedError,
    );
    setEnvForTest(undefined);
  });
});
