import { execute, query, queryOne } from './client.js';

export interface SettingRow {
  key: string;
  value: string;
}

export async function findSetting(key: string): Promise<SettingRow | null> {
  return queryOne<SettingRow>('SELECT `key`, value FROM settings WHERE `key` = ?', [key]);
}

export async function findSettings(keys: string[]): Promise<SettingRow[]> {
  if (keys.length === 0) return [];
  return query<SettingRow>(
    `SELECT \`key\`, value FROM settings WHERE \`key\` IN (${keys.map(() => '?').join(', ')})`,
    keys,
  );
}

export async function upsertSetting(key: string, value: string): Promise<void> {
  await execute(
    `INSERT INTO settings (\`key\`, value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [key, value, new Date()],
  );
}
