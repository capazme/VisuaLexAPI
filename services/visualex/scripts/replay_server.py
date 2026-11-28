"""The API as production runs it (Hypercorn, one worker), on recorded answers: no source is reached.

    cd services/visualex
    .venv/bin/python scripts/replay_server.py --record <folder> --cache-dir <empty folder> --port 5099

`--record` is a folder `collector_timing.py --record` filled. Every request the collectors send
is answered from it after its recorded latency (`replay_net`); our throttle, retries, caches and
parsing run as in production. The per-IP rate limit is lifted (one load generator is one IP).
`GET /__replay/stats` answers the requests the collectors sent since the last call, per host:
what would have reached each source. Never run against a deployment host's cache.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--record", required=True)
    parser.add_argument("--cache-dir", required=True, help="the persistent cache folder (empty: cold)")
    parser.add_argument("--workdir", help="working directory (download/, logs); default <cache-dir>/../workdir")
    parser.add_argument("--port", type=int, default=5099)
    parser.add_argument("--latency", default="recorded", help="'recorded' or a fixed number of seconds")
    parser.add_argument("--templates", action="store_true", help="answer unrecorded c.c. articles with art. 2043's page")
    parser.add_argument("--log-level", default="INFO", help="the app's log level (production: INFO)")
    args = parser.parse_args()

    # Read by config at import time.
    os.environ["RATE_LIMIT"] = "100000000"
    os.environ.setdefault("VISUALEX_LOG_FILE", "")
    cache_dir = Path(args.cache_dir).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    workdir = Path(args.workdir).resolve() if args.workdir else cache_dir.parent / "workdir"
    workdir.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(SERVICE))
    sys.path.insert(0, str(HERE))
    from visualex_api.tools import config
    config.PERSISTENT_CACHE_DIR = cache_dir
    os.chdir(workdir)

    from replay_net import STATS, install_replayer
    install_replayer(Path(args.record).resolve(), latency=args.latency, templates=args.templates)

    import structlog
    level = getattr(logging, args.log_level.upper())
    structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(level))
    logging.getLogger().setLevel(level)

    from quart import jsonify
    from asgi import app

    async def replay_stats():
        snapshot = STATS.snapshot()
        STATS.reset()
        return jsonify(snapshot)

    app.add_url_rule("/__replay/stats", view_func=replay_stats, methods=["GET"])

    from hypercorn.asyncio import serve
    from hypercorn.config import Config
    hconfig = Config()
    hconfig.bind = [f"127.0.0.1:{args.port}"]
    hconfig.workers = 1
    hconfig.accesslog = None
    hconfig.backlog = 2048
    print(f"replay server on 127.0.0.1:{args.port}, cache {cache_dir}", flush=True)
    asyncio.run(serve(app, hconfig))
    return 0


if __name__ == "__main__":
    sys.exit(main())
