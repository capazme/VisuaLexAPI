"""EU article text is a data contract (root CLAUDE.md rule 23; spec 2026-11-17 §7.3).

Highlights and notes on EU articles are stored already, pinned by offset and text over the
article's projection (`article_text` with every `\\n` removed). Until this file nothing noticed
an extractor change that moved them. It reads every article of the Official Journal fixtures
through `EurlexScraper.extract_article_text`, as the reader does, and compares each projection
with `fixtures/eurlex/frozen_eu_articles.json`: the SHA-256 of its UTF-8 and its length, never the
text.

The freeze binds now. A change of characters is refused, and the golden is never re-recorded to
make a test pass.
"""
import hashlib
import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.treextractor import _parse_eurlex_tree

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"
GOLDEN = json.loads((FIXTURES / "frozen_eu_articles.json").read_text(encoding="utf-8"))
# The page and the URL the app holds for it.
SOURCES = {
    "gdpr_oj_trimmed.html": "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
    "eprivacy_oj_legacy.html": "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita",
}


def projection(text: str) -> str:
    return text.replace("\n", "")


def fingerprint(text: str) -> dict:
    text = projection(text)
    return {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "length": len(text)}


def soup_of(name: str) -> BeautifulSoup:
    return BeautifulSoup((FIXTURES / name).read_text(encoding="utf-8"), "html.parser")


async def articles_of(name: str) -> list[str]:
    tree, _count, _metadata = await _parse_eurlex_tree(soup_of(name), SOURCES[name], link=True, details=False)
    return [item["numero"] for item in tree]


async def read_all() -> dict:
    scraper = EurlexScraper()
    out = {}
    for name in SOURCES:
        for number in await articles_of(name):
            out[f"{name}#art{number}"] = fingerprint(await scraper.extract_article_text(soup_of(name), number))
    return out


async def test_every_frozen_article_is_still_read_and_none_is_new():
    assert sorted(await read_all()) == sorted(GOLDEN)


@pytest.mark.parametrize("case", sorted(GOLDEN))
async def test_the_article_text_is_unchanged(case):
    name, article = case.split("#art")
    text = await EurlexScraper().extract_article_text(soup_of(name), article)
    assert fingerprint(text) == GOLDEN[case]
