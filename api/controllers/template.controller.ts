import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  createAutoMessageFromForm,
  deleteAutoMessageById,
  loadTemplatePage,
  saveCouponTemplateFromForm,
  saveTemplateFromForm,
  sendAutoMessageNow,
  updateAutoMessageFromForm,
} from '../../manager/models/template-model.js';
import { assertOkResult } from '../lib/model-result.js';
import { autoMessageBodyToForm, placeholderVisibilityToForm } from '../lib/template-form.js';
import { parseBody } from '../lib/validate.js';
import {
  autoMessageBodySchema,
  autoMessageIdParamsSchema,
  couponTemplateBodySchema,
  offerTemplateBodySchema,
} from '../schemas/template.schemas.js';
import { serializeTemplate } from '../serializers/template.serializer.js';

async function reloadTemplate() {
  const data = await loadTemplatePage();
  return serializeTemplate(data);
}

export async function getTemplateHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(await reloadTemplate());
}

export async function patchOfferTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(offerTemplateBodySchema, request.body);
  const form = placeholderVisibilityToForm(body.placeholderVisibility, 'placeholder');
  const result = await saveTemplateFromForm(body.template, form);
  assertOkResult(result);
  reply.status(200).send(await reloadTemplate());
}

export async function patchCouponTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(couponTemplateBodySchema, request.body);
  const form = placeholderVisibilityToForm(body.placeholderVisibility, 'coupon_placeholder');
  const result = await saveCouponTemplateFromForm(body.template, form);
  assertOkResult(result);
  reply.status(200).send(await reloadTemplate());
}

export async function createAutoMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(autoMessageBodySchema, request.body);
  const result = await createAutoMessageFromForm(autoMessageBodyToForm(body));
  assertOkResult(result);
  reply.status(201).send(await reloadTemplate());
}

export async function updateAutoMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(autoMessageIdParamsSchema, request.params);
  const body = parseBody(autoMessageBodySchema, request.body);
  const result = await updateAutoMessageFromForm(params.id, autoMessageBodyToForm(body));
  assertOkResult(result);
  reply.status(200).send(await reloadTemplate());
}

export async function deleteAutoMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(autoMessageIdParamsSchema, request.params);
  const result = await deleteAutoMessageById(params.id);
  assertOkResult(result);
  reply.status(204).send();
}

export async function sendAutoMessageHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(autoMessageIdParamsSchema, request.params);
  const result = await sendAutoMessageNow(params.id);
  assertOkResult(result);
  reply.status(202).send({ ok: true, autoMessageId: params.id });
}
