"""F1 - Python API (:5000) search journey on codice civile art. 2043.

Hits Normattiva/Brocardi LIVE (~6 scraper requests + 1 Playwright PDF): run at
most once per invocation, never in parallel, never from stress. The Python API
is unauthenticated; the user_a client is used only for latency recording.
"""
from __future__ import annotations

from e2e.context import Context
from e2e.report import Report, StepFailure

TAGS: frozenset[str] = frozenset({"external_scraper", "slow"})

SEARCH_BODY = {"act_type": "codice civile", "article": "2043", "version": "vigente"}


def _expect(cond: bool, message: str, dump: dict | None = None) -> None:
    if not cond:
        raise StepFailure(message, dump)


async def run(ctx: Context, report: Report) -> None:
    cfg = ctx.cfg
    py = cfg.py_api
    c = ctx.user_a

    with report.step("POST /fetch_norma_data (capture urn_full + url_base)"):
        _, body = await c.req("POST", f"{py}/fetch_norma_data", json=SEARCH_BODY,
                              timeout=cfg.search_timeout)
        norma_list = body.get("norma_data") if isinstance(body, dict) else None
        _expect(isinstance(norma_list, list) and len(norma_list) == 1,
                "norma_data missing or not a 1-element list", {"body": body})
        norma = norma_list[0]
        _expect(str(norma.get("urn", "")).endswith("~art2043!vig="),
                "urn does not end with ~art2043!vig=", {"norma": norma})
        _expect(str(norma.get("url", "")).startswith("https://www.normattiva.it/"),
                "url (base URN) is not a normattiva URL", {"norma": norma})
        ctx.cap("urn_full", norma["urn"])
        ctx.cap("url_base", norma["url"])
        ctx.cap("norma_data_2043", norma)

    with report.step("POST /fetch_article_text (single article)"):
        _, results = await c.req("POST", f"{py}/fetch_article_text", json=SEARCH_BODY,
                                 timeout=cfg.search_timeout)
        _expect(isinstance(results, list) and len(results) == 1,
                "expected a 1-element result array", {"body": results})
        first = results[0]
        _expect("error" not in first, "scraper returned an error", {"result": first})
        _expect(isinstance(first.get("article_text"), str) and first["article_text"].strip(),
                "article_text is empty", {"result": first})

    with report.step("POST /stream_article_text (NDJSON + brocardi)"):
        lines = await c.req_ndjson(
            f"{py}/stream_article_text",
            json={**SEARCH_BODY, "show_brocardi_info": True},
            timeout=cfg.search_timeout,
        )
        line = lines[0]
        _expect("error" not in line and isinstance(line.get("article_text"), str),
                "stream line has no article_text", {"line_keys": sorted(line)})
        if "brocardi_info" in line:
            report.note("brocardi_info present in stream line")
        elif "brocardi_error" in line:
            report.note(f"brocardi_error (external site hiccup): {line['brocardi_error']}")
        else:
            raise StepFailure("stream line carries neither brocardi_info nor brocardi_error",
                              {"line_keys": sorted(line)})

    with report.step("POST /fetch_tree (base URN, count + metadata.annexes)"):
        _, tree = await c.req(
            "POST", f"{py}/fetch_tree",
            json={"urn": ctx.get("url_base"), "link": False,
                  "details": False, "return_metadata": True},
            timeout=cfg.search_timeout,
        )
        _expect(isinstance(tree.get("count"), int) and tree["count"] > 0,
                "tree count is not > 0", {"tree_keys": sorted(tree)})
        annexes = (tree.get("metadata") or {}).get("annexes")
        _expect(isinstance(annexes, list) and len(annexes) > 0,
                "metadata.annexes missing or empty", {"metadata": tree.get("metadata")})

    with report.step("GET /history (implicit write from fetch_article_text)"):
        _, hist = await c.req("GET", f"{py}/history")
        entries = hist.get("history") or []
        _expect(any(e.get("article") == "2043" for e in entries),
                "no history entry with article == '2043'", {"tail": entries[-5:]})

    with report.step("POST /export_pdf (Playwright, %PDF magic)"):
        _, pdf = await c.req("POST", f"{py}/export_pdf", json={"urn": ctx.get("urn_full")},
                             timeout=cfg.pdf_timeout)
        _expect(isinstance(pdf, (bytes, bytearray)) and bytes(pdf[:4]) == b"%PDF",
                "export_pdf did not return a PDF body",
                {"body_head": repr(pdf[:32]) if isinstance(pdf, (bytes, bytearray)) else pdf})

    with report.step("negative: export_pdf rejects non-normattiva urn (400)"):
        await c.req("POST", f"{py}/export_pdf",
                    json={"urn": "https://eur-lex.europa.eu/eli/reg/2016/679/oj"},
                    expect=400)

    with report.step("POST /fetch_article_text multi-article '1218,1223'"):
        _, results = await c.req(
            "POST", f"{py}/fetch_article_text",
            json={"act_type": "codice civile", "article": "1218,1223"},
            timeout=cfg.search_timeout,
        )
        _expect(isinstance(results, list) and len(results) == 2,
                "expected a 2-element result array", {"body": results})
        for r in results:
            _expect("error" not in r and str(r.get("article_text", "")).strip(),
                    "multi-article result is empty or errored", {"result": r})
