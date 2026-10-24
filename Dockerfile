# Imagem backend (alias para docker/Dockerfile.backend — `docker build .` na raiz).
# Serviços: collector, scheduler, worker, migrate, api.

FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    xvfb \
    x11vnc \
    x11-utils \
    websockify \
    && git clone --depth 1 --branch v1.5.0 https://github.com/novnc/noVNC.git /usr/share/novnc \
    && test -f /usr/share/novnc/vnc_lite.html \
    && test -f /usr/share/novnc/core/rfb.js \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    GIT_TERMINAL_PROMPT=0

FROM base AS deps

ENV NODE_ENV=development

COPY package.json package-lock.json tsconfig.json ./
COPY backend/prisma ./backend/prisma

RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global url."https://github.com/".insteadOf "git@github.com:" \
    && git config --global http.version HTTP/1.1 \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-timeout 300000 \
    && mkdir -p /ms-playwright \
    && for attempt in 1 2 3 4 5; do \
         npm ci --ignore-scripts && break; \
         if [ "$attempt" -eq 5 ]; then exit 1; fi; \
         echo "npm ci falhou (tentativa $attempt/5), aguardando..."; \
         sleep $((attempt * 10)); \
       done \
    && npx playwright install-deps chromium \
    && npx playwright install chromium \
    && npx prisma generate \
    && mkdir -p /app/data

FROM deps AS backend

ENV NODE_ENV=production

COPY backend ./backend
COPY docker ./docker

RUN chmod +x /app/docker/api-entrypoint.sh

CMD ["npx", "tsx", "backend/src/app.ts"]
