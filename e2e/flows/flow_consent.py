"""F4 - MERL-T consent lifecycle on user_a (+ full consent for user_b).

Runs BEFORE the tracking/graph/qa/contrib flows: it leaves user_a at level
`full`, the baseline every needs_full_consent flow relies on, and sets
user_b to `full` too (the validate flow needs a second voter).

No needs_merlt tag: consent is pure BFF+Prisma, and the tracking-403 probe
is rejected by consentGuard before any MERL-T call happens.
"""
from __future__ import annotations

import uuid

from e2e.context import Context
from e2e.data.fixtures import FIXTURE_URN_2043
from e2e.report import Report, StepFailure

TAGS: frozenset[str] = frozenset()


def _assert_consent(body: dict, level: str, contribution: bool,
                    validation: bool, graph: bool) -> None:
    got = (body.get("level"), body.get("contributionEnabled"),
           body.get("validationEnabled"), body.get("graphEnabled"))
    want = (level, contribution, validation, graph)
    if got != want:
        raise StepFailure(
            f"consent state mismatch: want (level, contrib, valid, graph)={want}, got {got}",
            {"body": body},
        )


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    a = ctx.user_a
    consent_url = f"{cfg.bff}/merlt/consent"

    with report.step("GET consent - fresh user starts at none"):
        _, body = await a.req("GET", consent_url)
        if body.get("updatedAt") is not None:
            # Risk #10: user_a reused from a previous run (lookup-then-create
            # path in flow_auth) - the fresh-none assertion would be a false
            # failure. Note it and reset to none so the lifecycle below is
            # deterministic anyway.
            report.note(
                f"user_a reused from a previous run (updatedAt={body.get('updatedAt')}) - "
                "skipping fresh-none assertion, resetting to none (risk #10)"
            )
            _, body = await a.req("DELETE", consent_url,
                                  json={"reason": f"e2e reset {cfg.run_id}"})
            _assert_consent(body, "none", False, False, False)
        else:
            _assert_consent(body, "none", False, False, False)

    with report.step("tracking while none -> 403 consent_required"):
        _, body = await a.req(
            "POST", f"{cfg.bff}/merlt/events/article-viewed",
            json={"articleUrn": FIXTURE_URN_2043, "dwellMs": 3000,
                  "scrollMaxPct": 40, "sessionId": str(uuid.uuid4())},
            expect=403,
        )
        if body.get("detail") != "consent_required":
            raise StepFailure(f"expected detail consent_required, got {body!r}")

    with report.step("POST level basic -> graph on, contribution/validation off"):
        _, body = await a.req("POST", consent_url,
                              json={"level": "basic", "reason": f"e2e {cfg.run_id}"})
        _assert_consent(body, "basic", False, False, True)

    with report.step("POST level full -> all toggles on"):
        _, body = await a.req("POST", consent_url,
                              json={"level": "full", "reason": f"e2e {cfg.run_id}"})
        _assert_consent(body, "full", True, True, True)

    with report.step("DELETE consent -> revoked to none"):
        _, body = await a.req("DELETE", consent_url,
                              json={"reason": f"e2e revoke {cfg.run_id}"})
        _assert_consent(body, "none", False, False, False)

    with report.step("POST level full again - suite baseline for user_a"):
        body = await a.set_consent("full", reason=f"e2e baseline {cfg.run_id}")
        _assert_consent(body, "full", True, True, True)

    with report.step("POST level full for user_b (second voter for flow_validate)"):
        body = await ctx.user_b.set_consent("full", reason=f"e2e baseline {cfg.run_id}")
        _assert_consent(body, "full", True, True, True)

    with report.step("negative: invalid level -> 400 invalid_body"):
        _, body = await a.req("POST", consent_url,
                              json={"level": "invalid"}, expect=400)
        if body.get("detail") != "invalid_body":
            raise StepFailure(f"expected detail invalid_body, got {body!r}")
