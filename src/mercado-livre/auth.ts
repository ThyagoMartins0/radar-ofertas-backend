import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { type Browser, type BrowserContext, type Page } from 'playwright';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
  closeMercadoLivreLoginBrowser,
  launchMercadoLivreLoginBrowser,
} from './browser-login.js';
import { ensureAuthDir, getMlAuthPath, saveStorageState, updateSessionMeta } from './session.js';

export { MercadoLivrePanelLoginUnavailableError, getMercadoLivrePanelLoginHelp } from './browser-login.js';

export interface AffiliateLoginSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  usesCdp: boolean;
}

const AFFILIATE_LOGIN_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';
const LOGIN_PAGE_PATTERN = /login|registration|account-verification|jms\/mlb\/lgz/i;

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

export async function isAffiliatePortalReady(page: Page): Promise<boolean> {
  const url = page.url();
  if (LOGIN_PAGE_PATTERN.test(url)) return false;

  const hasLinkBuilder = await page
    .locator(
      'input[type="url"], input[placeholder*="URL"], input[placeholder*="url"], textarea, input[data-testid*="url"]',
    )
    .first()
    .isVisible()
    .catch(() => false);

  return hasLinkBuilder || /afiliados\/link-builder|afiliados-home|affiliate-program/i.test(url);
}

export async function openAffiliateLoginSession(
  mode: 'panel' | 'cli' = 'panel',
): Promise<AffiliateLoginSession> {
  await ensureAuthDir();

  const { browser, usesCdp } = await launchMercadoLivreLoginBrowser(mode);

  const context = usesCdp
    ? (browser.contexts()[0] ??
      (await browser.newContext({
        userAgent: env.ML_SCRAPER_USER_AGENT,
        locale: 'pt-BR',
      })))
    : await browser.newContext({
        userAgent: env.ML_SCRAPER_USER_AGENT,
        locale: 'pt-BR',
      });

  const page = await context.newPage();

  logger.info('Abrindo portal de afiliados — faça login manualmente no navegador');
  await page.goto(AFFILIATE_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: env.ML_HTTP_TIMEOUT_MS,
  });

  if (usesCdp) {
    logger.info(
      'Chrome conectado via CDP — faça login na janela aberta e volte ao painel para concluir.',
    );
  } else {
    logger.info(
      'O navegador permanecerá aberto até você confirmar. ' +
        'Conclua o login e acesse o Gerador de Links antes de continuar.',
    );
  }

  return { browser, context, page, usesCdp };
}

export async function persistAffiliateSession(context: BrowserContext): Promise<void> {
  const storageState = await context.storageState();
  await saveStorageState(storageState);
  await updateSessionMeta({
    lastLoginAt: new Date().toISOString(),
    lastError: null,
  });

  logger.info({ path: getMlAuthPath() }, 'Sessão de afiliado salva com sucesso');
}

export async function loginAffiliateSession(): Promise<void> {
  const { browser, context, page, usesCdp } = await openAffiliateLoginSession('cli');

  try {
    while (true) {
      await waitForEnter(
        '\nQuando estiver logado no portal de afiliados, pressione Enter para salvar a sessão... ',
      );

      if (await isAffiliatePortalReady(page)) break;

      logger.warn(
        { url: page.url() },
        'Login ainda não detectado — complete o login no navegador e pressione Enter novamente',
      );
    }

    await persistAffiliateSession(context);
  } finally {
    await closeMercadoLivreLoginBrowser(browser, usesCdp);
  }
}

export async function closeAffiliateLoginSession(session: AffiliateLoginSession): Promise<void> {
  await closeMercadoLivreLoginBrowser(session.browser, session.usesCdp);
}
