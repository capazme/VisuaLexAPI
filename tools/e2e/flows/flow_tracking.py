"""F5 - the 5 RLCF event endpoints, as user_a (full consent from flow_consent).

Every endpoint responds 202 {received, timestamp}. article-viewed may enrich
the 202 with an `ingestionJob` when the URN is not in the graph yet (lazy
trigger, Slice 2a) - captured opportunistically as `lazy_job_id`; flow_graph
owns the deterministic ingest test with its own fresh URN.
"""
from __future__ import annotations

import uuid

from e2e.context import Context
from e2e.data.fixtures import FIXTURE_URN_2043
from e2e.report import Report, StepFailure

TAGS: frozenset[str] = frozenset({"needs_merlt"})


def _assert_received(body: dict, endpoint: str) -> None:
    if body.get("received") != 1:
        raise StepFailure(f"{endpoint}: expected received=1, got {body!r}")


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    a = ctx.user_a
    events = f"{cfg.bff}/merlt/events"
    urn = ctx.get("urn_full") or FIXTURE_URN_2043
    session_id = str(uuid.uuid4())

    with report.step("article-viewed -> 202 (capture optional lazy ingestionJob)"):
        _, body = await a.req(
            "POST", f"{events}/article-viewed",
            json={"articleUrn": urn, "dwellMs": 4500, "scrollMaxPct": 60,
                  "sessionId": session_id},
            expect=202,
        )
        _assert_received(body, "article-viewed")
        job = body.get("ingestionJob")
        if job:
            ctx.cap("lazy_job_id", job["jobId"])
            report.note(f"lazy ingestion enqueued for {urn}: "
                        f"job {job['jobId']} ({job.get('status')})")

    with report.step("highlight-annotation (kind=annotation) -> 202"):
        _, body = await a.req(
            "POST", f"{events}/highlight-annotation",
            json={"kind": "annotation", "anchorText": "risarcire il danno",
                  "startOffset": 42, "articleUrn": urn,
                  "noteText": f"nota e2e {cfg.run_id}"},
            expect=202,
        )
        _assert_received(body, "highlight-annotation")

    with report.step("dossier-bookmark (kind=dossier) -> 202"):
        _, body = await a.req(
            "POST", f"{events}/dossier-bookmark",
            json={"kind": "dossier", "articleUrn": urn,
                  "dossierId": str(uuid.uuid4()), "tags": ["e2e", cfg.run_id]},
            expect=202,
        )
        _assert_received(body, "dossier-bookmark")

    with report.step("citation-clicked with null target -> 202"):
        _, body = await a.req(
            "POST", f"{events}/citation-clicked",
            json={"sourceArticleUrn": urn, "targetArticleUrn": None,
                  "citationText": "art. 1218 c.c."},
            expect=202,
        )
        _assert_received(body, "citation-clicked")

    with report.step("forum-signal (like) -> 202"):
        _, body = await a.req(
            "POST", f"{events}/forum-signal",
            json={"action": "like", "sharedEnvId": str(uuid.uuid4()),
                  "originalAuthorId": None},
            expect=202,
        )
        _assert_received(body, "forum-signal")

    with report.step("negative: scrollMaxPct 150 -> 400 invalid_body"):
        _, body = await a.req(
            "POST", f"{events}/article-viewed",
            json={"articleUrn": urn, "dwellMs": 1000, "scrollMaxPct": 150,
                  "sessionId": session_id},
            expect=400,
        )
        if body.get("detail") != "invalid_body":
            raise StepFailure(f"expected detail invalid_body, got {body!r}")

    with report.step("GET profile - tolerant (503 = known_issue H)"):
        status, body = await a.req("GET", f"{cfg.bff}/merlt/profile",
                                   expect=(200, 503))
        if status == 200:
            if "userId" not in body:
                raise StepFailure(f"profile 200 without userId: {body!r}")
            report.note(f"profile ok: authorityScore={body.get('authorityScore')}")
        else:
            report.note("known_issue H: GET /merlt/profile -> 503 (authority "
                        "cache miss + upstream fetch failed) - tolerated, flow not failed")
