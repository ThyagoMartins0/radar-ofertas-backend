import type { AccessTokenPayload } from '../services/auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AccessTokenPayload;
  }
}

export {};
