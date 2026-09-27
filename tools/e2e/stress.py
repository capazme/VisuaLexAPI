"""Closed-loop stress harness for the BFF/MERL-T local stack (blueprint §4).

Standalone CLI:
    python -m e2e.stress --users 10 --duration 60 [--include-search-cached]

Golden rule: external scrapers (Normattiva/EUR-Lex/Brocardi) are NEVER
stressed. The only Python-API traffic is the one-shot sequential cache
warm-up behind --include-search-cached and its low-rate (<=0.5 rps global)
re-hits on the already-warmed bodies. Everything else is local: BFF Prisma
writes, MERL-T tracking proxy, FalkorDB graph reads.

Outcome classes per request: ok / rate_limited (429) / contract_error
(other 4xx — harness bug, not load) / error (>=500, timeout, connection).
Exit code is non-zero when any threshold is breached (err% >= 1, or a p95
budget blown: tracking 500ms, graph 1500ms, CRUD 800ms).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import quote

from e2e.client import ApiClient
from e2e.config import CONFIG, Config
from e2e.data.fixtures import (
    EVENT_PAYLOADS,
    SEARCH_BODIES,
    SEEDED_GRAPH_URNS,
    STRESS_SEARCH_TERMS,
)
from e2e.report import Report, StepFailure

MAX_USERS = 50
MAX_DURATION = 600.0
RAMP_INTERVAL = 0.5          # seconds between VU starts
THINK_MIN, THINK_MAX = 0.5, 2.0
CACHED_SEARCH_INTERVAL = 2.0  # >=2s between cached searches -> <=0.5 rps global

# p95 budgets (ms) per threshold group; err% budget is global.
P95_BUDGETS = {"tracking": 500.0, "graph": 1500.0, "crud": 800.0}
ERR_PCT_BUDGET = 1.0

# action class -> threshold group (classes not listed only count toward err%)
CLASS_GROUP = {
    "tracking_article": "tracking",
    "tracking_other": "tracking",
    "graph_read": "graph",
    "graph_search": "graph",
    "dossier_crud": "crud",
    "annotation": "crud",
    "quicknorm_use": "crud",
}

OTHER_EVENTS = ["highlight-annotation", "dossier-bookmark", "citation-clicked", "forum-signal"]


# ---- metrics ----

@dataclass
class ClassStats:
    count: int = 0
    ok: int = 0
    rate_limited: int = 0
    contract_error: int = 0
    error: int = 0
    contract_violations: int = 0  # semantic asserts (e.g. counter not monotonic)
    latencies: list[float] = field(default_factory=list)  # ok-only, ms

    def percentile(self, p: int) -> float | None:
        if len(self.latencies) < 2:
            return self.latencies[0] if self.latencies else None
        cuts = statistics.quantiles(self.latencies, n=100)
        return cuts[p - 1]


class Metrics:
    def __init__(self) -> None:
        self.by_class: dict[str, ClassStats] = {}
        self.started = time.monotonic()

    def _stats(self, action_class: str) -> ClassStats:
        if action_class not in self.by_class:
            self.by_class[action_class] = ClassStats()
        return self.by_class[action_class]

    def add(self, action_class: str, status: int | None, latency_ms: float) -> None:
        s = self._stats(action_class)
        s.count += 1
        if not status:  # 0/None = timeout or connection error
            s.error += 1
        elif status >= 500:
            s.error += 1
        elif status == 429:
            s.rate_limited += 1
        elif status >= 400:
            s.contract_error += 1
        else:
            s.ok += 1
            s.latencies.append(latency_ms)

    def violation(self, action_class: str) -> None:
        self._stats(action_class).contract_violations += 1

    def totals(self) -> ClassStats:
        t = ClassStats()
        for s in self.by_class.values():
            t.count += s.count
            t.ok += s.ok
            t.rate_limited += s.rate_limited
            t.contract_error += s.contract_error
            t.error += s.error
            t.contract_violations += s.contract_violations
            t.latencies.extend(s.latencies)
        return t

    def group_latencies(self, group: str) -> list[float]:
        out: list[float] = []
        for cls, s in self.by_class.items():
            if CLASS_GROUP.get(cls) == group:
                out.extend(s.latencies)
        return out


# ---- virtual user ----

@dataclass
class VU:
    index: int
    client: ApiClient
    rng: random.Random
    quicknorm_id: str = ""
    qn_expected: int = 0
    event_rr: int = 0
    seq: int = 0


class StressRun:
    def __init__(self, cfg: Config, metrics: Metrics):
        self.cfg = cfg
        self.metrics = metrics
        self.run_id = cfg.run_id
        self.bff = cfg.bff

    async def timed(self, action_class: str, client: ApiClient, method: str,
                    url: str, *, json_body=None, timeout: float | None = None,
                    ) -> tuple[int, object]:
        t0 = time.monotonic()
        status, body = await client.req(method, url, json=json_body,
                                        expect=None, timeout=timeout)
        self.metrics.add(action_class, status, (time.monotonic() - t0) * 1000)
        return status, body

    # ---- actions (weights per blueprint §4) ----

    async def act_tracking_article(self, vu: VU) -> None:
        urn = vu.rng.choice(SEEDED_GRAPH_URNS)
        payload = EVENT_PAYLOADS["article-viewed"](urn, self.run_id)
        await self.timed("tracking_article", vu.client, "POST",
                         f"{self.bff}/merlt/events/article-viewed", json_body=payload)

    async def act_tracking_other(self, vu: VU) -> None:
        name = OTHER_EVENTS[vu.event_rr % len(OTHER_EVENTS)]
        vu.event_rr += 1
        urn = vu.rng.choice(SEEDED_GRAPH_URNS)
        payload = EVENT_PAYLOADS[name](urn, self.run_id)
        await self.timed("tracking_other", vu.client, "POST",
                         f"{self.bff}/merlt/events/{name}", json_body=payload)

    async def act_graph_read(self, vu: VU) -> None:
        # Seeded URNs only: they exist in the graph, so no lazy ingestion fires.
        urn = quote(vu.rng.choice(SEEDED_GRAPH_URNS), safe="")
        await self.timed("graph_read", vu.client, "GET",
                         f"{self.bff}/merlt/graph/article/{urn}?depth=1&limit=25")

    async def act_graph_search(self, vu: VU) -> None:
        term = quote(vu.rng.choice(STRESS_SEARCH_TERMS), safe="")
        await self.timed("graph_search", vu.client, "GET",
                         f"{self.bff}/merlt/graph/search?q={term}&limit=5")

    async def act_dossier_cycle(self, vu: VU) -> None:
        vu.seq += 1
        status, body = await self.timed(
            "dossier_crud", vu.client, "POST", f"{self.bff}/dossiers",
            json_body={"name": f"Stress {self.run_id} vu{vu.index} n{vu.seq}",
                       "tags": ["stress"]})
        if not (status in (200, 201) and isinstance(body, dict) and body.get("id")):
            return
        dossier_id = body["id"]
        await self.timed(
            "dossier_crud", vu.client, "POST",
            f"{self.bff}/dossiers/{dossier_id}/items",
            json_body={"itemType": "norm", "title": "Art. 2043 c.c.",
                       "content": {"act_type": "codice civile", "article": "2043"},
                       "status": "unread"})
        await self.timed("dossier_crud", vu.client, "DELETE",
                         f"{self.bff}/dossiers/{dossier_id}")

    async def act_consent_profile(self, vu: VU) -> None:
        await self.timed("consent_profile", vu.client, "GET", f"{self.bff}/merlt/consent")
        await self.timed("consent_profile", vu.client, "GET", f"{self.bff}/merlt/profile")

    async def act_annotation_cycle(self, vu: VU) -> None:
        status, body = await self.timed(
            "annotation", vu.client, "POST", f"{self.bff}/annotations",
            json_body={"normaKey": f"stress-{self.run_id}-vu{vu.index}",
                       "content": "nota stress", "annotationType": "note"})
        if status == 201 and isinstance(body, dict) and body.get("id"):
            await self.timed("annotation", vu.client, "DELETE",
                             f"{self.bff}/annotations/{body['id']}")

    async def act_forum_browse(self, vu: VU) -> None:
        await self.timed("forum_browse", vu.client, "GET",
                         f"{self.bff}/shared-environments?page=1")

    async def act_quicknorm_hammer(self, vu: VU) -> None:
        # Atomic-counter race probe: 5 concurrent /use, then assert the
        # server counter advanced by exactly the number of successful bumps.
        if not vu.quicknorm_id:
            return
        results = await asyncio.gather(*[
            self.timed("quicknorm_use", vu.client, "POST",
                       f"{self.bff}/quick-norms/{vu.quicknorm_id}/use")
            for _ in range(5)
        ])
        vu.qn_expected += sum(1 for st, _ in results if st and 200 <= st < 300)
        status, body = await self.timed("quicknorm_use", vu.client, "GET",
                                        f"{self.bff}/quick-norms")
        if status == 200 and isinstance(body, list):
            row = next((r for r in body if r.get("id") == vu.quicknorm_id), None)
            if row is None or row.get("usageCount") != vu.qn_expected:
                self.metrics.violation("quicknorm_use")
                got = row.get("usageCount") if row else "missing"
                print(f"  [vu{vu.index}] counter NOT monotonic: "
                      f"expected {vu.qn_expected}, got {got}")

    def action_table(self) -> list[tuple[float, object]]:
        return [
            (25, self.act_tracking_article),
            (15, self.act_tracking_other),
            (15, self.act_graph_read),
            (10, self.act_graph_search),
            (10, self.act_dossier_cycle),
            (10, self.act_consent_profile),
            (8, self.act_annotation_cycle),
            (5, self.act_forum_browse),
            (2, self.act_quicknorm_hammer),
        ]

    # ---- loops ----

    async def vu_loop(self, vu: VU, deadline: float) -> None:
        await asyncio.sleep(vu.index * RAMP_INTERVAL)  # ramp-up: 1 VU / 0.5s
        table = self.action_table()
        total_weight = sum(w for w, _ in table)
        while time.monotonic() < deadline:
            await asyncio.sleep(vu.rng.uniform(THINK_MIN, THINK_MAX))
            if time.monotonic() >= deadline:
                break
            r = vu.rng.uniform(0, total_weight)
            acc = 0.0
            for weight, action in table:
                acc += weight
                if r <= acc:
                    await action(vu)
                    break

    async def cached_search_loop(self, vus: list[VU], deadline: float) -> None:
        """<=0.5 rps global re-hits on the 5 warmed article bodies. The
        Python API serves these from its cache — no external scraper load."""
        rng = random.Random(f"{self.run_id}-cached-search")
        while time.monotonic() < deadline:
            await asyncio.sleep(CACHED_SEARCH_INTERVAL + rng.uniform(0.0, 0.5))
            if time.monotonic() >= deadline:
                break
            vu = rng.choice(vus)
            await self.timed("search_cached", vu.client, "POST",
                             f"{self.cfg.py_api}/fetch_article_text",
                             json_body=rng.choice(SEARCH_BODIES),
                             timeout=self.cfg.search_timeout)


# ---- setup ----

async def setup_users(cfg: Config, report: Report, n: int) -> tuple[ApiClient, list[VU]]:
    """Admin login, create/reuse stress-{i}-{run} users, login each,
    set consent (basic for all, full for the first ceil(10%)), create the
    per-VU quick-norm fixture. All in strict mode: setup failures abort."""
    admin = ApiClient(cfg, report, identity="admin")
    await admin.start()
    n_full = math.ceil(n * 0.10)
    vus: list[VU] = []
    try:
        await admin.login(cfg.admin_email, cfg.require_admin_password())
        for i in range(n):
            email = f"stress-{i}-{cfg.run_id}@test.local"
            username = f"stress-{i}-{cfg.run_id}"
            await admin.admin_create_user(email, username, cfg.user_password)
            client = ApiClient(cfg, report, identity=username)
            await client.start()
            vus.append(VU(index=i, client=client,
                          rng=random.Random(f"{cfg.run_id}-vu{i}")))
            await client.login(email, cfg.user_password)
            await client.set_consent("basic", reason="stress setup")
            if i < n_full:
                await client.set_consent("full", reason="stress setup (contrib VU)")
            _, qn = await client.req(
                "POST", f"{cfg.bff}/quick-norms",
                json={"label": f"Stress {cfg.run_id} vu{i}",
                      "searchParams": {"act_type": "codice civile", "article": "2043"}},
                expect=201)
            vus[-1].quicknorm_id = qn["id"]
    except BaseException:
        for vu in vus:
            await vu.client.close()
        await admin.close()
        raise
    print(f"setup: {n} VU pronti ({n_full} con consenso full), admin ok")
    return admin, vus


async def warm_cache(cfg: Config, admin: ApiClient) -> bool:
    """ONE sequential fetch per fixture body — fills the Python-API cache so
    the cached-search loop never re-hits the external scrapers."""
    print("warm-up cache Python API (5 fetch sequenziali, UNICI hit scraper)...")
    for body in SEARCH_BODIES:
        try:
            status, _ = await admin.req(
                "POST", f"{cfg.py_api}/fetch_article_text", json=body,
                expect=None, timeout=cfg.search_timeout)
        except StepFailure as e:  # connection error in strict mode
            status = None
            print(f"  warm-up: {e}")
        if status != 200:
            print(f"  warm-up FALLITO su art. {body['article']} (status {status}) "
                  f"-> cached-search disabilitato")
            return False
        print(f"  warmed art. {body['article']}")
    return True


# ---- reporting ----

def print_table(metrics: Metrics, duration: float) -> None:
    hdr = (f"{'CLASS':<18} {'COUNT':>6} {'RPS':>6} {'OK':>6} {'429':>5} "
           f"{'4XX':>5} {'ERR':>5} {'ERR%':>6} {'P50':>7} {'P95':>7} {'P99':>7}")
    print("\n" + hdr)
    print("-" * len(hdr))

    def row(name: str, s: ClassStats) -> str:
        err_pct = (s.error / s.count * 100) if s.count else 0.0
        p50, p95, p99 = s.percentile(50), s.percentile(95), s.percentile(99)
        fmt = lambda v: f"{v:7.0f}" if v is not None else f"{'-':>7}"
        return (f"{name:<18} {s.count:>6} {s.count / duration:>6.2f} {s.ok:>6} "
                f"{s.rate_limited:>5} {s.contract_error:>5} {s.error:>5} "
                f"{err_pct:>5.1f}% {fmt(p50)} {fmt(p95)} {fmt(p99)}")

    for name in sorted(metrics.by_class):
        print(row(name, metrics.by_class[name]))
    print("-" * len(hdr))
    print(row("TOTAL", metrics.totals()))


def evaluate_thresholds(metrics: Metrics) -> list[str]:
    breaches: list[str] = []
    total = metrics.totals()
    if total.count:
        err_pct = total.error / total.count * 100
        if err_pct >= ERR_PCT_BUDGET:
            breaches.append(f"err% globale {err_pct:.2f} >= {ERR_PCT_BUDGET}")
    for group, budget in P95_BUDGETS.items():
        lats = metrics.group_latencies(group)
        if len(lats) < 2:
            continue
        p95 = statistics.quantiles(lats, n=100)[94]
        if p95 > budget:
            breaches.append(f"p95 {group} {p95:.0f}ms > {budget:.0f}ms")
    if total.contract_violations:
        breaches.append(f"{total.contract_violations} violazioni contratto "
                        f"(counter non monotono)")
    return breaches


def write_json(cfg: Config, metrics: Metrics, duration: float,
               args: argparse.Namespace, breaches: list[str]) -> str:
    from e2e.report import OUT_DIR
    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"stress-{cfg.run_id}.json"
    payload = {
        "run_id": cfg.run_id,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "config": {"users": args.users, "duration": args.duration,
                   "include_search_cached": args.include_search_cached},
        "thresholds": {"err_pct": ERR_PCT_BUDGET, "p95_ms": P95_BUDGETS},
        "breaches": breaches,
        "classes": {
            name: {
                "count": s.count,
                "rps": round(s.count / duration, 3),
                "ok": s.ok,
                "rate_limited": s.rate_limited,
                "contract_error": s.contract_error,
                "error": s.error,
                "contract_violations": s.contract_violations,
                "p50_ms": s.percentile(50),
                "p95_ms": s.percentile(95),
                "p99_ms": s.percentile(99),
            }
            for name, s in sorted(metrics.by_class.items())
        },
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    return str(path)


# ---- CLI ----

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="python -m e2e.stress",
        description="Stress locale BFF/MERL-T. MAI gli scraper esterni: la sola "
                    "azione Python-API (--include-search-cached) ri-colpisce corpi "
                    "gia' in cache a <=0.5 rps globali.")
    p.add_argument("--users", type=int, default=CONFIG.stress_users,
                   help=f"virtual users (default {CONFIG.stress_users}, max {MAX_USERS})")
    p.add_argument("--duration", type=float, default=CONFIG.stress_duration,
                   help=f"seconds (default {CONFIG.stress_duration:.0f}, max {MAX_DURATION:.0f})")
    p.add_argument("--include-search-cached", action="store_true",
                   help="warm-up 5 articoli (unici hit scraper) + re-hit cache <=0.5 rps")
    p.add_argument("--i-know-what-im-doing", action="store_true",
                   help="lift the users/duration guardrails (NOT the scraper exclusion)")
    return p.parse_args(argv)


async def main_async(args: argparse.Namespace) -> int:
    if not args.i_know_what_im_doing:
        if args.users > MAX_USERS:
            print(f"guardrail: --users {args.users} > {MAX_USERS} "
                  f"(usa --i-know-what-im-doing per superarlo)")
            return 2
        if args.duration > MAX_DURATION:
            print(f"guardrail: --duration {args.duration:.0f} > {MAX_DURATION:.0f} "
                  f"(usa --i-know-what-im-doing per superarlo)")
            return 2
    if args.users < 1 or args.duration <= 0:
        print("guardrail: --users >= 1 e --duration > 0 richiesti")
        return 2

    cfg = CONFIG
    report = Report(cfg.run_id)
    metrics = Metrics()
    run = StressRun(cfg, metrics)

    try:
        admin, vus = await setup_users(cfg, report, args.users)
    except StepFailure as e:
        print(f"setup fallito: {e}")
        if e.dump:
            print(json.dumps(e.dump, ensure_ascii=False, default=str)[:1000])
        return 2
    try:
        cached_ok = False
        if args.include_search_cached:
            cached_ok = await warm_cache(cfg, admin)

        # Switch VU clients to record_only: from here on nothing raises,
        # every outcome is classified into the metrics instead.
        for vu in vus:
            vu.client.record_only = True

        deadline = time.monotonic() + args.duration
        print(f"\nstress: {args.users} VU x {args.duration:.0f}s "
              f"(ramp-up {RAMP_INTERVAL}s/VU, think {THINK_MIN}-{THINK_MAX}s)")
        t0 = time.monotonic()
        tasks = [asyncio.create_task(run.vu_loop(vu, deadline)) for vu in vus]
        if cached_ok:
            tasks.append(asyncio.create_task(run.cached_search_loop(vus, deadline)))
        await asyncio.gather(*tasks)
        duration = time.monotonic() - t0
    finally:
        for vu in vus:
            await vu.client.close()
        await admin.close()

    print_table(metrics, duration)
    breaches = evaluate_thresholds(metrics)
    path = write_json(cfg, metrics, duration, args, breaches)
    print(f"\nreport: {path}")
    if breaches:
        print("SOGLIE VIOLATE:")
        for b in breaches:
            print(f"  - {b}")
        return 1
    print("tutte le soglie rispettate")
    return 0


def main() -> None:
    sys.exit(asyncio.run(main_async(parse_args())))


if __name__ == "__main__":
    main()
