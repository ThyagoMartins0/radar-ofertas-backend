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
  databaseError?: string;
  processes?: {
    collector: ProcessHealthSnapshot;
    worker: ProcessHealthSnapshot;
  };
  timestamp: string;
};

/** Motivo do erro sem senha — ajuda a diagnosticar o deploy (host/usuário/permissão). */
function describeDatabaseError(error: unknown): string {
  const { errorCode, code } = (error ?? {}) as { errorCode?: string; code?: string };
  const prismaCode = errorCode ?? code;
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? '';
  return [prismaCode, firstLine.slice(0, 300)].filter(Boolean).join(': ');
}

async function pingDatabase(): Promise<{ status: 'ok' | 'error'; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: describeDatabaseError(error) };
  }
}

export async function healthHandler(_request: unknown, reply: FastifyReply): Promise<void> {
  const ping = await pingDatabase();
  const database = ping.status;
  const [collector, worker] = await Promise.all([
    getCollectorHealthSnapshot(),
    getWorkerHealthSnapshot(),
  ]);

  const body: HealthBody = {
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    ...(ping.error ? { databaseError: ping.error } : {}),
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
