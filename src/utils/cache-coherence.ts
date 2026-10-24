import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from './logger.js';

const INVALIDATION_CHANNEL = 'radar:cache:invalidate';

export type CacheDomain =
  | 'accounts'
  | 'queue-config'
  | 'score-config'
  | 'brand-config'
  | 'ml-sources'
  | 'coupons-config'
  | 'amazon-config'
  | 'amazon-sources';

type InvalidationHandler = () => void | Promise<void>;

const handlers = new Map<CacheDomain, Set<InvalidationHandler>>();

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let redisFailed = false;

function createRedisClient(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
}

function getPublisher(): Redis | null {
  if (!env.REDIS_ENABLED || redisFailed) return null;
  if (!publisher) {
    publisher = createRedisClient();
    publisher.on('error', () => {
      redisFailed = true;
    });
  }
  return publisher;
}

export function registerCacheInvalidationHandler(
  domain: CacheDomain,
  handler: InvalidationHandler,
): void {
  let set = handlers.get(domain);
  if (!set) {
    set = new Set();
    handlers.set(domain, set);
  }
  set.add(handler);
}

/** Notifica todas as réplicas/processos para invalidar caches locais do domínio. */
export async function publishCacheInvalidation(...domains: CacheDomain[]): Promise<void> {
  const unique = [...new Set(domains)];
  if (unique.length === 0) return;

  const redis = getPublisher();
  if (!redis) return;

  try {
    if (redis.status !== 'ready') await redis.connect();
    await redis.publish(INVALIDATION_CHANNEL, JSON.stringify({ domains: unique }));
  } catch (error) {
    redisFailed = true;
    logger.debug({ error, domains: unique }, 'Falha ao publicar invalidação de cache');
  }
}

async function dispatchInvalidation(domains: CacheDomain[]): Promise<void> {
  for (const domain of domains) {
    const set = handlers.get(domain);
    if (!set) continue;
    for (const handler of set) {
      try {
        await handler();
      } catch (error) {
        logger.error({ error, domain }, 'Handler de invalidação de cache falhou');
      }
    }
  }
}

export async function startCacheInvalidationSubscriber(): Promise<void> {
  if (!env.REDIS_ENABLED || subscriber) return;

  subscriber = createRedisClient();
  subscriber.on('error', (error) => {
    logger.debug({ error }, 'Subscriber de cache coherence desconectado');
  });

  try {
    await subscriber.connect();
    await subscriber.subscribe(INVALIDATION_CHANNEL);
    subscriber.on('message', (_channel, message) => {
      try {
        const parsed = JSON.parse(message) as { domains?: CacheDomain[] };
        if (!Array.isArray(parsed.domains) || parsed.domains.length === 0) return;
        void dispatchInvalidation(parsed.domains);
      } catch {
        /* payload inválido */
      }
    });
  } catch (error) {
    logger.debug({ error }, 'Não foi possível iniciar subscriber de cache coherence');
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}

export async function stopCacheInvalidationSubscriber(): Promise<void> {
  if (subscriber) {
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
  if (publisher) {
    await publisher.quit().catch(() => undefined);
    publisher = null;
  }
  redisFailed = false;
}
