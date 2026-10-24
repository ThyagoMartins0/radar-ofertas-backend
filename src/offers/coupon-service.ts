import { QueueEvents } from 'bullmq';
import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { findAccountById } from '../accounts/repository.js';
import { getEnabledWhatsAppDestinations } from '../accounts/whatsapp-destinations.js';
import { DEFAULT_ACCOUNT_ID } from '../accounts/types.js';
import { CHANNEL_LABELS, getEnabledChannels } from '../channels/index.js';
import type { Channel } from '../channels/types.js';
import type { MlCoupon } from '../mercado-livre/types.js';
import {
  getQueueConnection,
  getSenderQueue,
  getSenderQueueName,
  isRedisEnabled,
  SENDER_JOB_OPTIONS,
  textMessageJobId,
} from '../queue/index.js';
import { logger } from '../utils/logger.js';
import { getWhatsAppSocket, requireWhatsAppSocket, sendOffer } from '../whatsapp/index.js';
import { formatCouponMessage } from './coupon-template.js';

const IMMEDIATE_SEND_TIMEOUT_MS = 90_000;

function channelSendOrder(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => {
    if (a === 'telegram') return -1;
    if (b === 'telegram') return 1;
    return 0;
  });
}

async function sendTextMessageViaQueue(
  channel: Channel,
  accountId: string,
  text: string,
): Promise<void> {
  if (!isRedisEnabled()) {
    throw new Error('Inicie o worker em Configuração para enviar cupons.');
  }

  const queue = getSenderQueue(channel, accountId);
  const queueEvents = new QueueEvents(getSenderQueueName(channel, accountId), {
    connection: getQueueConnection(),
  });
  const suffix = `coupon-${Date.now()}-${accountId}`;

  try {
    await queueEvents.waitUntilReady();
    const job = await queue.add(
      'send-text',
      { text, force: true, accountId },
      { jobId: textMessageJobId(channel, suffix), priority: 1, ...SENDER_JOB_OPTIONS },
    );
    await job.waitUntilFinished(queueEvents, IMMEDIATE_SEND_TIMEOUT_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|timed out/i.test(message)) {
      throw new Error('Tempo esgotado — reinicie o worker em Configuração e tente de novo.');
    }
    throw error;
  } finally {
    await queueEvents.close();
  }
}

async function sendTextMessageNow(channel: Channel, text: string): Promise<void> {
  const accountIds = await getEnabledAccountIdsForChannel(channel);

  for (const accountId of accountIds) {
    if (channel === 'whatsapp' && accountId === DEFAULT_ACCOUNT_ID && getWhatsAppSocket()) {
      const account = await findAccountById(accountId, 'whatsapp');
      if (account?.platform === 'whatsapp') {
        const sock = await requireWhatsAppSocket();
        const destinations = getEnabledWhatsAppDestinations(account.config);
        for (const destination of destinations) {
          if (!destination.jid) continue;
          await sendOffer(sock, destination.jid, null, text);
        }
        continue;
      }
    }

    await sendTextMessageViaQueue(channel, accountId, text);
  }
}

export async function sendCouponToChannelsNow(coupon: MlCoupon): Promise<string> {
  const channels = channelSendOrder(getEnabledChannels());
  if (channels.length === 0) {
    throw new Error('Nenhum canal habilitado — ligue o WhatsApp ou o Telegram.');
  }

  const text = await formatCouponMessage(coupon);
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      await sendTextMessageNow(channel, text);
      logger.info({ channel, couponId: coupon.id }, 'Coupon sent immediately');
      return CHANNEL_LABELS[channel];
    }),
  );

  const sent: string[] = [];
  const errors: string[] = [];

  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index]!;
    const result = results[index]!;
    if (result.status === 'fulfilled') {
      sent.push(result.value);
      continue;
    }

    const reason = result.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    errors.push(`${CHANNEL_LABELS[channel]}: ${message}`);
  }

  if (sent.length === 0) {
    throw new Error(errors.join(' | '));
  }

  if (errors.length > 0) {
    return `Cupom enviado para ${sent.join(' e ')}. Falha: ${errors.join(' | ')}`;
  }

  if (sent.length === 1) return `Cupom enviado para ${sent[0]}.`;
  return `Cupom enviado para ${sent.join(' e ')}.`;
}
