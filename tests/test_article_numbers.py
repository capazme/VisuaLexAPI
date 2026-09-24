"""The article numbers Normattiva's own index lists must be accepted end to end.

`parse_article_input` used to accept a single article only as
``^\\d+(-[a-z]+)?$``. The live trees list three more shapes, all of which the
scraper resolves once the URN tail is built — measured on 2026-09-19 over the
archive manifest: 156 numbers in 12 acts, ~875 units lost in batches of 25.

Raw tree spelling -> canonical key -> Normattiva URN tail:

- dotted sub-number: ``"270 bis.1"`` -> ``270-bis.1`` -> ``~art270bis.1``
  (c.p. 270-bis.1, 416-bis.1, 648-ter.1; c.p.c. 473-bis.1 … 473-bis.72;
  d.lgs. 231/2001 25-bis.1); ``"70.1"`` -> ``70.1`` -> ``~art70.1``
  (D.P.R. 633/1972, whose tree already spells "19-bis.1" with a hyphen).
- slash: ``"314/2"`` … ``"314/28"`` -> ``314/2`` -> ``~art314/2`` (c.c., the
  repealed adozione speciale articles).
- compound ordinal: ``"135 sex decies"`` -> ``135-sex-decies`` ->
  ``~art135sexdecies``; ``"135 vicies semel"`` -> ``135-vicies-semel``
  (cod. consumo, l. 633/1941, cod. privacy).
- compound ordinal with a bare trailing digit: ``"171 octies 1"`` (l.
  633/1941). Probed live: ``~art171octies1`` — the tail the tree link used to
  build — makes Normattiva answer **Art. 1** (the wrong-article symptom of
  gotcha 24), while ``~art171octies.1`` returns "Art. 171-octies-1". So a
  trailing digit after an ordinal IS a dotted sub-number and canonicalises
  as ``171-octies.1``, the same family as ``270-bis.1``.

Ranges keep their meaning: ``"3-5"`` is tested before the single-article
grammar, so ``"473-bis.1"`` is one article and ``"3-5"`` three.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_parser import normalize_article_key
from visualex_api.tools.text_op import parse_article_input
from visualex_api.tools.treextractor import _generate_article_url
from visualex_api.tools.urngenerator import generate_urn


def _controller():
    return NormaController.__new__(NormaController)


# The exact strings the live trees returned on 2026-09-19 (get_tree(...,
# return_metadata=True)) for c.p., c.c., c.p.c., cod. consumo, l. 633/1941,
# cod. privacy, d.lgs. 231/2001 and D.P.R. 633/1972.
LIVE_ODD_TREE = (
    [{"numero": "270 bis.1", "allegato": None},
     {"numero": "270 quinquies.3", "allegato": None},
     {"numero": "518.1", "allegato": None},
     {"numero": "314/2", "allegato": None},
     {"numero": "314/28", "allegato": None},
     {"numero": "2506.1", "allegato": None},
     {"numero": "473 bis.72", "allegato": None},
     {"numero": "135 sex decies", "allegato": None},
     {"numero": "135 vicies semel", "allegato": None},
     {"numero": "171 octies 1", "allegato": None},
     {"numero": "2 quaterdecies.1", "allegato": None},
     {"numero": "19-bis.1", "allegato": None},
     {"numero": "70.1", "allegato": None}],
    13,
    {},
)

# parse_article_input calls get_tree(normurn) with no return_metadata, which
# answers the 2-tuple (articles, count).
RANGE_TREE = (
    [{"numero": "3", "allegato": None},
     {"numero": "4", "allegato": None},
     {"numero": "4 bis", "allegato": None},
     {"numero": "5", "allegato": None},
     {"numero": "6", "allegato": None}],
    5,
)


class TestParseArticleInputAcceptsTheTreeShapes:
    """get_tree is only consulted for ranges; a single article never touches it."""

    @pytest.mark.parametrize("raw,expected", [
        # dotted sub-number, hyphen / space / bare
        ("270-bis.1", "270-bis.1"),
        ("270 bis.1", "270-bis.1"),
        ("473-bis.72", "473-bis.72"),
        ("19-bis.1", "19-bis.1"),
        ("70.1", "70.1"),
        ("518.1", "518.1"),
        # slash
        ("314/2", "314/2"),
        ("314/28", "314/28"),
        # compound ordinal
        ("135-sex-decies", "135-sex-decies"),
        ("135 sex decies", "135-sex-decies"),
        ("135 vicies semel", "135-vicies-semel"),
        ("2 septies decies", "2-septies-decies"),
        # compound ordinal with a bare trailing digit is a dotted sub-number
        ("171 octies 1", "171-octies.1"),
        ("171-octies-1", "171-octies.1"),
        ("171-octies.1", "171-octies.1"),
        # the shapes that already worked, unchanged
        ("2043", "2043"),
        ("2-bis", "2-bis"),
        ("2 bis", "2-bis"),
        ("25-quinquiesdecies", "25-quinquiesdecies"),
    ])
    async def test_single_article_is_accepted_and_canonicalised(self, raw, expected):
        tree = AsyncMock(return_value=LIVE_ODD_TREE)
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            assert await parse_article_input(raw, "urn:x") == [expected]
        tree.assert_not_awaited()

    @pytest.mark.parametrize("raw,expected", [
        ("2 BIS", "2-bis"),
        ("270 BIS.1", "270-bis.1"),
        ("135 Sex Decies", "135-sex-decies"),
    ])
    async def test_suffix_tokens_are_lower_cased(self, raw, expected):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=LIVE_ODD_TREE)):
            assert await parse_article_input(raw, "urn:x") == [expected]

    @pytest.mark.parametrize("raw", [
        "abc", "1-", "1..2", "1-bis-", "1/", "/2", "1-bis.x", "1.", ".1",
        "1-bis.1.2", "314/2/3", "1--bis", "!!!",
    ])
    async def test_garbage_is_still_rejected(self, raw):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=LIVE_ODD_TREE)):
            result = await parse_article_input(raw, "urn:x")
        assert isinstance(result, dict) and "error" in result, raw

    async def test_range_still_expands_through_the_tree(self):
        tree = AsyncMock(return_value=RANGE_TREE)
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            assert await parse_article_input("3-5", "urn:x") == ["3", "4", "4-bis", "5"]
        tree.assert_awaited_once()

    async def test_range_and_dotted_single_in_one_request(self):
        """`473-bis.1` must not be read as the range 473..bis."""
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=RANGE_TREE)):
            assert await parse_article_input("3-4, 473-bis.1, 314/2", "urn:x") == [
                "3", "4", "4-bis", "473-bis.1", "314/2",
            ]

    async def test_range_canonicalises_compound_ordinal_members(self):
        """A range built from a live tree must canonicalise every member it picks up.

        Members taken from the tree used to be appended raw ("171 octies 1"),
        bypassing `_canonicalise_article_token`, so a range request on
        L. 633/1941 built `~art171octies1` — the tail Normattiva answers with
        Art. 1, HTTP 200 (gotcha 24) — instead of `~art171octies.1`.
        """
        tree = AsyncMock(return_value=(
            [{"numero": "170", "allegato": None},
             {"numero": "171 octies 1", "allegato": None},
             {"numero": "172", "allegato": None}],
            3,
        ))
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            result = await parse_article_input("170-172", "urn:x")
        assert result == ["170", "171-octies.1", "172"]


class TestGenerateUrnTails:
    """The URN tail is what Normattiva resolves; these are the tails it accepted live."""

    def test_dotted_sub_number_in_a_codice(self):
        urn = generate_urn("codice penale", article="270-bis.1", annex="1")
        assert urn.endswith("regio.decreto:1930-10-19;1398:1~art270bis.1")

    def test_bare_dotted_number(self):
        urn = generate_urn("decreto del presidente della repubblica",
                           date="1972-10-26", act_number="633", article="70.1")
        assert urn.endswith(";633~art70.1")

    def test_slash_number(self):
        urn = generate_urn("codice civile", article="314/2", annex="2")
        assert urn.endswith("regio.decreto:1942-03-16;262:2~art314/2")

    def test_compound_ordinal_joins_every_token(self):
        """`article.split('-')` used to unpack three tokens into two names."""
        urn = generate_urn("codice del consumo", article="135-sex-decies")
        assert urn.endswith(";206~art135sexdecies")
        urn = generate_urn("codice del consumo", article="135-vicies-semel")
        assert urn.endswith(";206~art135viciessemel")

    def test_compound_ordinal_with_sub_number(self):
        urn = generate_urn("legge", date="1941-04-22", act_number="633", article="171-octies.1")
        assert urn.endswith("legge:1941-04-22;633~art171octies.1")

    def test_plain_suffix_unchanged(self):
        urn = generate_urn("codice civile", article="2-bis", annex="2")
        assert urn.endswith(";262:2~art2bis")

    def test_version_suffix_still_follows_the_article(self):
        urn = generate_urn("codice penale", article="270-bis.1", annex="1", version="vigente")
        assert urn.endswith("~art270bis.1!vig=")


class TestTreeLinkTails:
    """`_generate_article_url` builds the per-article link of `/fetch_tree`.

    It strips spaces and hyphens and lower-cases, which is right for
    "270 bis.1" -> art270bis.1 and leaves "314/2" alone — but "171 octies 1"
    became art171octies1, a tail Normattiva answers with Art. 1.
    """

    @pytest.mark.parametrize("raw,tail", [
        ("270 bis.1", "art270bis.1"),
        ("19-bis.1", "art19bis.1"),
        ("70.1", "art70.1"),
        ("314/2", "art314/2"),
        ("135 sex decies", "art135sexdecies"),
        ("135 vicies semel", "art135viciessemel"),
        ("171 octies 1", "art171octies.1"),
        ("2 bis", "art2bis"),
        ("25 Quinquiesdecies", "art25quinquiesdecies"),
    ])
    def test_tail(self, raw, tail):
        assert _generate_article_url("urn:x", raw) == f"urn:x~{tail}"

    def test_annex_and_version_survive(self):
        assert _generate_article_url("urn:x!vig=", "171 octies 1", attachment_number=1) == \
            "urn:x:1~art171octies.1!vig="


class TestNormalizeArticleKeyEquivalences:
    """The tree's raw spelling and every request spelling share one key."""

    @pytest.mark.parametrize("spellings,key", [
        (["270 bis.1", "270-bis.1", "art. 270 bis.1"], "270-bis.1"),
        (["19-bis.1", "19 bis.1"], "19-bis.1"),
        (["70.1"], "70.1"),
        (["518.1", "art. 518.1"], "518.1"),
        (["314/2"], "314/2"),
        (["135 sex decies", "135-sex-decies"], "135-sex-decies"),
        (["135 vicies semel", "135-vicies-semel"], "135-vicies-semel"),
        (["171 octies 1", "171-octies-1", "171-octies.1"], "171-octies.1"),
        (["2 quaterdecies.1", "2-quaterdecies.1"], "2-quaterdecies.1"),
    ])
    def test_every_spelling_shares_the_key(self, spellings, key):
        assert {normalize_article_key(s) for s in spellings} == {key}

    def test_plain_shapes_unchanged(self):
        assert normalize_article_key("2 bis") == "2-bis"
        assert normalize_article_key("25 undevicies") == "25-undevicies"
        assert normalize_article_key("2043") == "2043"


class TestExistenceCheckFindsTheTreeShapes:
    @pytest.mark.parametrize("article", [
        "270-bis.1", "270-quinquies.3", "518.1", "314/2", "314/28", "2506.1",
        "473-bis.72", "135-sex-decies", "135-vicies-semel", "171-octies.1",
        "171-octies-1", "2-quaterdecies.1", "19-bis.1", "70.1",
    ])
    async def test_present(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=LIVE_ODD_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.parametrize("article", ["270-bis.2", "314/29", "135-sex", "171-octies", "70.2"])
    async def test_a_near_miss_is_still_absent(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=LIVE_ODD_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is False


@pytest.mark.live
async def test_live_cp_270_bis_1_is_the_aggravanti_article():
    """One real fetch: the dotted sub-number reaches the article it names."""
    from visualex_api.services.normattiva_scraper import NormattivaScraper
    from visualex_api.tools.norma import Norma, NormaVisitata

    nv = NormaVisitata(norma=Norma(tipo_atto="codice penale"),
                       numero_articolo="270-bis.1", allegato="1")
    assert nv.urn.endswith("regio.decreto:1930-10-19;1398:1~art270bis.1")
    text, urn = await NormattivaScraper().get_document(nv)
    assert "Circostanze aggravanti" in text
    assert "270-bis.1" in text.splitlines()[0]
