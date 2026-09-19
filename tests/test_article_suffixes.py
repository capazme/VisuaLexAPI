"""The ordinal suffix table every article-number pattern reads.

Italian article numbering does not stop at "decies". The catalogue of reati
presupposto of d.lgs. 231/2001 runs 25-bis … 25-sexiesdecies and beyond, and
tests/test_article_existence.py records the spellings captured live from
Normattiva's article tree on 2026-08-26 ("281 undecies", "669 terdecies",
"452 quaterdecies", "518 duodevicies", "2409 octiesdecies", "2409 noviesdecies",
"25 undecies", "25 quinquiesdecies", "25 septiesdecies", "25 undevicies").

Every regex that reads an article number used to carry its own copy of the
alternation, all nine of them stopping at "decies", so "art. 25-terdecies" was
read as art. 25-ter — an article that exists, which is why the truncation was
invisible. The table below is now the single copy.
"""

import re

import pytest

from visualex_api.services.akn_parser import normalize_article_key
from visualex_api.tools.article_suffixes import (
    ARTICLE_ORDINAL_SUFFIXES,
    ARTICLE_SUFFIX_ALTERNATION,
)
from visualex_api.tools.text_op import parse_article_input

# The suffixes Normattiva actually returned, per tests/test_article_existence.py.
LIVE_SUFFIXES = [
    "bis", "ter", "quater", "quinquies", "sexies", "septies", "octies",
    "novies", "decies", "undecies", "terdecies", "quaterdecies",
    "quinquiesdecies", "septiesdecies", "octiesdecies", "noviesdecies",
    "duodevicies", "undevicies",
]


class TestTable:
    @pytest.mark.parametrize("suffix", LIVE_SUFFIXES)
    def test_live_spellings_are_covered(self, suffix):
        assert suffix in ARTICLE_ORDINAL_SUFFIXES

    def test_alternation_is_ordered_longest_first(self):
        """Order is load-bearing where the pattern has no closing boundary.

        In an alternation the first branch that matches wins, so "ter" listed
        before "terdecies" claims the head of the longer word and leaves
        "decies" behind.
        """
        parts = ARTICLE_SUFFIX_ALTERNATION.split("|")
        assert parts == sorted(parts, key=len, reverse=True)

    @pytest.mark.parametrize("suffix", LIVE_SUFFIXES)
    def test_alternation_matches_the_whole_suffix(self, suffix):
        m = re.match(ARTICLE_SUFFIX_ALTERNATION, suffix, re.IGNORECASE)
        assert m is not None and m.group(0) == suffix

    def test_no_duplicates(self):
        assert len(set(ARTICLE_ORDINAL_SUFFIXES)) == len(ARTICLE_ORDINAL_SUFFIXES)


class TestNormalizeArticleKey:
    """The canonical key must agree on every separator, at every length."""

    @pytest.mark.parametrize("raw,expected", [
        ("25 terdecies", "25-terdecies"),
        ("25-terdecies", "25-terdecies"),
        ("25terdecies", "25-terdecies"),
        ("art. 25 quinquiesdecies", "25-quinquiesdecies"),
        ("2409 NOVIESDECIES", "2409-noviesdecies"),
        ("25undevicies", "25-undevicies"),
    ])
    def test_canonical_form(self, raw, expected):
        assert normalize_article_key(raw) == expected


class TestParseArticleInput:
    """The backend validator reads the suffix as any alphabetic tail.

    It never enumerated the ordinals, so it had no gap to close; these guard
    against someone "tidying" it into a list like the ones this change removed.
    """

    async def test_single_long_suffix(self):
        assert await parse_article_input("25-terdecies", "urn:x") == ["25-terdecies"]

    async def test_spaced_spelling_is_normalised(self):
        assert await parse_article_input("25 quinquiesdecies", "urn:x") == ["25-quinquiesdecies"]

    async def test_list_of_long_suffixes(self):
        assert await parse_article_input("25-undecies, 25 terdecies", "urn:x") == [
            "25-undecies", "25-terdecies",
        ]
