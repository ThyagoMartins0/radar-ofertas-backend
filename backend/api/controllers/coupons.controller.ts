import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  loadCouponsPage,
  refreshCoupons,
  sendCouponToChannels,
  updateCouponStoreLink,
} from '../../manager/models/coupons-model.js';
import { assertOkResult } from '../lib/model-result.js';
import { parseBody } from '../lib/validate.js';
import {
  couponIdParamsSchema,
  couponSendBodySchema,
  couponStoreLinkBodySchema,
} from '../schemas/coupons.schemas.js';
import { serializeCoupons } from '../serializers/coupons.serializer.js';

export async function listCouponsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const data = await loadCouponsPage();
  reply.status(200).send(serializeCoupons(data));
}

export async function refreshCouponsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await refreshCoupons();
  assertOkResult(result);
  const data = await loadCouponsPage(true);
  reply.status(200).send({ ...serializeCoupons(data), count: result.count });
}

export async function sendCouponHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(couponIdParamsSchema, request.params);
  const body = parseBody(couponSendBodySchema, request.body ?? {});
  const result = await sendCouponToChannels(params.id, body.code);
  assertOkResult(result);
  reply.status(202).send({ ok: true, message: result.message });
}

export async function patchCouponStoreLinkHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(couponIdParamsSchema, request.params);
  const body = parseBody(couponStoreLinkBodySchema, request.body);
  const result = await updateCouponStoreLink(params.id, body.storeUrl, body.code);
  assertOkResult(result);
  reply.status(200).send({ ok: true });
}
