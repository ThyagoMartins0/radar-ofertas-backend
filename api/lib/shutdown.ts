import { prisma } from '../../src/database/client.js';
import { closeAllQueues } from '../../src/queue/index.js';
import { closeLogStore } from '../../src/utils/log-store.js';
import { closeRedisState } from '../../src/utils/redis-state.js';
import { closeRefreshTokenStore } from '../services/refresh-token-store.js';

export async function shutdownApi(): Promise<void> {
  await closeRefreshTokenStore();
  await closeAllQueues();
  await closeLogStore();
  await closeRedisState();
  await prisma.$disconnect();
}
