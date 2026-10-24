import type { FastifyReply, FastifyRequest } from 'fastify';

import { loadSettingsData, saveAmazonAffiliateSettings, saveAmazonCollectionSettings, saveBrandIdentity, saveCouponsUrlSettings, saveOperatingHoursSettings, saveSendIntervalMinutes, saveSenderDelay } from '../../manager/models/settings-model.js';
import { saveScoreConfig } from '../../src/config/score-config.js';
import { mapServiceError } from '../lib/map-service-error.js';
import { parseBody } from '../lib/validate.js';
import {
  amazonAffiliateBodySchema,
  amazonCollectionBodySchema,
  brandBodySchema,
  couponsUrlBodySchema,
  operatingHoursBodySchema,
  scoreConfigBodySchema,
  sendIntervalBodySchema,
  senderDelayBodySchema,
} from '../schemas/settings.schemas.js';
import { serializeSettings } from '../serializers/settings.serializer.js';

async function reloadSettings() {
  const data = await loadSettingsData();
  return serializeSettings(data);
}

export async function getSettingsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(await reloadSettings());
}

export async function patchScoreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(scoreConfigBodySchema, request.body);
  try {
    await saveScoreConfig(body);
  } catch (error) {
    mapServiceError(error);
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchBrandHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(brandBodySchema, request.body);
  const result = await saveBrandIdentity(body);
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchOperatingHoursHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(operatingHoursBodySchema, request.body);
  const result = await saveOperatingHoursSettings(
    String(body.startHour),
    String(body.endHour),
  );
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchSendIntervalHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(sendIntervalBodySchema, request.body);
  const result = await saveSendIntervalMinutes(body.intervalMinutes);
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchSenderDelayHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(senderDelayBodySchema, request.body);
  const result = await saveSenderDelay(body.senderDelayMinutes);
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchCouponsUrlHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(couponsUrlBodySchema, request.body);
  const result = await saveCouponsUrlSettings(body.couponsUrl);
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchAmazonCollectionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(amazonCollectionBodySchema, request.body);
  const result = await saveAmazonCollectionSettings(body.enabled);
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}

export async function patchAmazonAffiliateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(amazonAffiliateBodySchema, request.body);
  const result = await saveAmazonAffiliateSettings({
    baseUrl: body.baseUrl,
    affiliateLinkPrefix: body.affiliateLinkPrefix,
    storeId: body.storeId,
  });
  if (!result.ok) {
    mapServiceError(new Error(result.error));
  }
  reply.status(200).send(await reloadSettings());
}
