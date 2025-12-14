import os
from pathlib import Path

BASE_PATH = Path(__file__).resolve().parents[2]

MAX_CACHE_SIZE = 10000
HISTORY_LIMIT = 50
HISTORY_FILE = BASE_PATH / "data" / "history.json"
RATE_LIMIT = 1000  # Limit to 100 requests per minute
RATE_LIMIT_WINDOW = 600  # Window size in seconds

PERSISTENT_CACHE_DIR = BASE_PATH / "download" / "cache"
PERSISTENT_CACHE_TTL = int(os.getenv("PERSISTENT_CACHE_TTL", 86400))

HTTP_MAX_CONCURRENCY = int(os.getenv("HTTP_MAX_CONCURRENCY", 3))
HTTP_MIN_INTERVAL = float(os.getenv("HTTP_MIN_INTERVAL", 0.5))
HTTP_MAX_RETRIES = int(os.getenv("HTTP_MAX_RETRIES", 4))
HTTP_BACKOFF_FACTOR = float(os.getenv("HTTP_BACKOFF_FACTOR", 2.0))
HTTP_INITIAL_BACKOFF = float(os.getenv("HTTP_INITIAL_BACKOFF", 0.5))
HTTP_JITTER = float(os.getenv("HTTP_JITTER", 0.3))
HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", 30))

FETCH_QUEUE_WORKERS = int(os.getenv("FETCH_QUEUE_WORKERS", 2))
FETCH_QUEUE_DELAY = float(os.getenv("FETCH_QUEUE_DELAY", 0.3))
