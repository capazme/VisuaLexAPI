"""F3 - SharedEnvironments journey: publish, search, like toggle, download,
per-item suggestion lifecycle (take/decline -> counts + aggregateStatus),
negative contracts (revoke taken -> 403, append to closed thread -> 409).

user_a owns the environment, user_b is the suggester (owners cannot suggest
to their own environments). One publish per run stays well under the
5-per-day limit because users are run-scoped.
"""
from __future__ import annotations

from urllib.parse import quote

from e2e.context import Context
from e2e.report import Report, FlowSkipped, StepFailure

TAGS: frozenset[str] = frozenset()


def _expect(cond: bool, message: str, dump: dict | None = None) -> None:
    if not cond:
        raise StepFailure(message, dump)


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    bff = cfg.bff
    run_id = cfg.run_id
    owner = ctx.user_a
    suggester = ctx.user_b
    if not owner.access_token or not suggester.access_token:
        raise FlowSkipped("flow_auth did not run (missing user tokens)")

    title = f"E2E env {run_id}"
    suggestions_base = f"{bff}/shared-environments-suggestions"
    created_quicknorm_id: str | None = None

    with report.step("user_a publishes a shared environment"):
        _, env = await owner.req(
            "POST", f"{bff}/shared-environments",
            json={"title": title, "description": "E2E harness environment",
                  "category": "civil", "tags": ["e2e"],
                  "content": {"dossiers": [], "quickNorms": [], "customAliases": [],
                              "annotations": [], "highlights": []}},
            expect=201,
        )
        _expect(env.get("isOwner") is True, "publish response isOwner is not true", {"body": env})
        env_id = ctx.cap("shared_env_id", env["id"])

    with report.step("user_b finds it via ?search= (pagination envelope)"):
        _, page = await suggester.req(
            "GET", f"{bff}/shared-environments?search={quote(title)}")
        data = page.get("data") or []
        _expect(any(e.get("id") == env_id for e in data),
                "published env not in search results", {"pagination": page.get("pagination")})
        _expect(isinstance((page.get("pagination") or {}).get("total"), int),
                "pagination envelope missing", {"body_keys": sorted(page)})

    with report.step("user_b like toggle: on -> off"):
        _, liked = await suggester.req("POST", f"{bff}/shared-environments/{env_id}/like")
        _expect(liked.get("liked") is True and liked.get("likeCount") == 1,
                f"unexpected like response: {liked}")
        _, unliked = await suggester.req("POST", f"{bff}/shared-environments/{env_id}/like")
        _expect(unliked.get("liked") is False and unliked.get("likeCount") == 0,
                f"unexpected unlike response: {unliked}")

    with report.step("user_b download returns the content blob"):
        _, dl = await suggester.req("POST", f"{bff}/shared-environments/{env_id}/download")
        content = dl.get("content")
        _expect(isinstance(content, dict) and "dossiers" in content,
                "download did not return the environment content", {"body_keys": sorted(dl)})

    with report.step("user_b creates a 2-item suggestion (quickNorm + annotation)"):
        _, sug = await suggester.req(
            "POST", f"{bff}/shared-environments/{env_id}/suggestions",
            json={"message": f"e2e {run_id}",
                  "items": [
                      {"itemType": "quickNorm",
                       "payload": {"label": f"Art 2043 e2e-{run_id}",
                                   "searchParams": {"act_type": "codice civile",
                                                    "article": "2043"}}},
                      {"itemType": "annotation",
                       "payload": {"articleId": "art-2043", "text": f"nota e2e {run_id}"}},
                  ]},
            expect=201,
        )
        _expect(sug.get("counts") == {"pending": 2, "taken": 0, "declined": 0},
                f"unexpected counts: {sug.get('counts')}", {"body": sug})
        _expect(sug.get("aggregateStatus") == "open",
                f"unexpected aggregateStatus: {sug.get('aggregateStatus')}")
        suggestion_id = ctx.cap("suggestion_id", sug["id"])
        by_type = {i["itemType"]: i["id"] for i in sug.get("items", [])}
        _expect(set(by_type) == {"quickNorm", "annotation"},
                "suggestion items do not carry the two expected itemTypes",
                {"items": sug.get("items")})
        take_item_id = by_type["quickNorm"]
        decline_item_id = by_type["annotation"]

    with report.step("owner sees the suggestion in /received"):
        _, received = await owner.req("GET", f"{suggestions_base}/received")
        _expect(any(s.get("id") == suggestion_id for s in received),
                "suggestion not in owner's received list", {"count": len(received or [])})

    with report.step("owner takes item0 + declines item1 -> counts {taken:1,declined:1}, closed"):
        _, took = await owner.req(
            "POST", f"{suggestions_base}/{suggestion_id}/items/{take_item_id}/take")
        _expect((took.get("item") or {}).get("status") == "taken",
                "take did not mark the item as taken", {"body": took})
        created_quicknorm_id = (took.get("created") or {}).get("id")
        _, declined = await owner.req(
            "POST", f"{suggestions_base}/{suggestion_id}/items/{decline_item_id}/decline",
            json={"reviewNote": "e2e"})
        _expect(declined.get("status") == "declined",
                "decline did not mark the item as declined", {"body": declined})
        _, received = await owner.req("GET", f"{suggestions_base}/received")
        ours = next((s for s in received if s.get("id") == suggestion_id), None)
        _expect(ours is not None, "suggestion vanished from /received after review")
        _expect(ours["counts"] == {"pending": 0, "taken": 1, "declined": 1},
                f"unexpected post-review counts: {ours['counts']}")
        _expect(ours["aggregateStatus"] == "closed",
                f"unexpected post-review aggregateStatus: {ours['aggregateStatus']}")

    with report.step("negatives: revoke taken item -> 403, append to closed thread -> 409"):
        await suggester.req(
            "DELETE", f"{suggestions_base}/{suggestion_id}/items/{take_item_id}", expect=403)
        await suggester.req(
            "POST", f"{suggestions_base}/{suggestion_id}/items",
            json={"items": [{"itemType": "annotation",
                             "payload": {"articleId": "art-1218", "text": "late e2e"}}]},
            expect=409,
        )

    with report.step("cleanup: taken quickNorm + shared environment"):
        if created_quicknorm_id:
            # The take landed a quickNorm row in user_a's workspace; remove it.
            await owner.req("DELETE", f"{bff}/quick-norms/{created_quicknorm_id}",
                            expect=(204, 404))
        await owner.req("DELETE", f"{bff}/shared-environments/{env_id}", expect=204)
