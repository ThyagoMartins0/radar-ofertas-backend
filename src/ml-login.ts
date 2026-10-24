import { resolveAccountAuthPath } from './accounts/repository.js';
import { DEFAULT_ACCOUNT_ID } from './accounts/types.js';
import { loginAffiliateSession, MercadoLivrePanelLoginUnavailableError } from './mercado-livre/auth.js';
import { getMlAuthPath, setMlAuthPath } from './mercado-livre/session.js';
import { logger } from './utils/logger.js';

/** Uso: `npm run ml:login` (conta default) ou `npm run ml:login -- <accountId>`. */
async function main(): Promise<void> {
  const accountId = process.argv[2]?.trim() || DEFAULT_ACCOUNT_ID;
  setMlAuthPath(resolveAccountAuthPath(accountId, 'mercado_livre'));
  logger.info({ accountId, authPath: getMlAuthPath() }, 'Iniciando login de afiliado Mercado Livre');
  await loginAffiliateSession();
}

main().catch((error) => {
  if (error instanceof MercadoLivrePanelLoginUnavailableError) {
    logger.error(error.userMessage);
    process.exit(1);
  }
  logger.error({ error }, 'ML affiliate login failed');
  process.exit(1);
});
