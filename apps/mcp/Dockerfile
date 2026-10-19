# The MCP module: VisuaLex's dossier and card tools for Claude Code and LibreLex
# (Streamable HTTP).
#
# Build with this folder as the context:
#   docker build -t visualex-mcp apps/mcp
#
# No database and no secret in the image: everything comes from the environment
# (infra/compose.app.yml). Spec: docs/superpowers/specs/2026-10-05-mcp-production-design.md

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3002

# The protected resource metadata needs no token: a 200 means the process serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3002)+'/.well-known/oauth-protected-resource').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so SIGTERM reaches the shutdown that closes the sessions first.
CMD ["node", "dist/index.js"]
