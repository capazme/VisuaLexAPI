# The ingress module: Caddy serving the built web app and routing to the server and
# the scrapers.
#
# Build from the REPOSITORY ROOT (the web app and the Caddyfile live in different
# folders):
#   docker build -f infra/ingress/Dockerfile -t visualex-ingress .
#
# MERL-T's front-end flags are decided HERE, at build time, and default to on:
#   --build-arg VITE_FEATURE_MERLT=false        hides all of it (and stops the tracking)
#   --build-arg VITE_FEATURE_MERLT_GRAPH=false  hides the graph only
# Leave them out to keep them on. An empty value is NOT "on": the app reads "" as off.

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
# Same origin: the app calls /api and the scraping paths on the origin that served it.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_FEATURE_MERLT
ARG VITE_FEATURE_MERLT_GRAPH
RUN npm run build

FROM caddy:2-alpine
COPY infra/ingress/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /app/dist /srv
# A broken Caddyfile fails the build, not the start.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# A normal user, on a port above 1024. Caddy keeps its small state under /tmp, so
# the root filesystem can be read-only (Compose: read_only + a tmpfs on /tmp).
# The official binary carries the file capability cap_net_bind_service; with every
# capability dropped the kernel then refuses to run it at all ("operation not
# permitted"). We listen on 8080 and need none.
RUN setcap -r /usr/bin/caddy \
    && adduser -D -u 10001 -s /sbin/nologin ingress
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 10001
EXPOSE 8080

# It answers on / whenever the static app is there; Compose's `up --wait` then means
# something.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
