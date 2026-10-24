import { env } from './env.js';

/** Porta pública do noVNC quando habilitado; `null` se desligado. */
export function resolveNovncPort(): number | null {
  if (!env.MANAGER_VNC_ENABLED) return null;
  return env.MANAGER_NOVNC_PORT;
}
