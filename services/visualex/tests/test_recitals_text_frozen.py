"""A recital's text is a data contract (spec 2026-11-17 §7, root CLAUDE.md rule 23).

Highlights and notes on a recital are pinned by offset and text over its projection: the text as
`/fetch_recitals` returns it (`extract_recitals`), every `\\n` removed. Changing one character of
it, a space included, moves every anchor after it, for every user, with nothing to tell.

`fixtures/eurlex/frozen_recitals.json` stores, per fixture and recital number, the SHA-256 of the
projection's UTF-8 and its length, never the text. The rules that settled the text once (spec
§7.2) are pinned by `test_eurlex_recitals.py`; this file says that nothing moves afterwards.

The freeze binds from the pull request that first stores marks on a recital (PR 4a of
`docs/superpowers/plans/2026-11-17-eu-recitals.md`). From then a change of characters is refused,
and the golden is never re-recorded to make a test pass.
"""
import hashlib
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from visualex_api.services.eurlex_scraper import extract_recitals

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"
GOLDEN = json.loads((FIXTURES / "frozen_recitals.json").read_text(encoding="utf-8"))
SOURCES = (
    "gdpr_oj_trimmed.html",  # modern markup, recitals 1, 2, 3 and 173
    "eprivacy_oj_legacy.html",  # legacy markup, 49 recitals
    "dir_2000_31_oj_legacy_preamble_trimmed.html",  # legacy markup from CELLAR, 65 recitals
)


def projection(text: str) -> str:
    return text.replace("\n", "")


def fingerprint(text: str) -> dict:
    text = projection(text)
    return {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "length": len(text)}


def recitals_of(name: str) -> dict:
    html = (FIXTURES / name).read_text(encoding="utf-8")
    return {r["number"]: r["text"] for r in extract_recitals(BeautifulSoup(html, "html.parser"))}


def read_all() -> dict:
    return {f"{name}#{number}": fingerprint(text) for name in SOURCES for number, text in recitals_of(name).items()}


def test_every_frozen_recital_is_still_read_and_none_is_new():
    assert sorted(read_all()) == sorted(GOLDEN)


@pytest.mark.parametrize("case", sorted(GOLDEN))
def test_the_recital_text_is_unchanged(case):
    name, number = case.split("#")
    assert fingerprint(recitals_of(name)[number]) == GOLDEN[case]


def test_cellars_legacy_page_reads_as_eurlexs():
    eurlex = {n: fingerprint(t) for n, t in recitals_of("eprivacy_oj_legacy.html").items()}
    cellar = {n: fingerprint(t) for n, t in recitals_of("cellar_eprivacy_oj_legacy.html").items()}
    assert len(eurlex) == 49
    assert cellar == eurlex
