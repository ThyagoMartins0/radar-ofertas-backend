import { telegramPublisher } from '../channels/telegram-publisher.js';
import { env } from '../config/env.js';
import { prisma } from '../database/client.js';
import { buildMlCategoryRows, hydrateMlSourcesCache } from '../config/ml-sources-config.js';
import {
  buildAmazonSourceRows,
  hydrateAmazonSourcesCache,
} from '../config/amazon-sources-config.js';
import { hasValidSession, loadSessionMeta, loadStorageState } from '../mercado-livre/session.js';
import { resolveMercadoLivreAffiliateTag } from '../accounts/ml-affiliate-tag.js';
import { getCollectorQueue, isRedisEnabled, closeAllQueues } from '../queue/index.js';
import { formatIsoInTimezone } from '../utils/datetime.js';

export type PreflightProfile = 'all' | 'collector' | 'worker' | 'scheduler' | 'api';

export interface PreflightItem {
  ok: boolean;
  label: string;
  detail: string;
  fix?: string;
}

export interface PreflightResult {
  ok: boolean;
  items: PreflightItem[];
}

function maskUrl(url: string): string {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

function databaseFixHint(message: string): string {
  if (message.includes('ECONNREFUSED') || message.includes('connect ETIMEDOUT')) {
    return 'O MySQL ainda não está acessível. Aguarde o container subir ou confira host/porta na DATABASE_URL.';
  }
  if (message.includes('Access denied')) {
    return 'Credenciais inválidas — confira MYSQL_USER, MYSQL_PASSWORD e DATABASE_URL no .env';
  }
  return 'Confira DATABASE_URL e rode: npm run migrate:deploy';
}

async function checkDatabase(): Promise<PreflightItem> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, label: 'MySQL', detail: maskUrl(env.DATABASE_URL) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      label: 'MySQL',
      detail: message,
      fix: databaseFixHint(message),
    };
  }
}

async function checkOfferDeliverySchema(): Promise<PreflightItem> {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'offer_deliveries'
        AND column_name = 'account_id'
    `;

    if (rows.length === 0) {
      return {
        ok: false,
        label: 'Schema do banco',
        detail: 'Migração pendente: coluna account_id ausente em offer_deliveries',
        fix: 'Pare o bot (Ctrl+C), rode npm run migrate:deploy e depois npm run prisma:generate',
      };
    }

    return {
      ok: true,
      label: 'Schema do banco',
      detail: 'offer_deliveries com suporte a multi-conta',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      label: 'Schema do banco',
      detail: message,
      fix: 'Confira DATABASE_URL e rode: npm run migrate:deploy',
    };
  }
}

async function checkRedis(): Promise<PreflightItem> {
  if (!isRedisEnabled()) {
    return {
      ok: false,
      label: 'Redis',
      detail: 'REDIS_ENABLED=false — collector e worker precisam do Redis',
      fix: 'Defina REDIS_ENABLED=true e REDIS_URL no .env',
    };
  }

  const queue = getCollectorQueue();
  try {
    await queue.getJobCounts('waiting');
    return { ok: true, label: 'Redis', detail: maskUrl(env.REDIS_URL) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      label: 'Redis',
      detail: message,
      fix: 'Confira REDIS_URL no .env',
    };
  }
}

async function checkMercadoLivre(): Promise<PreflightItem> {
  const state = await loadStorageState();
  const meta = await loadSessionMeta();

  if (!state || !hasValidSession(state)) {
    return {
      ok: false,
      label: 'Mercado Livre (afiliado)',
      detail: meta.lastError ?? 'Sem sessão válida',
      fix: 'npm run ml:login',
    };
  }

  return {
    ok: true,
    label: 'Mercado Livre (afiliado)',
    detail: meta.lastLoginAt
      ? `Login em ${formatIsoInTimezone(meta.lastLoginAt, env.APP_TIMEZONE)}`
      : 'Sessão OK',
  };
}

async function checkTelegram(): Promise<PreflightItem> {
  if (!env.TELEGRAM_ENABLED) {
    return {
      ok: true,
      label: 'Telegram',
      detail: 'Desabilitado (TELEGRAM_ENABLED=false) — nada será enviado ao Telegram',
    };
  }

  const result = await telegramPublisher.verify();
  if (!result.ok) {
    return {
      ok: false,
      label: 'Telegram',
      detail: result.detail,
      fix: 'Crie o bot no @BotFather, adicione-o como admin do canal e preencha TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no .env',
    };
  }

  return { ok: true, label: 'Telegram', detail: result.detail };
}

async function checkAffiliateTag(): Promise<PreflightItem> {
  const tag = await resolveMercadoLivreAffiliateTag();
  if (!tag.trim()) {
    return {
      ok: false,
      label: 'Tag afiliado (Mercado Livre)',
      detail: 'Tag de afiliado ML não configurada',
      fix: 'Contas → Mercado Livre → Configurar (tag) ou AFFILIATE_CONFIG={"tag":"sua-tag-ml"} no .env',
    };
  }
  return { ok: true, label: 'Tag afiliado (Mercado Livre)', detail: tag };
}

async function checkAmazonStoreId(): Promise<PreflightItem> {
  await hydrateAmazonSourcesCache();
  const activeAmazon = buildAmazonSourceRows().filter((row) => row.channels.length > 0);
  if (activeAmazon.length === 0) {
    return {
      ok: true,
      label: 'ID da loja (Amazon)',
      detail: 'Nenhuma fonte Amazon ativa — opcional',
    };
  }

  const storeId = env.AMAZON_AFFILIATE_STORE_ID.trim();
  if (!storeId) {
    return {
      ok: false,
      label: 'ID da loja (Amazon)',
      detail: 'AMAZON_AFFILIATE_STORE_ID vazio',
      fix: 'Defina AMAZON_AFFILIATE_STORE_ID=mercadaodasfa-20 no .env (ID da loja em Compartilhar links de afiliados)',
    };
  }

  return { ok: true, label: 'ID da loja (Amazon)', detail: storeId };
}

async function checkCategories(): Promise<PreflightItem> {
  await hydrateMlSourcesCache();
  // Ativa = alimenta ao menos um canal.
  const rows = buildMlCategoryRows().filter((row) => row.channels.length > 0);
  const invalid = rows.filter((row) => !row.valid);

  if (invalid.length > 0) {
    return {
      ok: false,
      label: 'Categorias ML',
      detail: `${invalid.length} inválida(s): ${invalid.map((c) => c.category).join(', ')}`,
      fix: 'Ajuste ML_CATEGORIES no .env ou remova links extras inválidos no painel',
    };
  }

  const envCount = rows.filter((row) => row.fromEnv).length;
  const customCount = rows.filter((row) => !row.fromEnv).length;

  return {
    ok: true,
    label: 'Categorias ML',
    detail: `${rows.length} ativa(s) — ${envCount} do .env, ${customCount} extra(s)`,
  };
}

async function checkAmazonSources(): Promise<PreflightItem> {
  await hydrateAmazonSourcesCache();
  const rows = buildAmazonSourceRows().filter((row) => row.channels.length > 0);
  const invalid = rows.filter((row) => !row.valid);

  if (invalid.length > 0) {
    return {
      ok: false,
      label: 'Fontes Amazon',
      detail: `${invalid.length} inválida(s): ${invalid.map((c) => c.source).join(', ')}`,
      fix: 'Ajuste AMAZON_SOURCES no .env ou remova links extras inválidos no painel',
    };
  }

  if (rows.length === 0) {
    return {
      ok: true,
      label: 'Fontes Amazon',
      detail: 'Nenhuma fonte ativa',
    };
  }

  const envCount = rows.filter((row) => row.fromEnv).length;
  const customCount = rows.filter((row) => !row.fromEnv).length;

  return {
    ok: true,
    label: 'Fontes Amazon',
    detail: `${rows.length} ativa(s) — ${envCount} do .env, ${customCount} extra(s)`,
  };
}

async function checkUsersTable(): Promise<PreflightItem> {
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT TABLE_NAME AS table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
    `;

    if (rows.length === 0) {
      return {
        ok: false,
        label: 'Tabela users',
        detail: 'Migração pendente: tabela users ausente',
        fix: 'Rode npm run migrate:deploy e npm run prisma:generate',
      };
    }

    return { ok: true, label: 'Tabela users', detail: 'Autenticação JWT habilitada' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, label: 'Tabela users', detail: message };
  }
}

function checkJwtSecret(): PreflightItem {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return {
      ok: false,
      label: 'JWT_SECRET',
      detail: 'Segredo ausente ou com menos de 32 caracteres',
      fix: 'Defina JWT_SECRET no .env (mínimo 32 caracteres)',
    };
  }
  return { ok: true, label: 'JWT_SECRET', detail: 'Configurado' };
}

function checkApiAdminBootstrap(): PreflightItem {
  const username = env.API_ADMIN_USERNAME.trim();
  const password = env.API_ADMIN_PASSWORD;
  if (!username || !password) {
    return {
      ok: false,
      label: 'Admin API',
      detail: 'API_ADMIN_USERNAME e API_ADMIN_PASSWORD são necessários no primeiro boot',
      fix: 'Defina credenciais no .env — o admin é criado se a tabela users estiver vazia',
    };
  }
  return {
    ok: true,
    label: 'Admin API',
    detail: `Bootstrap configurado para usuário "${username}"`,
  };
}

async function runChecks(profile: PreflightProfile): Promise<PreflightItem[]> {
  const items: PreflightItem[] = [];

  items.push(await checkDatabase());
  items.push(await checkOfferDeliverySchema());

  if (profile === 'all' || profile === 'collector' || profile === 'worker') {
    items.push(await checkRedis());
  }

  if (profile === 'all' || profile === 'worker') {
    items.push(await checkTelegram());
  }

  if (profile === 'all' || profile === 'collector' || profile === 'api') {
    items.push(await checkCategories());
    items.push(await checkAmazonSources());
  }

  if (profile === 'all' || profile === 'api') {
    items.push(await checkUsersTable());
    items.push(checkJwtSecret());
    items.push(checkApiAdminBootstrap());
    items.push(await checkRedis());
  }

  if (profile === 'all' || profile === 'collector') {
    items.push(await checkMercadoLivre());
    items.push(await checkAffiliateTag());
    items.push(await checkAmazonStoreId());
  }

  return items;
}

export function printPreflight(items: PreflightItem[]): void {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     Radar Ofertas — Verificação      ║');
  console.log('╚══════════════════════════════════════╝\n');

  for (const item of items) {
    const icon = item.ok ? '✓' : '✗';
    console.log(`${icon} ${item.label}`);
    console.log(`  ${item.detail}`);
    if (!item.ok && item.fix) {
      console.log(`  → ${item.fix}`);
    }
    console.log('');
  }
}

export function printSetupGuide(): void {
  console.log('═══ Setup completo (rode na ordem) ═══\n');
  console.log('  npm install');
  console.log('  npm run prisma:generate');
  console.log('  npm run migrate:deploy');
  console.log('  npm run ml:login          # login afiliado ML');
  console.log('  npm run wa:login          # QR code WhatsApp');
  console.log('  npm run wa:channel -- "https://whatsapp.com/channel/..."');
  console.log('  npm run check             # verificar tudo');
  console.log('  npm run up                # subir collector + scheduler + api + frontend\n');
  console.log('Telegram (opcional): crie o bot no @BotFather, adicione-o como admin do');
  console.log('canal e defina TELEGRAM_ENABLED/TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no .env.\n');
}

export async function runPreflight(profile: PreflightProfile = 'all'): Promise<PreflightResult> {
  const items = await runChecks(profile);
  const ok = items.every((item) => item.ok);
  return { ok, items };
}

function parseProfile(argv: string[]): PreflightProfile {
  const arg = argv.find((a) => a.startsWith('--profile='));
  const value = arg?.split('=')[1];
  if (
    value === 'collector' ||
    value === 'worker' ||
    value === 'scheduler' ||
    value === 'api'
  ) {
    return value;
  }
  return 'all';
}

async function main(): Promise<void> {
  if (process.env.RADAR_SKIP_PREFLIGHT === '1') {
    return;
  }

  const guide = process.argv.includes('--guide');
  if (guide) {
    printSetupGuide();
    return;
  }

  const profile = parseProfile(process.argv);
  const result = await runPreflight(profile);
  printPreflight(result.items);

  if (!result.ok) {
    console.log('Corrija os itens acima antes de continuar.\n');
    printSetupGuide();
    process.exit(1);
  }

  console.log('Tudo OK — pode subir o bot.\n');
}

const isDirectRun = process.argv[1]?.includes('preflight');
if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await closeAllQueues();
      await prisma.$disconnect();
    });
}
