import { runUnifiedWorker } from './channels/worker-runner.js';
import { logger } from './utils/logger.js';
import { setWhatsAppOwnerConflictHandler } from './whatsapp/index.js';

setWhatsAppOwnerConflictHandler(() => {
  logger.error(
    'WhatsApp já está sendo usado por outro processo — encerrando este worker duplicado.',
  );
  process.exit(0);
});

runUnifiedWorker().catch((error) => {
  logger.error({ error }, 'Sender worker process failed');
  process.exit(1);
});
