"""What a Normattiva article page says about its own validity window.

The pages are third-party HTML. The tests read the captured pages in
`fixtures/normattiva/` for the facts that are on them, and build the rest in the
portal's own markup: a "Testo in vigore" block in front of a `div.bodyTesto`.
`test_normattiva_validity_live.py` repeats the main cases against the portal
(`-m live`).
"""
from datetime import date

import pytest

from visualex_api.services import normattiva_validity as validity_module
from visualex_api.services.normattiva_validity import (
    extract_validity,
    is_historical_request,
    read_validity,
    reject_future_version_date,
)
from visualex_api.tools.exceptions import ValidationError

from tests.validity_pages import page, synthetic, window


class TestWindowShapes:
    def test_a_closed_window_is_a_historical_text(self):
        v = extract_validity(
            synthetic(dal="25-12-2003", al="29-12-2007", version=7, updated="11/08/2026"), article="7",
        )
        assert v == {
            "state": "historical",
            "valid_from": "2003-12-25",
            "valid_to": "2007-12-29",
            "version_number": 7,
            "act_updated": "2026-08-11",
            "request_in_window": None,
        }

    def test_an_open_window_is_the_text_in_force(self):
        v = extract_validity(synthetic(dal="28-12-2025"), article="7")
        assert v["state"] == "current"
        assert (v["valid_from"], v["valid_to"]) == ("2025-12-28", None)

    def test_a_window_that_only_ends_is_an_article_that_did_not_exist_yet(self):
        v = extract_validity(
            synthetic(al="12-9-2014", content="<span>ARTICOLO NON ANCORA ESISTENTE O VIGENTE</span>"), article="7",
        )
        assert v["state"] == "not_yet"
        assert (v["valid_from"], v["valid_to"]) == (None, "2014-09-12")

    def test_a_window_that_only_ends_is_not_guessed_when_the_notice_is_missing(self):
        assert extract_validity(synthetic(al="12-9-2014"), article="7") is None

    def test_dates_are_day_first_and_unpadded(self):
        v = extract_validity(synthetic(dal="1-2-2003"), article="7")
        assert v["valid_from"] == "2003-02-01"

    def test_a_date_that_is_not_a_day_makes_the_whole_window_unreadable(self):
        assert extract_validity(synthetic(dal="31-2-2020"), article="7") is None

    @pytest.mark.parametrize("separator", [" ", " - ", ", ", " – "])
    def test_what_sits_between_the_two_dates_does_not_matter(self, separator):
        raw = synthetic(dal="25-12-2003").replace(
            "</div><div", f'{separator}<span>al:</span> <span>&nbsp;29-12-2007</span></div><div', 1,
        )
        v = extract_validity(raw, article="7")
        assert (v["valid_from"], v["valid_to"]) == ("2003-12-25", "2007-12-29")

    def test_a_page_without_the_block_says_nothing(self):
        raw = '<html><body><div class="bodyTesto"><h2>Art. 7</h2>testo</div></body></html>'
        assert extract_validity(raw, article="7") is None

    def test_a_block_that_states_no_window_says_nothing(self):
        assert extract_validity(synthetic(), article="7") is None

    def test_a_page_without_a_body_says_nothing(self):
        assert extract_validity(f"<html><body>{window(dal='1-1-2000')}</body></html>", article="7") is None

    @pytest.mark.parametrize("raw", ["", None, "<html></html>", "plain text"])
    def test_garbage_says_nothing(self, raw):
        assert extract_validity(raw, article="7") is None


class TestCapturedPages:
    """Whole pages the repository already holds (August 2026)."""

    def test_the_text_of_art_2043_c_c_has_been_in_force_since_1942(self):
        v = extract_validity(page("attachment.html"), article="2043")
        assert v == {
            "state": "current",
            "valid_from": "1942-04-19",
            "valid_to": None,
            "version_number": None,  # never amended: the page has no update link
            "act_updated": "2026-06-12",
            "request_in_window": None,
        }

    def test_an_amended_article_names_its_version(self):
        v = extract_validity(page("akn_comma_div.html"), article="3")
        assert (v["state"], v["valid_from"], v["version_number"]) == ("current", "2005-03-08", 2)
        assert v["act_updated"] == "2026-04-20"

    def test_a_repealed_article_is_abrogated_from_the_day_of_the_repeal(self):
        v = extract_validity(page("abrogato.html"), article="3")
        assert (v["state"], v["valid_from"], v["valid_to"], v["version_number"]) == (
            "abrogated", "2018-09-19", None, 2,
        )

    def test_a_label_with_a_suffix_is_matched(self):
        v = extract_validity(page("fallback.html"), article="6-bis")
        assert (v["state"], v["valid_from"], v["version_number"]) == ("current", "2012-11-28", 1)

    def test_the_constitution_art_3_has_been_in_force_since_1948(self):
        v = extract_validity(page("akn_just_text.html"), article="3")
        assert (v["state"], v["valid_from"]) == ("current", "1948-01-01")

    @pytest.mark.parametrize("name,article", [
        ("cp_544_abrogato_trimmed.html", "544"),
        ("cp_524_abrogato_malformed_trimmed.html", "524"),
    ])
    def test_the_trimmed_repeal_pages_are_abrogated_once_they_have_a_window(self, name, article):
        """Both shapes, the healthy one and the malformed one whose notice
        html.parser moves out of the span the text extractor reads."""
        raw = page(name).replace("<body>", "<body>" + window(dal="1-1-1996"), 1)
        v = extract_validity(raw, article=article)
        assert v["state"] == "abrogated"


class TestRecapturedPages:
    """Trimmed pages captured from the portal on 2026-10-01 (`fixtures/normattiva/README.md`).

    They assert what the portal printed, so a change in its markup shows up here first.
    """

    def test_a_middle_version_states_both_ends_of_its_window(self):
        v = extract_validity(
            page("art1284_cc_at_2007-12-29_trimmed.html"), article="1284", requested_date="2007-12-29",
        )
        assert (v["state"], v["valid_from"], v["valid_to"], v["version_number"]) == (
            "historical", "2003-12-25", "2007-12-29", 7,
        )
        assert v["request_in_window"] is True
        assert date.fromisoformat(v["act_updated"])  # the day of the consolidation, not a fact of the text

    def test_an_article_that_did_not_exist_yet_states_only_the_end(self):
        v = extract_validity(
            page("art183bis_cpc_at_2010-01-01_not_yet_trimmed.html"), article="183-bis", requested_date="2010-01-01",
        )
        assert (v["state"], v["valid_from"], v["valid_to"], v["request_in_window"]) == (
            "not_yet", None, "2014-09-12", True,
        )

    def test_a_partial_abrogation_is_not_an_abrogation(self):
        requested = "2015-01-01"
        v = extract_validity(
            page("art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html"), article="183", requested_date=requested,
        )
        assert v["state"] in ("historical", "current")
        assert v["valid_from"] <= requested <= (v["valid_to"] or "9999-12-31")
        assert v["request_in_window"] is True


class TestAbrogation:
    def test_a_partial_notice_is_not_an_abrogation(self):
        """art. 183 c.p.c. carries "COMMA ABROGATO" in the middle of other commi."""
        content = (
            '<div class="art-commi-div-akn">'
            '<div class="art-comma-div-akn"><span class="comma-num-akn">1. </span>'
            '<span class="art_text_in_comma">Il debitore paga.</span></div>'
            '<div class="art-comma-div-akn"><div class="ins-akn art_abrogato-akn">'
            "((COMMA ABROGATO DALLA L. 1 GENNAIO 2000, N. 1))</div></div>"
            "</div>"
        )
        v = extract_validity(synthetic(dal="1-1-2000", al="31-12-2005", label="Art. 183", content=content), article="183")
        assert v["state"] == "historical"

    def test_a_whole_article_notice_is_an_abrogation_even_with_a_closed_window(self):
        content = '<div class="ins-akn art_abrogato-akn">((ARTICOLO ABROGATO DALLA L. 1 GENNAIO 2000, N. 1))</div>'
        v = extract_validity(synthetic(dal="1-1-2000", al="31-12-2005", content=content), article="7")
        assert (v["state"], v["valid_to"]) == ("abrogated", "2005-12-31")


class TestTheArticleAskedFor:
    def test_a_page_for_another_article_says_nothing(self):
        """Normattiva answers 200 for a URN that names something else: the decree
        that approves the code, when the code's annex is missing."""
        assert extract_validity(synthetic(dal="1-1-1942", label="Art. 1"), article="1284") is None

    @pytest.mark.parametrize("label,article", [
        ("Art. 183 bis", "183-bis"),
        ("Art. 183-bis.", "183 bis"),
        ("Art. 6-bis", "6-bis"),
        ("Art. 25 undecies", "25-undecies"),
        ("Art. 2409 octiesdecies", "2409-octiesdecies"),
        ("Art. 270-bis.1", "270-bis.1"),
        ("Art. 314/2", "314/2"),
        ("Codice Penale-art. 524", "524"),
        ("  Art. 2043. (Risarcimento per fatto illecito).", "2043"),
    ])
    def test_the_label_may_be_spelled_the_portals_way(self, label, article):
        assert extract_validity(synthetic(dal="1-1-1942", label=label), article=article)["state"] == "current"

    def test_a_suffix_of_the_wrong_article_does_not_match(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Art. 183 ter"), article="183-bis") is None

    def test_an_unreadable_label_says_nothing_when_an_article_was_asked_for(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Premessa"), article="7") is None

    def test_without_an_article_the_label_is_not_checked(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Premessa"))["state"] == "current"


class TestRequestedDate:
    CLOSED = synthetic(dal="25-12-2003", al="29-12-2007")

    @pytest.mark.parametrize("requested,expected", [
        ("2005-06-01", True),
        ("2003-12-25", True),   # the first day is in
        ("2007-12-29", True),   # and so is the last
        ("2003-12-24", False),
        ("2007-12-30", False),
    ])
    def test_the_window_is_inclusive_at_both_ends(self, requested, expected):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is expected

    def test_without_a_date_there_is_no_verdict(self):
        assert extract_validity(self.CLOSED, article="7")["request_in_window"] is None

    @pytest.mark.parametrize("requested", ["29 dicembre 2007", " 2007-12-29 "])
    def test_the_italian_long_form_and_stray_spaces_are_understood(self, requested):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is True

    @pytest.mark.parametrize("requested", ["ieri", "2007-13-45", "", 20071229])
    def test_a_date_that_cannot_be_read_gives_no_verdict(self, requested):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is None

    def test_an_open_window_does_not_contain_a_date_before_its_start(self):
        v = extract_validity(synthetic(dal="8-3-2005"), article="7", requested_date="2000-01-01")
        assert v["request_in_window"] is False

    def test_a_not_yet_page_contains_the_days_up_to_its_end(self):
        raw = synthetic(al="12-9-2014", content="<span>NON ANCORA ESISTENTE O VIGENTE</span>")
        assert extract_validity(raw, article="7", requested_date="2010-01-01")["request_in_window"] is True
        assert extract_validity(raw, article="7", requested_date="2015-01-01")["request_in_window"] is False


class FakeCache:
    def __init__(self, entries=None, error=None):
        self.entries = entries or {}
        self.error = error
        self.asked = []

    async def get(self, key):
        self.asked.append(key)
        if self.error:
            raise self.error
        return self.entries.get(key)


URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art3!vig=2007-12-29"


class TestReadValidity:
    async def test_it_reads_the_page_the_scraper_keeps_under_the_urn(self):
        cache = FakeCache({URN: synthetic(dal="25-12-2003", al="29-12-2007")})
        v = await read_validity(cache, URN, article="7", requested_date="2005-06-01")
        assert v["state"] == "historical" and v["request_in_window"] is True
        assert cache.asked == [URN]

    async def test_a_cache_miss_is_no_validity(self):
        assert await read_validity(FakeCache(), URN, article="7") is None

    @pytest.mark.parametrize("cache,urn", [(None, URN), (FakeCache(), None), (FakeCache(), "")])
    async def test_nothing_to_ask_is_no_validity(self, cache, urn):
        assert await read_validity(cache, urn, article="7") is None

    async def test_a_backend_error_never_reaches_the_caller(self):
        assert await read_validity(FakeCache(error=RuntimeError("redis down")), URN, article="7") is None

    @pytest.mark.parametrize("stored", [b"<html></html>", 42, ["x"], ""])
    async def test_a_value_that_is_not_a_page_is_no_validity(self, stored):
        assert await read_validity(FakeCache({URN: stored}), URN, article="7") is None

    async def test_a_page_that_breaks_the_parser_never_reaches_the_caller(self, monkeypatch):
        def boom(*args, **kwargs):
            raise ValueError("unexpected markup")

        monkeypatch.setattr(validity_module, "extract_validity", boom)
        cache = FakeCache({URN: synthetic(dal="1-1-2000")})
        assert await read_validity(cache, URN, article="7") is None


class TestIsHistoricalRequest:
    @pytest.mark.parametrize("version,version_date,expected", [
        ("vigente", None, False),
        ("vigente", "", False),
        ("vigente", "   ", False),
        (None, None, False),
        ("originale", None, True),
        ("ORIGINALE", "", True),
        ("vigente", "2007-12-29", True),
        (None, "2007-12-29", True),
        ("vigente", 20071229, False),
    ])
    def test_the_request_names_a_past_text_or_it_does_not(self, version, version_date, expected):
        assert is_historical_request(version, version_date) is expected


class TestRejectFutureVersionDate:
    TODAY = date(2026, 10, 1)

    @pytest.mark.parametrize("value", [
        None, "", "2026-10-01", "2000-01-01", "1 ottobre 2026",
        "ieri", "2026-02-31", "31 febbraio 2019", 20261002,
    ])
    def test_today_the_past_and_what_the_existing_parser_judges_pass(self, value):
        reject_future_version_date(value, today=self.TODAY)

    @pytest.mark.parametrize("value", ["2026-10-02", "2999-01-01", "2 ottobre 2026", " 2026-10-02 "])
    def test_a_later_day_is_refused_with_the_reason(self, value):
        with pytest.raises(ValidationError, match="futura"):
            reject_future_version_date(value, today=self.TODAY)

    def test_without_a_stated_today_the_clock_is_used(self):
        with pytest.raises(ValidationError):
            reject_future_version_date("2999-01-01")
        reject_future_version_date("2000-01-01")

    def test_a_missing_tz_database_does_not_refuse_a_valid_date(self, monkeypatch):
        def no_tz(name):
            raise validity_module.ZoneInfoNotFoundError(name)

        monkeypatch.setattr(validity_module, "ZoneInfo", no_tz)
        reject_future_version_date("2000-01-01")
        with pytest.raises(ValidationError):
            reject_future_version_date("2999-01-01")
