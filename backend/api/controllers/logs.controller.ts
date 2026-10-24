import type { FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../../src/config/env.js';
import {
  classifyLogEntry,
  classifyMlScrapeEntry,
} from '../../manager/models/logs/log-classifier.js';
import { loadLogsApi } from '../../manager/models/logs-model.js';
import {
  isMlScrapeLogEntry,
  subscribeLogAppended,
  type LogEntry,
  type LogFilters,
} from '../../src/utils/log-store.js';
import { parseQuery } from '../lib/validate.js';
import { logsQuerySchema, logsStreamQuerySchema } from '../schemas/logs.schemas.js';

function matchesStreamFilters(entry: LogEntry, filters: LogFilters): boolean {
  if (filters.level && filters.level !== 'all' && entry.level !== filters.level) return false;
  if (filters.source && filters.source !== 'all' && entry.source !== filters.source) return false;
  return true;
}

function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function getLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = parseQuery(logsQuerySchema, request.query);
  const params = new URLSearchParams();
  params.set('level', query.level);
  params.set('source', query.source);
  params.set('limit', String(query.limit));
  if (query.since) params.set('since', query.since);
  if (query.mlSince) params.set('mlSince', query.mlSince);

  const data = await loadLogsApi(params);
  reply.status(200).send({ ...data, redisEnabled: env.REDIS_ENABLED });
}

export async function streamLogsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = parseQuery(logsStreamQuerySchema, request.query);
  const filters: LogFilters = {
    level: query.level,
    source: query.source,
  };

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  writeSseEvent(reply, 'ready', { redisEnabled: env.REDIS_ENABLED });

  const unsubscribe = subscribeLogAppended((entry) => {
    if (!matchesStreamFilters(entry, filters)) return;

    writeSseEvent(reply, 'log', {
      type: 'audit',
      entry: classifyLogEntry(entry),
    });

    if (isMlScrapeLogEntry(entry)) {
      writeSseEvent(reply, 'log', {
        type: 'mlScrape',
        entry: classifyMlScrapeEntry(entry),
      });
    }
  });

  const heartbeat = setInterval(() => {
    writeSseEvent(reply, 'ping', { t: Date.now() });
  }, 30_000);

  request.raw.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
