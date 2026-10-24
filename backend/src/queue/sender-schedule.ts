import {
  getOperatingHoursStart,
  getOperatingHoursEnd,
  getSenderDelayMinutesCached,
} from '../config/queue-config-store.js';
import { env } from '../config/env.js';
import { findLastSentAt, findPendingOfferIds } from '../offers/repository.js';
import {
  isWithinOperatingHoursStored,
  msUntilOperatingWindowStored,
  nowInTimezone,
} from '../utils/datetime.js';

function getOperatingHours() {
  return {
    startHour: getOperatingHoursStart(),
    endHour: getOperatingHoursEnd(),
  };
}

function nextOperatingCursor(cursorMs: number): number {
  const hours = getOperatingHours();
  const stored = new Date(cursorMs);
  if (isWithinOperatingHoursStored(hours, stored)) {
    return cursorMs;
  }
  return cursorMs + msUntilOperatingWindowStored(hours, stored);
}

function advanceCursor(cursorMs: number, senderDelayMs: number): number {
  return nextOperatingCursor(cursorMs + senderDelayMs);
}

export async function estimatePendingSendTimes(offerIds?: string[]): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  const targets = offerIds && offerIds.length > 0 ? new Set(offerIds) : null;

  const pendingIds = await findPendingOfferIds();
  if (pendingIds.length === 0) return result;

  const senderDelayMs = getSenderDelayMinutesCached() * 60 * 1000;
  const storedNowMs = nowInTimezone(env.APP_TIMEZONE).getTime();

  const lastSentAt = await findLastSentAt();
  let cursor = lastSentAt ? lastSentAt.getTime() + senderDelayMs : storedNowMs;
  cursor = Math.max(cursor, storedNowMs);
  cursor = nextOperatingCursor(cursor);

  for (let i = 0; i < pendingIds.length; i++) {
    const offerId = pendingIds[i];
    if (!targets || targets.has(offerId)) {
      result.set(offerId, new Date(cursor));
    }
    if (i < pendingIds.length - 1) {
      cursor = advanceCursor(cursor, senderDelayMs);
    }
  }

  return result;
}
