import { getEnabledAccountIdsForChannel } from '../accounts/channel-accounts.js';
import { CHANNELS, type Channel } from '../channels/types.js';
import { env } from '../config/env.js';
import {
  execute,
  newId,
  query,
  queryOne,
  toBool,
  transaction,
  type SqlParam,
} from '../database/client.js';
import { nowInTimezone } from '../utils/datetime.js';
import type { CreateOfferInput, DeliveryRecord, OfferRecord } from './types.js';

interface OfferRow {
  id: string;
  mercado_livre_id: string;
  title: string;
  price: number | string;
  old_price: number | string | null;
  discount: number | null;
  image: string | null;
  permalink: string | null;
  affiliate_link: string | null;
  rating: number | null;
  sold_quantity: number | null;
  sales_rank: string | null;
  seller: string | null;
  official_store: number | boolean;
  best_seller: number | boolean;
  score: number;
  sent_at: Date | null;
  created_at: Date;
}

interface DeliveryRow {
  id: string;
  offer_id: string;
  channel: string;
  account_id: string;
  sent_at: Date | null;
  message_id: string | null;
  error: string | null;
  created_at: Date;
}

function toRecord(offer: OfferRow): OfferRecord {
  return {
    id: offer.id,
    mercadoLivreId: offer.mercado_livre_id,
    title: offer.title,
    price: Number(offer.price),
    oldPrice: offer.old_price ? Number(offer.old_price) : null,
    discount: offer.discount,
    image: offer.image,
    permalink: offer.permalink,
    affiliateLink: offer.affiliate_link,
    rating: offer.rating,
    soldQuantity: offer.sold_quantity,
    salesRank: offer.sales_rank,
    seller: offer.seller,
    officialStore: toBool(offer.official_store),
    bestSeller: toBool(offer.best_seller),
    score: offer.score,
    sentAt: offer.sent_at,
    createdAt: offer.created_at,
  };
}

async function count(sql: string, params: SqlParam[] = []): Promise<number> {
  const row = await queryOne<{ count: number | string }>(sql, params);
  return Number(row?.count ?? 0);
}

export async function offerExists(mercadoLivreId: string): Promise<boolean> {
  const total = await count('SELECT COUNT(*) AS count FROM offers WHERE mercado_livre_id = ?', [
    mercadoLivreId,
  ]);
  return total > 0;
}

/** Id da oferta com este mercadoLivreId, ou null. Usado para topar entregas
 * faltantes quando o mesmo produto reaparece na coleta de outro canal. */
export async function findOfferIdByMercadoLivreId(mercadoLivreId: string): Promise<string | null> {
  const offer = await queryOne<{ id: string }>('SELECT id FROM offers WHERE mercado_livre_id = ?', [
    mercadoLivreId,
  ]);
  return offer?.id ?? null;
}

/**
 * Canais em que todas as contas habilitadas já concluíram o envio (sentAt preenchido).
 * Entregas pendentes ou com falha não contam — permitem reenfileirar na próxima coleta.
 */
export async function findExistingDeliveryChannels(offerId: string): Promise<Channel[]> {
  const deliveries = await query<Pick<DeliveryRow, 'channel' | 'account_id' | 'sent_at'>>(
    'SELECT channel, account_id, sent_at FROM offer_deliveries WHERE offer_id = ?',
    [offerId],
  );

  const sentByChannel = new Map<string, Set<string>>();
  for (const row of deliveries) {
    if (!row.sent_at) continue;
    const accounts = sentByChannel.get(row.channel) ?? new Set<string>();
    accounts.add(row.account_id);
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
  const rows = await query<Pick<DeliveryRow, 'offer_id' | 'channel' | 'account_id'>>(
    'SELECT offer_id, channel, account_id FROM offer_deliveries WHERE sent_at IS NULL ORDER BY created_at ASC',
  );
  return rows.map((row) => ({
    offerId: row.offer_id,
    channel: row.channel as Channel,
    accountId: row.account_id,
  }));
}

export async function sentOfferExistsByTitleAndPrice(
  title: string,
  price: number,
): Promise<boolean> {
  const total = await count(
    'SELECT COUNT(*) AS count FROM offers WHERE title = ? AND price = ? AND sent_at IS NOT NULL',
    [title, price],
  );
  return total > 0;
}

export async function createOffer(input: CreateOfferInput): Promise<OfferRecord> {
  const id = newId();
  await execute(
    `INSERT INTO offers (
      id, mercado_livre_id, title, price, old_price, discount, image, permalink,
      affiliate_link, rating, sold_quantity, sales_rank, seller, official_store,
      best_seller, score, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.mercadoLivreId,
      input.title,
      input.price,
      input.oldPrice,
      input.discount,
      input.image,
      input.permalink,
      input.affiliateLink,
      input.rating,
      input.soldQuantity,
      input.salesRank,
      input.seller,
      input.officialStore,
      input.bestSeller,
      input.score,
      nowInTimezone(env.APP_TIMEZONE),
    ],
  );
  const offer = await findOfferById(id);
  if (!offer) throw new Error(`Offer ${id} not found after insert`);
  return offer;
}

export async function findOfferById(id: string): Promise<OfferRecord | null> {
  const offer = await queryOne<OfferRow>('SELECT * FROM offers WHERE id = ?', [id]);
  return offer ? toRecord(offer) : null;
}

export async function updateOfferAffiliateLink(id: string, affiliateLink: string): Promise<void> {
  await execute('UPDATE offers SET affiliate_link = ? WHERE id = ?', [affiliateLink, id]);
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
  const columns: Array<[string, SqlParam | undefined]> = [
    ['rating', data.rating],
    ['sold_quantity', data.soldQuantity],
    ['sales_rank', data.salesRank],
    ['seller', data.seller],
  ];
  const set = columns.filter((entry): entry is [string, SqlParam] => entry[1] !== undefined);
  if (set.length === 0) return;
  await execute(
    `UPDATE offers SET ${set.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
    [...set.map(([, value]) => value), id],
  );
}

// --- Entregas por canal -------------------------------------------------------

function toDeliveryRecord(delivery: DeliveryRow): DeliveryRecord {
  return {
    id: delivery.id,
    offerId: delivery.offer_id,
    channel: delivery.channel as Channel,
    accountId: delivery.account_id,
    sentAt: delivery.sent_at,
    messageId: delivery.message_id,
    error: delivery.error,
    createdAt: delivery.created_at,
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
  await execute(
    `INSERT INTO offer_deliveries (id, offer_id, channel, account_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE error = NULL`,
    [newId(), offerId, channel, accountId, new Date()],
  );
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

  await transaction(async (conn) => {
    await execute(
      `INSERT INTO offer_deliveries (id, offer_id, channel, account_id, sent_at, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sent_at = VALUES(sent_at), message_id = VALUES(message_id), error = NULL`,
      [newId(), offerId, channel, accountId, sentAt, messageId, new Date()],
      conn,
    );
    // Só o primeiro canal a concluir grava — o filtro sent_at IS NULL evita
    // sobrescrever a marca de um canal que publicou antes.
    await execute(
      'UPDATE offers SET sent_at = ? WHERE id = ? AND sent_at IS NULL',
      [sentAt, offerId],
      conn,
    );
  });
}

/** Registra a falha na entrega do canal, preservando o motivo para o painel. */
export async function markOfferDeliveryFailed(
  offerId: string,
  channel: Channel,
  error: string,
  accountId = 'default',
): Promise<void> {
  await execute(
    `INSERT INTO offer_deliveries (id, offer_id, channel, account_id, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE error = VALUES(error)`,
    [newId(), offerId, channel, accountId, error.slice(0, 500), new Date()],
  );
}

export async function findDelivery(
  offerId: string,
  channel: Channel,
  accountId = 'default',
): Promise<DeliveryRecord | null> {
  const delivery = await queryOne<DeliveryRow>(
    'SELECT * FROM offer_deliveries WHERE offer_id = ? AND channel = ? AND account_id = ?',
    [offerId, channel, accountId],
  );
  return delivery ? toDeliveryRecord(delivery) : null;
}

export async function findDeliveriesByOffer(offerId: string): Promise<DeliveryRecord[]> {
  const deliveries = await query<DeliveryRow>(
    'SELECT * FROM offer_deliveries WHERE offer_id = ? ORDER BY channel ASC',
    [offerId],
  );
  return deliveries.map(toDeliveryRecord);
}

/** Entregas de várias ofertas de uma vez — evita N+1 nas listagens do painel. */
export async function findDeliveriesByOfferIds(
  offerIds: string[],
): Promise<Map<string, DeliveryRecord[]>> {
  if (offerIds.length === 0) return new Map();

  const placeholders = offerIds.map(() => '?').join(', ');
  const deliveries = await query<DeliveryRow>(
    `SELECT * FROM offer_deliveries WHERE offer_id IN (${placeholders}) ORDER BY channel ASC`,
    offerIds,
  );

  const byOffer = new Map<string, DeliveryRecord[]>();
  for (const delivery of deliveries) {
    const list = byOffer.get(delivery.offer_id) ?? [];
    list.push(toDeliveryRecord(delivery));
    byOffer.set(delivery.offer_id, list);
  }
  return byOffer;
}

export async function offerWasSentTo(
  offerId: string,
  channel: Channel,
  accountId = 'default',
): Promise<boolean> {
  const total = await count(
    `SELECT COUNT(*) AS count FROM offer_deliveries
     WHERE offer_id = ? AND channel = ? AND account_id = ? AND sent_at IS NOT NULL`,
    [offerId, channel, accountId],
  );
  return total > 0;
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

interface WhereClause {
  sql: string;
  params: SqlParam[];
}

const FAILED_DELIVERY_EXISTS =
  'EXISTS (SELECT 1 FROM offer_deliveries d WHERE d.offer_id = offers.id AND d.error IS NOT NULL AND d.sent_at IS NULL)';

function statusWhere(sent: OfferSentFilter = 'all'): WhereClause | null {
  if (sent === 'pending') {
    return { sql: `offers.sent_at IS NULL AND NOT ${FAILED_DELIVERY_EXISTS}`, params: [] };
  }
  if (sent === 'sent') return { sql: 'offers.sent_at IS NOT NULL', params: [] };
  if (sent === 'error') {
    return { sql: `offers.sent_at IS NULL AND ${FAILED_DELIVERY_EXISTS}`, params: [] };
  }
  return null;
}

function originWhere(origin: OfferOriginFilter = 'all'): WhereClause | null {
  if (origin === 'amazon') {
    return {
      sql: `offers.permalink LIKE ? OR (
        offers.mercado_livre_id NOT LIKE ? AND offers.mercado_livre_id NOT LIKE ? AND offers.permalink IS NULL
      )`,
      params: ['%amazon%', 'MLB%', 'mlb%'],
    };
  }
  if (origin === 'mercado_livre') {
    return {
      sql: 'offers.mercado_livre_id LIKE ? OR offers.permalink LIKE ? OR offers.permalink LIKE ?',
      params: ['MLB%', '%mercadolivre%', '%mercadolibre%'],
    };
  }
  return null;
}

function destinationWhere(destination: OfferDestinationFilter = 'all'): WhereClause | null {
  if (destination === 'whatsapp' || destination === 'telegram') {
    return {
      sql: 'EXISTS (SELECT 1 FROM offer_deliveries d WHERE d.offer_id = offers.id AND d.channel = ?)',
      params: [destination],
    };
  }
  return null;
}

function buildOffersWhere(options: FindOffersOptions): WhereClause {
  const parts = [
    statusWhere(options.sent ?? 'all'),
    originWhere(options.origin ?? 'all'),
    destinationWhere(options.destination ?? 'all'),
  ].filter((part): part is WhereClause => part !== null);

  if (parts.length === 0) return { sql: '', params: [] };
  return {
    sql: `WHERE ${parts.map((part) => `(${part.sql})`).join(' AND ')}`,
    params: parts.flatMap((part) => part.params),
  };
}

async function countWhere(options: FindOffersOptions): Promise<number> {
  const where = buildOffersWhere(options);
  return count(`SELECT COUNT(*) AS count FROM offers ${where.sql}`, where.params);
}

export async function getOfferStats(): Promise<OfferStats> {
  const [total, pending, sent] = await Promise.all([
    countWhere({}),
    countWhere({ sent: 'pending' }),
    countWhere({ sent: 'sent' }),
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
    count(
      'SELECT COUNT(*) AS count FROM offer_deliveries WHERE channel = ? AND sent_at IS NOT NULL',
      [channel],
    ),
    count('SELECT COUNT(*) AS count FROM offer_deliveries WHERE channel = ? AND sent_at IS NULL', [
      channel,
    ]),
    count(
      'SELECT COUNT(*) AS count FROM offer_deliveries WHERE channel = ? AND sent_at IS NULL AND error IS NOT NULL',
      [channel],
    ),
    queryOne<{ sent_at: Date | null }>(
      'SELECT sent_at FROM offer_deliveries WHERE channel = ? AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1',
      [channel],
    ),
  ]);

  return { channel, sent, pending, failed, lastSentAt: last?.sent_at ?? null };
}

export async function countOffers(
  options: FindOffersOptions | OfferSentFilter = 'all',
): Promise<number> {
  const filters: FindOffersOptions = typeof options === 'string' ? { sent: options } : options;
  return countWhere(filters);
}

export async function findOffers(options: FindOffersOptions = {}): Promise<OfferRecord[]> {
  const { sent = 'all', limit = 20, offset = 0 } = options;
  const orderBy =
    sent === 'sent'
      ? 'offers.sent_at DESC'
      : sent === 'pending' || sent === 'error'
        ? 'offers.created_at ASC'
        : 'offers.created_at DESC';
  const where = buildOffersWhere(options);
  const offers = await query<OfferRow>(
    `SELECT offers.* FROM offers ${where.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...where.params, limit, offset],
  );
  return offers.map(toRecord);
}

export async function findPendingOfferIds(): Promise<string[]> {
  const offers = await query<{ id: string }>(
    'SELECT id FROM offers WHERE sent_at IS NULL ORDER BY created_at ASC',
  );
  return offers.map((offer) => offer.id);
}

export async function deletePendingOffers(): Promise<number> {
  const result = await execute('DELETE FROM offers WHERE sent_at IS NULL');
  return result.affectedRows;
}

/** Remove uma única oferta apenas se ela ainda estiver pendente (não enviada). */
export async function deletePendingOfferById(id: string): Promise<number> {
  const result = await execute('DELETE FROM offers WHERE id = ? AND sent_at IS NULL', [id]);
  return result.affectedRows;
}

export async function findLastSentAt(): Promise<Date | null> {
  const offer = await queryOne<{ sent_at: Date | null }>(
    'SELECT sent_at FROM offers WHERE sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 1',
  );
  return offer?.sent_at ?? null;
}
