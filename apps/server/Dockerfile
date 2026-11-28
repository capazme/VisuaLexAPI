# The server module: Express + Prisma, the gateway to accounts, dossiers and MERL-T.
#
# Build with this folder as the context:
#   docker build -t visualex-server apps/server
#   docker build --target migrate -t visualex-migrate apps/server
#
# Two targets on purpose. The one-shot that applies the migrations runs from the build
# stage, which holds the `prisma/` folder (schema and migrations); the runtime does not,
# and carries the production dependencies and `dist/` only. `prisma` (the CLI that
# applies the migrations) is a production dependency since G-555, so the blocking audit
# covers it. The runtime takes it out again: from Prisma 7 the CLI brings about 200 MB
# (Studio, a local Postgres, TypeScript) the server never loads.

FROM node:24-bookworm-slim AS base
# Debian, not Alpine. Prisma 7 (G-612) has no query engine binary any more (the client is JavaScript and
# WebAssembly, and talks to Postgres through node-postgres); openssl stays for the Prisma CLI's schema
# engine, which `prisma migrate deploy` runs in the `migrate` target.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# Node 24 ships npm 11, which is what writes the lockfile (CI pins Node 24).
RUN npm ci

FROM deps AS build
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# The client is generated into src/generated/prisma and compiled into dist/ with the rest.
RUN npx prisma generate && npm run build

# One-shot: applies the migrations, then exits. Not part of the runtime. The URL comes from DATABASE_URL
# through prisma.config.ts (Prisma 7 no longer reads it from the schema).
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# pdfjs-dist (LC57) pulls in @napi-rs/canvas as an optional dependency, ~28 MB of native binaries used only to draw
# pages: the server reads their text and never loads it, so it is removed here and nothing else optional is dropped.
# The Prisma CLI goes too (see the top): `npm uninstall --no-save` removes it with what only it needs, leaving
# @prisma/client, the pg adapter and node-postgres, which is all the server loads (G-612).
RUN npm ci --omit=dev && npm uninstall --no-save --omit=dev prisma \
    && rm -rf node_modules/@napi-rs/canvas node_modules/@napi-rs/canvas-* && npm cache clean --force
# The generated client is part of dist/ (src/generated/prisma, compiled), so nothing else comes from the build stage.
COPY --from=build /app/dist ./dist
# The MERL-T dead-letter log (NDJSON, capped at 50 MB) is written under ./logs
# unless MERLT_DEAD_LETTER_DIR says otherwise; give it a home the user can write.
# A case's act files (LC50), encrypted, live under ./pratica-files (PRATICA_FILES_DIR): a volume the user can write.
RUN mkdir -p /app/logs /app/pratica-files && chown node:node /app/logs /app/pratica-files && chmod 700 /app/pratica-files
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so SIGTERM reaches the graceful shutdown (idle sockets swept, Prisma
# disconnected, a forced exit after 10 s) instead of stopping at a shell.
CMD ["node", "dist/index.js"]
