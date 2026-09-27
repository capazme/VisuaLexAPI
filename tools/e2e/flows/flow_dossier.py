"""F2 - BFF platform CRUD journey as user_a.

Dossier + items, annotations, highlights, quick norms (atomic /use counter),
custom aliases (409 on duplicate trigger), IDOR probe with user_b, item-level
cleanup, plus the bookmarks snake/camel contract check (known_issue:B).
Response-shape gotcha verified against the controllers: dossiers serialize
snake_case (is_pinned, item_type); annotations/highlights/quick-norms/aliases
return raw camelCase rows.
"""
from __future__ import annotations

from urllib.parse import quote

from e2e.context import Context
from e2e.report import Report, FlowSkipped, StepFailure

TAGS: frozenset[str] = frozenset()

# Fallback dossier-item content when flow_search was skipped (opaque JSON blob).
NORMA_2043 = {
    "tipo_atto": "codice civile",
    "data": "1942-03-16",
    "numero_atto": "262",
    "numero_articolo": "2043",
    "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043!vig=",
}


def _expect(cond: bool, message: str, dump: dict | None = None) -> None:
    if not cond:
        raise StepFailure(message, dump)


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    bff = cfg.bff
    run_id = cfg.run_id
    ua = ctx.user_a
    if not ua.access_token or not ctx.user_b.access_token:
        raise FlowSkipped("flow_auth did not run (missing user tokens)")

    norma_key = f"e2e-{run_id}-art-2043"
    norma_content = ctx.get("norma_data_2043") or NORMA_2043

    with report.step("POST /dossiers (snake_case response)"):
        _, dossier = await ua.req(
            "POST", f"{bff}/dossiers",
            json={"name": f"E2E {run_id}", "tags": ["e2e"]}, expect=201,
        )
        _expect("is_pinned" in dossier, "dossier response is not snake_case (is_pinned missing)",
                {"body": dossier})
        dossier_id = ctx.cap("dossier_id", dossier["id"])

    with report.step("POST /dossiers/:id/items + PUT status -> done"):
        _, item = await ua.req(
            "POST", f"{bff}/dossiers/{dossier_id}/items",
            json={"itemType": "norm", "title": "Art. 2043 c.c.",
                  "content": norma_content, "status": "unread"},
            expect=201,
        )
        _expect(item.get("item_type") == "norm", "item response is not snake_case (item_type)",
                {"body": item})
        item_id = item["id"]
        _, updated = await ua.req(
            "PUT", f"{bff}/dossiers/{dossier_id}/items/{item_id}",
            json={"status": "done"},
        )
        _expect(updated.get("status") == "done", "item status did not update to done",
                {"body": updated})

    with report.step("POST /annotations (camelCase row)"):
        _, ann = await ua.req(
            "POST", f"{bff}/annotations",
            json={"normaKey": norma_key, "content": f"nota e2e {run_id}",
                  "annotationType": "note"},
            expect=201,
        )
        _expect(ann.get("normaKey") == norma_key, "annotation row normaKey mismatch",
                {"body": ann})
        annotation_id = ann["id"]

    with report.step("POST /highlights + negative endOffset<=startOffset -> 400"):
        _, hl = await ua.req(
            "POST", f"{bff}/highlights",
            json={"normaKey": norma_key, "text": "risarcire il danno",
                  "color": "yellow", "startOffset": 10, "endOffset": 30},
            expect=201,
        )
        highlight_id = hl["id"]
        await ua.req(
            "POST", f"{bff}/highlights",
            json={"normaKey": norma_key, "text": "x", "color": "yellow",
                  "startOffset": 10, "endOffset": 10},
            expect=400,
        )

    with report.step("GET /annotations?normaKey= + negative no-param -> 400"):
        _, anns = await ua.req("GET", f"{bff}/annotations?normaKey={quote(norma_key)}")
        _expect(isinstance(anns, list) and any(a.get("id") == annotation_id for a in anns),
                "created annotation not returned by normaKey filter", {"count": len(anns or [])})
        await ua.req("GET", f"{bff}/annotations", expect=400)

    with report.step("quick-norm create + POST /:id/use x2 -> usageCount 2 (atomic)"):
        _, qn = await ua.req(
            "POST", f"{bff}/quick-norms",
            json={"label": f"Art 2043 e2e-{run_id}",
                  "searchParams": {"act_type": "codice civile", "article": "2043"}},
            expect=201,
        )
        quicknorm_id = qn["id"]
        await ua.req("POST", f"{bff}/quick-norms/{quicknorm_id}/use")
        _, used = await ua.req("POST", f"{bff}/quick-norms/{quicknorm_id}/use")
        _expect(used.get("usageCount") == 2,
                f"usageCount expected 2, got {used.get('usageCount')}", {"body": used})

    with report.step("custom-alias create + duplicate -> 409 + use -> usageCount 1"):
        alias_body = {"trigger": f"e2e{run_id}", "type": "shortcut",
                      "expandTo": "codice civile art. 2043"}
        _, alias = await ua.req("POST", f"{bff}/custom-aliases", json=alias_body, expect=201)
        alias_id = alias["id"]
        await ua.req("POST", f"{bff}/custom-aliases", json=alias_body, expect=409)
        _, alias_used = await ua.req("POST", f"{bff}/custom-aliases/{alias_id}/use")
        _expect(alias_used.get("usageCount") == 1,
                f"alias usageCount expected 1, got {alias_used.get('usageCount')}",
                {"body": alias_used})

    with report.step("IDOR: user_b GET /dossiers/:id -> 404"):
        await ctx.user_b.req("GET", f"{bff}/dossiers/{dossier_id}", expect=404)

    with report.step("bookmarks contract snake vs camel (known_issue:B)"):
        status, _ = await ua.req(
            "POST", f"{bff}/bookmarks",
            json={"norma_key": norma_key, "norma_data": norma_content},
            expect=(400, 500),
        )
        report.record("NOTE", f"{bff}/bookmarks", status, 0.0, True,
                      f"snake_case body rejected with {status} "
                      "(500 = unmapped Zod parse failure, 400 would be the fixed shape)",
                      known_issue="B")
        _, bm = await ua.req(
            "POST", f"{bff}/bookmarks",
            json={"normaKey": norma_key, "normaData": norma_content,
                  "title": f"E2E {run_id}", "tags": ["e2e"]},
            expect=201,
        )
        await ua.req("DELETE", f"{bff}/bookmarks/{bm['id']}", expect=204)

    with report.step("cleanup: item-level deletes (alias, quicknorm, highlight, annotation, dossier)"):
        # Item-level on purpose: the collection-level DELETE /annotations|/highlights
        # wipes the WHOLE user and stays reserved to applyEnvironment(replace).
        await ua.req("DELETE", f"{bff}/custom-aliases/{alias_id}", expect=204)
        await ua.req("DELETE", f"{bff}/quick-norms/{quicknorm_id}", expect=204)
        await ua.req("DELETE", f"{bff}/highlights/{highlight_id}", expect=204)
        await ua.req("DELETE", f"{bff}/annotations/{annotation_id}", expect=204)
        await ua.req("DELETE", f"{bff}/dossiers/{dossier_id}/items/{item_id}", expect=204)
        await ua.req("DELETE", f"{bff}/dossiers/{dossier_id}", expect=204)
