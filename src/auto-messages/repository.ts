import { execute, newId, query, queryOne, toBool, type SqlParam } from '../database/client.js';
import type { AutoMessageRecord, AutoMessageScheduleType } from './types.js';

interface AutoMessageRow {
  id: string;
  title: string;
  content: string;
  scheduleType: string;
  scheduledAt: Date | null;
  dailyHour: number | null;
  dailyMinute: number | null;
  enabled: unknown;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_AUTO_MESSAGE = `SELECT id, title, content, schedule_type AS scheduleType,
  scheduled_at AS scheduledAt, daily_hour AS dailyHour, daily_minute AS dailyMinute, enabled,
  last_sent_at AS lastSentAt, created_at AS createdAt, updated_at AS updatedAt
  FROM auto_messages`;

function mapRow(row: AutoMessageRow): AutoMessageRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    scheduleType: row.scheduleType as AutoMessageScheduleType,
    scheduledAt: row.scheduledAt,
    dailyHour: row.dailyHour,
    dailyMinute: row.dailyMinute,
    enabled: toBool(row.enabled),
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findAllAutoMessages(): Promise<AutoMessageRecord[]> {
  const rows = await query<AutoMessageRow>(`${SELECT_AUTO_MESSAGE} ORDER BY created_at DESC`);
  return rows.map(mapRow);
}

export async function findAutoMessageById(id: string): Promise<AutoMessageRecord | null> {
  const row = await queryOne<AutoMessageRow>(`${SELECT_AUTO_MESSAGE} WHERE id = ?`, [id]);
  return row ? mapRow(row) : null;
}

export async function findEnabledDailyAutoMessages(): Promise<AutoMessageRecord[]> {
  const rows = await query<AutoMessageRow>(
    `${SELECT_AUTO_MESSAGE}
     WHERE schedule_type = 'daily' AND enabled = true
     ORDER BY created_at ASC`,
  );
  return rows.map(mapRow);
}

export async function findDueOnceAutoMessages(now: Date): Promise<AutoMessageRecord[]> {
  const rows = await query<AutoMessageRow>(
    `${SELECT_AUTO_MESSAGE}
     WHERE schedule_type = 'once' AND enabled = true AND scheduled_at <= ? AND last_sent_at IS NULL
     ORDER BY scheduled_at ASC`,
    [now],
  );
  return rows.map(mapRow);
}

export interface CreateAutoMessageInput {
  title: string;
  content: string;
  scheduleType?: AutoMessageScheduleType;
  scheduledAt?: Date | null;
  dailyHour?: number | null;
  dailyMinute?: number | null;
  enabled?: boolean;
}

export async function createAutoMessage(input: CreateAutoMessageInput): Promise<AutoMessageRecord> {
  const id = newId();
  const now = new Date();
  await execute(
    `INSERT INTO auto_messages
       (id, title, content, schedule_type, scheduled_at, daily_hour, daily_minute, enabled,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.content,
      input.scheduleType ?? 'manual',
      input.scheduledAt ?? null,
      input.dailyHour ?? null,
      input.dailyMinute ?? 0,
      input.enabled ?? true,
      now,
      now,
    ],
  );
  const created = await findAutoMessageById(id);
  if (!created) throw new Error(`Mensagem automática ${id} não encontrada após criar`);
  return created;
}

export interface UpdateAutoMessageInput {
  title?: string;
  content?: string;
  scheduleType?: AutoMessageScheduleType;
  scheduledAt?: Date | null;
  dailyHour?: number | null;
  dailyMinute?: number | null;
  enabled?: boolean;
  lastSentAt?: Date | null;
}

const UPDATE_COLUMNS: Record<keyof UpdateAutoMessageInput, string> = {
  title: 'title',
  content: 'content',
  scheduleType: 'schedule_type',
  scheduledAt: 'scheduled_at',
  dailyHour: 'daily_hour',
  dailyMinute: 'daily_minute',
  enabled: 'enabled',
  lastSentAt: 'last_sent_at',
};

export async function updateAutoMessage(
  id: string,
  input: UpdateAutoMessageInput,
): Promise<AutoMessageRecord | null> {
  try {
    const sets = ['updated_at = ?'];
    const params: SqlParam[] = [new Date()];
    for (const key of Object.keys(UPDATE_COLUMNS) as Array<keyof UpdateAutoMessageInput>) {
      const value = input[key];
      if (value === undefined) continue;
      sets.push(`${UPDATE_COLUMNS[key]} = ?`);
      params.push(value);
    }

    const result = await execute(`UPDATE auto_messages SET ${sets.join(', ')} WHERE id = ?`, [
      ...params,
      id,
    ]);
    if (result.affectedRows === 0) return null;
    return await findAutoMessageById(id);
  } catch {
    return null;
  }
}

export async function deleteAutoMessage(id: string): Promise<boolean> {
  try {
    const result = await execute('DELETE FROM auto_messages WHERE id = ?', [id]);
    return result.affectedRows > 0;
  } catch {
    return false;
  }
}
