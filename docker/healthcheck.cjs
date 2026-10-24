// HEALTHCHECK da imagem: só a API escuta HTTP. Worker/collector/scheduler usam a mesma imagem
// sem porta — testar 3001 neles faz o Docker/Swarm matá-los com SIGTERM em loop.
const { readdirSync, readFileSync } = require('node:fs');

function isApiProcessRunning() {
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('api/server.ts')) return true;
    } catch {
      /* processo encerrou durante a leitura */
    }
  }
  return false;
}

if (!isApiProcessRunning()) process.exit(0);

fetch(`http://127.0.0.1:${process.env.API_PORT || 3001}/`)
  .then((response) => process.exit(response.ok ? 0 : 1))
  .catch(() => process.exit(1));
