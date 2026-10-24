import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { buildOpenApiSpec } from '../openapi/spec.js';

export const openapiRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/openapi.json', async (_request, reply) => {
    reply.type('application/json').send(buildOpenApiSpec());
  });
};
