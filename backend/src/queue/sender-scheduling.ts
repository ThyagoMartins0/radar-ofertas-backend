import type { Channel } from '../channels/types.js';
import { env } from '../config/env.js';
import {
  getOperatingHoursEnd,
  getOperatingHoursStart,
  getSenderDelayMinutesCached,
  hydrateQueueConfigCache,
} from '../config/queue-config-store.js';
import { reserveNextSenderPacingDelayMs } from '../utils/sender-pacing.js';
import { isWithinOperatingHours, msUntilOperatingWindow } from '../utils/datetime.js';

function getOperatingHours() {
  return {
    startHour: getOperatingHoursStart(),
    endHour: getOperatingHoursEnd(),
  };
}

/** Delay BullMQ no enqueue — evita moveToDelayed no worker (filas delayed zumbis). */
export async function computeOfferSendDelayMs(
  channel: Channel,
  accountId: string,
  options: { force?: boolean } = {},
): Promise<number> {
  if (options.force) return 0;

  await hydrateQueueConfigCache();

  let delayMs = 0;
  const operatingHours = getOperatingHours();
  if (!isWithinOperatingHours(env.APP_TIMEZONE, operatingHours)) {
    delayMs = msUntilOperatingWindow(env.APP_TIMEZONE, operatingHours);
  }

  const pacingMs = getSenderDelayMinutesCached() * 60 * 1000;
  if (pacingMs > 0) {
    const pacingDelayMs = await reserveNextSenderPacingDelayMs(channel, accountId, pacingMs);
    if (pacingDelayMs > 0) delayMs = Math.max(delayMs, pacingDelayMs);
  }

  return delayMs;
}
