function getZonedParts(timeZone: string, instant: Date): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const raw = parts.find((part) => part.type === type)?.value ?? '0';
  return Number.parseInt(raw, 10);
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Horário no fuso informado, persistido como timestamp sem conversão extra —
 * o valor no banco corresponde ao relógio local da região.
 */
export function nowInTimezone(timeZone: string): Date {
  const instant = new Date();
  const parts = getZonedParts(timeZone, instant);

  return new Date(
    Date.UTC(
      partValue(parts, 'year'),
      partValue(parts, 'month') - 1,
      partValue(parts, 'day'),
      partValue(parts, 'hour'),
      partValue(parts, 'minute'),
      partValue(parts, 'second'),
      instant.getMilliseconds(),
    ),
  );
}

export function formatInTimezone(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(value);
}

/** Valor para input datetime-local a partir de Date gravado como relógio local (UTC fields). */
export function toDatetimeLocalInputValue(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

/** Interpreta datetime-local como relógio local da região (mesmo padrão de nowInTimezone). */
export function parseDatetimeLocalValue(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const h = Number(match[4]);
  const min = Number(match[5]);
  const date = new Date(Date.UTC(y, m, d, h, min, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Interpreta input type="time" (HH:mm). */
export function parseTimeInputValue(value: string): { hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatTimeInputValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Formata datas gravadas via nowInTimezone — os componentes de horário
 * já correspondem ao relógio local e estão nos campos UTC do Date.
 */
export function formatStoredLocalDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(value);
}

export function formatIsoInTimezone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatInTimezone(date, timeZone);
}

export interface OperatingHours {
  startHour: number;
  endHour: number;
}

export function getZonedTimeOfDay(
  timeZone: string,
  instant: Date = new Date(),
): { hour: number; minute: number; second: number } {
  const parts = getZonedParts(timeZone, instant);
  return {
    hour: partValue(parts, 'hour'),
    minute: partValue(parts, 'minute'),
    second: partValue(parts, 'second'),
  };
}

function minutesSinceMidnight(hour: number, minute: number, second: number): number {
  return hour * 60 + minute + second / 60;
}

function endMinutes(endHour: number): number {
  return endHour === 0 ? 24 * 60 : endHour * 60;
}

export function isWithinOperatingHours(
  timeZone: string,
  hours: OperatingHours,
  instant: Date = new Date(),
): boolean {
  const { hour, minute, second } = getZonedTimeOfDay(timeZone, instant);
  const current = minutesSinceMidnight(hour, minute, second);
  const start = hours.startHour * 60;
  const end = endMinutes(hours.endHour);
  return current >= start && current < end;
}

export function msUntilOperatingWindow(
  timeZone: string,
  hours: OperatingHours,
  instant: Date = new Date(),
): number {
  if (isWithinOperatingHours(timeZone, hours, instant)) return 0;

  const { hour, minute, second } = getZonedTimeOfDay(timeZone, instant);
  const current = minutesSinceMidnight(hour, minute, second);
  const start = hours.startHour * 60;

  const minutesToWait = current < start ? start - current : 24 * 60 - current + start;

  return Math.max(60_000, Math.ceil(minutesToWait * 60 * 1000));
}

function storedLocalMinutesSinceMidnight(stored: Date): number {
  return stored.getUTCHours() * 60 + stored.getUTCMinutes() + stored.getUTCSeconds() / 60;
}

/** Janela operacional para datas gravadas via nowInTimezone (componentes no UTC do Date). */
export function isWithinOperatingHoursStored(hours: OperatingHours, stored: Date): boolean {
  const current = storedLocalMinutesSinceMidnight(stored);
  const start = hours.startHour * 60;
  const end = endMinutes(hours.endHour);
  return current >= start && current < end;
}

export function msUntilOperatingWindowStored(hours: OperatingHours, stored: Date): number {
  if (isWithinOperatingHoursStored(hours, stored)) return 0;

  const current = storedLocalMinutesSinceMidnight(stored);
  const start = hours.startHour * 60;
  const minutesToWait = current < start ? start - current : 24 * 60 - current + start;

  return Math.max(60_000, Math.ceil(minutesToWait * 60 * 1000));
}
