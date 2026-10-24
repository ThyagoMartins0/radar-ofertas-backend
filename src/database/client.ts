import { randomUUID } from 'node:crypto';
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';

import { env } from '../config/env.js';

/** Pool ou conexão de uma transação — toda função de consulta aceita os dois. */
export type Db = Pool | PoolConnection;

export type SqlParam = string | number | boolean | Date | null | Buffer;

const globalForDb = globalThis as unknown as { mysqlPool: Pool | undefined };

/**
 * Pool MySQL criado sob demanda a partir de DATABASE_URL.
 * Datas são lidas/gravadas em UTC (`timezone: 'Z'`), DECIMAL volta como number
 * e colunas JSON já chegam parseadas.
 */
export function getPool(): Pool {
  globalForDb.mysqlPool ??= mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: 10,
    timezone: 'Z',
    decimalNumbers: true,
    supportBigNumbers: true,
  });
  return globalForDb.mysqlPool;
}

export async function query<T>(
  sql: string,
  params: SqlParam[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  return rows as unknown as T[];
}

export async function queryOne<T>(
  sql: string,
  params: SqlParam[] = [],
  db: Db = getPool(),
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: SqlParam[] = [],
  db: Db = getPool(),
): Promise<ResultSetHeader> {
  const [result] = await db.query<ResultSetHeader>(sql, params);
  return result;
}

export async function transaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function pingDatabase(): Promise<void> {
  await getPool().query('SELECT 1');
}

export async function closeDatabase(): Promise<void> {
  const pool = globalForDb.mysqlPool;
  globalForDb.mysqlPool = undefined;
  await pool?.end();
}

/** Id de linha novo (UUID; colunas id são VARCHAR(191)). */
export function newId(): string {
  return randomUUID();
}

/** JSON para colunas JSON — mysql2 não serializa objetos como JSON sozinho. */
export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Coluna JSON pode chegar parseada (tipo JSON) ou como string (TEXT / MariaDB). */
export function fromJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** BOOLEAN do MySQL é TINYINT(1) — chega como 0/1. */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function isMysqlError(error: unknown): error is Error & { code: string; errno: number } {
  return error instanceof Error && typeof (error as { errno?: unknown }).errno === 'number';
}
