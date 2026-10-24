import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  getPrismaState,
  getWorkerState,
  restartWorker,
  runPrismaGenerate,
  startWorker,
  stopWorker,
} from '../../manager/models/process-model.js';
import { isChannel, type Channel } from '../../src/channels/types.js';
import { ForbiddenError } from '../errors/api-errors.js';
import { env } from '../../src/config/env.js';
import { parseQuery } from '../lib/validate.js';
import { workerQuerySchema } from '../schemas/workers.schemas.js';

function resolveChannel(value?: string): Channel {
  return value && isChannel(value) ? value : 'whatsapp';
}

function assertSpawnAllowed(): void {
  if (!env.MANAGER_CAN_SPAWN_WORKERS) {
    throw new ForbiddenError('Spawn de workers desabilitado neste ambiente');
  }
}

export async function getWorkerStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = parseQuery(workerQuerySchema, request.query);
  reply.status(200).send(await getWorkerState(resolveChannel(query.channel), query.accountId));
}

export async function startWorkerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  assertSpawnAllowed();
  const query = parseQuery(workerQuerySchema, request.query);
  reply.status(200).send(await startWorker(resolveChannel(query.channel), query.accountId));
}

export async function stopWorkerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  assertSpawnAllowed();
  const query = parseQuery(workerQuerySchema, request.query);
  reply.status(200).send(await stopWorker(resolveChannel(query.channel), query.accountId));
}

export async function restartWorkerHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  assertSpawnAllowed();
  const query = parseQuery(workerQuerySchema, request.query);
  reply.status(200).send(await restartWorker(resolveChannel(query.channel), query.accountId));
}

export async function getPrismaStatusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.status(200).send(getPrismaState());
}

export async function runPrismaGenerateHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  assertSpawnAllowed();
  reply.status(200).send(runPrismaGenerate());
}
