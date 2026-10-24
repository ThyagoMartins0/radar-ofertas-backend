import type {
  Offer as PrismaOffer,
  OfferDelivery as PrismaOfferDelivery,
  Prisma,
} from '@prisma/client';
import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { CHANNELS, type Channel } from '../channels/types.js';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { nowInTimezone } from '../utils/datetime.js';
import type { CreateOfferInput, DeliveryRecord, OfferRecord } from './types.js';

function toRecord(offer: PrismaOffer): OfferRecord {
  return {
    id: offer.id,
    mercadoLivreId: offer.mercadoLivreId,
    title: offer.title,
    price: Number(offer.price),
    oldPrice: offer.oldPrice ? Number(offer.oldPrice) : null,
    discount: offer.discount,
    image: offer.image,
    permalink: offer.permalink,
    affiliateLink: offer.affiliateLink,
    rating: offer.rating,
    soldQuantity: offer.soldQuantity,
    salesRank: offer.salesRank,
    seller: offer.seller,
    officialStore: offer.officialStore,
    bestSeller: offer.bestSeller,
    score: offer.score,
    sentAt: offer.sentAt,
    createdAt: offer.createdAt,
  };
}

export async function offerExists(mercadoLivreId: string): Promise<boolean> {
  const count = await prisma.offer.count({ where: { mercadoLivreId } });
  return count > 0;
}

/** Id da oferta com este mercadoLivreId, ou null. Usado para topar entregas
 * faltantes quando o mesmo produto reaparece na coleta de outro canal. */
export async function findOfferIdByMercadoLivreId(mercadoLivreId: string): Promise<string | null> {
  const offer = await prisma.offer.findUnique({
    where: { mercadoLivreId },
    select: { id: true },
  });
  return offer?.id ?? null;
}

/**
 * Canais em que todas as contas habilitadas já concluíram o envio (sentAt preenchido).
 * Entregas pendentes ou com falha não contam — permitem reenfileirar na próxima coleta.
 */
export async function findExistingDeliveryChannels(offerId: string): Promise<Channel[]> {
  const deliveries = await prisma.offerDelivery.findMany({
    where: { offerId },
    select: { channel: true, accountId: true, sentAt: true },
  });

  const sentByChannel = new Map<string, Set<string>>();
  for (const row of deliveries) {
    if (!row.sentAt) continue;
    const accounts = sentByChannel.get(row.channel) ?? new Set<string>();
    accounts.add(row.accountId);
    sentByChannel.set(row.channel, accounts);
  }

  const complete: Channel[] = [];
  for (const channel of CHANNELS) {
    const required = await getEnabledAccountIdsForChannel(channel);
    const sent = sentByChannel.get(channel);
    if (sent && required.every((accountId) => sent.has(accountId))) {
      complete.push(channel);
    }
  }
  return complete;
}

export async function findPendingDeliveries(): Promise<
  Array<{ offerId: string; channel: Channel; accountId: string }>
> {
  const rows = await prisma.offerDelivery.findMany({
    where: { sentAt: null },
    select: { offerId: true, channel: true, accountId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    offerId: row.offerId,
    channel: row.channel as Channel,
    accountId: row.accountId,
  }));
}

export async function sentOfferExistsByTitleAndPrice(
  title: string,
  price: number,
): Promise<boolean> {
  const count = await prisma.offer.count({
    where: {
      title,
      price,
      sentAt: { not: null },
    },
  });
  return count > 0;
}

export async function createOffer(input: CreateOfferInput): Promise<OfferRecord> {
  const offer = await prisma.offer.create({
    data: {
      ...input,
      createdAt: nowInTimezone(env.APP_TIMEZONE),
    },
  });
  return toRecord(offer);
}

export async function findOfferById(id: string): Promise<OfferRecord | null> {
  const offer = await prisma.offer.findUnique({ where: { id } });
  return offer ? toRecord(offer) : null;
}

export async function updateOfferAffiliateLink(id: string, affiliateLink: string): Promise<void> {
  await prisma.offer.update({
    where: { id },
    data: { affiliateLink },
  });
}

export async function updateOfferMarketInsights(
  id: string,
  data: {
    rating?: number | null;
    soldQuantity?: number | null;
    salesRank?: string | null;
    seller?: string | null;
  },
): Promise<void> {
  await prisma.offer.update({
    where: { id },
    data,
  });
}

// --- Entregas por canal -------------------------------------------------------

function toDeliveryRecord(delivery: PrismaOfferDelivery): DeliveryRecord {
  return {
    id: delivery.id,
    offerId: delivery.offerId,
    channel: delivery.channel as Channel,
    accountId: delivery.accountId,
    sentAt: delivery.sentAt,
    messageId: delivery.messageId,
    error: delivery.error,
    createdAt: delivery.createdAt,
  };
}

/**
 * Abre (ou reabre) a entrega pendente de um canal. Chamado no enfileiramento —
 * a linha com sentAt nulo é o registro de "esta oferta deve ir para este canal".
 * Idempotente: reenfileirar limpa o erro anterior sem apagar um envio concluído.
 */
export async function openOfferDelivery(
  offerId: string,
  channel: Channel,
  accountId = 'default',
): Promise<void> {
  await prisma.offerDelivery.upsert({
    where: { offerId_channel_accountId: { offerId, channel, accountId } },
    update: { error: null },
    create: { offerId, channel, accountId },
  });
}

/**
 * Fecha a entrega como enviada e denormaliza o primeiro envio em Offer.sentAt.
 * As duas escritas vão numa transação: o dedup por título+preço lê Offer.sentAt,
 * então ele nunca pode divergir das entregas.
 */
export async function markOfferDelivered(
  offerId: string,
  channel: Channel,
  messageId: string,
  accountId = 'default',
): Promise<void> {
  const sentAt = nowInTimezone(env.APP_TIMEZONE);

  await prisma.$transaction([
    prisma.offerDelivery.upsert({
      where: { offerId_channel_accountId: { offerId, channel, accountId } },
      update: { sentAt, messageId, error: null },
      create: { offerId, channel, accountId, sentAt, messageId },
    }),
    // Só o primeiro canal a concluir grava — updateMany com sentAt: null evita
    // sobrescrever a marca de um canal que publicou antes.
    prisma.offer.updateMany({
      where: { id: offerId, sentAt: null },
      data: { sentAt },
    }),
  ]);
}

/** Registra a falha na entrega do canal, preservando o motivo para o painel. */
export async function markOfferDeliveryFailed(
  offerId: string,
  channel: Channel,
  error: string,
  accountId = 'default',
): Promise<void> {
  await prisma.offerDelivery.upsert({
    where: { offerId_channel_accountId: { offerId, channel, accountId } },
    update: { error: error.slice(0, 500) },
    create: { offerId, channel, accountId, error: error.slice(0, 500) },
  });
}

export async function findDelivery(
  offerId: string,
  channel: Channel,
  accountId = 'default',
): Promise<DeliveryRecord | null> {
  const delivery = await prisma.offerDelivery.findUnique({
    where: { offerId_channel_accountId: { offerId, channel, accountId } },
  });
  return delivery ? toDeliveryRecord(delivery) : null;
}

export async function findDeliveriesByOffer(offerId: string): Promise<DeliveryRecord[]> {
  const deliveries = await prisma.offerDelivery.findMany({
    where: { offerId },
    orderBy: { channel: 'asc' },
  });
  return deliveries.map(toDeliveryRecord);
}

/** Entregas de várias ofertas de uma vez — evita N+1 nas listagens do painel. */
export async function findDeliveriesByOfferIds(
  offerIds: string[],
): Promise<Map<string, DeliveryRecord[]>> {
  if (offerIds.length === 0) return new Map();

  const deliveries = await prisma.offerDelivery.findMany({
    where: { offerId: { in: offerIds } },
    orderBy: { channel: 'asc' },
  });

  const byOffer = new Map<string, DeliveryRecord[]>();
  for (const delivery of deliveries) {
    const list = byOffer.get(delivery.offerId) ?? [];
    list.push(toDeliveryRecord(delivery));
    byOffer.set(delivery.offerId, list);
  }
  return byOffer;
}

export async function offerWasSentTo(
  offerId: string,
  channel: Channel,
  accountId = 'default',
): Promise<boolean> {
  const count = await prisma.offerDelivery.count({
    where: { offerId, channel, accountId, sentAt: { not: null } },
  });
  return count > 0;
}

export type OfferSentFilter = 'all' | 'pending' | 'sent' | 'error';
export type OfferOriginFilter = 'all' | 'mercado_livre' | 'amazon';
export type OfferDestinationFilter = 'all' | 'whatsapp' | 'telegram';

export interface OfferStats {
  total: number;
  pending: number;
  sent: number;
}

export interface FindOffersOptions {
  sent?: OfferSentFilter;
  origin?: OfferOriginFilter;
  destination?: OfferDestinationFilter;
  limit?: number;
  offset?: number;
}

function statusWhere(sent: OfferSentFilter = 'all'): Prisma.OfferWhereInput {
  if (sent === 'pending') {
    return {
      sentAt: null,
      NOT: {
        deliveries: {
          some: { error: { not: null }, sentAt: null },
        },
      },
    };
  }
  if (sent === 'sent') return { sentAt: { not: null } };
  if (sent === 'error') {
    return {
      sentAt: null,
      deliveries: {
        some: { error: { not: null }, sentAt: null },
      },
    };
  }
  return {};
}

function originWhere(origin: OfferOriginFilter = 'all'): Prisma.OfferWhereInput {
  if (origin === 'amazon') {
    return {
      OR: [
        { permalink: { contains: 'amazon', mode: 'insensitive' } },
        {
          AND: [
            { NOT: { mercadoLivreId: { startsWith: 'MLB', mode: 'insensitive' } } },
            { NOT: { mercadoLivreId: { startsWith: 'mlb' } } },
            { permalink: { equals: null } },
          ],
        },
      ],
    };
  }
  if (origin === 'mercado_livre') {
    return {
      OR: [
        { mercadoLivreId: { startsWith: 'MLB', mode: 'insensitive' } },
        { permalink: { contains: 'mercadolivre', mode: 'insensitive' } },
        { permalink: { contains: 'mercadolibre', mode: 'insensitive' } },
      ],
    };
  }
  return {};
}

function destinationWhere(
  destination: OfferDestinationFilter = 'all',
): Prisma.OfferWhereInput {
  if (destination === 'whatsapp' || destination === 'telegram') {
    return { deliveries: { some: { channel: destination } } };
  }
  return {};
}

function buildOffersWhere(options: FindOffersOptions): Prisma.OfferWhereInput {
  const parts = [
    statusWhere(options.sent ?? 'all'),
    originWhere(options.origin ?? 'all'),
    destinationWhere(options.destination ?? 'all'),
  ].filter((part) => Object.keys(part).length > 0);

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { AND: parts };
}

export async function getOfferStats(): Promise<OfferStats> {
  const [total, pending, sent] = await Promise.all([
    prisma.offer.count(),
    prisma.offer.count({ where: statusWhere('pending') }),
    prisma.offer.count({ where: statusWhere('sent') }),
  ]);
  return { total, pending, sent };
}

export interface ChannelStats {
  channel: Channel;
  /** Entregas concluídas neste canal. */
  sent: number;
  /** Enfileiradas e ainda não concluídas. */
  pending: number;
  /** Pendentes cuja última tentativa falhou. */
  failed: number;
  lastSentAt: Date | null;
}

export async function getChannelStats(channel: Channel): Promise<ChannelStats> {
  const [sent, pending, failed, last] = await Promise.all([
    prisma.offerDelivery.count({ where: { channel, sentAt: { not: null } } }),
    prisma.offerDelivery.count({ where: { channel, sentAt: null } }),
    prisma.offerDelivery.count({ where: { channel, sentAt: null, error: { not: null } } }),
    prisma.offerDelivery.findFirst({
      where: { channel, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
  ]);

  return { channel, sent, pending, failed, lastSentAt: last?.sentAt ?? null };
}

export async function countOffers(options: FindOffersOptions | OfferSentFilter = 'all'): Promise<number> {
  const filters: FindOffersOptions =
    typeof options === 'string' ? { sent: options } : options;
  return prisma.offer.count({ where: buildOffersWhere(filters) });
}

export async function findOffers(options: FindOffersOptions = {}): Promise<OfferRecord[]> {
  const { sent = 'all', limit = 20, offset = 0 } = options;
  const orderBy =
    sent === 'sent'
      ? { sentAt: 'desc' as const }
      : sent === 'pending' || sent === 'error'
        ? { createdAt: 'asc' as const }
        : { createdAt: 'desc' as const };
  const offers = await prisma.offer.findMany({
    where: buildOffersWhere(options),
    orderBy,
    take: limit,
    skip: offset,
  });
  return offers.map(toRecord);
}

export async function findPendingOfferIds(): Promise<string[]> {
  const offers = await prisma.offer.findMany({
    where: { sentAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return offers.map((offer) => offer.id);
}

export async function deletePendingOffers(): Promise<number> {
  const result = await prisma.offer.deleteMany({ where: { sentAt: null } });
  return result.count;
}

/** Remove uma única oferta apenas se ela ainda estiver pendente (não enviada). */
export async function deletePendingOfferById(id: string): Promise<number> {
  const result = await prisma.offer.deleteMany({ where: { id, sentAt: null } });
  return result.count;
}

export async function findLastSentAt(): Promise<Date | null> {
  const offer = await prisma.offer.findFirst({
    where: { sentAt: { not: null } },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  return offer?.sentAt ?? null;
}
