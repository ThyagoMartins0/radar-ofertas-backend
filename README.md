# Radar Ofertas — Backend

Collector, workers, filas Redis/BullMQ e **API REST** (`/api/v1`). O painel React está em outro repositório e consome esta API.

## Configuração

```bash
cp .env.example .env
# Ajuste DATABASE_URL, JWT_SECRET, API_ADMIN_* e demais variáveis.
```

### Banco de dados

Use `DATABASE_URL` (MySQL) e, para o MySQL do Docker Compose, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PORT`.

### Frontend (CORS)

Com o painel em outro host/porta, defina:

```env
API_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

API: **http://localhost:3001** — `GET /` (probe) e `GET /api/v1/health`

Dokploy: ver [DOKPLOY.md](./DOKPLOY.md). Container Port = **3001**.

Dev com hot reload de código:

```bash
npm run docker:dev
```

## Desenvolvimento local (npm)

```bash
docker compose up -d mysql redis
npm install
npm run migrate:deploy
npm run api          # :3001
npm run dev          # collector
npm run worker
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `docker compose up -d --build` | Stack completa |
| `npm run api` | API REST em desenvolvimento |
| `npm run check` | Preflight do ambiente |
| `npm test` | Testes unitários |
