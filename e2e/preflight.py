"""Ordered stack preflight (blueprint §2): 13 checks, hard/soft semantics.

Hard failures block the run (the runner prints the bring-up hint and exits 2).
Soft failures downgrade dependent flows to SKIPPED via tags — never silent.
Runnable standalone: python -m e2e.preflight [--skip-optional]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import aiohttp

from e2e.config import CONFIG, Config

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
BACKEND_ENV = BACKEND_DIR / ".env"

# container_name values declared in docker-compose.merlt.yml
CONTAINERS = (
    "visualex-merlt-postgres",
    "visualex-merlt-redis",
    "visualex-merlt-falkordb",
    "visualex-merlt-qdrant",
    "visualex-merlt-api",
    "visualex-merlt-worker",
)
RQ_QUEUES = ("merlt_ingest", "merlt_extract", "merlt_ner_train")
RQ_REDIS_URL = "redis://merlt-redis:6379/1"
FALKOR_PORT = os.environ.get("MERLT_FALKOR_PORT", "6382")
GRAPH_NAME = os.environ.get("MERLT_GRAPH_NAME", "merl_t_legal")

ProbeFn = Callable[[], Awaitable[tuple[bool, str]]]


@dataclass
class Check:
    name: str
    gap: str
    hard: bool
    probe: ProbeFn
    skip_tags: frozenset[str] = frozenset()
    optional: bool = False  # skipped entirely under --skip-optional


# ---- low-level helpers ----

async def _run_cmd(*args: str, cwd: Path | None = None,
                   timeout: float = 60.0) -> tuple[int, str]:
    """Run a CLI probe; (-1, reason) when the binary is missing or it hangs."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, cwd=str(cwd) if cwd else None,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
    except FileNotFoundError:
        return -1, f"binary not found: {args[0]}"
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, f"timed out after {timeout}s: {' '.join(args[:4])}"
    return proc.returncode or 0, out.decode(errors="replace").strip()


async def _http(session: aiohttp.ClientSession, method: str, url: str, *,
                json_body: Any = None, headers: dict[str, str] | None = None,
                timeout: float = 10.0) -> tuple[int, Any]:
    """(status, parsed body); status 0 on connection error/timeout."""
    try:
        async with session.request(
            method, url, json=json_body, headers=headers,
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            try:
                body = await resp.json(content_type=None)
            except (ValueError, aiohttp.ClientError):
                body = await resp.text()
            return resp.status, body
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        return 0, f"{type(e).__name__}: {e}"


def _short(body: Any, limit: int = 160) -> str:
    s = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False, default=str)
    return s[:limit]


def _env_file_value(path: Path, key: str) -> str:
    if not path.exists():
        return ""
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            return stripped.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _parse_graph_count(out: str) -> int | None:
    m = re.search(r"\(integer\)\s+(\d+)", out)
    if m:
        return int(m.group(1))
    for line in out.splitlines():
        s = line.strip().strip('"')
        if s.isdigit():
            return int(s)
    return None


# ---- quick probe reused by the runner's --wait-for-stack loop ----

async def quick_stack_status(cfg: Config) -> tuple[bool, bool, bool, str]:
    """(py_api_ok, bff_ok, merlt_ok, detail) — checks 1/2/3 in one shot."""
    async with aiohttp.ClientSession() as session:
        s1, _ = await _http(session, "GET", f"{cfg.py_api}/")
        s2, b2 = await _http(session, "GET", f"{cfg.bff}/merlt/health")
        s3, _ = await _http(session, "GET", f"{cfg.merlt}/health")
    py_ok = s1 == 200
    bff_ok = s2 in (200, 503) and isinstance(b2, dict) and b2.get("bff") == "ok"
    merlt_ok = s3 == 200
    return py_ok, bff_ok, merlt_ok, f"py_api={s1} bff={s2} merlt={s3}"


# ---- the 13 checks ----

def build_checks(cfg: Config, session: aiohttp.ClientSession,
                 state: dict[str, str]) -> list[Check]:
    async def c1_py_api() -> tuple[bool, str]:
        status, body = await _http(session, "GET", f"{cfg.py_api}/")
        return status == 200, f"GET / -> {status or _short(body, 80)}"

    async def c2_bff() -> tuple[bool, str]:
        status, body = await _http(session, "GET", f"{cfg.bff}/merlt/health")
        if isinstance(body, dict) and body.get("bff") == "ok":
            merlt = body.get("merlt", "?")
            if status == 200 and merlt == "reachable":
                return True, "bff ok, merlt reachable"
            # BFF itself is fine; MERL-T reachability skip is owned by check 3
            return True, f"bff ok, merlt {merlt} (gap D)"
        return False, f"BFF down: status={status} {_short(body, 100)}"

    async def c3_merlt_direct() -> tuple[bool, str]:
        status, body = await _http(session, "GET", f"{cfg.merlt}/health")
        if status == 200:
            return True, f"GET {cfg.merlt}/health -> 200"
        return False, f"MERL-T unreachable ({status or _short(body, 80)}) -> MERL-T flows skipped"

    async def c4_containers() -> tuple[bool, str]:
        rc, out = await _run_cmd("docker", "inspect", "--format",
                                 "{{.Name}} {{.State.Running}} {{.State.Health.Status}}",
                                 *CONTAINERS)
        if rc != 0:
            return False, _short(out, 140) or "docker inspect failed"
        bad: list[str] = []
        for ln in out.splitlines():
            parts = ln.strip().lstrip("/").split()
            if not parts:
                continue
            # NB exact match: "unhealthy".endswith("healthy") is True, and a
            # stopped container keeps its last recorded Health.Status.
            if len(parts) != 3 or parts[1] != "true" or parts[2] != "healthy":
                bad.append(f"{parts[0]} ({' '.join(parts[1:]) or 'unknown'})")
        if bad:
            return False, "not running+healthy: " + ", ".join(bad)
        return True, f"{len(CONTAINERS)} containers healthy"

    async def c5_worker_queues() -> tuple[bool, str]:
        rc, out = await _run_cmd("docker", "exec", "visualex-merlt-worker",
                                 "rq", "info", "--url", RQ_REDIS_URL)
        if rc != 0:
            return False, _short(out, 140)
        missing = [q for q in RQ_QUEUES if q not in out]
        if missing:
            return False, "queues missing from rq info: " + ", ".join(missing)
        m = re.search(r"(\d+)\s+workers", out)
        if not m or int(m.group(1)) < 1:
            return False, "no workers registered on the RQ queues"
        return True, f"{m.group(1)} worker(s) on {len(RQ_QUEUES)} queues"

    async def c6_rq_enqueue_side() -> tuple[bool, str]:
        snippet = "import os,redis;u=os.environ['RQ_REDIS_URL'];redis.from_url(u).ping();print(u)"
        rc, out = await _run_cmd("docker", "exec", "visualex-merlt-api",
                                 "python", "-c", snippet)
        if rc != 0:
            return False, _short(out, 140)
        url = out.splitlines()[-1].strip() if out else ""
        if not url.endswith("/1"):
            return False, f"RQ_REDIS_URL={url!r} on merlt-api (expected .../1)"
        return True, f"ping ok, {url}"

    async def c7_api_key() -> tuple[bool, str]:
        if _env_file_value(BACKEND_ENV, "MERLT_API_KEY"):
            return True, "set in backend/.env (functional probe lives in flow ops)"
        return False, "missing in backend/.env -> flow ops will 503 (gap G)"

    async def c8_internal_secret() -> tuple[bool, str]:
        problems: list[str] = []
        bff_secret = _env_file_value(BACKEND_ENV, "MERLT_INTERNAL_SECRET")
        if not bff_secret:
            problems.append("MERLT_INTERNAL_SECRET missing in backend/.env")
        rc, out = await _run_cmd("docker", "exec", "visualex-merlt-worker",
                                 "printenv", "MERLT_INTERNAL_SECRET")
        if rc != 0:
            problems.append(f"worker env probe failed: {_short(out, 60)}")
        elif bff_secret and out.strip() != bff_secret:
            problems.append("BFF/worker secret mismatch")
        # Functional negative: a wrong secret must be a clean 401
        # (500 = internal_auth_not_configured, gap I's fail-closed mode).
        status, body = await _http(
            session, "POST", f"{cfg.bff}/merlt/internal/job-callback",
            json_body={}, headers={"X-Internal-Secret": "e2e-wrong-secret"},
        )
        if status == 500:
            problems.append("callback -> 500 (BFF secret unset, fail-closed)")
        elif status != 401:
            problems.append(f"wrong-secret callback -> {status} (expected 401)")
        if problems:
            return False, "; ".join(problems)
        return True, "secret coherent, wrong secret -> 401"

    async def c9_graph_seed() -> tuple[bool, str]:
        cypher = "MATCH (n) RETURN count(n)"
        rc, out = await _run_cmd("redis-cli", "-p", FALKOR_PORT,
                                 "GRAPH.QUERY", GRAPH_NAME, cypher)
        if rc != 0:
            rc, out = await _run_cmd("docker", "exec", "visualex-merlt-falkordb",
                                     "redis-cli", "GRAPH.QUERY", GRAPH_NAME, cypher)
        if rc != 0:
            return False, _short(out, 140)
        count = _parse_graph_count(out)
        if count is None:
            return False, f"unparseable GRAPH.QUERY output: {_short(out, 100)}"
        if count <= 100:
            return False, f"{count} nodes — Libro IV seed missing (expected ~27700, gap I)"
        return True, f"{count} nodes in {GRAPH_NAME}"

    async def c10_prisma() -> tuple[bool, str]:
        rc, out = await _run_cmd("npx", "prisma", "migrate", "status",
                                 cwd=BACKEND_DIR, timeout=120.0)
        if "Database schema is up to date!" in out:
            return True, "schema up to date"
        last = out.splitlines()[-1].strip() if out else f"rc={rc}"
        return False, _short(last, 140)

    async def c11_admin_login() -> tuple[bool, str]:
        if not cfg.admin_password:
            return False, "ADMIN_PASSWORD / E2E_ADMIN_PASSWORD not set"
        status, body = await _http(
            session, "POST", f"{cfg.bff}/auth/login",
            json_body={"email": cfg.admin_email, "password": cfg.admin_password},
        )
        if status != 200 or not isinstance(body, dict):
            return False, f"login -> {status} {_short(body, 100)}"
        if not body.get("user", {}).get("is_admin"):
            return False, f"{cfg.admin_email} exists but is_admin is false"
        state["token"] = body["access_token"]
        return True, f"admin login ok ({cfg.admin_email})"

    async def c12_consent_roundtrip() -> tuple[bool, str]:
        token = state.get("token", "")
        if not token:
            return False, "no admin token (check 11 failed)"
        hdrs = {"Authorization": f"Bearer {token}"}
        status, body = await _http(
            session, "POST", f"{cfg.bff}/merlt/consent",
            json_body={"level": "basic", "reason": "e2e preflight"}, headers=hdrs,
        )
        if status != 200 or not (isinstance(body, dict) and body.get("graphEnabled") is True):
            return False, f"set basic -> {status} {_short(body, 100)}"
        status, body = await _http(
            session, "DELETE", f"{cfg.bff}/merlt/consent",
            json_body={"reason": "e2e preflight revert"}, headers=hdrs,
        )
        if status != 200 or not (isinstance(body, dict) and body.get("level") == "none"):
            return False, f"revoke -> {status} {_short(body, 100)}"
        return True, "basic -> none round-trip ok"

    async def c13_vite() -> tuple[bool, str]:
        status, _ = await _http(session, "GET", f"{cfg.frontend}/")
        return status == 200, f"GET {cfg.frontend}/ -> {status}"

    # skip_tags note: the seed-dependent flow (graph) and the callback-dependent
    # flows all carry needs_worker, so checks 4/5/6/8/9 converge on that tag;
    # check 3 also blankets needs_llm (Q&A/extraction route through MERL-T).
    return [
        Check("1 Python API up", "-", True, c1_py_api),
        Check("2 BFF up + MERL-T proxy", "D", True, c2_bff),
        Check("3 MERL-T direct", "D", False, c3_merlt_direct,
              frozenset({"needs_merlt", "needs_worker", "needs_llm"})),
        Check("4 Sidecar containers healthy", "D", False, c4_containers,
              frozenset({"needs_worker"})),
        Check("5 Worker alive + 3 RQ queues", "D", False, c5_worker_queues,
              frozenset({"needs_worker"})),
        Check("6 RQ_REDIS_URL on merlt-api", "E", False, c6_rq_enqueue_side,
              frozenset({"needs_worker"})),
        Check("7 MERLT_API_KEY in BFF env", "G", False, c7_api_key),
        Check("8 MERLT_INTERNAL_SECRET coherent", "I", False, c8_internal_secret,
              frozenset({"needs_worker"})),
        Check("9 Graph seeded (Libro IV)", "I", False, c9_graph_seed,
              frozenset({"needs_worker"})),
        Check("10 Platform DB migrated", "A", True, c10_prisma),
        Check("11 Admin exists + loginable", "-", True, c11_admin_login),
        Check("12 Consent write+revoke", "-", True, c12_consent_roundtrip),
        Check("13 Vite dev server", "-", False, c13_vite, optional=True),
    ]


# ---- orchestration ----

async def run_preflight(cfg: Config = CONFIG,
                        skip_optional: bool = False) -> tuple[int, set[str]]:
    """Run all checks in order. Returns (hard_failures, tags_to_skip)."""
    hard_failures = 0
    skip_tags: set[str] = set()
    rows: list[tuple[str, str, str, str]] = []
    state: dict[str, str] = {}

    async with aiohttp.ClientSession() as session:
        for check in build_checks(cfg, session, state):
            if skip_optional and not check.hard:
                rows.append((check.name, check.gap, "SKIP", "--skip-optional"))
                continue
            ok, detail = await check.probe()
            if ok:
                result = "OK"
            elif check.hard:
                result = "FAIL"
                hard_failures += 1
            else:
                result = "SOFT-FAIL"
                skip_tags |= check.skip_tags
            rows.append((check.name, check.gap, result, detail))

    name_w = max(len(r[0]) for r in rows)
    print(f"\n{'CHECK':<{name_w}}  {'GAP':<3}  {'RESULT':<9}  DETAIL")
    print("-" * (name_w + 3 + 9 + 40))
    for name, gap, result, detail in rows:
        print(f"{name:<{name_w}}  {gap:<3}  {result:<9}  {detail[:110]}")
    print(f"\npreflight: {hard_failures} hard failure(s)"
          + (f", skipping tags {sorted(skip_tags)}" if skip_tags else ""))
    return hard_failures, skip_tags


async def _main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m e2e.preflight",
        description="Stack preflight for the VisuaLex E2E harness (13 ordered checks).",
    )
    parser.add_argument("--skip-optional", action="store_true",
                        help="run hard checks only (1, 2, 10, 11, 12)")
    args = parser.parse_args()
    hard_failures, _ = await run_preflight(CONFIG, skip_optional=args.skip_optional)
    return 2 if hard_failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
