import { prisma } from '../database/client.js';
import type { AutoMessageRecord, AutoMessageScheduleType } from './types.js';

function mapRow(row: {
  id: string;
  title: string;
  content: string;
  scheduleType: string;
  scheduledAt: Date | null;
  dailyHour: number | null;
  dailyMinute: number | null;
  enabled: boolean;
  lastSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AutoMessageRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    scheduleType: row.scheduleType as AutoMessageScheduleType,
    scheduledAt: row.scheduledAt,
    dailyHour: row.dailyHour,
    dailyMinute: row.dailyMinute,
    enabled: row.enabled,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findAllAutoMessages(): Promise<AutoMessageRecord[]> {
  const rows = await prisma.autoMessage.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(mapRow);
}

export async function findAutoMessageById(id: string): Promise<AutoMessageRecord | null> {
  const row = await prisma.autoMessage.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
}

export async function findEnabledDailyAutoMessages(): Promise<AutoMessageRecord[]> {
  const rows = await prisma.autoMessage.findMany({
    where: { scheduleType: 'daily', enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(mapRow);
}

export async function findDueOnceAutoMessages(now: Date): Promise<AutoMessageRecord[]> {
  const rows = await prisma.autoMessage.findMany({
    where: {
      scheduleType: 'once',
      enabled: true,
      scheduledAt: { lte: now },
      lastSentAt: null,
    },
    orderBy: { scheduledAt: 'asc' },
  });
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
  const row = await prisma.autoMessage.create({
    data: {
      title: input.title,
      content: input.content,
      scheduleType: input.scheduleType ?? 'manual',
      scheduledAt: input.scheduledAt ?? null,
      dailyHour: input.dailyHour ?? null,
      dailyMinute: input.dailyMinute ?? 0,
      enabled: input.enabled ?? true,
    },
  });
  return mapRow(row);
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

export async function updateAutoMessage(
  id: string,
  input: UpdateAutoMessageInput,
): Promise<AutoMessageRecord | null> {
  try {
    const row = await prisma.autoMessage.update({ where: { id }, data: input });
    return mapRow(row);
  } catch {
    return null;
  }
}

export async function deleteAutoMessage(id: string): Promise<boolean> {
  try {
    await prisma.autoMessage.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}
