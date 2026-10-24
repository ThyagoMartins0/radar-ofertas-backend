import { spawn, type ChildProcess } from 'node:child_process';
import { hostname } from 'node:os';

import { CHANNELS } from '../../src/channels/types.js';
import { env } from '../../src/config/env.js';
import { getWorkerHeartbeat, isWorkerHeartbeatFresh } from '../../src/utils/redis-state.js';
import { logger } from '../../src/utils/logger.js';

const SPAWN_DISABLED_DETAIL =
  'Worker gerenciado externamente — use Docker ou npm run worker no terminal.';
const WORKER_SCRIPT = 'src/worker.ts';

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

  const proc = spawn('npx', ['tsx', '--env-file=.env', WORKER_SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    detached: !isWindows,
    stdio: 'inherit',
  });
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

// --- Prisma generate (run and finish) ----------------------------------------

export type PrismaStatus = 'idle' | 'running' | 'done' | 'error';

export interface PrismaState {
  status: PrismaStatus;
  output: string;
  error: string | null;
}

let prismaStatus: PrismaStatus = 'idle';
let prismaOutput = '';
let prismaError: string | null = null;

export function getPrismaState(): PrismaState {
  return { status: prismaStatus, output: prismaOutput, error: prismaError };
}

export function runPrismaGenerate(): PrismaState {
  if (prismaStatus === 'running') return getPrismaState();

  prismaStatus = 'running';
  prismaOutput = '';
  prismaError = null;

  const proc = spawn('npx', ['prisma', 'generate'], {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buffer = '';
  const collect = (chunk: Buffer): void => {
    buffer += chunk.toString();
    if (buffer.length > 8000) buffer = buffer.slice(-8000);
  };
  proc.stdout?.on('data', collect);
  proc.stderr?.on('data', collect);

  proc.on('error', (error) => {
    prismaStatus = 'error';
    prismaError = error.message;
    logger.error({ error }, 'prisma generate falhou ao iniciar');
  });

  proc.on('exit', (code) => {
    prismaOutput = buffer.trim();
    if (code === 0) {
      prismaStatus = 'done';
      prismaError = null;
    } else {
      prismaStatus = 'error';
      prismaError = `prisma generate terminou com código ${code ?? '—'}`;
    }
    logger.info({ code }, 'prisma generate finalizado');
  });

  return getPrismaState();
}
