import { env } from './env.js';

const NOVNC_VIEWER_PATH = '/vnc_lite.html?scale=true&path=websockify';

function normalizeNovncViewerUrl(base: string): string {
  const trimmed = base.trim().replace(/\/$/, '');
  if (trimmed.includes('vnc_lite.html')) return trimmed;
  return `${trimmed}${NOVNC_VIEWER_PATH}`;
}

/** Porta pública do noVNC quando habilitado; `null` se desligado. */
export function resolveNovncPort(): number | null {
  if (!env.MANAGER_VNC_ENABLED) return null;
  return env.MANAGER_NOVNC_PORT;
}

/** URL completa do viewer noVNC para o painel abrir (null se VNC desligado ou URL não configurada). */
export function resolveNovncPublicUrl(): string | null {
  if (!env.MANAGER_VNC_ENABLED) return null;
  const configured = env.MANAGER_NOVNC_PUBLIC_URL.trim();
  if (!configured) return null;
  return normalizeNovncViewerUrl(configured);
}
