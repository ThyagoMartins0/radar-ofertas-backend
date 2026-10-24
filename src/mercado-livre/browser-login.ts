import { chromium, type Browser } from 'playwright';

import { env } from '../config/env.js';

export const ML_LOGIN_VNC_INSTRUCTIONS =
  'O login do Mercado Livre precisa de um navegador visível no servidor (noVNC). No Environment da API defina MANAGER_VNC_ENABLED=true, MANAGER_VNC_PASSWORD e MANAGER_NOVNC_PUBLIC_URL=https://SEU-DOMINIO-VNC (domínio Dokploy na porta 6080 do container). Faça redeploy da API e do painel, abra o link noVNC e conclua o login — a sessão é salva no banco (tabela ml_sessions).';

export const ML_LOGIN_CDP_INSTRUCTIONS =
  'Alternativa: com um Chrome aberto com --remote-debugging-port=9222 acessível pelo servidor, defina ML_LOGIN_CDP_URL com o endereço dele e tente de novo pelo painel.';

export const ML_LOGIN_HOST_INSTRUCTIONS =
  'Fora do Docker também dá para rodar npm run ml:login numa máquina com o mesmo .env — a sessão vai para o mesmo banco.';

export function hasVirtualDisplay(): boolean {
  return Boolean(process.env.DISPLAY?.trim());
}

export function getMercadoLivrePanelLoginHelp(): string {
  return `${ML_LOGIN_VNC_INSTRUCTIONS}\n\n${ML_LOGIN_CDP_INSTRUCTIONS}\n\n${ML_LOGIN_HOST_INSTRUCTIONS}`;
}

/** Login pelo painel exige navegador visível ou Chrome via CDP no host. */
export class MercadoLivrePanelLoginUnavailableError extends Error {
  readonly userMessage: string;

  constructor(cause?: unknown) {
    super('Mercado Livre panel login unavailable');
    this.name = 'MercadoLivrePanelLoginUnavailableError';
    this.userMessage = getMercadoLivrePanelLoginHelp();
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export type MercadoLivreLoginBrowser = {
  browser: Browser;
  /** CDP: desconecta sem fechar o Chrome do usuário. */
  usesCdp: boolean;
};

function isMissingDisplayError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /XServer|headed browser|xvfb-run/i.test(message);
}

export function canLaunchVisibleMercadoLivreBrowser(mode: 'panel' | 'cli' = 'panel'): boolean {
  if (env.ML_LOGIN_CDP_URL.trim()) return true;
  if (hasVirtualDisplay()) return true;
  if (mode === 'panel') return false;
  return !env.ML_BROWSER_HEADLESS;
}

function buildPlaywrightLaunchEnv(): NodeJS.ProcessEnv {
  const launchEnv: NodeJS.ProcessEnv = { ...process.env };
  const display = process.env.DISPLAY?.trim();
  if (display) {
    launchEnv.DISPLAY = display;
  }
  return launchEnv;
}

export async function launchMercadoLivreLoginBrowser(
  mode: 'panel' | 'cli' = 'panel',
): Promise<MercadoLivreLoginBrowser> {
  const cdpUrl = env.ML_LOGIN_CDP_URL.trim();
  if (cdpUrl) {
    try {
      const browser = await chromium.connectOverCDP(cdpUrl);
      return { browser, usesCdp: true };
    } catch (error) {
      throw new MercadoLivrePanelLoginUnavailableError(error);
    }
  }

  if (mode === 'panel' && !canLaunchVisibleMercadoLivreBrowser('panel')) {
    throw new MercadoLivrePanelLoginUnavailableError();
  }

  try {
    // Sem sinais de automação: o Google bloqueia "Entrar com Google" quando detecta navigator.webdriver.
    const browser = await chromium.launch({
      headless: false,
      env: buildPlaywrightLaunchEnv(),
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return { browser, usesCdp: false };
  } catch (error) {
    if (isMissingDisplayError(error)) {
      throw new MercadoLivrePanelLoginUnavailableError(error);
    }
    throw error;
  }
}

export async function closeMercadoLivreLoginBrowser(
  browser: Browser,
  usesCdp: boolean,
): Promise<void> {
  if (usesCdp) {
    browser.close().catch(() => undefined);
    return;
  }
  await browser.close();
}
