import { loginAffiliateSession, MercadoLivrePanelLoginUnavailableError } from './mercado-livre/auth.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Iniciando login de afiliado Mercado Livre');
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
