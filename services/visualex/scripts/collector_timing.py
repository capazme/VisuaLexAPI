"""Timing harness for the data collectors: where a request's time goes.

Runs a fixed list of real requests against the root app (``app.py``) in this process,
through Quart's test client, first with an empty cache (cold) and then again in the same
process (warm), and prints one row per request: the wall time and its parts — network
wait per host, our own throttle and retry waits, HTML parsing, text extraction,
Playwright, cache reads and writes. Parts can overlap (requests running in parallel), so
they need not add up to the wall time.

Every article and decision text the requests return is written to ``<out>/texts``; with
``--compare <dir>`` the texts are compared byte for byte with an earlier run's, which is
how a change to a collector proves it left ``article_text`` and the decision texts
untouched (root CLAUDE.md, rule 23).

It talks to the real sources. Run it a few times, never in a loop, and never against a
deployment host: it is a measurement, not a load test.

    cd services/visualex
    .venv/bin/python scripts/collector_timing.py --out /tmp/timing-before
    .venv/bin/python scripts/collector_timing.py --out /tmp/timing-after --compare /tmp/timing-before

``--corte-cost-bundle <zip>`` seeds the Corte costituzionale's 2001-today bundle (56 MB)
into the empty cache, so a cold run does not download it again; the download is a cost of
its own, measured once with the flag left out.
"""
from __future__ import annotations

import argparse
import asyncio
import functools
import hashlib
import json
import logging
import os
import shutil
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent

# Requests: (name, method, path, body). One of each common path; the Cassazione's PDF
# comes after its lookup, as the decision's tab asks for it.
CASES: list[tuple[str, str, str, dict]] = [
    ("cc_2043", "POST", "/stream_article_text", {"act_type": "codice civile", "article": "2043"}),
    ("cc_2043_2044", "POST", "/stream_article_text", {"act_type": "codice civile", "article": "2043,2044"}),
    ("cpc_183", "POST", "/stream_article_text", {"act_type": "codice di procedura civile", "article": "183"}),
    ("cp_612bis", "POST", "/stream_article_text", {"act_type": "codice penale", "article": "612 bis"}),
    ("l241_1990_art1_3", "POST", "/stream_article_text",
     {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1-3"}),
    ("dlgs231_year_only", "POST", "/stream_article_text",
     {"act_type": "decreto legislativo", "date": "2001", "act_number": "231", "article": "5"}),
    ("cc_1284_historical", "POST", "/stream_article_text",
     {"act_type": "codice civile", "article": "1284", "version_date": "2010-01-01"}),
    # /fetch_tree as the web asks for it (actStructureCache.ts): with the section labels
    ("tree_l241_1990", "POST", "/fetch_tree",
     {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241",
      "link": False, "details": True, "return_metadata": True}),
    ("rubriche_l241_1990", "POST", "/fetch_rubriche",
     {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"}),
    ("tree_cc", "POST", "/fetch_tree",
     {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262",
      "link": False, "details": True, "return_metadata": True}),
    ("rubriche_cc", "POST", "/fetch_rubriche",
     {"urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"}),
    ("gdpr_art6", "POST", "/stream_article_text",
     {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "6"}),
    ("gdpr_art17", "POST", "/stream_article_text",
     {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "17"}),
    ("rubriche_gdpr", "POST", "/fetch_rubriche", {"urn": "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"}),
    ("cass_civ_12449_2024", "POST", "/fetch_decision",
     {"corte": "cassazione", "archivio": "civile", "numero": 12449, "anno": 2024}),
    ("cass_pdf_12449_2024", "POST", "/fetch_decision_pdf",
     {"corte": "cassazione", "archivio": "civile", "numero": 12449, "anno": 2024}),
    ("corte_cost_242_2019", "POST", "/fetch_decision",
     {"corte": "corte_costituzionale", "numero": 242, "anno": 2019}),
    ("cgue_634_2021", "POST", "/fetch_decision",
     {"corte": "corte_giustizia_ue", "numero": 634, "anno": 2021}),
    ("search_2043_cc", "POST", "/search_decisions",
     {"norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"}, "archivio": "civile"}),
]


class Meter:
    """Seconds and counts per part, summed over every call made during one request."""

    def __init__(self) -> None:
        self.seconds: dict[str, float] = defaultdict(float)
        self.count: dict[str, int] = defaultdict(int)

    def add(self, key: str, seconds: float) -> None:
        self.seconds[key] += seconds
        self.count[key] += 1

    def snapshot(self) -> dict:
        return {k: {"s": round(v, 3), "n": self.count[k]} for k, v in sorted(self.seconds.items())}

    def reset(self) -> None:
        self.seconds.clear()
        self.count.clear()


METER = Meter()


def _wrap_async(owner, name: str, key) -> None:
    original = getattr(owner, name)

    @functools.wraps(original)
    async def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return await original(*args, **kwargs)
        finally:
            METER.add(key(args, kwargs) if callable(key) else key, time.perf_counter() - start)

    setattr(owner, name, wrapper)


def _wrap_sync(owner, name: str, key: str) -> None:
    original = getattr(owner, name)

    @functools.wraps(original)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return original(*args, **kwargs)
        finally:
            METER.add(key, time.perf_counter() - start)

    setattr(owner, name, wrapper)


def instrument() -> None:
    """Timers around the parts of a request. Imports happen here, after the cache folder
    was pointed at the run's own."""
    import aiohttp
    import bs4
    from yarl import URL

    import app as root_app
    from visualex_api.services import akn_fetch, eurlex_fetch, eurlex_scraper, normattiva_scraper, pdfextractor
    from visualex_api.services import http_client as http_module
    from visualex_api.services.decisions import curia, italgiure
    from visualex_api.tools import cache as cache_module
    from visualex_api.tools import treextractor

    def host_of(args, kwargs) -> str:
        # ClientSession._request(self, method, str_or_url, ...)
        target = args[2] if len(args) > 2 else kwargs.get("str_or_url")
        try:
            return f"net:{URL(str(target)).host}"
        except Exception:  # noqa: BLE001
            return "net:?"

    # Headers (connect, TLS, send, server's wait) and the body's download, per host.
    _wrap_async(aiohttp.ClientSession, "_request", host_of)
    _wrap_async(aiohttp.ClientResponse, "read", lambda a, k: f"net_body:{a[0].url.host}")

    # Our own waits on the shared client (and the decision readers' twin).
    _wrap_async(http_module.ThrottledHttpClient, "_respect_min_interval", "wait:throttle")
    original_delay = http_module.ThrottledHttpClient._retry_delay

    def retry_delay(self, attempt, headers=None):
        delay = original_delay(self, attempt, headers)
        METER.add("wait:retry", delay)
        return delay

    http_module.ThrottledHttpClient._retry_delay = retry_delay

    _wrap_sync(bs4.BeautifulSoup, "__init__", "parse:bs4")
    _wrap_async(normattiva_scraper.NormattivaScraper, "estrai_da_html", "extract:normattiva")
    _wrap_async(eurlex_scraper.EurlexScraper, "extract_article_text", "extract:eurlex")
    # An EU act's page, the scraper's and the tree's alike: CELLAR first (its network time is
    # under net:publications.europa.eu), the browser on EUR-Lex second.
    _wrap_async(eurlex_fetch, "fetch_from_cellar", "cellar:eurlex")
    _wrap_async(eurlex_fetch, "fetch_with_playwright", "playwright:eurlex")
    _wrap_async(treextractor, "_parse_normattiva_tree", "extract:tree")
    _wrap_async(akn_fetch, "_fetch_and_parse", "akn:fetch+parse")
    _wrap_sync(akn_fetch, "parse_akn", "akn:parse")
    _wrap_async(pdfextractor, "extract_pdf", "playwright:pdf")
    _wrap_async(root_app, "extract_pdf", "playwright:pdf")
    _wrap_async(root_app, "complete_request_date", "date_completion")
    _wrap_async(root_app, "read_validity", "validity")
    _wrap_async(italgiure, "read_decision_pdf_async", "parse:cass_pdf")
    _wrap_sync(curia, "text_from_xhtml", "parse:curia")
    _wrap_async(cache_module.PersistentCache, "get", lambda a, k: f"cache_get:{a[0].namespace}")
    _wrap_async(cache_module.PersistentCache, "set", lambda a, k: f"cache_set:{a[0].namespace}")


def _texts_of(name: str, path: str, status: int, body: bytes) -> dict[str, str]:
    """The texts a request returned, by a stable name: what rule 23 freezes."""
    texts: dict[str, str] = {}
    if path == "/stream_article_text":
        for i, line in enumerate(body.decode("utf-8").splitlines()):
            if not line.strip():
                continue
            item = json.loads(line)
            if "article_text" in item:
                number = item.get("norma_data", {}).get("numero_articolo") or str(i)
                texts[f"{name}__art{number}"] = item["article_text"]
    elif path == "/fetch_decision" and status == 200:
        decision = json.loads(body)
        if decision.get("testo"):
            texts[f"{name}__testo"] = json.dumps(decision["testo"], ensure_ascii=False, sort_keys=True)
    elif path == "/fetch_decision_pdf" and status == 200:
        texts[f"{name}__sha256"] = hashlib.sha256(body).hexdigest()
    return texts


async def run_pass(client, label: str, out: Path) -> list[dict]:
    rows = []
    for name, method, path, payload in CASES:
        METER.reset()
        start = time.perf_counter()
        response = await client.open(path, method=method, json=payload)
        body = await response.get_data()
        wall = time.perf_counter() - start
        texts = _texts_of(name, path, response.status_code, body)
        text_dir = out / "texts" / label
        text_dir.mkdir(parents=True, exist_ok=True)
        for key, text in texts.items():
            (text_dir / f"{key}.txt").write_text(text, encoding="utf-8")
        error = None
        if response.status_code >= 400:
            error = body[:200].decode("utf-8", "replace")
        elif path == "/stream_article_text":
            errors = [json.loads(line).get("error") for line in body.decode().splitlines() if line.strip()]
            error = "; ".join(e for e in errors if e) or None
        rows.append({
            "pass": label, "case": name, "status": response.status_code,
            "wall_s": round(wall, 3), "bytes": len(body), "texts": len(texts),
            "error": error, "parts": METER.snapshot(),
        })
        print(f"{label:5} {name:22} {response.status_code} {wall:7.3f}s "
              f"{'' if not error else 'ERROR ' + error[:80]}", flush=True)
    return rows


def _table(rows: list[dict]) -> str:
    groups = [
        ("net", lambda k: k.startswith("net:") or k.startswith("net_body:")),
        ("throttle", lambda k: k == "wait:throttle"),
        ("retry", lambda k: k == "wait:retry"),
        ("bs4", lambda k: k == "parse:bs4"),
        ("extract", lambda k: k.startswith("extract:")),
        ("playwright", lambda k: k.startswith("playwright:")),
        ("akn", lambda k: k == "akn:parse"),
        ("cache", lambda k: k.startswith("cache_")),
    ]
    head = "| pass | case | status | wall s | requests | " + " | ".join(g for g, _ in groups) + " |"
    lines = [head, "|" + "---|" * (5 + len(groups))]
    for row in rows:
        cells = []
        for _, match in groups:
            total = sum(v["s"] for k, v in row["parts"].items() if match(k))
            cells.append(f"{total:.2f}" if total else "")
        # requests sent to the sources (Playwright visits counted apart, in their column)
        sent = sum(v["n"] for k, v in row["parts"].items() if k.startswith("net:"))
        visits = sum(v["n"] for k, v in row["parts"].items() if k.startswith("playwright:"))
        count = f"{sent}" + (f" + {visits} pw" if visits else "")
        lines.append(f"| {row['pass']} | {row['case']} | {row['status']} | {row['wall_s']:.2f} | {count} | "
                     + " | ".join(cells) + " |")
    return "\n".join(lines)


def compare(out: Path, other: Path) -> int:
    """Byte comparison of every text of this run with the same text of `other`."""
    differences = 0
    compared = 0
    for mine in sorted((out / "texts").rglob("*.txt")):
        rel = mine.relative_to(out / "texts")
        theirs = other / "texts" / rel
        if not theirs.exists():
            print(f"MISSING in {other}: {rel}")
            differences += 1
            continue
        compared += 1
        if mine.read_bytes() != theirs.read_bytes():
            print(f"DIFFERENT: {rel}")
            differences += 1
    for theirs in sorted((other / "texts").rglob("*.txt")):
        if not (out / "texts" / theirs.relative_to(other / "texts")).exists():
            print(f"MISSING in this run: {theirs.relative_to(other / 'texts')}")
            differences += 1
    print(f"compared {compared} texts, {differences} differences")
    return differences


async def main_async(args) -> int:
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache_dir).resolve() if args.cache_dir else Path(tempfile.mkdtemp(prefix="vlx-cache-"))
    cache_dir.mkdir(parents=True, exist_ok=True)
    if args.corte_cost_bundle:
        target = cache_dir / "corte_cost" / Path(args.corte_cost_bundle).name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copyfile(args.corte_cost_bundle, target)  # a fresh mtime: not refreshed

    # Point every cache at the run's own folder before anything creates one, and keep the
    # exported PDFs (written under the working directory) out of the source tree.
    sys.path.insert(0, str(SERVICE))
    from visualex_api.tools import config
    config.PERSISTENT_CACHE_DIR = cache_dir
    workdir = out / "workdir"
    workdir.mkdir(exist_ok=True)
    # /stream_article_text adds every request to the search history: the run's own files,
    # never the service's (history_manager and dossier_manager read these names at import).
    config.HISTORY_FILE = workdir / "history.json"
    config.DOSSIER_FILE = workdir / "dossiers.json"
    os.chdir(workdir)

    import structlog
    structlog.configure(wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING))
    logging.getLogger().setLevel(logging.WARNING)

    from app import NormaController
    instrument()
    logging.getLogger().setLevel(logging.WARNING)

    controller = NormaController()
    rows: list[dict] = []
    async with controller.app.test_app() as test_app:
        client = test_app.test_client()
        for label in args.passes.split(","):
            rows += await run_pass(client, label, out)
    from visualex_api.services.decisions.http import decisions_http_client
    from visualex_api.services.http_client import http_client
    await http_client.close()
    await decisions_http_client.close()

    (out / "timing.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    table = _table(rows)
    (out / "timing.md").write_text(table + "\n")
    print()
    print(table)
    print(f"\ncache: {cache_dir}\nresults: {out}")
    if args.compare:
        return 1 if compare(out, Path(args.compare).resolve()) else 0
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, help="folder for timing.json, timing.md and texts/")
    parser.add_argument("--cache-dir", help="the cache folder; default a new empty one (cold)")
    parser.add_argument("--passes", default="cold,warm",
                        help="labels of the passes run in this process, in order")
    parser.add_argument("--corte-cost-bundle", help="a copy of P_json2001_oggi.zip to seed")
    parser.add_argument("--compare", help="an earlier run's --out: compare the texts byte for byte")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
