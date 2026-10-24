import { whatsappPublisher } from './channels/whatsapp-publisher.js';
import { env } from './config/env.js';
import { prisma } from './database/client.js';
import { startSenderWorker } from './jobs/sender.js';
import { searchConfiguredCategories } from './mercado-livre/index.js';
import { generateAffiliateLink } from './mercado-livre/affiliate-link.js';
import { hasValidSession, loadStorageState } from './mercado-livre/session.js';
import { processOffers } from './offers/service.js';
import { getSenderQueue } from './queue/index.js';
import { logger } from './utils/logger.js';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  isPlaceholderChannelId,
  validateWhatsAppChannel,
} from './whatsapp/index.js';

const E2E_LIMIT = Number(process.env.E2E_LIMIT ?? 3);

async function requireValidChannel(sock: Awaited<ReturnType<typeof connectWhatsApp>>): Promise<{
  jid: string;
  label: string;
}> {
  if (isPlaceholderChannelId(env.WHATSAPP_CHANNEL_ID)) {
    throw new Error(
      'WHATSAPP_CHANNEL_ID é placeholder — rode npm run wa:channel com o link do seu canal',
    );
  }

  const channel = await validateWhatsAppChannel(sock, env.WHATSAPP_CHANNEL_ID);
  if (!channel.valid) {
    throw new Error(`Canal WhatsApp inválido: ${channel.reason} — rode npm run wa:channel`);
  }

  return {
    jid: env.WHATSAPP_CHANNEL_ID,
    label: channel.name ?? env.WHATSAPP_CHANNEL_ID,
  };
}

async function waitForQueueDrain(timeoutMs = 120_000): Promise<void> {
  const queue = getSenderQueue('whatsapp');
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const pending = counts.waiting + counts.active + counts.delayed;

    if (pending === 0) {
      if (counts.failed > 0) {
        const failed = await queue.getFailed(0, 3);
        throw new Error(failed[0]?.failedReason ?? 'Sender job failed');
      }
      return;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('Timeout aguardando fila offer-sender');
}

async function main(): Promise<void> {
  logger.info({ limit: E2E_LIMIT }, 'Iniciando teste E2E completo');

  const mlState = await loadStorageState();
  if (!hasValidSession(mlState)) {
    throw new Error('Sessão Mercado Livre inválida — rode npm run ml:login');
  }

  const samplePermalink =
    'https://produto.mercadolivre.com.br/MLB-4356882227-moletom-canguru-unissex-com-capuz-e-bolso-quentinho-confo-_JM';
  const sampleLink = await generateAffiliateLink(samplePermalink, 'MLB4356882227');
  if (!sampleLink.includes('meli.la') && !sampleLink.includes('/sec/')) {
    throw new Error(`Link afiliado de teste não encurtado: ${sampleLink}`);
  }
  logger.info({ sampleLink }, 'Sessão ML OK — link encurtado gerado');

  await prisma.offer.deleteMany();
  logger.info('Ofertas antigas removidas para teste limpo');

  Object.assign(env, { ML_SEARCH_LIMIT: E2E_LIMIT });
  const rawOffers = await searchConfiguredCategories();
  if (rawOffers.length === 0) {
    throw new Error('Coleta retornou zero produtos');
  }
  logger.info({ count: rawOffers.length }, 'Coleta concluída');

  const enqueued = await processOffers(rawOffers);
  const saved = await prisma.offer.findMany({ orderBy: { createdAt: 'desc' } });
  const shortLinks = saved.filter(
    (o) => o.affiliateLink?.includes('meli.la') || o.affiliateLink?.includes('/sec/'),
  );

  logger.info(
    {
      coletados: rawOffers.length,
      salvos: saved.length,
      enfileirados: enqueued,
      comLinkEncurtado: shortLinks.length,
      amostra: saved.map((o) => ({
        id: o.mercadoLivreId,
        title: o.title.slice(0, 40),
        link: o.affiliateLink,
      })),
    },
    'Ofertas processadas',
  );

  if (shortLinks.length === 0) {
    throw new Error('Nenhuma oferta ficou com link encurtado meli.la/sec');
  }

  if (enqueued === 0) {
    throw new Error('Nenhuma oferta passou no score mínimo para envio');
  }

  const sock = await connectWhatsApp();
  const target = await requireValidChannel(sock);

  // O E2E exercita só o caminho do WhatsApp — o Telegram tem seu próprio worker.
  const worker = startSenderWorker(whatsappPublisher);
  logger.info({ channel: target.label, jid: target.jid }, 'Worker sender iniciado para teste E2E');

  try {
    await waitForQueueDrain();
  } finally {
    await worker.close();
  }

  const sent = await prisma.offer.findMany({
    where: { sentAt: { not: null } },
    orderBy: { sentAt: 'desc' },
  });

  logger.info(
    {
      destino: target.label,
      enviadas: sent.length,
      ofertas: sent.map((o) => ({
        id: o.mercadoLivreId,
        title: o.title.slice(0, 40),
        link: o.affiliateLink,
        sentAt: o.sentAt,
      })),
    },
    'Teste E2E concluído com sucesso',
  );

  await prisma.$disconnect();
  await disconnectWhatsApp();
  process.exit(0);
}

main().catch(async (error) => {
  logger.error({ error }, 'Teste E2E falhou');
  await prisma.$disconnect();
  process.exit(1);
});
