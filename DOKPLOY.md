# Dokploy — backend (`backlmbot`)

## Build

| Campo | Valor |
|--------|--------|
| Repositório | `radar-ofertas-backend` |
| Build context | `.` (raiz) |
| Dockerfile | `Dockerfile` |
| Container Port (Domain) | **3001** (igual a `API_PORT`; 80 também responde no Docker) |

O `Dockerfile` da raiz sobe a **API REST**. O collector não escuta HTTP — se o command padrão antigo (`app.ts`) estiver no ar, o Traefik devolve 502.

## Worker de envio (WhatsApp / Telegram)

O QR do WhatsApp e o envio de ofertas **não rodam dentro da API**. É obrigatório um **segundo app** no Dokploy (mesma imagem/Dockerfile, **sem domínio HTTP**):

| Campo | Valor |
|--------|--------|
| Command | `npx tsx --import ./src/bootstrap-env.ts src/worker.ts` |
| Environment | Igual ao backend (mesmo `REDIS_*`, `MYSQL_*`, `WHATSAPP_AUTH_PATH`, volume `/app/data` compartilhado com a API) |
| Volume | Montar o mesmo diretório de dados da API (`auth_info_baileys`, credenciais ML) |

Sem esse processo, o painel fica em **“Aguardando worker de envio…”** e o status/QR não aparecem.

Opcional: apps separados para `src/app.ts` (collector) e `src/scheduler.ts` (agendador).

## Domain

| Campo | Valor |
|--------|--------|
| Host | `backlmbot.simplapp.com.br` |
| Path / Internal Path | `/` |
| Strip Path | desligado |
| **Container Port** | **3001** (ou 80 — a API no Docker escuta as duas) |
| Custom Entrypoint | desligado |
| **HTTPS** | **ligado** (Let's Encrypt) |
| Middlewares | vazio |

## Environment

**Não cole a `.env` do PC.** `localhost` e `MYSQL_PORT=3360` só existem na sua máquina.

| Local (PC) | Dokploy (container) |
|------------|---------------------|
| `NODE_ENV=local` | `NODE_ENV=production` |
| `MYSQL_HOST=localhost` `MYSQL_PORT=3360` | `MYSQL_DOCKER_HOST=<Internal Host>` `MYSQL_PORT=3306` |
| `REDIS_URL=redis://localhost:6379` | `REDIS_URL=redis://<Internal Host>:6379` |
| `API_CORS_ORIGINS=http://localhost:5173,...` | `API_CORS_ORIGINS=https://rdofertas.simplapp.com.br` |
| `MANAGER_VNC_ENABLED=true` | `MANAGER_VNC_ENABLED=false` (Xvfb falhando = 502) |

Copie `.env.dokploy.example`. No serviço MySQL/Redis do Dokploy, use o **Internal Host**.

Obrigatório para o processo não morrer na subida (502):

- `JWT_SECRET` (≥ 32 chars, não o placeholder)
- `MYSQL_*` + `MYSQL_DOCKER_HOST` (porta **3306** na rede interna)
- `REDIS_URL` + `REDIS_ENABLED=true` (Redis no Dokploy, não localhost)
- `API_CORS_ORIGINS=https://rdofertas.simplapp.com.br`
- `MANAGER_VNC_ENABLED=false`

## Conferir

Depois do redeploy:

- `https://backlmbot.simplapp.com.br/` → `{"status":"ok","service":"radar-ofertas-api"}`
- `https://backlmbot.simplapp.com.br/api/v1/health` → JSON de health

No frontend, `API_PROXY_UPSTREAM` deve ser o **hostname interno** deste app + `:3001` (não a URL HTTPS pública), se o nginx do painel fizer proxy de `/api`.
