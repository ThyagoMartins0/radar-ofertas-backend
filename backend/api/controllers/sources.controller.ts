import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  addAmazonSource,
  addMlSource,
  loadSourcesData,
  removeAmazonSource,
  removeMlSource,
  saveSourceFlags,
} from '../../manager/models/sources-model.js';
import { assertOkResult } from '../lib/model-result.js';
import { parseBody } from '../lib/validate.js';
import {
  addSourceBodySchema,
  buildSourceFlagsForm,
  channelParamsSchema,
  patchSourcesBodySchema,
  sourceIdParamsSchema,
} from '../schemas/sources.schemas.js';
import { serializeSources } from '../serializers/sources.serializer.js';

export async function getSourcesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(channelParamsSchema, request.params);
  const data = await loadSourcesData(params.channel);
  reply.status(200).send(serializeSources(data));
}

export async function patchSourcesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(channelParamsSchema, request.params);
  const body = parseBody(patchSourcesBodySchema, request.body);
  const result = await saveSourceFlags(params.channel, buildSourceFlagsForm(body));
  assertOkResult(result);
  const data = await loadSourcesData(params.channel);
  reply.status(200).send(serializeSources(data));
}

export async function addMlSourceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(channelParamsSchema, request.params);
  const body = parseBody(addSourceBodySchema, request.body);
  const result = await addMlSource(params.channel, body.url, body.label);
  assertOkResult(result);
  const data = await loadSourcesData(params.channel);
  reply.status(201).send(serializeSources(data));
}

export async function addAmazonSourceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(channelParamsSchema, request.params);
  const body = parseBody(addSourceBodySchema, request.body);
  const result = await addAmazonSource(params.channel, body.url, body.label);
  assertOkResult(result);
  const data = await loadSourcesData(params.channel);
  reply.status(201).send(serializeSources(data));
}

export async function deleteMlSourceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(sourceIdParamsSchema, request.params);
  const result = await removeMlSource(params.sourceId);
  assertOkResult(result);
  const data = await loadSourcesData(params.channel);
  reply.status(200).send(serializeSources(data));
}

export async function deleteAmazonSourceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = parseBody(sourceIdParamsSchema, request.params);
  const result = await removeAmazonSource(params.sourceId);
  assertOkResult(result);
  const data = await loadSourcesData(params.channel);
  reply.status(200).send(serializeSources(data));
}
