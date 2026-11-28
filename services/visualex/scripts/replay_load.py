"""Load generator for `replay_server.py`: N users reading at once, latency percentiles, source requests.

    cd services/visualex
    .venv/bin/python scripts/replay_load.py --scenario warm --users 50 --duration 20 --out run.json

Scenarios (the server must answer from recorded answers, never from a source):

- ``warm``: one pass over the mix first (every cache filled), then ``--users`` users each send
  one request after another, picked from the mix at random, for ``--duration`` seconds.
- ``cold-distinct``: ``--users`` users each read a different article of the c.c. at the same
  moment, on a server just started on an empty cache (needs ``--templates`` on the server).
- ``cold-same``: ``--users`` users read art. 2043 c.c. at the same moment, on a server just
  started on an empty cache: how many requests reach Normattiva for one article.

A read counts as ok when the answer is 200 and, for an article, carries ``article_text`` with no
``error``. Prints and writes p50/p90/p95/p99/max, throughput, errors, and the requests the
collectors sent per host during the measured part (``/__replay/stats``), also per 100 reads.

It is a heavy process on a shared machine: short runs, one at a time, with the load average
checked first.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time

import aiohttp

ART = "/stream_article_text"
CC = {"act_type": "codice civile"}

# The mix of a reading day: mostly articles of the codes, then ordinary acts, EU articles and
# decisions; the tree and the titles the reader opens with an act. Every item is in the
# recording `collector_timing.py --record` makes (its CASES).
MIX: list[tuple[int, str, str, dict]] = [
    (6, "cc_2043", ART, {**CC, "article": "2043"}),
    (4, "cc_2044", ART, {**CC, "article": "2044"}),
    (3, "cpc_183", ART, {"act_type": "codice di procedura civile", "article": "183"}),
    (3, "cp_612bis", ART, {"act_type": "codice penale", "article": "612 bis"}),
    (1, "cc_1284_2010", ART, {**CC, "article": "1284", "version_date": "2010-01-01"}),
    (2, "l241_art1", ART, {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1"}),
    (2, "l241_art3", ART, {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "3"}),
    (1, "dlgs231_art5", ART, {"act_type": "decreto legislativo", "date": "2001", "act_number": "231", "article": "5"}),
    *[(1, f"l24_art{n}", ART, {"act_type": "legge", "date": "2017-03-08", "act_number": "24", "article": str(n)})
      for n in (1, 5, 7, 10, 15)],
    (3, "gdpr_art6", ART, {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "6"}),
    (2, "gdpr_art17", ART, {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "17"}),
    (2, "tree_cc", "/fetch_tree", {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262",
                                   "link": False, "details": True, "return_metadata": True}),
    (2, "rubriche_cc", "/fetch_rubriche", {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"}),
    (2, "cass_12449_2024", "/fetch_decision", {"corte": "cassazione", "archivio": "civile", "numero": 12449, "anno": 2024}),
    (1, "corte_cost_242_2019", "/fetch_decision", {"corte": "corte_costituzionale", "numero": 242, "anno": 2019}),
    (1, "cgue_634_2021", "/fetch_decision", {"corte": "corte_giustizia_ue", "numero": 634, "anno": 2021}),
    (1, "search_2043", "/search_decisions", {"norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"},
                                             "archivio": "civile"}),
]

# c.c. articles for the cold-distinct scenario: numbers the c.c. holds, none of them recorded.
CC_ARTICLES = [str(n) for n in range(1100, 2900) if n not in (2043, 2044, 1284)]


def _ok(path: str, status: int, body: bytes) -> tuple[bool, str | None]:
    if status != 200:
        return False, f"http {status}"
    if path == ART:
        lines = [json.loads(line) for line in body.decode("utf-8").splitlines() if line.strip()]
        errors = [line["error"] for line in lines if line.get("error")]
        if errors:
            return False, errors[0][:80]
        if not any("article_text" in line for line in lines):
            return False, "no article_text"
    return True, None


async def one(session, base: str, name: str, path: str, body: dict, samples: list) -> None:
    start = time.perf_counter()
    try:
        async with session.post(base + path, json=body) as response:
            data = await response.read()
            ok, error = _ok(path, response.status, data)
    except Exception as exc:  # noqa: BLE001
        ok, error = False, type(exc).__name__
    samples.append({"name": name, "s": time.perf_counter() - start, "ok": ok, "error": error})


def _pct(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    values = sorted(values)
    k = max(0, min(len(values) - 1, int(round(q * (len(values) - 1)))))
    return values[k]


def summarise(samples: list, wall: float, stats: dict) -> dict:
    ok = [s["s"] for s in samples if s["ok"]]
    every = [s["s"] for s in samples]
    errors: dict[str, int] = {}
    for s in samples:
        if not s["ok"]:
            errors[s["error"]] = errors.get(s["error"], 0) + 1
    sent = stats.get("sent", {})
    total_sent = sum(sent.values())
    return {
        "reads": len(samples), "ok": len(ok), "errors": errors,
        "p50": _pct(every, 0.50), "p90": _pct(every, 0.90), "p95": _pct(every, 0.95),
        "p99": _pct(every, 0.99), "max": max(every) if every else float("nan"),
        "mean": statistics.fmean(every) if every else float("nan"),
        "wall_s": wall, "reads_per_s": len(samples) / wall if wall else float("nan"),
        "source_requests": sent, "source_missing": stats.get("missing", {}),
        "source_requests_per_100_reads": round(100 * total_sent / len(samples), 1) if samples else None,
    }


async def run(args) -> dict:
    connector = aiohttp.TCPConnector(limit=0, force_close=False)
    timeout = aiohttp.ClientTimeout(total=args.timeout)
    rng = random.Random(args.seed)
    weighted = [item for item in MIX for _ in range(item[0])]
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        if args.scenario == "warm":
            warm: list = []
            for _, name, path, body in MIX:
                await one(session, args.base, name, path, body, warm)
            failed = [s for s in warm if not s["ok"]]
            if failed:
                print("warm-up failures:", failed, file=sys.stderr)
            async with session.get(args.base + "/__replay/stats") as response:
                await response.read()  # reset the counters
            samples: list = []
            deadline = time.perf_counter() + args.duration

            async def user(i: int) -> None:
                local = random.Random(args.seed * 1000 + i)
                while time.perf_counter() < deadline:
                    _, name, path, body = local.choice(weighted)
                    await one(session, args.base, name, path, body, samples)

            start = time.perf_counter()
            await asyncio.gather(*(user(i) for i in range(args.users)))
            wall = time.perf_counter() - start
        else:
            samples = []
            if args.scenario == "cold-distinct":
                numbers = rng.sample(CC_ARTICLES, args.users)
                jobs = [(f"cc_{n}", ART, {**CC, "article": n}) for n in numbers]
            else:
                jobs = [("cc_2043", ART, {**CC, "article": "2043"})] * args.users
            start = time.perf_counter()
            await asyncio.gather(*(one(session, args.base, name, path, body, samples) for name, path, body in jobs))
            wall = time.perf_counter() - start
        async with session.get(args.base + "/__replay/stats") as response:
            stats = await response.json()
    result = summarise(samples, wall, stats)
    result.update({"scenario": args.scenario, "users": args.users, "duration": args.duration,
                   "label": args.label})
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="http://127.0.0.1:5099")
    parser.add_argument("--scenario", choices=["warm", "cold-distinct", "cold-same"], default="warm")
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--duration", type=float, default=20.0, help="warm: seconds of load")
    parser.add_argument("--timeout", type=float, default=300.0, help="per request")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--label", default="")
    parser.add_argument("--out", help="append the result as one JSON line")
    args = parser.parse_args()
    result = asyncio.run(run(args))
    line = (f"{args.label:10} {args.scenario:13} users={args.users:4} reads={result['reads']:6} ok={result['ok']:6} "
            f"p50={result['p50']:.3f} p95={result['p95']:.3f} p99={result['p99']:.3f} max={result['max']:.3f} "
            f"rps={result['reads_per_s']:.1f} src/100={result['source_requests_per_100_reads']} "
            f"errors={result['errors']}")
    print(line, flush=True)
    if args.out:
        with open(args.out, "a") as handle:
            handle.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
