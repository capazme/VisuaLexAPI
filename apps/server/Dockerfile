# The server module: Express + Prisma, the gateway to accounts, dossiers and MERL-T.
#
# Build with this folder as the context:
#   docker build -t visualex-server apps/server
#   docker build --target migrate -t visualex-migrate apps/server
#
# Two targets on purpose. `prisma` and `tsx` are development dependencies, so the
# one-shot that applies the migrations runs from the build stage, and the runtime
# carries only what `node dist/index.js` needs.

FROM node:24-bookworm-slim AS base
# Debian, not Alpine, and openssl on purpose: Prisma's query engine picks its
# binary from the libssl it finds, at `generate` time and again at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Node 24 ships npm 11, which is what writes the lockfile (CI pins Node 24).
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

# One-shot: applies the migrations, then exits. Not part of the runtime.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The generated client is not a dependency: it comes from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
# The MERL-T dead-letter log (NDJSON, capped at 50 MB) is written under ./logs
# unless MERLT_DEAD_LETTER_DIR says otherwise; give it a home the user can write.
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so SIGTERM reaches the graceful shutdown (idle sockets swept, Prisma
# disconnected, a forced exit after 10 s) instead of stopping at a shell.
CMD ["node", "dist/index.js"]
