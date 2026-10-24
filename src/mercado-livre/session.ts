import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { execute, fromJson, queryOne, toJson } from '../database/client.js';
import { logger } from '../utils/logger.js';
import type { StorageState } from './types.js';

const STORAGE_FILE = 'storage-state.json';
const META_FILE = 'session-meta.json';

let activeAuthPath = env.ML_AUTH_PATH;

/** Auth path da conta ML ativa neste processo (default: ML_AUTH_PATH do .env). */
export function getMlAuthPath(): string {
  return activeAuthPath;
}

export function setMlAuthPath(authPath: string): void {
  activeAuthPath = authPath;
}

export interface SessionMeta {
  lastLoginAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

const EMPTY_META: SessionMeta = { lastLoginAt: null, lastRefreshAt: null, lastError: null };

function useDatabase(): boolean {
  return env.ML_SESSION_STORE === 'database';
}

function storagePath(): string {
  return path.join(getMlAuthPath(), STORAGE_FILE);
}

function metaPath(): string {
  return path.join(getMlAuthPath(), META_FILE);
}

export async function ensureAuthDir(): Promise<void> {
  await mkdir(getMlAuthPath(), { recursive: true });
}

async function readStorageFile(): Promise<StorageState | null> {
  try {
    const raw = await readFile(storagePath(), 'utf-8');
    return JSON.parse(raw) as StorageState;
  } catch {
    return null;
  }
}

async function readMetaFile(): Promise<SessionMeta> {
  try {
    const raw = await readFile(metaPath(), 'utf-8');
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return { ...EMPTY_META };
  }
}

interface MlSessionRow {
  storage_state: unknown;
  last_login_at: Date | null;
  last_refresh_at: Date | null;
  last_error: string | null;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

/** Upsert em ml_sessions; só as colunas informadas são atualizadas numa linha existente. */
async function upsertSessionRow(
  authPath: string,
  fields: {
    storage_state?: string;
    last_login_at?: Date | null;
    last_refresh_at?: Date | null;
    last_error?: string | null;
  },
  overwrite = true,
): Promise<void> {
  const fieldColumns = Object.keys(fields) as Array<keyof typeof fields>;
  const columns = ['auth_path', ...fieldColumns, 'updated_at'];
  const values = [authPath, ...fieldColumns.map((column) => fields[column] ?? null), new Date()];
  const updates = overwrite
    ? [...fieldColumns, 'updated_at'].map((column) => `${column} = VALUES(${column})`)
    : ['auth_path = auth_path'];
  await execute(
    `INSERT INTO ml_sessions (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
    values,
  );
}

/** Sessão antiga em arquivo (volume ./data) é copiada para o banco na primeira leitura. */
async function importSessionFileToDatabase(authPath: string): Promise<StorageState | null> {
  const state = await readStorageFile();
  if (!state) return null;

  const meta = await readMetaFile();
  await upsertSessionRow(
    authPath,
    {
      storage_state: toJson(state),
      last_login_at: toDate(meta.lastLoginAt),
      last_refresh_at: toDate(meta.lastRefreshAt),
      last_error: meta.lastError,
    },
    false,
  );
  logger.info({ authPath }, 'Mercado Livre session imported from file to database');
  return state;
}

export async function loadStorageState(): Promise<StorageState | null> {
  if (!useDatabase()) return readStorageFile();

  const authPath = getMlAuthPath();
  try {
    const row = await queryOne<Pick<MlSessionRow, 'storage_state'>>(
      'SELECT storage_state FROM ml_sessions WHERE auth_path = ?',
      [authPath],
    );
    if (row?.storage_state) return fromJson<StorageState>(row.storage_state);
    return await importSessionFileToDatabase(authPath);
  } catch (error) {
    logger.warn({ error, authPath }, 'Failed to load Mercado Livre session from database');
    return null;
  }
}

export async function saveStorageState(state: StorageState): Promise<void> {
  if (!useDatabase()) {
    await ensureAuthDir();
    await writeFile(storagePath(), JSON.stringify(state, null, 2), 'utf-8');
    await updateSessionMeta({ lastRefreshAt: new Date().toISOString(), lastError: null });
    logger.info({ path: storagePath() }, 'Mercado Livre session saved');
    return;
  }

  const authPath = getMlAuthPath();
  await upsertSessionRow(authPath, {
    storage_state: toJson(state),
    last_refresh_at: new Date(),
    last_error: null,
  });
  logger.info({ authPath }, 'Mercado Livre session saved to database');
}

export async function loadSessionMeta(): Promise<SessionMeta> {
  if (!useDatabase()) return readMetaFile();

  const authPath = getMlAuthPath();
  try {
    const row = await queryOne<Omit<MlSessionRow, 'storage_state'>>(
      'SELECT last_login_at, last_refresh_at, last_error FROM ml_sessions WHERE auth_path = ?',
      [authPath],
    );
    if (!row) return { ...EMPTY_META };
    return {
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      lastRefreshAt: row.last_refresh_at?.toISOString() ?? null,
      lastError: row.last_error,
    };
  } catch (error) {
    logger.warn({ error, authPath }, 'Failed to load Mercado Livre session meta from database');
    return { ...EMPTY_META };
  }
}

export async function updateSessionMeta(partial: Partial<SessionMeta>): Promise<void> {
  if (!useDatabase()) {
    await ensureAuthDir();
    const current = await readMetaFile();
    const next = { ...current, ...partial };
    await writeFile(metaPath(), JSON.stringify(next, null, 2), 'utf-8');
    return;
  }

  const fields: Parameters<typeof upsertSessionRow>[1] = {};
  if (partial.lastLoginAt !== undefined) fields.last_login_at = toDate(partial.lastLoginAt);
  if (partial.lastRefreshAt !== undefined) fields.last_refresh_at = toDate(partial.lastRefreshAt);
  if (partial.lastError !== undefined) fields.last_error = partial.lastError;
  await upsertSessionRow(getMlAuthPath(), fields);
}

export function cookiesToHeader(cookies: StorageState['cookies'], domains: string[]): string {
  const allowed = new Set(domains);
  return cookies
    .filter(
      (cookie) =>
        allowed.has(cookie.domain.replace(/^\./, '')) ||
        [...allowed].some((d) => cookie.domain.endsWith(d)),
    )
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function hasValidSession(state: StorageState | null): boolean {
  if (!state?.cookies?.length) return false;
  const now = Date.now() / 1000;
  const sessionCookies = state.cookies.filter(
    (c) => c.name.toLowerCase().includes('session') || c.name === 'ssid',
  );
  if (sessionCookies.length === 0) return state.cookies.length > 3;
  return sessionCookies.some((c) => !c.expires || c.expires > now);
}

export function isSessionExpired(state: StorageState | null): boolean {
  return !hasValidSession(state);
}

const LINK_BUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/link-builder';

export async function refreshSessionCookies(): Promise<StorageState | null> {
  const state = await loadStorageState();
  if (!state) return null;

  const cookieHeader = cookiesToHeader(state.cookies, ['mercadolivre.com.br', 'mercadolibre.com']);

  try {
    const response = await fetch(LINK_BUILDER_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Cookie: cookieHeader,
        'User-Agent': env.ML_SCRAPER_USER_AGENT,
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      await updateSessionMeta({ lastError: `Cookie refresh HTTP ${response.status}` });
      return null;
    }

    const finalUrl = response.url;
    if (/login|registration|account-verification/i.test(finalUrl)) {
      await updateSessionMeta({ lastError: 'Cookie refresh redirected to login' });
      logger.warn('Cookie refresh hit login page — run npm run ml:login');
      return null;
    }

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length === 0) {
      logger.debug('Cookie refresh returned no Set-Cookie headers');
      await updateSessionMeta({ lastRefreshAt: new Date().toISOString() });
      return state;
    }

    const cookieMap = new Map(state.cookies.map((c) => [`${c.domain}:${c.name}`, c]));
    for (const entry of setCookies) {
      const [pair, ...attrs] = entry.split(';').map((s) => s.trim());
      const [name, value] = pair?.split('=') ?? [];
      if (!name || value === undefined) continue;

      let domain = 'mercadolivre.com.br';
      let expires: number | undefined;
      for (const attr of attrs) {
        const [key, val] = attr.split('=');
        if (key?.toLowerCase() === 'domain' && val) domain = val;
        if (key?.toLowerCase() === 'expires' && val) {
          const ts = Date.parse(val) / 1000;
          if (Number.isFinite(ts)) expires = ts;
        }
      }

      cookieMap.set(`${domain}:${name}`, {
        name,
        value,
        domain,
        path: '/',
        expires,
      });
    }

    const refreshed: StorageState = { ...state, cookies: [...cookieMap.values()] };
    await updateSessionMeta({ lastRefreshAt: new Date().toISOString(), lastError: null });
    logger.debug('Mercado Livre session cookies refreshed in memory');
    return refreshed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateSessionMeta({ lastError: message });
    logger.warn({ error }, 'Cookie refresh failed');
    return null;
  }
}
