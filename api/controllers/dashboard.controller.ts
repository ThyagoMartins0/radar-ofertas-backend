import type { FastifyReply, FastifyRequest } from 'fastify';

import { handleCollectOffers, loadDashboardData } from '../../manager/models/dashboard-model.js';
import {
  saveSearchLimit,
  saveSenderDelayMinutes,
  getSearchLimit,
} from '../../src/config/queue-config-store.js';
import { logger } from '../../src/utils/logger.js';
import { getMetrics } from '../../src/utils/metrics.js';
import { ValidationError } from '../errors/api-errors.js';
import { parseBody } from '../lib/validate.js';
import { collectOffersBodySchema } from '../schemas/offers.schemas.js';
import { serializeDashboard } from '../serializers/dashboard.serializer.js';

export async function getDashboardHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await loadDashboardData();
  reply.status(200).send(serializeDashboard(data));
}

export async function collectOffersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(collectOffersBodySchema, request.body ?? {});
  const searchLimit = body.searchLimit ?? getSearchLimit();
  await saveSearchLimit(searchLimit);
  if (body.sendAfterCollect && body.sendDelayMinutes != null) {
    await saveSenderDelayMinutes(body.sendDelayMinutes);
  }

  const productName = body.productName?.trim() || undefined;
  logger.info({ productName, searchLimit }, '[busca] Solicitada pelo painel');
  const result = await handleCollectOffers({ productName });
  if ('error' in result) {
    logger.warn({ productName, error: result.error }, '[busca] Recusada');
    throw new ValidationError(result.error);
  }
  reply.status(202).send({
    queued: true,
    searchLimit,
    productName: productName ?? null,
    sendAfterCollect: body.sendAfterCollect,
    sendDelayMinutes: body.sendDelayMinutes ?? null,
  });
}

export async function getMetricsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(await getMetrics());
}
