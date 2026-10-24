import type { FastifyReply, FastifyRequest } from 'fastify';

import { ValidationError } from '../errors/api-errors.js';
import {
  getAuthenticatedUser,
  login,
  logout,
  refresh,
} from '../services/auth.service.js';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
} from '../schemas/auth.schemas.js';

export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = loginBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError('Dados de login inválidos', parsed.error.flatten());
  }

  const tokens = await login(parsed.data.username, parsed.data.password);
  reply.status(200).send(tokens);
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = refreshBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError('Refresh token inválido', parsed.error.flatten());
  }

  const tokens = await refresh(parsed.data.refreshToken);
  reply.status(200).send(tokens);
}

export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = logoutBodySchema.safeParse(request.body);
  if (!parsed.success) {
    throw new ValidationError('Refresh token inválido', parsed.error.flatten());
  }

  await logout(parsed.data.refreshToken);
  reply.status(204).send();
}

export async function meHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await getAuthenticatedUser(request.user.sub);
  reply.status(200).send({ user });
}
