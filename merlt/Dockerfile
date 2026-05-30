# MERL-T - Multi-Expert Reinforcement Learning for Legal Text
# Open Source - Apache 2.0 License

# Build stage with PyTorch (CPU version for smaller image)
FROM python:3.11-slim AS builder

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml README.md ./

# Install PyTorch CPU version first (smaller than GPU)
RUN pip install --upgrade pip setuptools wheel && \
    pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install package dependencies
RUN pip install -e .

# Production stage
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install runtime dependencies
# postgresql-client provides `psql` used by the Slice 2a seed loader to restore
# the bridge_table dump (merlt.scripts.load_seed_libro_iv).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY merlt/ ./merlt/
COPY pyproject.toml README.md ./

# Install the package itself
RUN pip install -e . --no-deps

# Pre-create the uploads dir so a mounted named volume (Slice 2c shared uploads)
# inherits appuser ownership instead of being created root-owned at mount time.
RUN mkdir -p /app/uploads/user_documents

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
# Loop β prereq (0.0): pre-create the HuggingFace cache dir owned by appuser so
# the mounted named volume (merlt_hf_cache, e5-large weights) initializes with
# appuser ownership instead of root — otherwise the warmup/encode hits
# "Permission denied: /home/appuser/.cache/huggingface/hub" at boot.
RUN mkdir -p /home/appuser/.cache/huggingface && \
    chown -R appuser:appuser /home/appuser/.cache
# Loop β E.2/E.3: pre-create the RLCF checkpoint dir owned by appuser so the
# mounted named volume (merlt_checkpoints, policy .pt files) initializes with
# appuser ownership — otherwise saving a trained policy hits "Permission denied".
RUN mkdir -p /app/checkpoints && \
    chown -R appuser:appuser /app/checkpoints
USER appuser

# Expose API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run FastAPI with uvicorn
CMD ["uvicorn", "merlt.app:app", "--host", "0.0.0.0", "--port", "8000"]
