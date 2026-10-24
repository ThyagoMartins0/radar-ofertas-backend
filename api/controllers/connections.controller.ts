import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  cancelMercadoLivreConnection,
  finishMercadoLivreConnection,
  getMercadoLivreConnectionState,
  getWhatsAppConnectionState,
  startMercadoLivreConnection,
  startWhatsAppConnection,
} from '../../manager/models/connection-model.js';
import { getTelegramSessionStatusForAccount } from '../../manager/models/session-model.js';
import { parseBody } from '../lib/validate.js';
import { accountIdParamsSchema } from '../schemas/accounts.schemas.js';

export async function startWhatsAppConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  reply.status(200).send(await startWhatsAppConnection(params.accountId));
}

export async function getWhatsAppConnectStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  reply.status(200).send(await getWhatsAppConnectionState(params.accountId));
}

export async function startMercadoLivreConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  reply.status(200).send(await startMercadoLivreConnection(params.accountId));
}

export async function finishMercadoLivreConnectHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(await finishMercadoLivreConnection());
}

export async function cancelMercadoLivreConnectHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await cancelMercadoLivreConnection();
  reply.status(200).send(getMercadoLivreConnectionState());
}

export async function getMercadoLivreConnectStatusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(getMercadoLivreConnectionState());
}

export async function verifyTelegramConnectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(accountIdParamsSchema, request.params);
  reply.status(200).send(await getTelegramSessionStatusForAccount(params.accountId));
}
