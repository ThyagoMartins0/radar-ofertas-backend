import { hostname } from 'node:os';

import { CHANNELS } from '../channels/types.js';
import { env } from '../config/env.js';
import {
  getCollectorHeartbeat,
  getWorkerHeartbeat,
  isProcessHeartbeatFresh,
  type RedisProcessHeartbeat,
} from './redis-state.js';

export type ProcessHealthState = 'ok' | 'stopped' | 'stale' | 'unavailable';

export interface ProcessHealthSnapshot {
  status: ProcessHealthState;
  startedAt: string | null;
  detail: string | null;
  pid: number | null;
  host: string | null;
  updatedAt: string | null;
}

function snapshotFromHeartbeat(heartbeat: RedisProcessHeartbeat | null): ProcessHealthSnapshot {
  if (!heartbeat) {
    return {
      status: 'stopped',
      startedAt: null,
      detail: null,
      pid: null,
      host: null,
      updatedAt: null,
    };
  }

  const fresh = isProcessHeartbeatFresh(heartbeat);
  const hostLabel = heartbeat.host !== hostname() ? heartbeat.host : 'local';

  return {
    status: fresh ? 'ok' : 'stale',
    startedAt: heartbeat.startedAt || null,
    detail: fresh ? `Ativo (PID ${heartbeat.pid}, ${hostLabel})` : 'Heartbeat expirado',
    pid: heartbeat.pid,
    host: heartbeat.host,
    updatedAt: heartbeat.updatedAt,
  };
}

function unavailableSnapshot(detail: string): ProcessHealthSnapshot {
  return {
    status: 'unavailable',
    startedAt: null,
    detail,
    pid: null,
    host: null,
    updatedAt: null,
  };
}

export async function getCollectorHealthSnapshot(): Promise<ProcessHealthSnapshot> {
  if (!env.REDIS_ENABLED) {
    return unavailableSnapshot('Redis desabilitado — heartbeat indisponível');
  }

  return snapshotFromHeartbeat(await getCollectorHeartbeat());
}

export async function getWorkerHealthSnapshot(): Promise<ProcessHealthSnapshot> {
  if (!env.REDIS_ENABLED) {
    return unavailableSnapshot('Redis desabilitado — heartbeat indisponível');
  }

  for (const channel of CHANNELS) {
    const heartbeat = await getWorkerHeartbeat(channel);
    if (heartbeat && isProcessHeartbeatFresh(heartbeat)) {
      return snapshotFromHeartbeat(heartbeat);
    }
  }

  const stale = await getWorkerHeartbeat('whatsapp');
  if (stale) {
    return snapshotFromHeartbeat(stale);
  }

  return snapshotFromHeartbeat(null);
}

export function isProcessHealthOk(snapshot: ProcessHealthSnapshot): boolean {
  return snapshot.status === 'ok';
}

export function processHealthHttpStatus(snapshot: ProcessHealthSnapshot): number {
  return snapshot.status === 'ok' ? 200 : 503;
}
