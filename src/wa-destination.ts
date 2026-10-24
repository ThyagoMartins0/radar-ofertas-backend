import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { connectWhatsApp, WhatsAppOwnedElsewhereError } from './whatsapp/index.js';
import { resolveWhatsAppInvite } from './whatsapp/invite.js';
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

async function main(): Promise<void> {
  logger.info('Conectando ao WhatsApp para consultar destino...');
  const sock = await connectWhatsApp();

  const raw =
    process.argv[2] ??
    (await ask(
      'Cole o link (chat.whatsapp.com/... ou whatsapp.com/channel/...) ou o JID (@g.us / @newsletter): ',
    ));

  if (!raw.trim()) {
    logger.error('Destino não informado');
    process.exit(1);
  }

  const resolved = await resolveWhatsAppInvite(sock, raw);

  console.log('\nDestino encontrado:');
  console.log(`  Tipo: ${resolved.kind === 'group' ? 'Grupo' : 'Canal'}`);
  console.log(`  Nome: ${resolved.label ?? '—'}`);
  console.log(`  JID:  ${resolved.jid}`);
  console.log('\nAdicione em Configuração › Destinos WhatsApp ou no JSON da conta:');
  console.log(`  jid: ${resolved.jid}`);
}

main().catch((error) => {
  if (error instanceof WhatsAppOwnedElsewhereError) {
    logger.error(
      'A sessão do WhatsApp já está ativa em outro processo. Pare o worker antes de rodar npm run wa:destination.',
    );
    process.exit(1);
  }
  logger.error({ error }, 'Falha ao consultar destino');
  process.exit(1);
});
