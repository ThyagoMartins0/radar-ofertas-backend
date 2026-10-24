# Dokploy — backend (`backlmbot`)

## Build

| Campo | Valor |
|--------|--------|
| Repositório | `radar-ofertas-backend` |
| Build context | `.` (raiz) |
| Dockerfile | `Dockerfile` |
| Container Port (Domain) | **3001** (não 3000, não 80) |

O `Dockerfile` da raiz sobe a **API REST**. O collector não escuta HTTP — se o command padrão antigo (`app.ts`) estiver no ar, o Traefik devolve 502.

## Domain

| Campo | Valor |
|--------|--------|
| Host | `backlmbot.simplapp.com.br` |
| Path / Internal Path | `/` |
| Strip Path | desligado |
| **Container Port** | **3001** |
| Custom Entrypoint | desligado |
| **HTTPS** | **ligado** (Let's Encrypt) |
| Middlewares | vazio |

## Environment

Copie `.env.dokploy.example` e troque os hostnames internos do MySQL/Redis no Dokploy.

Obrigatório para o processo não morrer na subida (502):

- `JWT_SECRET` (≥ 32 chars)
- `MYSQL_*` + `MYSQL_DOCKER_HOST` **ou** `DATABASE_URL`
- `REDIS_URL` + `REDIS_ENABLED=true`
- `API_CORS_ORIGINS=https://rdofertas.simplapp.com.br`

## Conferir

Depois do redeploy:

- `https://backlmbot.simplapp.com.br/` → `{"status":"ok","service":"radar-ofertas-api"}`
- `https://backlmbot.simplapp.com.br/api/v1/health` → JSON de health

No frontend, `API_PROXY_UPSTREAM` deve ser o **hostname interno** deste app + `:3001` (não a URL HTTPS pública), se o nginx do painel fizer proxy de `/api`.
