"""F9 - RLCF validation: user_b votes on a pending proposal.

user_b is the voter so the entity promoted by user_a in flow_contrib is
votable (voter != author). Falls back to any pending entity when flow_contrib
was skipped; skips cleanly on an empty queue. The re-GET at the end proves
MERL-T's per-user exclusion (voted items disappear from that voter's queue).

NB the live validate-entity response is EntityValidationResponse
{entity_id, new_status, votes_count, threshold_reached, ...} - the field is
`new_status`, not the `validation_status` the BFF integration mock used.
"""
from __future__ import annotations

from typing import Any

from e2e.context import Context
from e2e.report import Report, StepFailure, FlowSkipped

TAGS: frozenset[str] = frozenset({"needs_merlt", "needs_full_consent"})


def _item_id(item: Any) -> str | None:
    """Pending items expose the id as `id` (PendingEntityData); tolerate
    `entity_id` in case the MERL-T serializer changes."""
    if not isinstance(item, dict):
        return None
    return item.get("id") or item.get("entity_id")


async def run(ctx: Context, report: Report) -> None:
    bff = ctx.cfg.bff
    voter = ctx.user_b

    with report.step("GET /validate/pending (user_b)"):
        status, body = await voter.req(
            "GET", f"{bff}/merlt/validate/pending?limit=50", expect=(200, 503),
        )
        if status == 503:
            raise FlowSkipped("MERL-T non raggiungibile (validate/pending 503)")
        entities = body.get("pending_entities") if isinstance(body, dict) else None
        if entities is None:
            raise StepFailure(f"no pending_entities in response: {body}")
        report.note(
            f"{len(entities)} pending entities (total={body.get('total_entities')}, "
            f"user_can_vote={body.get('user_can_vote')})"
        )

    target = None
    promoted_id = ctx.get("pendingId")
    if promoted_id:
        target = next((e for e in entities if _item_id(e) == promoted_id), None)
        if target is None:
            report.note(
                f"pendingId {promoted_id} (da flow_contrib) non in coda per user_b: "
                "voto sulla prima entita' pendente disponibile"
            )
    if target is None:
        target = next((e for e in entities if _item_id(e)), None)
    if target is None:
        raise FlowSkipped("nessuna proposta pendente")
    entity_id = _item_id(target)
    report.note(f"voto su entity_id={entity_id} nome={target.get('nome')}")

    with report.step("negative: vote 'maybe' -> 400 (enum approve|reject|edit)"):
        await voter.req(
            "POST", f"{bff}/merlt/validate/entity",
            json={"entityId": entity_id, "vote": "maybe"}, expect=400,
        )

    with report.step("POST /validate/entity approve"):
        _, res = await voter.req(
            "POST", f"{bff}/merlt/validate/entity",
            json={"entityId": entity_id, "vote": "approve", "reason": f"E2E {ctx.cfg.run_id}"},
        )
        if not (isinstance(res, dict) and res.get("entity_id") == entity_id):
            raise StepFailure(f"unexpected validate response: {res}")
        report.note(
            f"new_status={res.get('new_status')} votes={res.get('votes_count')} "
            f"threshold_reached={res.get('threshold_reached')}"
        )

    with report.step("re-GET pending: voted entity excluded for user_b"):
        _, body2 = await voter.req("GET", f"{bff}/merlt/validate/pending?limit=50")
        entities2 = body2.get("pending_entities") if isinstance(body2, dict) else []
        if any(_item_id(e) == entity_id for e in entities2):
            raise StepFailure(
                f"entity {entity_id} still in user_b's pending queue after voting "
                "(user_id-scoped exclusion broken)"
            )
