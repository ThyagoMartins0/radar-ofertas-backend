import { getEnabledChannels } from '../channels/index.js';
import type { Channel } from '../channels/types.js';
import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { getBrandName } from '../config/brand-config.js';
import { env } from '../config/env.js';
import {
  cancelScheduledAutoMessageJobs,
  enqueueAutoMessageSend,
  enqueueScheduledAutoMessageSend,
} from '../queue/index.js';
import {
  formatIsoInTimezone,
  formatStoredLocalDate,
  formatTimeInputValue,
  getZonedTimeOfDay,
  parseDatetimeLocalValue,
  parseTimeInputValue,
} from '../utils/datetime.js';
import { logger } from '../utils/logger.js';
import { toUserErrorMessage } from '../utils/user-error.js';
import {
  createAutoMessage,
  deleteAutoMessage,
  findAllAutoMessages,
  findAutoMessageById,
  findDueOnceAutoMessages,
  findEnabledDailyAutoMessages,
  updateAutoMessage,
  type CreateAutoMessageInput,
  type UpdateAutoMessageInput,
} from './repository.js';
import {
  AUTO_MESSAGE_SCHEDULE_TYPES,
  type AutoMessageRecord,
  type AutoMessageScheduleType,
} from './types.js';

export function parseScheduleType(value: string): AutoMessageScheduleType | null {
  return AUTO_MESSAGE_SCHEDULE_TYPES.includes(value as AutoMessageScheduleType)
    ? (value as AutoMessageScheduleType)
    : null;
}

export function renderAutoMessageContent(content: string): string {
  const now = new Date();
  const replacements: Record<string, string> = {
    brand: getBrandName(),
    date: formatIsoInTimezone(now.toISOString(), env.APP_TIMEZONE).slice(0, 10),
    time: formatIsoInTimezone(now.toISOString(), env.APP_TIMEZONE).slice(11, 16),
  };

  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
  }
  return result.trim();
}

export function describeAutoMessageSchedule(message: AutoMessageRecord): string {
  if (!message.enabled) return 'Pausada';
  if (message.scheduleType === 'daily' && message.dailyHour !== null) {
    const minute = message.dailyMinute ?? 0;
    return `Diário às ${formatTimeInputValue(message.dailyHour, minute)}`;
  }
  if (message.scheduleType === 'once' && message.scheduledAt) {
    return `Programada para ${formatStoredLocalDate(message.scheduledAt)}`;
  }
  return 'Salva — envio manual';
}

export async function listAutoMessages(): Promise<AutoMessageRecord[]> {
  return findAllAutoMessages();
}

function buildScheduleSummary(
  scheduleType: AutoMessageScheduleType,
  scheduledAt: Date | null,
  dailyHour: number | null,
  dailyMinute: number | null,
): string {
  if (scheduleType === 'once' && scheduledAt) {
    return `Envio programado para ${formatStoredLocalDate(scheduledAt)}.`;
  }
  if (scheduleType === 'daily' && dailyHour !== null) {
    return `Envio diário às ${formatTimeInputValue(dailyHour, dailyMinute ?? 0)}.`;
  }
  return 'Mensagem salva. Use Enviar agora quando quiser publicar.';
}

export async function saveAutoMessageFromForm(
  form: Record<string, string>,
  id?: string,
): Promise<{ ok: true; id: string; summary: string } | { ok: false; error: string }> {
  try {
    const title = form.title?.trim() ?? '';
    const content = form.content?.trim() ?? '';
    if (!title) return { ok: false, error: 'Informe um título para a mensagem.' };
    if (!content) return { ok: false, error: 'Informe o texto da mensagem.' };

    const scheduleType = parseScheduleType(form.scheduleType ?? 'manual') ?? 'manual';
    const enabled = !('enabled' in form) || form.enabled === '1';

    let scheduledAt: Date | null = null;
    let dailyHour: number | null = null;
    let dailyMinute: number | null = null;

    if (scheduleType === 'once') {
      const raw = form.scheduledAt?.trim();
      if (!raw) return { ok: false, error: 'Informe data e hora para programar o envio.' };
      scheduledAt = parseDatetimeLocalValue(raw);
      if (!scheduledAt) return { ok: false, error: 'Data/hora inválida.' };
      if (scheduledAt.getTime() <= Date.now()) {
        return { ok: false, error: 'A data/hora deve ser no futuro.' };
      }
    }

    if (scheduleType === 'daily') {
      const parsed = parseTimeInputValue(form.dailyTime ?? '08:00');
      if (!parsed) return { ok: false, error: 'Informe um horário válido (ex: 08:00).' };
      dailyHour = parsed.hour;
      dailyMinute = parsed.minute;
    }

    const payload: CreateAutoMessageInput & UpdateAutoMessageInput = {
      title,
      content,
      scheduleType,
      scheduledAt: scheduleType === 'once' ? scheduledAt : null,
      dailyHour: scheduleType === 'daily' ? dailyHour : null,
      dailyMinute: scheduleType === 'daily' ? dailyMinute : 0,
      enabled,
      ...(scheduleType === 'once' ? { lastSentAt: null } : {}),
    };

    if (id) {
      await cancelScheduledAutoMessageJobs(id);
      const updated = await updateAutoMessage(id, payload);
      if (!updated) return { ok: false, error: 'Mensagem não encontrada.' };
      if (scheduleType === 'once' && scheduledAt) {
        await scheduleAutoMessage(updated.id, scheduledAt);
      }
      return {
        ok: true,
        id: updated.id,
        summary: buildScheduleSummary(scheduleType, scheduledAt, dailyHour, dailyMinute),
      };
    }

    const created = await createAutoMessage(payload);
    if (scheduleType === 'once' && scheduledAt) {
      await scheduleAutoMessage(created.id, scheduledAt);
    }
    return {
      ok: true,
      id: created.id,
      summary: buildScheduleSummary(scheduleType, scheduledAt, dailyHour, dailyMinute),
    };
  } catch (error) {
    return { ok: false, error: toUserErrorMessage(error) };
  }
}

export async function removeAutoMessage(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await findAutoMessageById(id);
  if (!existing) return { ok: false, error: 'Mensagem não encontrada.' };
  await cancelScheduledAutoMessageJobs(id);
  const deleted = await deleteAutoMessage(id);
  return deleted ? { ok: true } : { ok: false, error: 'Não foi possível excluir a mensagem.' };
}

export async function dispatchAutoMessage(
  autoMessageId: string,
  options: { force?: boolean; channels?: Channel[] } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = await findAutoMessageById(autoMessageId);
  if (!message) return { ok: false, error: 'Mensagem não encontrada.' };

  const channels = options.channels ?? getEnabledChannels();
  if (channels.length === 0) {
    return { ok: false, error: 'Nenhum canal de envio está ativo.' };
  }

  for (const channel of channels) {
    const accountIds = await getEnabledAccountIdsForChannel(channel);
    for (const accountId of accountIds) {
      await enqueueAutoMessageSend(channel, autoMessageId, accountId, {
        force: options.force === true,
      });
    }
  }

  logger.info({ autoMessageId, channels, force: options.force }, 'Auto message enqueued');
  return { ok: true };
}

export async function scheduleAutoMessage(
  autoMessageId: string,
  scheduledAt: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = await findAutoMessageById(autoMessageId);
  if (!message) return { ok: false, error: 'Mensagem não encontrada.' };

  const delayMs = scheduledAt.getTime() - Date.now();
  if (delayMs <= 0) {
    return dispatchAutoMessage(autoMessageId);
  }

  const channels = getEnabledChannels();
  if (channels.length === 0) {
    return { ok: false, error: 'Nenhum canal de envio está ativo.' };
  }

  await cancelScheduledAutoMessageJobs(autoMessageId);

  await updateAutoMessage(autoMessageId, {
    scheduleType: 'once',
    scheduledAt,
    enabled: true,
    lastSentAt: null,
  });

  for (const channel of channels) {
    const accountIds = await getEnabledAccountIdsForChannel(channel);
    for (const accountId of accountIds) {
      await enqueueScheduledAutoMessageSend(channel, autoMessageId, delayMs, accountId);
    }
  }

  logger.info(
    { autoMessageId, scheduledAt: scheduledAt.toISOString(), channels },
    'Auto message scheduled',
  );
  return { ok: true };
}

export async function markAutoMessageSent(autoMessageId: string): Promise<void> {
  const message = await findAutoMessageById(autoMessageId);
  if (!message) return;

  await updateAutoMessage(autoMessageId, {
    lastSentAt: new Date(),
    ...(message.scheduleType === 'once' ? { scheduledAt: null, enabled: false } : {}),
  });
}

function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(a) === fmt.format(b);
}

/** Verifica mensagens diárias e programadas que já passaram do horário e enfileira. */
export async function processScheduledAutoMessages(): Promise<void> {
  const now = new Date();
  const { hour: localHour, minute: localMinute } = getZonedTimeOfDay(env.APP_TIMEZONE, now);

  const dailyMessages = await findEnabledDailyAutoMessages();
  for (const message of dailyMessages) {
    if (message.dailyHour !== localHour) continue;
    if ((message.dailyMinute ?? 0) !== localMinute) continue;
    if (message.lastSentAt && isSameLocalDay(message.lastSentAt, now, env.APP_TIMEZONE)) continue;
    await dispatchAutoMessage(message.id);
  }

  const dueOnce = await findDueOnceAutoMessages(now);
  for (const message of dueOnce) {
    await dispatchAutoMessage(message.id);
  }
}

export const AUTO_MESSAGE_PLACEHOLDERS = [
  { key: 'brand', label: 'Nome do canal', example: 'Radar Ofertas' },
  { key: 'date', label: 'Data de hoje', example: '22/07/2026' },
  { key: 'time', label: 'Hora atual', example: '08:00' },
] as const;
