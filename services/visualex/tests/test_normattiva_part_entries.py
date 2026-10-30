"""A part of a split article is an entry of its own (G-387 (a), G-389).

Art. 1 l. 296/2006 has 14 parts, «1 (commi 1-100)» … «1 (commi 1301-1364)», and its URN serves
the first. A part is the article plus its comma range, `parte: "701-800"`; a request names it by
that range or by a comma it holds (`comma: "773"`). The first part has no `parte` (Q1): its
request, its keys and its text are those of before (root CLAUDE.md, rule 23). A part saved before
Normattiva splits the article again is refused with today's parts, never answered with another
range (Q3). The pages are the captures in `fixtures/normattiva/` (README there).
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiohttp
import pytest
from bs4 import BeautifulSoup

from app import NormaController
from visualex_api.services import normattiva_scraper as scraper_module
from visualex_api.services.normattiva_parts import (
    article_page_key, normalize_comma, normalize_range, part_cache_key, partial_notice, range_holding,
    extract_parts,
)
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.tools.exceptions import (
    IndexUnavailableError, ParsingError, ResourceNotFoundError, ValidationError,
)
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.treextractor import _parse_normattiva_tree
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS, FakeCache, ask, brocardi, controller, _no_history_writes,
)
from tests.validity_pages import page

L296_TREE = page("l296_2006_art1_parts_tree_trimmed.html")
DLGS23_TREE = page("dlgs23_2015_tree_trimmed.html")
PART_8 = page("l296_2006_art1_part_701-800_trimmed.html")
ACT = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2006-12-27;296"
ARTICLE = ACT + "~art1"
PART_8_KEY = ARTICLE + "#commi701-800"
RANGES = [f"{100 * (k - 1) + 1}-{1364 if k == 14 else 100 * k}" for k in range(1, 15)]


def tree_of(raw, url=ACT):
    return asyncio.run(_parse_normattiva_tree(BeautifulSoup(raw, "html.parser"), url, False, False, True))


# Parsed once, outside any running loop: the request tests run in one.
L296_PARSED = tree_of(L296_TREE)
WHOLE_ART_1 = DLGS23_TREE.replace('numero_articolo">3', 'numero_articolo">1')
WHOLE_ART_1_PARSED = tree_of(WHOLE_ART_1)


def l296(parte=None, data_versione=None):
    norma = Norma(tipo_atto="legge", data="2006-12-27", numero_atto="296")
    return NormaVisitata(norma=norma, numero_articolo="1", data_versione=data_versione, parte=parte)


class TestTheTree:
    """`/fetch_tree` listed the 14 parts as 14 «articles» numbered «1 (commi 101-200)»."""

    def test_one_article_with_its_parts(self):
        entries, count, metadata = tree_of(L296_TREE)
        parts = [e for e in entries if e["numero"] == "1"]
        assert [e["commi"] for e in parts] == RANGES
        assert [e["parte"] for e in parts] == [None] + RANGES[1:]
        assert parts[7]["label"] == "1 (commi 701-800)"
        assert count == 1 and metadata["annexes"][0]["article_numbers"] == ["1"]

    def test_an_earlier_version_s_parts_stay_out(self):
        entries, _, _ = tree_of(L296_TREE)
        assert {e["numero"] for e in entries} == {"1"}

    def test_a_part_links_to_its_article(self):
        entries, _, _ = asyncio.run(_parse_normattiva_tree(
            BeautifulSoup(L296_TREE, "html.parser"), ACT, True, False, True))
        assert {e["url"] for e in entries} == {ARTICLE}

    def test_a_whole_article_has_no_part_keys(self):
        entries, _, _ = tree_of(DLGS23_TREE)
        assert entries and all("parte" not in e and "commi" not in e for e in entries)


class TestNaming:
    def test_a_range_and_a_comma_as_a_request_writes_them(self):
        assert normalize_range(" 701 - 800 ") == "701-800"
        assert normalize_range("701") is None and normalize_range(701) is None and normalize_range("x-y") is None
        assert normalize_comma("773") == "773" and normalize_comma(773) == "773" and normalize_comma("4 Bis") == "4 bis"
        assert normalize_comma(True) is None and normalize_comma("lett. a") is None and normalize_comma("1" * 9) is None

    def test_the_range_holding_a_comma_by_its_number(self):
        assert range_holding(RANGES, "773") == "701-800"
        assert range_holding(RANGES, "773-bis") == "701-800"
        assert range_holding(RANGES, "1364") == "1301-1364"
        assert range_holding(RANGES, "1365") is None

    def test_a_part_s_key_and_its_article_page(self):
        assert part_cache_key(ARTICLE, "701-800") == PART_8_KEY
        assert article_page_key(PART_8_KEY) == ARTICLE and article_page_key(ARTICLE) == ARTICLE

    def test_the_notice_names_the_part_served(self):
        parts = extract_parts(L296_TREE, article="1")
        assert partial_notice(parts) == "testo parziale: commi 1-100 di 1364 (diviso in 14 parti)"
        assert partial_notice(parts, "701-800") == "testo parziale: commi 701-800 di 1364 (diviso in 14 parti)"


class TestTheNorm:
    def test_the_first_part_s_norm_is_the_article_s(self):
        nv = l296()
        assert "parte" not in nv.to_dict() and str(nv).endswith("art. 1")

    def test_a_part_is_another_norm_on_the_same_urn(self):
        nv = l296("701-800")
        assert nv.urn == l296().urn and nv.to_dict()["parte"] == "701-800"
        assert nv != l296() and hash(nv) != hash(l296()) and nv == l296("701-800")
        assert str(nv).endswith("art. 1 (commi 701-800)")
        assert NormaVisitata.from_dict(nv.to_dict()).parte == "701-800"
        # The scraper's memory keys a call by the norm's repr: a part never reads part 1's text.
        assert repr(nv) != repr(l296())


async def _asked(body, tree=L296_PARSED):
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=tree)):
        return await ctrl.create_norma_visitata_from_data(
            {"act_type": "legge", "date": "2006-12-27", "act_number": "296", "article": "1", **body})


class TestTheRequest:
    async def test_a_part_by_its_range(self):
        [nv] = await _asked({"parte": "701-800"})
        assert nv.parte == "701-800" and nv.urn.endswith(";296~art1")

    async def test_a_part_by_a_comma_it_holds(self):
        [nv] = await _asked({"comma": "773"})
        assert nv.parte == "701-800"

    @pytest.mark.parametrize("body", [{}, {"comma": "42"}, {"parte": "1-100"}])
    async def test_the_first_part_is_the_article_as_before(self, body):
        [nv] = await _asked(body)
        assert nv.parte is None and "parte" not in nv.to_dict()

    async def test_a_comma_past_the_last_range(self):
        with pytest.raises(ResourceNotFoundError, match=r"Il comma 1400 non è nell'art\. 1 di .*\(commi 1-1364\)"):
            await _asked({"comma": "1400"})

    async def test_a_range_the_tree_does_not_list(self):
        with pytest.raises(ResourceNotFoundError, match=r"non ha la parte commi 701-799: è diviso in commi 1-100, "):
            await _asked({"parte": "701-799"})

    async def test_a_range_of_an_article_listed_whole(self):
        with pytest.raises(ResourceNotFoundError, match=r"L'art\. 1 di .* non è diviso in parti"):
            await _asked({"parte": "1-2"}, tree=WHOLE_ART_1_PARSED)

    async def test_a_comma_of_a_whole_article_is_in_it(self):
        [nv] = await _asked({"comma": "2"}, tree=WHOLE_ART_1_PARSED)
        assert nv.parte is None

    async def test_an_unreadable_tree_never_says_it_does_not_exist(self):
        """A comma: a 503 in words, never the first part as if it held it. A range: left to the
        reader. Neither: the article, failing open as before (gotcha 24)."""
        ctrl = NormaController.__new__(NormaController)
        body = {"act_type": "legge", "date": "2006-12-27", "act_number": "296", "article": "1"}
        with patch("app.get_tree", new=AsyncMock(return_value=("Empty response from server", 0, {}))), \
                patch("app.fetch_act_index", new=AsyncMock(return_value=None)):
            with pytest.raises(IndexUnavailableError, match=r"per trovare il comma 773"):
                await ctrl.create_norma_visitata_from_data({**body, "comma": "773"})
            [by_part] = await ctrl.create_norma_visitata_from_data({**body, "parte": "701-800"})
            [plain] = await ctrl.create_norma_visitata_from_data(body)
        assert by_part.parte == "701-800" and plain.parte is None

    async def test_a_comma_with_an_unreadable_tree_is_a_503_on_the_routes(self):
        ctrl = NormaController()
        body = {"act_type": "legge", "date": "2006-12-27", "act_number": "296", "article": "1", "comma": "773"}
        with patch("app.get_tree", new=AsyncMock(return_value=("Empty response from server", 0, {}))), \
                patch("app.fetch_act_index", new=AsyncMock(return_value=None)), patch("app.add_to_history"):
            for route in ("/fetch_norma_data", "/fetch_article_text", "/fetch_all_data", "/stream_article_text"):
                response = await ctrl.app.test_client().post(route, json=body)
                assert response.status_code == 503, route
                assert "per trovare il comma 773" in (await response.get_json())["error"], route

    @pytest.mark.parametrize("body,words", [
        ({"parte": "701-800", "comma": "773"}, "non entrambi"),
        ({"parte": "settecento"}, "Parte non valida"),
        ({"comma": "lett. a"}, "Comma non valido"),
        ({"comma": "773", "article": "1,3"}, "un solo articolo"),
    ])
    async def test_refused(self, body, words):
        with pytest.raises(ValidationError, match=words):
            await _asked(body)

    async def test_an_eu_article_has_no_parts(self):
        ctrl = NormaController.__new__(NormaController)
        eu = {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "6"}
        with patch("app.get_tree", new=AsyncMock(return_value=([{"numero": "6", "allegato": None}], 1, {}))):
            [nv] = await ctrl.create_norma_visitata_from_data({**eu, "comma": "1"})
            assert nv.parte is None
            with pytest.raises(ValidationError, match="solo per i testi di Normattiva"):
                await ctrl.create_norma_visitata_from_data({**eu, "parte": "1-2"})


class DictCache:
    def __init__(self, entries=None):
        self.entries = dict(entries or {})

    async def get(self, key):
        return self.entries.get(key)

    async def set(self, key, value):
        self.entries[key] = value


class FakeNormattiva:
    """The shared client's `request`: the article page, then the part's, as the session reads them."""

    def __init__(self, article_page=L296_TREE, part_page=PART_8):
        self.pages = {"article": article_page, "part": part_page}
        self.calls = []

    async def request(self, method, url, *, source, session=None, **_):
        self.calls.append((url, session))
        kind = "part" if "caricaArticolo" in url else "article"
        return SimpleNamespace(text=self.pages[kind])


def bare_scraper(cache=None):
    scraper = NormattivaScraper.__new__(NormattivaScraper)  # no __init__: no persistent cache
    from visualex_api.tools.selectors import NormattivaSelectors
    scraper.selectors = NormattivaSelectors()
    scraper.cache = cache if cache is not None else DictCache()
    return scraper


async def _read(nv, client, cache=None):
    scraper = bare_scraper(cache)
    with patch.object(scraper_module, "http_client", client):
        text, key = await NormattivaScraper.get_document.__wrapped__(scraper, nv)
    return scraper, text, key


class TestReadingAPart:
    async def test_the_part_s_text_and_key(self):
        client = FakeNormattiva()
        scraper, text, key = await _read(l296("701-800"), client)
        assert text.startswith("Art. 1\n\n701. Il primo periodo del comma 150") and "\n\n703. " in text
        assert key == PART_8_KEY
        assert scraper.cache.entries[PART_8_KEY] == PART_8
        assert scraper.cache.entries[ARTICLE] == L296_TREE

    async def test_the_extractor_s_text_untouched(self):
        """Rule 23: the same extractor on the part's page, nothing added or dropped."""
        scraper = bare_scraper()
        _, text, _ = await _read(l296("701-800"), FakeNormattiva())
        assert text == await scraper.estrai_da_html(PART_8)

    async def test_both_pages_in_one_session_of_their_own(self):
        client = FakeNormattiva()
        await _read(l296("701-800"), client)
        [(article_url, first), (part_url, second)] = client.calls
        assert article_url == ARTICLE
        assert part_url.startswith("https://www.normattiva.it/atto/caricaArticolo?") and "art.progressivo=8" in part_url
        assert isinstance(first, aiohttp.ClientSession) and first is second and first.closed
        other = FakeNormattiva()
        await _read(l296("701-800"), other)
        assert other.calls[0][1] is not first

    async def test_a_kept_part_costs_no_request(self):
        client = FakeNormattiva()
        _, text, key = await _read(l296("701-800"), client, DictCache({PART_8_KEY: PART_8}))
        assert client.calls == [] and key == PART_8_KEY and text.startswith("Art. 1\n\n701. ")

    async def test_a_kept_article_page_is_not_overwritten(self):
        cache = DictCache({ARTICLE: L296_TREE + "<!-- kept -->"})
        await _read(l296("701-800"), FakeNormattiva(), cache)
        assert cache.entries[ARTICLE].endswith("<!-- kept -->")

    async def test_a_part_split_again_is_refused_with_today_s_parts(self):
        with pytest.raises(ResourceNotFoundError, match=r"non ha la parte commi 701-750: oggi è diviso in commi 1-100, .* e 1301-1364"):
            await _read(l296("701-750"), FakeNormattiva())

    async def test_the_first_part_is_never_read_as_a_part(self):
        """Q1: «1-100» is the article itself; asked as a part (a tree the request could not read),
        it is refused, never kept under a second key."""
        cache = DictCache()
        with pytest.raises(ResourceNotFoundError, match="va chiesto senza parte"):
            await _read(l296("1-100"), FakeNormattiva(), cache)
        assert not any("#commi" in key for key in cache.entries)

    async def test_a_new_part_is_parsed_once(self):
        scraper = bare_scraper()
        calls = []
        real = NormattivaScraper.estrai_da_html

        async def counted(self, page, *args, **kwargs):
            calls.append(1)
            return await real(self, page, *args, **kwargs)

        with patch.object(NormattivaScraper, "estrai_da_html", counted), \
                patch.object(scraper_module, "http_client", FakeNormattiva()):
            await NormattivaScraper.get_document.__wrapped__(scraper, l296("701-800"))
        assert len(calls) == 1

    async def test_an_article_no_longer_split(self):
        with pytest.raises(ResourceNotFoundError, match="non è diviso in parti"):
            await _read(l296("701-800"), FakeNormattiva(article_page=WHOLE_ART_1))

    async def test_a_page_with_no_tree(self):
        with pytest.raises(IndexUnavailableError):
            await _read(l296("701-800"), FakeNormattiva(article_page="<html><body>no tree</body></html>"))

    async def test_another_part_s_page_is_never_kept(self):
        """Normattiva answered with part 9: never stored, never served as part 8."""
        cache = DictCache()
        client = FakeNormattiva(part_page=PART_8.replace("701. ", "801. ").replace("702. ", "802. ").replace("703. ", "803. "))
        with pytest.raises(ParsingError):
            await _read(l296("701-800"), client, cache)
        assert PART_8_KEY not in cache.entries

    async def test_never_the_akn_export(self):
        with patch.object(scraper_module, "fetch_act_article", AsyncMock(side_effect=AssertionError("AKN"))), \
                pytest.raises(ParsingError):
            await _read(l296("701-800"), FakeNormattiva(part_page="<html>nothing</html>"))


class TestOnTheWire:
    def _serving(self, cache_entries):
        scraper = bare_scraper(DictCache(cache_entries))
        async def document(nv):
            return ("PART TEXT", PART_8_KEY) if nv.parte else ("TEXT", ARTICLE)

        scraper.get_document = AsyncMock(side_effect=document)
        return scraper

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_part_says_where_it_is(self, controller, brocardi, endpoint):
        scraper = self._serving({PART_8_KEY: PART_8, ARTICLE: L296_TREE})
        [result] = await ask(controller, endpoint, [l296("701-800")], scraper=scraper)
        assert result["article_text"] == "PART TEXT" and result["url"] == PART_8_KEY
        assert result["norma_data"]["parte"] == "701-800"
        assert result["testo_parziale"] is True and len(result["parti"]) == 14
        assert result["note_aggiornamento"] == [] and result["note_non_lette"] is False

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_part_is_partial_when_the_article_page_has_left_the_cache(self, controller, brocardi, endpoint):
        scraper = self._serving({PART_8_KEY: PART_8})
        [result] = await ask(controller, endpoint, [l296("701-800")], scraper=scraper)
        assert result["parti"] is None and result["testo_parziale"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_first_part_answers_as_before(self, controller, brocardi, endpoint):
        scraper = self._serving({ARTICLE: L296_TREE})
        [result] = await ask(controller, endpoint, [l296()], scraper=scraper)
        assert result["article_text"] == "TEXT" and result["url"] == ARTICLE
        assert "parte" not in result["norma_data"] and result["testo_parziale"] is True

    async def test_a_part_s_page_gone_after_a_restart_is_read_again_in_its_session(self):
        scraper = bare_scraper(DictCache())
        scraper.read_part_page = AsyncMock(return_value=PART_8)
        nv = l296("701-800")
        assert await NormaController._page_left_the_cache(scraper, PART_8_KEY, nv) is True
        scraper.read_part_page.assert_awaited_once_with(nv)
        scraper.request_document = AsyncMock(side_effect=AssertionError("a part's key is no address"))
        assert await NormaController._page_left_the_cache(scraper, PART_8_KEY, None) is False

    async def test_today_s_part_page_is_read_again_for_today(self):
        """The page of today's text, gone after a restart, is read again for today's request."""
        ctrl = NormaController.__new__(NormaController)
        today_key = PART_8_KEY.replace("#", "!vig=2026-10-30#")
        scraper = bare_scraper(DictCache())
        scraper.get_document = AsyncMock(return_value=("PART TEXT", today_key))
        scraper.read_part_page = AsyncMock(return_value=None)
        await ctrl._text_today(scraper, l296("701-800"))
        [asked] = scraper.read_part_page.await_args.args
        assert asked.parte == "701-800" and asked.versione == "vigente" and asked.data_versione

    async def test_the_text_in_force_today_keeps_the_part(self):
        ctrl = NormaController.__new__(NormaController)
        scraper = SimpleNamespace(get_document=AsyncMock(side_effect=RuntimeError("stop")))
        await ctrl._text_today(scraper, l296("701-800"))
        [today] = scraper.get_document.await_args.args
        assert today.parte == "701-800" and today.versione == "vigente" and today.data_versione


class TestTheConvention:
    """`conventions/sources/golden.json`: a part is the article plus `identity.part`."""

    @staticmethod
    def _parts():
        from tests.test_sources_golden import GOLDEN
        return [c for c in GOLDEN["norms"] if "part" in c["identity"]]

    def test_the_part_is_the_norm_s_parte(self):
        cases = self._parts()
        assert len(cases) == 2
        for case in cases:
            nv = NormaVisitata.from_dict(case["input"])
            assert nv.to_dict().get("parte") == case["identity"]["part"]["value"], case["id"]
            assert nv.urn == case["identity"]["article"]["value"], case["id"]

    @pytest.mark.parametrize("label,params", [
        ("art. 1, commi 701-800, l. 27 dicembre 2006, n. 296", {"date": "2006-12-27", "parte": "701-800"}),
        ("art. 1 (commi 701-800) l. 296/2006", {"date": "2006", "parte": "701-800"}),
        ("art. 1, comma 773, l. 296/2006", {"date": "2006", "comma": "773"}),
        ("art. 1 co. 773 l. 296/2006", {"date": "2006", "comma": "773"}),
    ])
    def test_a_part_or_a_comma_reads_back(self, label, params):
        from visualex_api.tools.nl_parser import parse_nl_query
        assert parse_nl_query(label).to_api_params() == {
            "act_type": "legge", "act_number": "296", "article": "1", **params}

    @pytest.mark.parametrize("label,comma", [
        ("art. 3 co. 4-bis l. 241/1990", "4-bis"),
        ("art. 3, comma 2, lett. a), l. 241/1990", "2"),
        ("art. 3, commi 1 e 2, l. 241/1990", None),          # a list: no one part
        ("art. 3, primo comma, l. 241/1990", None),          # an ordinal: not sent on
        ("art. 3, n. 2, l. 241/1990", None),
    ])
    def test_only_a_single_numbered_comma_is_sent_on(self, label, comma):
        from visualex_api.tools.nl_parser import parse_nl_query
        params = parse_nl_query(label).to_api_params()
        assert (params["article"], params.get("act_number"), params.get("comma")) == ("3", "241", comma)

    @pytest.mark.parametrize("label", ["artt. 1, 2, comma 3 l. 241/1990", "art. 1-3, comma 2 l. 241/1990"])
    def test_a_comma_after_several_articles_names_none(self, label):
        from visualex_api.tools.nl_parser import parse_nl_query
        params = parse_nl_query(label).to_api_params()
        assert "comma" not in params and "parte" not in params

    def test_the_citation_of_a_part(self):
        from visualex_api.tools.sources import cite_article
        norm = {"tipo_atto": "legge", "numero_atto": "296", "data": "2006-12-27", "numero_articolo": "1"}
        assert cite_article({**norm, "parte": "701-800"}) == "art. 1, commi 701-800, l. 27 dicembre 2006, n. 296"
        assert cite_article(norm) == "art. 1, l. 27 dicembre 2006, n. 296"


class TestTheFirstPartIsUntouched:
    """Spec §8: a request with no `parte` is today's code path, byte for byte."""

    async def test_no_part_reads_the_urn_s_page_with_the_same_extractor(self):
        article_page = page("dlgs23_2015_art3_update_notes_trimmed.html")
        nv = NormaVisitata(norma=Norma(tipo_atto="decreto legislativo", data="2015-03-04", numero_atto="23"),
                           numero_articolo="3")
        scraper = bare_scraper(DictCache({nv.urn: article_page}))
        with patch.object(NormattivaScraper, "_get_part", AsyncMock(side_effect=AssertionError("a part"))):
            text, url = await NormattivaScraper.get_document.__wrapped__(scraper, nv)
        assert url == nv.urn and "#" not in url
        assert text == await scraper.estrai_da_html(article_page)
        assert "parte" not in nv.to_dict()
