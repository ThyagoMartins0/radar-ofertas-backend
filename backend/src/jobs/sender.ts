import { DEFAULT_ACCOUNT_ID } from '../accounts/types.js';
import { DelayedError, Worker } from 'bullmq';
import type { Channel, ChannelPublisher } from '../channels/types.js';
import { fetchAmazonOfferInsights } from '../amazon/index.js';
import { findAutoMessageById } from '../auto-messages/repository.js';
import { markAutoMessageSent, renderAutoMessageContent } from '../auto-messages/service.js';
import { env } from '../config/env.js';
import {
  getOperatingHoursStart,
  getOperatingHoursEnd,
  getSenderDelayMinutesCached,
  hydrateQueueConfigCache,
} from '../config/queue-config-store.js';
import { formatOfferMessage } from '../offers/service.js';
import {
  findDelivery,
  findOfferById,
  markOfferDelivered,
  markOfferDeliveryFailed,
  updateOfferAffiliateLink,
  updateOfferMarketInsights,
} from '../offers/repository.js';
import { buildOfferAffiliateLink, shouldRefreshAmazonAffiliateLink } from '../offers/affiliate-link.js';
import { detectOfferPlatform } from '../offers/platform.js';
import { getQueueConnection, getSenderQueueName, type SenderJobData } from '../queue/index.js';
import { isWithinOperatingHours, msUntilOperatingWindow } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';
import { recordSendSuccess, recordSendFailure } from '../utils/metrics.js';
import { acquireSenderPacingSlot } from '../utils/sender-pacing.js';

// Tempo máximo para gerar o link de afiliado no envio antes de cair no fallback,
// garantindo que uma sessão ML lenta nunca segure a fila de envio.
const AFFILIATE_LINK_SEND_TIMEOUT_MS = 10_000;

function getOperatingHours() {
  return {
    startHour: getOperatingHoursStart(),
    endHour: getOperatingHoursEnd(),
  };
}

async function enforceSenderPacing(
  job: { moveToDelayed: (timestamp: number, token?: string) => Promise<void> },
  channel: Channel,
  accountId: string,
  force: boolean,
  token?: string,
): Promise<void> {
  if (force) return;

  const delayMs = getSenderDelayMinutesCached() * 60 * 1000;
  if (delayMs <= 0) return;

  const waitMs = await acquireSenderPacingSlot(channel, accountId, delayMs);
  if (waitMs > 0) {
    await job.moveToDelayed(Date.now() + waitMs, token);
    throw new DelayedError();
  }
}

function resolveJobAccountId(data: SenderJobData, workerAccountId: string): string {
  return data.accountId ?? (workerAccountId || DEFAULT_ACCOUNT_ID);
}

/** @internal exportado para testes unitários */
export { resolveJobAccountId };

/**
 * Worker de envio de um canal/conta. Cada processo consome a fila da sua conta;
 * o publisher é a única parte específica do canal.
 */
export function startSenderWorker(publisher: ChannelPublisher): Worker<SenderJobData> {
  const { channel, accountId: workerAccountId } = publisher;

  const worker = new Worker<SenderJobData>(
    getSenderQueueName(channel, workerAccountId),
    async (job, token) => {
      await hydrateQueueConfigCache();
      const operatingHours = getOperatingHours();
      const force = job.data.force === true;
      const accountId = resolveJobAccountId(job.data, workerAccountId);
      const { offerId, autoMessageId, text } = job.data;
      const isOfferSend = Boolean(offerId) && !autoMessageId && !text;

      if (!isOfferSend && !force && !isWithinOperatingHours(env.APP_TIMEZONE, operatingHours)) {
        const delayMs = msUntilOperatingWindow(env.APP_TIMEZONE, operatingHours);
        logger.info(
          {
            channel,
            accountId,
            jobId: job.id,
            autoMessageId,
            delayMs,
            timezone: env.APP_TIMEZONE,
            operatingHours,
          },
          'Outside operating hours — delaying send',
        );
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      }

      if (!isOfferSend) {
        await enforceSenderPacing(job, channel, accountId, force, token);
      }

      if (text) {
        try {
          const { messageId } = await publisher.publishText(text);
          logger.info({ channel, accountId, messageId, force }, 'Text message published');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ channel, accountId, error: message }, 'Text message publish failed');
          throw error;
        }

        return;
      }

      if (autoMessageId) {
        const autoMessage = await findAutoMessageById(autoMessageId);
        if (!autoMessage) {
          logger.warn({ channel, accountId, autoMessageId }, 'Auto message not found, skipping');
          return;
        }

        const rendered = renderAutoMessageContent(autoMessage.content);

        try {
          const { messageId } = await publisher.publishText(rendered);
          await markAutoMessageSent(autoMessageId);
          logger.info(
            { channel, accountId, autoMessageId, messageId, title: autoMessage.title, force },
            'Auto message published',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            { channel, accountId, autoMessageId, error: message },
            'Auto message publish failed',
          );
          throw error;
        }

        return;
      }

      if (!offerId) {
        logger.warn(
          { channel, accountId, jobId: job.id },
          'Sender job without offerId or autoMessageId, skipping',
        );
        return;
      }

      const offer = await findOfferById(offerId);
      if (!offer) {
        logger.warn({ channel, accountId, offerId }, 'Offer not found, skipping');
        return;
      }

      const delivery = await findDelivery(offerId, channel, accountId);
      if (delivery?.sentAt) {
        logger.info(
          { channel, accountId, offerId },
          'Offer already sent to this channel/account, skipping',
        );
        return;
      }

      const permalink = offer.permalink;
      const needsAffiliateLink =
        permalink &&
        (!offer.affiliateLink ||
          shouldRefreshAmazonAffiliateLink(permalink, offer.mercadoLivreId, offer.affiliateLink));

      if (needsAffiliateLink) {
        const affiliateLink = await buildOfferAffiliateLink(
          permalink,
          offer.mercadoLivreId,
          undefined,
          {
            allowBrowser: false,
            timeoutMs: AFFILIATE_LINK_SEND_TIMEOUT_MS,
          },
        );
        await updateOfferAffiliateLink(offerId, affiliateLink);
        offer.affiliateLink = affiliateLink;
        logger.info({ channel, accountId, offerId }, 'Affiliate link gerado sob demanda no envio');
      }

      const isAmazonOffer = detectOfferPlatform(offer) === 'amazon';
      const needsAmazonInsights =
        isAmazonOffer &&
        permalink &&
        (offer.rating === null || offer.soldQuantity === null || !offer.salesRank);

      if (needsAmazonInsights) {
        try {
          const insights = await fetchAmazonOfferInsights(permalink);
          if (insights) {
            const salesRank =
              insights.reviewsCount !== null ? String(insights.reviewsCount) : offer.salesRank;
            await updateOfferMarketInsights(offerId, {
              rating: insights.rating ?? offer.rating,
              soldQuantity: insights.soldQuantity ?? offer.soldQuantity,
              salesRank,
              seller: insights.seller ?? offer.seller,
            });
            offer.rating = insights.rating ?? offer.rating;
            offer.soldQuantity = insights.soldQuantity ?? offer.soldQuantity;
            offer.salesRank = salesRank;
            offer.seller = insights.seller ?? offer.seller;
          }
        } catch (error) {
          logger.warn({ channel, accountId, offerId, error }, 'Falha ao enriquecer oferta Amazon');
        }
      }

      const caption = await formatOfferMessage(offer);

      try {
        const { messageId } = await publisher.publish(offer, caption);
        await markOfferDelivered(offerId, channel, messageId, accountId);
        recordSendSuccess(channel, accountId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markOfferDeliveryFailed(offerId, channel, message, accountId).catch(() => {});
        recordSendFailure(channel, accountId);
        throw error;
      }

      logger.info({ channel, accountId, offerId, title: offer.title, force }, 'Offer published');
    },
    {
      connection: getQueueConnection(),
      concurrency: env.QUEUE_CONFIG.senderConcurrency,
      // Link afiliado + enriquecimento Amazon + publicação WhatsApp podem passar de 30s.
      lockDuration: 120_000,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      { channel, accountId: workerAccountId, jobId: job?.id, error },
      'Sender job failed',
    );
  });

  return worker;
}
