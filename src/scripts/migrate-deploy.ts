import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Aplica src/database/schema.sql (CREATE TABLE IF NOT EXISTS — seguro rodar a cada deploy). */
async function main(): Promise<void> {
  const schemaPath = path.resolve(import.meta.dirname, '../database/schema.sql');
  const sql = await readFile(schemaPath, 'utf-8');

  const connection = await mysql.createConnection({
    uri: env.DATABASE_URL,
    multipleStatements: true,
  });
  try {
    await connection.query(sql);
    logger.info({ schemaPath }, 'Schema MySQL aplicado');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  logger.error({ error }, 'Falha ao aplicar schema MySQL');
  process.exit(1);
});
