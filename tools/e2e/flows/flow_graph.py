"""F6 - graph read + lazy ingest + job poll, as user_a.

The seeded-URN read carries the `!vig=` version marker on purpose: an
empty result there means the BFF's normalizeGraphUrn() regressed (Slice 2a
gotcha #6). The ingest half is THE end-to-end probe that gaps D+E+I are
closed: BFF enqueue -> RQ worker -> FalkorDB write -> internal callback.
Note: the worker fetches the ingested article live from Normattiva - one
fresh URN per run, never parallelize this flow.
"""
from __future__ import annotations

import random
import re
from urllib.parse import quote, urlencode

from e2e.context import Context
from e2e.data.fixtures import FIXTURE_URN_2043, FIXTURE_URN_ABSENT
from e2e.report import FlowSkipped, Report, StepFailure

TAGS: frozenset[str] = frozenset({"needs_merlt", "needs_worker", "slow"})

# The graph seed covers Libro IV only (arts 1173-2059), so any Libro I-III
# article is an absent-candidate. Fixed small pools get burned by previous
# runs' lazy ingestions against the same stack, so sample randomly (seeded by
# run_id for reproducibility) from the whole 11..1172 range (1-10 were the old
# fixed pool, likely already ingested).
_ABSENT_SAMPLE_SIZE = 15


def _absent_candidates(run_id: str) -> list[str]:
    rng = random.Random(run_id)
    return [str(n) for n in rng.sample(range(11, 1173), _ABSENT_SAMPLE_SIZE)]

_WORKER_HINT = "hint: docker logs visualex-merlt-worker --tail 50"


def _with_version_marker(urn: str) -> str:
    """Ensure the NIR `!vig=` marker so the read proves normalizeGraphUrn."""
    return urn if "!" in urn else f"{urn}!vig="


def _swap_article(urn: str, number: str) -> str:
    return re.sub(r"~art\w+", f"~art{number}", urn)


async def _get_subgraph(client, base: str, urn: str,
                        depth: int = 1, limit: int = 25) -> dict:
    _, body = await client.req(
        "GET", f"{base}/graph/article/{quote(urn, safe='')}?depth={depth}&limit={limit}"
    )
    return body


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    a = ctx.user_a
    base = f"{cfg.bff}/merlt"

    with report.step("subgraph art 2043 with !vig= (proves normalizeGraphUrn)"):
        urn_2043 = _with_version_marker(ctx.get("urn_full") or FIXTURE_URN_2043)
        body = await _get_subgraph(a, base, urn_2043)
        nodes = body.get("nodes") or []
        if not nodes:
            raise StepFailure(
                "subgraph for art 2043 is empty - seed missing (preflight #9) "
                "or normalizeGraphUrn regression (gotcha #6)",
                {"urn": urn_2043},
            )
        report.note(f"art 2043 subgraph: {len(nodes)} nodes / "
                    f"{len(body.get('edges') or [])} edges")

    with report.step("graph search q=risoluzione -> bare array"):
        _, results = await a.req(
            "GET", f"{base}/graph/search?" + urlencode({"q": "risoluzione", "limit": 5})
        )
        if not isinstance(results, list):
            raise StepFailure(
                f"graph search: expected bare array, got {type(results).__name__}",
                {"body": results},
            )
        report.note(f"search 'risoluzione': {len(results)} results")

    with report.step("pick a not-indexed URN (empty nodes = lazy-ingest signal)"):
        candidates = tuple(_swap_article(FIXTURE_URN_ABSENT, n)
                           for n in _absent_candidates(ctx.cfg.run_id))
        absent_urn = ""
        for candidate in candidates:
            body = await _get_subgraph(a, base, candidate)
            if not (body.get("nodes") or []):
                absent_urn = candidate
                break
            report.note(f"{candidate} already indexed (previous-run residue) - trying next")
        if not absent_urn:
            raise FlowSkipped(
                "no un-indexed URN available - every absent-candidate was "
                "already ingested by previous runs against this stack"
            )
        ctx.cap("graph_absent_urn", absent_urn)

    with report.step("POST /graph/ingest -> job created; repeat -> same jobId (200)"):
        status, body = await a.req("POST", f"{base}/graph/ingest",
                                   json={"urn": absent_urn}, expect=(200, 202))
        job_id = body["jobId"]
        if status == 200:
            # created=false path: an in-flight job for this URN already existed.
            report.note(f"in-flight job {job_id} reused from a previous run "
                        "(200 instead of 202)")
        status2, body2 = await a.req("POST", f"{base}/graph/ingest",
                                     json={"urn": absent_urn}, expect=200)
        if body2.get("jobId") != job_id:
            raise StepFailure(
                f"ingest idempotency broken: first jobId {job_id}, "
                f"repeat returned {body2.get('jobId')}"
            )
        ctx.cap("ingest_job_id", job_id)

    with report.step(f"poll job status until completed (max {cfg.ingest_poll_max:.0f}s)"):
        status_url = f"{base}/graph/jobs/{job_id}/status"

        async def fetch() -> dict:
            _, b = await a.req("GET", status_url)
            return b

        final = await a.poll(
            fetch,
            lambda b: b.get("status") in ("completed", "failed", "timeout"),
            max_wait=cfg.ingest_poll_max,
            label=f"ingest job {job_id} ({_WORKER_HINT})",
        )
        if final.get("status") != "completed":
            raise StepFailure(
                f"ingest job {job_id} ended '{final.get('status')}' ({_WORKER_HINT})",
                {"body": final},
            )
        if not final.get("nodesCreated"):
            raise StepFailure(
                f"ingest job {job_id} completed but nodesCreated="
                f"{final.get('nodesCreated')!r}",
                {"body": final},
            )
        report.note(f"ingested: {final['nodesCreated']} nodes / "
                    f"{final.get('edgesCreated')} edges")

    with report.step("re-GET subgraph -> now non-empty"):
        body = await _get_subgraph(a, base, absent_urn)
        if not (body.get("nodes") or []):
            raise StepFailure(
                f"subgraph still empty after completed ingestion for {absent_urn}",
                {"body": body},
            )

    with report.step("IDOR: user_b reads user_a's job status -> 404"):
        _, body = await ctx.user_b.req("GET", f"{base}/graph/jobs/{job_id}/status",
                                       expect=404)
        if body.get("detail") != "job_not_found":
            raise StepFailure(f"expected detail job_not_found, got {body!r}")

    if cfg.merlt_internal_secret:
        with report.step("internal-callback with wrong secret -> 401"):
            _, body = await a.req(
                "POST", f"{base}/internal/job-callback",
                json={"bffJobId": f"e2e-bogus-{cfg.run_id}", "status": "completed"},
                headers={"X-Internal-Secret": "wrong-secret-e2e"},
                auth=False,
                expect=401,
            )
            if body.get("detail") != "invalid_internal_secret":
                raise StepFailure(
                    f"expected detail invalid_internal_secret, got {body!r} "
                    "(a 500 means the BFF secret is unset - gap I fail-closed mode)"
                )
    else:
        report.note("MERLT_INTERNAL_SECRET not set in harness env - "
                    "wrong-secret callback probe skipped")
