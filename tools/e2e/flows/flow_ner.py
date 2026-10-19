"""F10 - NER feedback (user) + stats (admin) + optional training.

Sends 3 article_xref feedbacks as user_a (confirmation, correction with
correctReference, 3000-char contextWindow) so the admin stats assertion
by_surface.article_xref >= 2 holds even on a fresh MERL-T DB. The BFF caps
contextWindow at 1200 chars server-side (privacy budget) - not observable
from outside, so the long-window step asserts acceptance only.

Training is gated behind ctx 'include_ner_training' (slow spaCy job on the
RQ worker). A job stuck in 'queued' >60s is a soft-fail (recorded, poll
aborted, flow not failed): that signature is the worker queue-list
regression - see preflight check 5 (merlt_ner_train must be in the worker's
queue list).
"""
from __future__ import annotations

import asyncio
import time

from e2e.context import Context
from e2e.report import Report, StepFailure, FlowSkipped

TAGS: frozenset[str] = frozenset({"needs_merlt", "needs_full_consent", "needs_admin"})

FALLBACK_URN = "urn:nir:stato:regio.decreto:1942-03-16;262~art1453!vig="
CONTEXT = (
    "Nei contratti a prestazioni corrispettive, quando uno dei contraenti non "
    "adempie, l'altro puo' chiedere l'adempimento o la risoluzione ex art. 1453 "
    "c.c., salvo il risarcimento del danno."
)


async def run(ctx: Context, report: Report) -> None:
    bff = ctx.cfg.bff
    user = ctx.user_a
    admin = ctx.admin
    urn = ctx.get("urn_full", FALLBACK_URN)
    feedback_url = f"{bff}/merlt/ner/feedback"

    with report.step("ner/feedback confirmation -> 202 received"):
        status, body = await user.req(
            "POST", feedback_url,
            json={
                "surface": "article_xref",
                "feedbackType": "confirmation",
                "articleUrn": urn,
                "selectedText": "art. 1453",
                "startOffset": 96,
                "endOffset": 105,
                "contextWindow": CONTEXT,
            },
            expect=(202, 503),
        )
        if status == 503:
            raise FlowSkipped("MERL-T non raggiungibile (ner/feedback 503)")
        if not (isinstance(body, dict) and body.get("received")):
            raise StepFailure(f"expected received:true, got {body}")
        report.note(f"feedback_id={body.get('feedback_id')} sample_weight={body.get('sample_weight')}")

    with report.step("ner/feedback correction (with correctReference) -> 202"):
        _, body = await user.req(
            "POST", feedback_url,
            json={
                "surface": "article_xref",
                "feedbackType": "correction",
                "articleUrn": urn,
                "selectedText": "art 1453 codice civile",
                "contextWindow": CONTEXT,
                "correctReference": {
                    "actType": "codice civile",
                    "article": "1453",
                    "displayText": "art. 1453 c.c.",
                },
            },
            expect=202,
        )
        if not (isinstance(body, dict) and body.get("received")):
            raise StepFailure(f"expected received:true, got {body}")

    with report.step("negative: correction without correctReference -> 400"):
        await user.req(
            "POST", feedback_url,
            json={
                "surface": "article_xref",
                "feedbackType": "correction",
                "selectedText": "art. 9999",
            },
            expect=400,
        )

    with report.step("privacy: 3000-char contextWindow accepted (202)"):
        big_window = (CONTEXT + " ") * 20
        await user.req(
            "POST", feedback_url,
            json={
                "surface": "article_xref",
                "feedbackType": "confirmation",
                "articleUrn": urn,
                "selectedText": "art. 1453",
                "contextWindow": big_window[:3000],
            },
            expect=202,
        )
        report.note("il BFF tronca a 1200 char lato server (privacy budget) - non verificabile dall'esterno, verificata solo l'accettazione")

    with report.step("admin: ner/feedback/stats (total + by_surface)"):
        _, stats = await admin.req("GET", f"{bff}/merlt/ner/feedback/stats")
        if not (isinstance(stats, dict) and "total" in stats and isinstance(stats.get("by_surface"), dict)):
            raise StepFailure(f"unexpected stats shape: {stats}")
        xref = stats["by_surface"].get("article_xref", 0)
        if xref < 2:
            raise StepFailure(
                f"by_surface.article_xref={xref}, expected >=2 (this run just sent 3)"
            )
        report.note(f"total={stats['total']} untrained={stats.get('untrained')} by_surface={stats['by_surface']}")

    with report.step("negative: non-admin stats -> 403 admin_required"):
        _, body = await user.req(
            "GET", f"{bff}/merlt/ner/feedback/stats", expect=403,
        )
        if isinstance(body, dict) and body.get("detail") != "admin_required":
            raise StepFailure(f"expected detail=admin_required, got {body}")

    if not ctx.get("include_ner_training"):
        report.note("training NER saltato: flag include_ner_training non attivo (job spaCy lento, needs_worker)")
        return

    with report.step("admin: ner/training/start -> 202 queued"):
        status, body = await admin.req(
            "POST", f"{bff}/merlt/ner/training/start",
            json={"nIter": 5, "onlyUntrained": True},
            expect=(202, 503),
        )
        if status == 503:
            raise StepFailure(
                "ner/training/start 503: coda RQ non disponibile - verifica preflight "
                "check 5/6 (worker in ascolto su merlt_ner_train + RQ_REDIS_URL sull'api)"
            )
        task_id = body.get("task_id") if isinstance(body, dict) else None
        if not task_id:
            raise StepFailure(f"no task_id in training start response: {body}")
        report.note(f"task_id={task_id} status={body.get('status')}")

    with report.step(f"poll training job (max {ctx.cfg.ner_train_poll_max:.0f}s)"):
        job_url = f"{bff}/merlt/ner/training/jobs/{task_id}"
        deadline = time.monotonic() + ctx.cfg.ner_train_poll_max
        queued_deadline = time.monotonic() + 60.0
        last: dict = {}
        job_status: str | None = None
        while time.monotonic() < deadline:
            _, raw = await admin.req("GET", job_url)
            last = raw if isinstance(raw, dict) else {}
            job_status = last.get("status")
            if job_status in ("finished", "failed", "stopped"):
                break
            if job_status == "queued" and time.monotonic() > queued_deadline:
                # Soft-fail: recorded as a failed step but the flow proceeds -
                # this is the queue-list regression, not a harness assertion.
                report.record(
                    "POLL", job_url, None, 0.0, False,
                    "training job fermo in 'queued' >60s: il worker non ascolta la coda "
                    "merlt_ner_train (regressione lista code, preflight check 5)",
                )
                report.note("soft-fail: training rimasto in coda, poll interrotto")
                return
            await asyncio.sleep(ctx.cfg.poll_interval)
        if job_status == "finished":
            report.note(f"training completato: result={last.get('result')}")
        elif job_status == "failed":
            raise StepFailure(f"training fallito: {last.get('error')}", {"job": last})
        else:
            raise StepFailure(
                f"training non terminale dopo {ctx.cfg.ner_train_poll_max:.0f}s (status={job_status})",
                {"job": last},
            )
