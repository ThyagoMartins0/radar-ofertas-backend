import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  hydrateAmazonOfferRecord,
  loadOfferDetail,
  loadOffersPage,
} from '../../manager/models/offers-model.js';
import {
  buildTemplateValues,
  loadMessageTemplate,
  loadPlaceholderVisibility,
  renderMessageTemplate,
} from '../../src/offers/message-template.js';
import {
  removeAllPendingOffers,
  removePendingOffer,
  sendOfferNow,
} from '../../src/offers/service.js';
import {
  saveAffiliateLinkDelaySettings,
  saveSearchLimit,
} from '../../src/config/queue-config-store.js';
import { NotFoundError } from '../errors/api-errors.js';
import { mapServiceError } from '../lib/map-service-error.js';
import { parseBody, parseQuery } from '../lib/validate.js';
import {
  affiliateDelayBodySchema,
  offerIdParamsSchema,
  offersListQuerySchema,
  searchLimitBodySchema,
} from '../schemas/offers.schemas.js';
import { serializeOfferDetail, serializeOffersPage } from '../serializers/offer.serializer.js';

export async function listOffersHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = parseQuery(offersListQuerySchema, request.query);
  const data = await loadOffersPage(
    {
      status: query.status,
      origin: query.origin,
      destination: query.destination,
    },
    query.page,
  );
  reply.status(200).send(serializeOffersPage(data));
}

export async function getOfferHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(offerIdParamsSchema, request.params);
  const { offer, database } = await loadOfferDetail(params.id);

  if (!database.available) {
    reply.status(503).send({
      error: database.error ?? 'Banco de dados indisponível',
      code: 'SERVICE_UNAVAILABLE',
    });
    return;
  }

  if (!offer) {
    throw new NotFoundError('Oferta não encontrada');
  }

  const { offer: hydratedOffer, coupon } = await hydrateAmazonOfferRecord(offer);
  const [template, visibility] = await Promise.all([
    loadMessageTemplate(),
    loadPlaceholderVisibility(),
  ]);
  const messagePreview = renderMessageTemplate(
    template,
    buildTemplateValues(hydratedOffer),
    visibility,
  );

  reply.status(200).send(serializeOfferDetail({ offer: hydratedOffer, messagePreview, coupon }));
}

export async function patchSearchLimitHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(searchLimitBodySchema, request.body);
  try {
    await saveSearchLimit(body.searchLimit);
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(200).send({ searchLimit: body.searchLimit });
}

export async function patchAffiliateDelayHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(affiliateDelayBodySchema, request.body);
  try {
    await saveAffiliateLinkDelaySettings(
      body.affiliateDelayMs,
      body.affiliateBacklogDelayMinutes,
      body.affiliateBacklogThreshold,
    );
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(200).send(body);
}

export async function sendOfferNowHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(offerIdParamsSchema, request.params);
  try {
    await sendOfferNow(params.id);
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(202).send({ ok: true, offerId: params.id });
}

export async function deleteOfferHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(offerIdParamsSchema, request.params);
  try {
    await removePendingOffer(params.id);
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(204).send();
}

export async function deletePendingOffersHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  let count = 0;
  try {
    count = await removeAllPendingOffers();
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(200).send({ deleted: count });
}
