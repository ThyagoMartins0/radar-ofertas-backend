import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  addAccount,
  loadAccountsData,
  removeAccount,
  saveAccountMercadoLivreConfig,
  saveAccountTelegramConfig,
  saveAccountWhatsAppChannel,
  saveAccountWhatsAppDestination,
  removeAccountWhatsAppDestination,
  toggleAccount,
  toggleAccountWhatsAppDestination,
} from '../../manager/models/accounts-model.js';
import { assertOkResult } from '../lib/model-result.js';
import { parseBody } from '../lib/validate.js';
import {
  accountIdParamsSchema,
  accountPlatformParamsSchema,
  addAccountBodySchema,
  mercadoLivreConfigBodySchema,
  telegramConfigBodySchema,
  whatsAppChannelBodySchema,
  whatsAppDestinationBodySchema,
  whatsAppDestinationIdBodySchema,
  whatsAppDestinationToggleBodySchema,
} from '../schemas/accounts.schemas.js';
import { serializeAccounts } from '../serializers/accounts.serializer.js';

async function reloadAccounts() {
  const data = await loadAccountsData();
  return serializeAccounts(data);
}

export async function listAccountsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(await reloadAccounts());
}

export async function createAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = parseBody(addAccountBodySchema, request.body);
  const result = await addAccount({ platform: body.platform, label: body.label });
  assertOkResult(result);
  reply.status(201).send(await reloadAccounts());
}

export async function toggleAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountPlatformParamsSchema, request.params);
  const result = await toggleAccount(params.accountId, params.platform);
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}

export async function deleteAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountPlatformParamsSchema, request.params);
  const result = await removeAccount(params.accountId, params.platform);
  assertOkResult(result);
  reply.status(204).send();
}

export async function patchWhatsAppChannelHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(whatsAppChannelBodySchema, request.body);
  const result = await saveAccountWhatsAppChannel(params.accountId, body.inviteLink);
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}

export async function addWhatsAppDestinationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(whatsAppDestinationBodySchema, request.body);
  const result = await saveAccountWhatsAppDestination(params.accountId, body.inviteInput);
  assertOkResult(result);
  reply.status(201).send(await reloadAccounts());
}

export async function removeWhatsAppDestinationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(whatsAppDestinationIdBodySchema, request.body);
  const result = await removeAccountWhatsAppDestination(params.accountId, body.destinationId);
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}

export async function toggleWhatsAppDestinationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(whatsAppDestinationToggleBodySchema, request.body);
  const result = await toggleAccountWhatsAppDestination(
    params.accountId,
    body.destinationId,
    body.enabled,
  );
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}

export async function patchTelegramConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(telegramConfigBodySchema, request.body);
  const result = await saveAccountTelegramConfig(params.accountId, {
    telegramEnabled: body.enabled ? '1' : '0',
    botToken: body.botToken,
    chatId: body.chatId,
  });
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}

export async function patchMercadoLivreConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  const body = parseBody(mercadoLivreConfigBodySchema, request.body);
  const result = await saveAccountMercadoLivreConfig(params.accountId, {
    affiliateTag: body.affiliateTag,
  });
  assertOkResult(result);
  reply.status(200).send(await reloadAccounts());
}
