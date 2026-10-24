import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Fecha o Chromium após este tempo sem uso — libera RAM entre ciclos de coleta. */
const IDLE_CLOSE_MS = 60_000;

let browser: Browser | null = null;
let idleTimer: NodeJS.Timeout | undefined;
let operationChain: Promise<unknown> = Promise.resolve();

async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: env.ML_BROWSER_HEADLESS });
  logger.debug('Playwright browser launched (pooled)');
  return browser;
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void closeBrowserPool();
  }, IDLE_CLOSE_MS);
}

/** Encerra o Chromium compartilhado (shutdown do processo ou fim de ciclo). */
export async function closeBrowserPool(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (!browser) return;
  await browser.close().catch(() => {});
  browser = null;
  logger.debug('Playwright browser pool closed');
}

export interface PooledContextOptions {
  storageState?: BrowserContextOptions['storageState'];
}

/**
 * Reutiliza um único Chromium por processo e serializa operações — evita N
 * instâncias paralelas (POOL_CONCURRENCY × fallback) estourando CPU/RAM.
 */
export async function withPooledBrowserContext<T>(
  options: PooledContextOptions,
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<T> => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }

    const instance = await ensureBrowser();
    const context = await instance.newContext({
      userAgent: env.ML_SCRAPER_USER_AGENT,
      locale: 'pt-BR',
      storageState: options.storageState,
    });

    try {
      return await fn(context);
    } finally {
      await context.close().catch(() => {});
      scheduleIdleClose();
    }
  };

  const result = operationChain.then(run, run);
  operationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
