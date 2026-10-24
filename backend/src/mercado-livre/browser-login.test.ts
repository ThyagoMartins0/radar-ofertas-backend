import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canLaunchVisibleMercadoLivreBrowser,
  MercadoLivrePanelLoginUnavailableError,
} from './browser-login.js';
import { stubEnv, restoreEnv } from '../test/env-stub.js';

describe('mercado livre browser login', () => {
  it('bloqueia painel com ML_BROWSER_HEADLESS=true sem CDP', () => {
    stubEnv({ ML_BROWSER_HEADLESS: true, ML_LOGIN_CDP_URL: '' });
    assert.equal(canLaunchVisibleMercadoLivreBrowser(), false);
    restoreEnv();
  });

  it('permite painel com ML_LOGIN_CDP_URL', () => {
    stubEnv({ ML_BROWSER_HEADLESS: true, ML_LOGIN_CDP_URL: 'http://127.0.0.1:9222' });
    assert.equal(canLaunchVisibleMercadoLivreBrowser(), true);
    restoreEnv();
  });

  it('permite painel com DISPLAY (Xvfb + VNC no Docker)', () => {
    stubEnv({ ML_BROWSER_HEADLESS: true, ML_LOGIN_CDP_URL: '' });
    const prev = process.env.DISPLAY;
    process.env.DISPLAY = ':99';
    assert.equal(canLaunchVisibleMercadoLivreBrowser('panel'), true);
    process.env.DISPLAY = prev;
    restoreEnv();
  });

  it('bloqueia painel com ML_BROWSER_HEADLESS=false sem DISPLAY', () => {
    stubEnv({ ML_BROWSER_HEADLESS: false, ML_LOGIN_CDP_URL: '' });
    const prev = process.env.DISPLAY;
    delete process.env.DISPLAY;
    assert.equal(canLaunchVisibleMercadoLivreBrowser('panel'), false);
    process.env.DISPLAY = prev;
    restoreEnv();
  });

  it('permite CLI com ML_BROWSER_HEADLESS=false sem DISPLAY', () => {
    stubEnv({ ML_BROWSER_HEADLESS: false, ML_LOGIN_CDP_URL: '' });
    const prev = process.env.DISPLAY;
    delete process.env.DISPLAY;
    assert.equal(canLaunchVisibleMercadoLivreBrowser('cli'), true);
    process.env.DISPLAY = prev;
    restoreEnv();
  });

  it('expõe instruções amigáveis no erro do painel', () => {
    const error = new MercadoLivrePanelLoginUnavailableError();
    assert.match(error.userMessage, /npm run ml:login/);
    assert.match(error.userMessage, /MANAGER_VNC_ENABLED|noVNC|6080/);
    assert.match(error.userMessage, /ML_LOGIN_CDP_URL/);
  });
});
