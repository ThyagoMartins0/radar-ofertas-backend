import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { connectWhatsApp, WhatsAppOwnedElsewhereError } from './whatsapp/index.js';
import { logger } from './utils/logger.js';

async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
  return answer;
}

function extractInviteCode(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/channel\/([A-Za-z0-9]+)/)?.[1];
  if (fromUrl) return fromUrl;
  return trimmed;
}

async function main(): Promise<void> {
  logger.info('Conectando ao WhatsApp para consultar canal...');
  const sock = await connectWhatsApp();

  const raw =
    process.argv[2] ?? (await ask('Cole o link ou código do canal (whatsapp.com/channel/...): '));
  const inviteCode = extractInviteCode(raw);

  if (!inviteCode) {
    logger.error('Código do canal não informado');
    process.exit(1);
  }

  const meta = await sock.newsletterMetadata('invite', inviteCode);
  if (!meta?.id) {
    logger.error({ inviteCode }, 'Canal não encontrado');
    process.exit(1);
  }

  console.log('\nCanal encontrado:');
  console.log(`  Nome: ${meta.name ?? meta.thread_metadata?.name ?? '—'}`);
  console.log(`  JID:  ${meta.id}`);
  console.log('\nAdicione no .env:');
  console.log(`WHATSAPP_CHANNEL_ID=${meta.id}`);
}

main().catch((error) => {
  if (error instanceof WhatsAppOwnedElsewhereError) {
    logger.error(
      'A sessão do WhatsApp já está ativa em outro processo. Pare o worker antes de rodar npm run wa:channel.',
    );
    process.exit(1);
  }
  logger.error({ error }, 'Falha ao consultar canal');
  process.exit(1);
});
