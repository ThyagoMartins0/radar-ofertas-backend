import type { FastifyReply, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../errors/api-errors.js';
import { verifyAccessToken, type AccessTokenPayload } from '../services/auth.service.js';

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token Bearer ausente');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new UnauthorizedError('Token Bearer ausente');
  }

  const payload: AccessTokenPayload = await verifyAccessToken(token);
  request.user = payload;
}
