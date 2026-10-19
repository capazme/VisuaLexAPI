# The scraper module: the Python API and the Chromium it drives.
#
# Build from the REPOSITORY ROOT — version.txt is read from it:
#   docker build -f services/visualex/Dockerfile -t visualex-scrapers .
#
# Sizing, measured on this image: idle about 280 MiB; four PDF exports at once
# peaked at about 1.06 GiB and 195 processes. Docker's default 64 MB /dev/shm is
# enough — Playwright's Chromium avoids it — so no --shm-size is needed.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    VISUALEX_LOG_FILE=

# The image mirrors the repository layout: /version reads version.txt two levels
# above this folder, and config.py puts data/ and download/ relative to it.
WORKDIR /repo/services/visualex

# Debian, not Alpine: Playwright does not support musl.
COPY services/visualex/requirements.txt ./
RUN pip install -r requirements.txt \
    && playwright install --with-deps chromium

COPY version.txt /repo/version.txt
COPY services/visualex/ ./

# data/ (search history, dossiers) and download/ (the cache) are volumes in
# production: without them both die with every rebuild.
RUN useradd --create-home --uid 10001 app \
    && mkdir -p data download \
    && chown -R app:app /repo /ms-playwright

USER app
EXPOSE 5000

# /health, never /health/detailed: that one probes the real sources.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=3)"

# ONE worker. The rate limiter, the circuit breaker and the fetch queue keep
# their state in memory, per process; more workers would each have their own.
CMD ["hypercorn", "asgi:app", "--bind", "0.0.0.0:5000", "--workers", "1"]
