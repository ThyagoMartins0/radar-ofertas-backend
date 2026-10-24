import { chromium, type Browser } from 'playwright';

import { env } from '../config/env.js';

export const ML_LOGIN_HOST_INSTRUCTIONS =
  'No Docker o painel não abre navegador dentro do container. No host, rode: npm run ml:login — a sessão fica em ./data/ml_auth e é compartilhada com os containers.';

export const ML_LOGIN_CDP_INSTRUCTIONS =
  'Alternativa: defina ML_LOGIN_CDP_URL=http://host.docker.internal:9222 no .env, abra o Chrome com --remote-debugging-port=9222 e tente de novo pelo painel.';

export const ML_LOGIN_VNC_INSTRUCTIONS =
  'Com noVNC: MANAGER_VNC_ENABLED=true, rebuild do serviço api, abra http://localhost:6080/vnc_lite.html?scale=true&path=websockify e use Logar no painel.';

export function hasVirtualDisplay(): boolean {
  return Boolean(process.env.DISPLAY?.trim());
}

export function getMercadoLivrePanelLoginHelp(): string {
  return `${ML_LOGIN_HOST_INSTRUCTIONS}\n\n${ML_LOGIN_VNC_INSTRUCTIONS}\n\n${ML_LOGIN_CDP_INSTRUCTIONS}`;
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
    const browser = await chromium.launch({
      headless: false,
      env: buildPlaywrightLaunchEnv(),
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
