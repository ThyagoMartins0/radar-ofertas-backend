import { resetAndRequeuePendingSenderJobs } from '../queue/index.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  const requeued = await resetAndRequeuePendingSenderJobs();
  logger.info({ requeued }, 'Pending offer sends reset and requeued');
  console.log(`Reenfileirados: ${requeued}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
