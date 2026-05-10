# ── base: shared layer ────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./

# ── dev: all deps (prod + dev) for running tests ──────────────────────────────
FROM base AS dev
RUN npm install
COPY server/ ./server/
COPY public/ ./public/

# ── prod: production-only deps ────────────────────────────────────────────────
FROM base AS prod
RUN npm install --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "server/index.js"]
