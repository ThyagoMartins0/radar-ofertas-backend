import { connectWhatsApp, WhatsAppOwnedElsewhereError } from './whatsapp/index.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Iniciando login WhatsApp — escaneie o QR code quando aparecer');
  await connectWhatsApp();
  logger.info('WhatsApp conectado — sessão salva. Pode encerrar com Ctrl+C');
}

main().catch((error) => {
  if (error instanceof WhatsAppOwnedElsewhereError) {
    logger.error(
      'A sessão do WhatsApp já está ativa em outro processo. Pare o worker antes de parear novamente (npm run wa:login).',
    );
    process.exit(1);
  }
  logger.error({ error }, 'Login WhatsApp falhou');
  process.exit(1);
});
