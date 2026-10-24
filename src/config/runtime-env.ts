import { existsSync } from 'node:fs';

function isContainerRuntime(): boolean {
  if (process.env.RUNNING_IN_DOCKER === '1' || process.env.RUNNING_IN_DOCKER === 'true') {
    return true;
  }
  return existsSync('/.dockerenv');
}

function encodeMysqlCredential(value: string): string {
  return encodeURIComponent(value);
}

function buildDatabaseUrl(host: string, port: string): string | undefined {
  const user = process.env.MYSQL_USER?.trim();
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE?.trim();
  if (!user || password === undefined || !database) {
    return undefined;
  }
  return `mysql://${encodeMysqlCredential(user)}:${encodeMysqlCredential(password)}@${host}:${port}/${database}`;
}

function replaceLocalHostInUrl(url: string, dockerHost: string): string {
  return url.replace(/@(localhost|127\.0\.0\.1)(?=:|\/)/g, `@${dockerHost}`);
}

export function isUnresolvedPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  return /<[^>]+>/.test(value) || value.includes('Internal Host') || value.includes('a mesma senha');
}

/**
 * Monta DATABASE_URL a partir de MYSQL_* e corrige localhost dentro de containers.
 * Deve rodar antes de qualquer conexão com o MySQL (`tsx --import ./src/bootstrap-env.ts`).
 */
export function applyRuntimeEnv(): void {
  if (process.env.NODE_ENV === 'development') {
    process.env.NODE_ENV = 'local';
  }

  const inContainer = isContainerRuntime();
  const dbHost = inContainer
    ? (process.env.MYSQL_DOCKER_HOST?.trim() ?? 'host.docker.internal')
    : (process.env.MYSQL_HOST?.trim() ?? 'localhost');
  const dbPort = process.env.MYSQL_PORT?.trim() ?? '3306';

  const built = buildDatabaseUrl(dbHost, dbPort);
  if (built) {
    process.env.DATABASE_URL = built;
  } else if (inContainer && process.env.DATABASE_URL) {
    const dockerHost = process.env.MYSQL_DOCKER_HOST?.trim() ?? 'host.docker.internal';
    process.env.DATABASE_URL = replaceLocalHostInUrl(process.env.DATABASE_URL, dockerHost);
  }

  if (inContainer && process.env.REDIS_URL) {
    const redisHost = process.env.REDIS_DOCKER_HOST?.trim() ?? 'redis';
    process.env.REDIS_URL = replaceLocalHostInUrl(process.env.REDIS_URL, redisHost);
  }

  if (
    inContainer &&
    (isUnresolvedPlaceholder(process.env.MYSQL_DOCKER_HOST) ||
      isUnresolvedPlaceholder(process.env.MYSQL_PASSWORD) ||
      isUnresolvedPlaceholder(process.env.REDIS_URL) ||
      isUnresolvedPlaceholder(process.env.REDIS_DOCKER_HOST))
  ) {
    console.error(
      '[bootstrap] MYSQL_DOCKER_HOST / REDIS_* ainda têm placeholder. Cole o Internal Host real do Dokploy.',
    );
  }
}
