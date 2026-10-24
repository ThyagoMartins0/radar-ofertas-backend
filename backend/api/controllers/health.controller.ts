import type { FastifyReply } from 'fastify';

import { prisma } from '../../src/database/client.js';
import {
  getCollectorHealthSnapshot,
  getWorkerHealthSnapshot,
  processHealthHttpStatus,
  type ProcessHealthSnapshot,
} from '../../src/utils/process-health.js';

type HealthBody = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  processes?: {
    collector: ProcessHealthSnapshot;
    worker: ProcessHealthSnapshot;
  };
  timestamp: string;
};

async function pingDatabase(): Promise<'ok' | 'error'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function healthHandler(_request: unknown, reply: FastifyReply): Promise<void> {
  const database = await pingDatabase();
  const [collector, worker] = await Promise.all([
    getCollectorHealthSnapshot(),
    getWorkerHealthSnapshot(),
  ]);

  const body: HealthBody = {
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    processes: { collector, worker },
    timestamp: new Date().toISOString(),
  };

  reply.status(database === 'ok' ? 200 : 503).send(body);
}

export async function collectorHealthHandler(
  _request: unknown,
  reply: FastifyReply,
): Promise<void> {
  const snapshot = await getCollectorHealthSnapshot();
  reply.status(processHealthHttpStatus(snapshot)).send({
    process: 'collector',
    ...snapshot,
    timestamp: new Date().toISOString(),
  });
}

export async function workerHealthHandler(_request: unknown, reply: FastifyReply): Promise<void> {
  const snapshot = await getWorkerHealthSnapshot();
  reply.status(processHealthHttpStatus(snapshot)).send({
    process: 'worker',
    ...snapshot,
    timestamp: new Date().toISOString(),
  });
}
