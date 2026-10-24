import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { printPreflight, printSetupGuide, runPreflight } from './preflight.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const children: ChildProcess[] = [];

function spawnScript(script: string): ChildProcess {
  const isWindows = process.platform === 'win32';
  const child = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, RADAR_SKIP_PREFLIGHT: '1' },
    shell: isWindows,
  });

  children.push(child);
  return child;
}

function shutdown(signal: string): void {
  console.log(`\n${signal} — encerrando processos...`);
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    }
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const result = await runPreflight('all');
  printPreflight(result.items);

  // Falhas de sessão ML não bloqueiam a subida — o login é feito pelo painel (Configurações › Mercado Livre).
  const criticalFailures = result.items.filter(
    (i) => !i.ok && i.label !== 'Mercado Livre (afiliado)',
  );
  if (criticalFailures.length > 0) {
    console.log('Corrija os itens acima antes de continuar.\n');
    printSetupGuide();
    process.exit(1);
  }

  console.log('Subindo collector, scheduler e API REST...\n');
  console.log('Frontend (repo separado): cd frontend && npm run dev\n');

  // O worker de envio NÃO sobe aqui: quem gerencia o worker é o painel (Settings
  // › Operações). Subir um worker também aqui criaria dois donos da sessão
  // do WhatsApp ao mesmo tempo (connectionReplaced em loop).
  spawnScript('dev');
  spawnScript('scheduler');
  spawnScript('api');

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
