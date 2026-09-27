"""F7 - MERL-T experts Q&A journey (Loop beta).

One real LLM query (costs money), then the 4 feedback channels with their
exact scales, and the history lookup. BFF-side Zod negatives run FIRST so
they are exercised even when the LLM key is missing (the query step degrades
to FlowSkipped on 503). Refine is gated behind ctx 'include_refine' (second
LLM call = extra cost); confirm-source runs only when a `live:` node id shows
up among the retrieved sources.
"""
from __future__ import annotations

from e2e.context import Context
from e2e.report import Report, StepFailure, FlowSkipped

TAGS: frozenset[str] = frozenset(
    {"needs_merlt", "needs_full_consent", "needs_llm", "slow", "costs_money"}
)


def _assert_feedback_ok(body: object) -> None:
    """MERL-T feedback responses carry {success, feedback_id?, message}."""
    if isinstance(body, dict) and body.get("success") is False:
        raise StepFailure(f"feedback rejected: {body.get('message')}", {"body": body})


async def run(ctx: Context, report: Report) -> None:
    bff = ctx.cfg.bff
    user = ctx.user_a

    with report.step("negative: 3-char query -> 400 invalid_body"):
        _, body = await user.req(
            "POST", f"{bff}/merlt/experts/query", json={"query": "ex?"}, expect=400,
        )
        if not (isinstance(body, dict) and body.get("detail") == "invalid_body"):
            raise StepFailure(f"expected detail=invalid_body, got {body}")

    with report.step("negative: inline rating 3 -> 400 (scale is literal 1|5)"):
        await user.req(
            "POST", f"{bff}/merlt/experts/feedback/inline",
            json={"traceId": "e2e-negative", "rating": 3}, expect=400,
        )

    with report.step("experts/query (convergent, real LLM call)"):
        status, body = await user.req(
            "POST", f"{bff}/merlt/experts/query",
            json={
                "query": "Quando e' possibile la risoluzione del contratto ex art 1453 cc?",
                "mode": "convergent",
            },
            expect=(200, 503),
            timeout=ctx.cfg.qa_timeout,
        )
        if status == 503:
            raise FlowSkipped("LLM non disponibile (OPENROUTER_API_KEY?)")
        trace_id = body.get("trace_id") if isinstance(body, dict) else None
        if not trace_id:
            raise StepFailure(f"no trace_id in query response (trace_id is the canonical handle, never query_id): {body if not isinstance(body, dict) else list(body)}")
        ctx.cap("trace_id", trace_id)
        sources = body.get("sources") or []
        retrieved = body.get("retrieved_sources") or []
        ctx.cap("qa_sources", sources)
        ctx.cap("qa_retrieved_sources", retrieved)
        report.note(
            f"trace_id={trace_id} experts={body.get('experts_used')} "
            f"confidence={body.get('confidence')} sources={len(sources)} retrieved={len(retrieved)}"
        )

    with report.step("feedback/inline rating=5"):
        _, fb = await user.req(
            "POST", f"{bff}/merlt/experts/feedback/inline",
            json={"traceId": trace_id, "rating": 5},
        )
        _assert_feedback_ok(fb)

    source_id = next(
        (s.get("urn") for s in retrieved if isinstance(s, dict) and s.get("urn")),
        None,
    ) or next(
        (s.get("article_urn") for s in sources if isinstance(s, dict) and s.get("article_urn")),
        None,
    )
    if source_id:
        with report.step("feedback/source relevance=4 (int 1..5)"):
            _, fb = await user.req(
                "POST", f"{bff}/merlt/experts/feedback/source",
                json={"traceId": trace_id, "sourceId": source_id, "relevance": 4},
            )
            _assert_feedback_ok(fb)
    else:
        report.note("feedback/source saltato: la risposta non ha fonti con urn/article_urn")

    with report.step("feedback/detailed (floats 0..1, NOT 1..5)"):
        _, fb = await user.req(
            "POST", f"{bff}/merlt/experts/feedback/detailed",
            json={
                "traceId": trace_id,
                "retrievalScore": 0.8,
                "reasoningScore": 0.7,
                "synthesisScore": 0.9,
            },
        )
        _assert_feedback_ok(fb)

    with report.step("feedback/preference preferredExpert=systemic"):
        _, fb = await user.req(
            "POST", f"{bff}/merlt/experts/feedback/preference",
            json={"traceId": trace_id, "preferredExpert": "systemic"},
        )
        _assert_feedback_ok(fb)

    with report.step("experts/history contains our trace_id"):
        _, hist = await user.req("GET", f"{bff}/merlt/experts/history?limit=20")
        items = hist if isinstance(hist, list) else []
        if not any(isinstance(i, dict) and i.get("trace_id") == trace_id for i in items):
            raise StepFailure(
                f"trace {trace_id} not found in history ({len(items)} items)",
                {"first_items": items[:3]},
            )

    if ctx.get("include_refine"):
        with report.step("experts/refine (follow-up, second LLM call)"):
            _, ref = await user.req(
                "POST", f"{bff}/merlt/experts/refine",
                json={"traceId": trace_id, "followUpQuery": "E in caso di inadempimento parziale?"},
                timeout=ctx.cfg.qa_timeout,
            )
            refined_trace = ref.get("trace_id") if isinstance(ref, dict) else None
            if not refined_trace:
                raise StepFailure(f"refine response has no trace_id: {ref}")
            report.note(f"refine ok, trace_id={refined_trace}")
    else:
        report.note("refine saltato: flag include_refine non attivo (seconda chiamata LLM, costo extra)")

    live_node = next(
        (
            s.get("node_id")
            for s in retrieved
            if isinstance(s, dict)
            and isinstance(s.get("node_id"), str)
            and s["node_id"].startswith("live:")
        ),
        None,
    )
    if live_node:
        with report.step("experts/confirm-source (live: node found)"):
            _, conf = await user.req(
                "POST", f"{bff}/merlt/experts/confirm-source",
                json={"nodeId": live_node},
            )
            report.note(f"confirm-source su {live_node}: {conf if isinstance(conf, dict) else type(conf).__name__}")
    else:
        report.note("confirm-source saltato: nessun node_id 'live:' tra le retrieved_sources (atteso con grafo seedato)")
