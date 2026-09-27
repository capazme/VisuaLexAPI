"""Asking for an article that does not exist must not return a different one.

Measured on live Normattiva before this change: c.c. art. 99999, art. 7000 and
art. 2-bis all returned 592 characters of "Art. 1 — È approvato il testo del
Codice civile", with no error and no warning.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController


def _controller():
    # Same trick the existing suite uses: skip __init__ so no Quart app, no
    # routes and no scrapers are built.
    return NormaController.__new__(NormaController)


TREE = (
    [{"numero": "1", "allegato": None},
     {"numero": "2", "allegato": None},
     {"numero": "2-bis", "allegato": None},
     {"numero": "3", "allegato": None}],
    4,
    {},
)

# Captured from live Normattiva on 2026-08-26 with
# get_tree(..., return_metadata=True): the tree spells every suffix with a
# SPACE and goes far past "decies". These are the exact strings returned for
# c.p.c., c.p., c.c. and d.lgs. 231/2001.
REAL_SUFFIX_TREE = (
    [{"numero": "281 undecies", "allegato": None},
     {"numero": "669 terdecies", "allegato": None},
     {"numero": "452 quaterdecies", "allegato": None},
     {"numero": "518 duodevicies", "allegato": None},
     {"numero": "2409 octiesdecies", "allegato": None},
     {"numero": "2409 noviesdecies", "allegato": None},
     {"numero": "25 undecies", "allegato": None},
     {"numero": "25 quinquiesdecies", "allegato": None},
     {"numero": "25 septiesdecies", "allegato": None},
     {"numero": "25 undevicies", "allegato": None},
     {"numero": "25 bis.1", "allegato": None},
     {"numero": "2409 duodecies.1", "allegato": None}],
    12,
    {},
)


class TestExistenceCheck:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["1", "2-bis", "3"])
    async def test_existing_articles_pass(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["99999", "7000", "4"])
    async def test_missing_articles_are_reported(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is False

    @pytest.mark.asyncio
    async def test_bis_spelling_variants_match(self):
        """The tree API and the scraper disagree on "2-bis" vs "2 bis"."""
        ctrl = _controller()
        spaced = ([{"numero": "2 bis", "allegato": None}], 1, {})
        with patch("app.get_tree", new=AsyncMock(return_value=spaced)):
            assert await ctrl._article_exists_in_tree("https://x", "2-bis", None) is True


class TestSuffixesBeyondDecies:
    """The normaliser must not enumerate suffixes.

    A hand-maintained list that stopped at "decies" rejected 50 real articles
    across the four main codici alone — art. 669-terdecies c.p.c. (reclamo
    cautelare), art. 452-quaterdecies c.p., art. 281-undecies c.p.c., art.
    2409-octiesdecies c.c. — plus the whole 25-undecies..25-undevicies family
    of d.lgs. 231/2001, all of which the scraper returned correctly before the
    existence check existed. A false "non esiste" on an article that exists is
    worse than the wrong-article bug this check was added to fix.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", [
        "281-undecies",
        "669-terdecies",
        "452-quaterdecies",
        "518-duodevicies",
        "2409-octiesdecies",
        "2409-noviesdecies",
        "25-undecies",
        "25-quinquiesdecies",
        "25-septiesdecies",
        "25-undevicies",
    ])
    async def test_hyphenated_request_matches_the_spaced_tree_spelling(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=REAL_SUFFIX_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["25 undecies", "669 terdecies"])
    async def test_spaced_request_matches_too(self, article):
        """Both sides are canonicalised, so the request spelling is free."""
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=REAL_SUFFIX_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["25-bis.1", "2409-duodecies.1"])
    async def test_sub_numbered_family_is_pinned_deliberately(self, article):
        """"25 bis.1" is a real tree entry. It is currently unreachable through
        parse_article_input, but the normaliser resolves it, so a later change
        to the input parser does not have to touch this rule."""
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=REAL_SUFFIX_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    async def test_a_genuinely_absent_suffixed_article_is_still_reported(self):
        """Suffix-agnostic must not mean "matches anything"."""
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=REAL_SUFFIX_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", "25-vicies", None) is False
            assert await ctrl._article_exists_in_tree("https://x", "670-terdecies", None) is False


class TestFailOpen:
    """A Normattiva outage must not become "this article does not exist"."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tree_result", [
        ("Failed to retrieve the page: boom", 0, {}),
        ("Empty response from server", 0, {}),
        ([], 0, {}),
    ])
    async def test_unavailable_tree_returns_none(self, tree_result):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=tree_result)):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None

    @pytest.mark.asyncio
    async def test_exception_returns_none(self):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(side_effect=RuntimeError("down"))):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None


class TestRequestValidation:
    @pytest.mark.asyncio
    async def test_missing_act_type_is_rejected(self):
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data({"article": "1"})

    @pytest.mark.asyncio
    async def test_missing_article_is_rejected(self):
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data({"act_type": "legge"})

    @pytest.mark.asyncio
    async def test_malformed_article_is_rejected_not_scraped(self):
        """parse_article_input returns an ERROR DICT rather than raising; the
        root controller never checked it, so `for article in articles` iterated
        the dict's keys and produced a URN ending in ~arterror."""
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data(
                {"act_type": "legge", "date": "1990-08-07",
                 "act_number": "241", "article": "!!!"}
            )


class TestCachedTreeShape:
    """get_tree is wrapped in @cached(serializer=JsonSerializer()).

    The serializer round-trips the (articles, count, metadata) TUPLE through
    JSON, so every call after the first one in a process returns a LIST. A
    check that only unpacks tuples reads the 3-element envelope as the article
    list and reports every article of every cached act as missing — measured
    live on L. 241/1990 art. 3 before this guard was widened.
    """

    CACHED_TREE = [
        [{"numero": "1", "allegato": None},
         {"numero": "2 bis", "allegato": None},
         {"numero": "3", "allegato": None},
         {"numero": "25 undecies", "allegato": None},
         {"numero": "669 terdecies", "allegato": None},
         {"numero": "2409 octiesdecies", "allegato": None}],
        6,
        {},
    ]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", [
        "1", "2-bis", "3", "25-undecies", "669-terdecies", "2409-octiesdecies",
    ])
    async def test_existing_articles_pass_on_a_cache_hit(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=self.CACHED_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    async def test_missing_article_still_reported_on_a_cache_hit(self):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=self.CACHED_TREE)):
            assert await ctrl._article_exists_in_tree("https://x", "99999", None) is False


class TestAnnexScoping:
    @pytest.mark.asyncio
    async def test_article_is_matched_within_the_requested_annex(self):
        """Codici carry a default annex; an article of the dispositivo must not
        satisfy a request scoped to allegato 2."""
        ctrl = _controller()
        tree = (
            [{"numero": "1", "allegato": None},
             {"numero": "2043", "allegato": 2}],
            2,
            {},
        )
        with patch("app.get_tree", new=AsyncMock(return_value=tree)):
            assert await ctrl._article_exists_in_tree("https://x", "2043", "2") is True
            assert await ctrl._article_exists_in_tree("https://x", "1", "2") is False


@pytest.fixture(scope="module")
def client():
    """A real Quart app with the real routes.

    No scraper is reached: every test using it fails before the fan-out.
    """
    return NormaController().app.test_client()


class TestHttpStatusAndBody:
    """The two new exceptions must reach the client as a status it can branch
    on and a body it can read.

    Before this, every failure of the root controller was a 500 with the
    message in a JSON body — and on /stream_article_text, the endpoint the
    search box actually calls, nothing caught them at all, so Quart answered
    with a 500 HTML error page carrying no message whatsoever.
    """

    @pytest.fixture(autouse=True)
    def _no_history_writes(self):
        with patch("app.add_to_history"):
            yield

    @pytest.mark.asyncio
    @pytest.mark.parametrize("endpoint", [
        "/fetch_norma_data",
        "/fetch_article_text",
        "/fetch_brocardi_info",
        "/fetch_all_data",
        "/stream_article_text",
    ])
    async def test_missing_act_type_is_a_400_with_a_message(self, client, endpoint):
        response = await client.post(endpoint, json={"article": "1"})
        assert response.status_code == 400
        assert "act_type" in (await response.get_json())["error"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("endpoint", [
        "/fetch_norma_data",
        "/fetch_article_text",
        "/fetch_brocardi_info",
        "/fetch_all_data",
        "/stream_article_text",
    ])
    async def test_absent_article_is_a_404_with_a_message(self, client, endpoint):
        from visualex_api.tools.exceptions import ResourceNotFoundError

        boom = AsyncMock(side_effect=ResourceNotFoundError(
            "Articolo 669-terdecies non presente in codice di procedura civile"
        ))
        with patch.object(NormaController, "create_norma_visitata_from_data", boom):
            response = await client.post(endpoint, json={
                "act_type": "codice di procedura civile", "article": "669-terdecies",
            })
        assert response.status_code == 404
        assert "non presente" in (await response.get_json())["error"]

    @pytest.mark.asyncio
    async def test_a_scraper_failure_is_still_a_500(self, client):
        """Only the documented client-side errors are remapped."""
        boom = AsyncMock(side_effect=RuntimeError("Normattiva is down"))
        with patch.object(NormaController, "create_norma_visitata_from_data", boom):
            response = await client.post("/fetch_article_text", json={
                "act_type": "legge", "article": "1",
            })
        assert response.status_code == 500
        assert "Normattiva is down" in (await response.get_json())["error"]
