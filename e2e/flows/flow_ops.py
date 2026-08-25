"""F11 - admin RLCF training start (loop-closure A5).

Both `success:true` (run started) and `success:false` with the
"Buffer insufficiente (N/50)" message are PASS - the Pydantic floor ge=50 on
the feedback buffer is documented behavior, not a bug. A 503 with the rest of
the MERL-T stack green is gap G (MERLT_API_KEY missing/wrong in backend/.env:
opsClient must send it as X-API-Key, and without it MERL-T 401s every call,
which the BFF maps to 503 merlt_unavailable).
"""
from __future__ import annotations

from e2e.context import Context
from e2e.report import Report, StepFailure

TAGS: frozenset[str] = frozenset({"needs_admin", "needs_merlt"})


async def run(ctx: Context, report: Report) -> None:
    url = f"{ctx.cfg.bff}/merlt/ops/rlcf/training/start"

    with report.step("negative: no auth -> 401"):
        await ctx.user_a.req("POST", url, json={"epochs": 1}, expect=401, auth=False)

    with report.step("negative: non-admin -> 403 admin_required"):
        _, body = await ctx.user_a.req("POST", url, json={"epochs": 1}, expect=403)
        if isinstance(body, dict) and body.get("detail") != "admin_required":
            raise StepFailure(f"expected detail=admin_required, got {body}")

    with report.step("admin: training start -> 202 (buffer-insufficiente e' PASS)"):
        status, body = await ctx.admin.req(
            "POST", url, json={"epochs": 1}, expect=(202, 503),
        )
        if status == 503:
            raise StepFailure(
                "503 merlt_unavailable dalla ops route: con lo stack MERL-T sano questo "
                "e' il gap G. Rimedio: imposta MERLT_API_KEY in backend/.env (opsClient "
                "la manda come header X-API-Key) e riavvia il BFF.",
                {"response": body},
            )
        if not (isinstance(body, dict) and "success" in body):
            raise StepFailure(f"unexpected ops response shape: {body}")
        if body["success"]:
            ctx.cap("rlcf_training_id", body.get("training_id"))
            report.note(f"training avviato: training_id={body.get('training_id')}")
        else:
            report.note(f"success:false accettato (comportamento documentato): {body.get('message')}")
