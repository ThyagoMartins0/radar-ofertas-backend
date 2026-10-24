import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';

import { CHANNELS } from '../../src/channels/types.js';
import { env } from '../../src/config/env.js';
import {
  getCollectorHeartbeat,
  getWorkerHeartbeat,
  isProcessHeartbeatFresh,
  isWorkerHeartbeatFresh,
} from '../../src/utils/redis-state.js';
import { logger } from '../../src/utils/logger.js';

const SPAWN_DISABLED_DETAIL =
  'Worker gerenciado externamente — use Docker ou npm run worker no terminal.';
const WORKER_SCRIPT = 'src/worker.ts';
const COLLECTOR_SCRIPT = 'src/app.ts';

export function canManagerSpawnWorkers(): boolean {
  return env.MANAGER_CAN_SPAWN_WORKERS;
}

const isWindows = process.platform === 'win32';

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

export type WorkerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface WorkerState {
  status: WorkerStatus;
  startedAt: string | null;
  detail: string | null;
}

/** @deprecated Mantido para compatibilidade com views — use WorkerState. */
export interface AccountWorkerState {
  accountId: string;
  label: string;
  prefix: string;
  state: WorkerState;
}

interface WorkerSlot {
  proc?: ChildProcess;
  status: WorkerStatus;
  startedAt: string | null;
  detail: string | null;
}

let workerSlot: WorkerSlot = { status: 'stopped', startedAt: null, detail: null };

function spawnTsxScript(script: string): ChildProcess {
  // No container não há .env (variáveis vêm do Dokploy e são herdadas via process.env).
  const envFileArgs = existsSync('.env') ? ['--env-file=.env'] : [];
  return spawn('npx', ['tsx', '--import', './src/bootstrap-env.ts', ...envFileArgs, script], {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    detached: !isWindows,
    stdio: 'inherit',
  });
}

// --- Collector (busca de ofertas) ---------------------------------------------
// Sem um processo consumindo a fila do collector, "Buscar" só enfileira e nada acontece.

let collectorProc: ChildProcess | undefined;

/** Sobe o collector (src/app.ts) se o painel pode spawnar e nenhum collector está vivo. */
export async function ensureCollectorRunning(): Promise<void> {
  if (!canManagerSpawnWorkers()) {
    logger.info('[collector] MANAGER_CAN_SPAWN_WORKERS=false — collector deve rodar como app separado');
    return;
  }
  if (collectorProc) {
    logger.info({ pid: collectorProc.pid }, '[collector] Já iniciado por esta API');
    return;
  }

  const heartbeat = await getCollectorHeartbeat();
  if (heartbeat && isProcessHeartbeatFresh(heartbeat)) {
    logger.info(
      { pid: heartbeat.pid, host: heartbeat.host, updatedAt: heartbeat.updatedAt },
      '[collector] Outro collector ativo (heartbeat no Redis) — não iniciando outro',
    );
    return;
  }

  logger.info('[collector] Nenhum collector ativo — iniciando');
  const proc = spawnTsxScript(COLLECTOR_SCRIPT);
  collectorProc = proc;

  proc.on('spawn', () => logger.info({ pid: proc.pid }, 'Collector iniciado pelo painel'));
  proc.on('error', (error) => {
    if (collectorProc === proc) collectorProc = undefined;
    logger.error({ error }, 'Falha ao iniciar collector pelo painel');
  });
  proc.on('exit', (code, signal) => {
    if (collectorProc === proc) collectorProc = undefined;
    logger.info({ code, signal }, 'Collector encerrado');
  });
}

export function workerDomPrefix(): string {
  return 'worker';
}

async function findExternalWorkerState(): Promise<WorkerState | null> {
  for (const channel of CHANNELS) {
    const heartbeat = await getWorkerHeartbeat(channel);
    if (heartbeat && isWorkerHeartbeatFresh(heartbeat)) {
      const hostLabel = heartbeat.host !== hostname() ? heartbeat.host : 'local';
      return {
        status: 'running',
        startedAt: heartbeat.startedAt || null,
        detail: `Ativo (PID ${heartbeat.pid}, ${hostLabel})`,
      };
    }
  }

  return null;
}

export async function getSenderWorkerState(): Promise<WorkerState> {
  if (workerSlot.proc && (workerSlot.status === 'running' || workerSlot.status === 'starting')) {
    return {
      status: workerSlot.status,
      startedAt: workerSlot.startedAt,
      detail: workerSlot.detail,
    };
  }

  const external = await findExternalWorkerState();
  if (external) return external;

  if (!canManagerSpawnWorkers()) {
    return { status: 'stopped', startedAt: null, detail: SPAWN_DISABLED_DETAIL };
  }

  return {
    status: workerSlot.status,
    startedAt: workerSlot.startedAt,
    detail: workerSlot.detail,
  };
}

/** Compat: rotas antigas passam canal/conta — status é do worker unificado. */
export async function getWorkerState(
  _channel?: import('../../src/channels/types.js').Channel,
  _accountId?: string,
): Promise<WorkerState> {
  return getSenderWorkerState();
}

export async function listWorkerStates(
  _channel?: import('../../src/channels/types.js').Channel,
): Promise<AccountWorkerState[]> {
  const state = await getSenderWorkerState();
  return [
    {
      accountId: 'default',
      label: 'Envio (WhatsApp + Telegram)',
      prefix: workerDomPrefix(),
      state,
    },
  ];
}

export async function isWorkerRunning(): Promise<boolean> {
  const { status } = await getSenderWorkerState();
  return status === 'running' || status === 'starting';
}

export async function startSenderWorker(): Promise<WorkerState> {
  if (!canManagerSpawnWorkers()) {
    return (await findExternalWorkerState()) ?? {
      status: 'stopped',
      startedAt: null,
      detail: SPAWN_DISABLED_DETAIL,
    };
  }

  if (workerSlot.proc && (workerSlot.status === 'running' || workerSlot.status === 'starting')) {
    return getSenderWorkerState();
  }

  const external = await findExternalWorkerState();
  if (external?.status === 'running') {
    return external;
  }

  workerSlot.status = 'starting';
  workerSlot.detail = null;
  workerSlot.startedAt = new Date().toISOString();

  const proc = spawnTsxScript(WORKER_SCRIPT);
  workerSlot.proc = proc;

  proc.on('spawn', () => {
    if (workerSlot.proc === proc) workerSlot.status = 'running';
    logger.info({ pid: proc.pid }, 'Worker unificado iniciado pelo painel');
  });

  proc.on('error', (error) => {
    if (workerSlot.proc !== proc) return;
    workerSlot.status = 'error';
    workerSlot.detail = error.message;
    workerSlot.proc = undefined;
    logger.error({ error }, 'Falha ao iniciar worker pelo painel');
  });

  proc.on('exit', (code, signal) => {
    if (workerSlot.proc === proc) workerSlot.proc = undefined;
    workerSlot.status = 'stopped';
    workerSlot.detail = `Encerrado (code=${code ?? '—'}, signal=${signal ?? '—'})`;
    logger.info({ code, signal }, 'Worker unificado encerrado');
  });

  return getSenderWorkerState();
}

/** Compat com rotas antigas. */
export async function startWorker(
  _channel?: import('../../src/channels/types.js').Channel,
  _accountId?: string,
): Promise<WorkerState> {
  return startSenderWorker();
}

export async function stopSenderWorker(): Promise<WorkerState> {
  if (!canManagerSpawnWorkers()) {
    return (await findExternalWorkerState()) ?? {
      status: 'stopped',
      startedAt: null,
      detail: SPAWN_DISABLED_DETAIL,
    };
  }

  const proc = workerSlot.proc;
  if (!proc) {
    workerSlot.status = 'stopped';
    workerSlot.startedAt = null;
    workerSlot.detail = null;
    return getSenderWorkerState();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      workerSlot.status = 'stopped';
      workerSlot.startedAt = null;
      workerSlot.detail = null;
      void getSenderWorkerState().then(resolve);
    };

    proc.once('exit', finish);
    killProcessTree(proc);
    setTimeout(finish, 5000);
  });
}

export async function stopWorker(
  _channel?: import('../../src/channels/types.js').Channel,
  _accountId?: string,
): Promise<WorkerState> {
  return stopSenderWorker();
}

export async function restartSenderWorker(): Promise<WorkerState> {
  if (!canManagerSpawnWorkers()) {
    return (await findExternalWorkerState()) ?? {
      status: 'stopped',
      startedAt: null,
      detail: SPAWN_DISABLED_DETAIL,
    };
  }

  await stopSenderWorker();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return startSenderWorker();
}

export async function restartWorker(
  _channel?: import('../../src/channels/types.js').Channel,
  _accountId?: string,
): Promise<WorkerState> {
  return restartSenderWorker();
}
