"""Tests for natural language input parser — 30+ input variations."""

import pytest
from visualex_api.tools.nl_parser import parse_nl_query, ParsedQuery, resolve_eu_year_and_number


class TestArticlePatterns:
    """AC: "art." / "articolo" / "artt." interchangeable."""

    def test_art_dot(self):
        r = parse_nl_query("art. 2043 cc")
        assert r.article == "2043"
        assert r.act_type == "codice civile"

    def test_articolo(self):
        r = parse_nl_query("articolo 3 codice civile")
        assert r.article == "3"
        assert r.act_type == "codice civile"

    def test_artt(self):
        r = parse_nl_query("artt. 1,2,3 cc")
        assert "1" in r.article
        assert r.act_type == "codice civile"

    def test_art_no_dot(self):
        r = parse_nl_query("art 2043 cc")
        assert r.article == "2043"
        assert r.act_type == "codice civile"

    def test_article_with_bis_suffix(self):
        r = parse_nl_query("art. 2-bis cp")
        assert r.article == "2-bis"
        assert r.act_type == "codice penale"

    def test_article_with_spaced_bis(self):
        r = parse_nl_query("art. 2 bis cc")
        assert r.article == "2-bis"

    def test_article_ter(self):
        r = parse_nl_query("art. 5-ter cpc")
        assert r.article == "5-ter"
        assert r.act_type == "codice di procedura civile"


class TestCommonAbbreviations:
    """AC: Common abbreviations recognized: cc, cp, cpc, cpp, cost., c.d.s., t.u.b., t.u.f."""

    def test_cc(self):
        r = parse_nl_query("art. 1 cc")
        assert r.act_type == "codice civile"

    def test_cp(self):
        r = parse_nl_query("art. 575 cp")
        assert r.act_type == "codice penale"

    def test_cpc(self):
        r = parse_nl_query("art. 100 cpc")
        assert r.act_type == "codice di procedura civile"

    def test_cpp(self):
        r = parse_nl_query("art. 1 cpp")
        assert r.act_type == "codice di procedura penale"

    def test_cost(self):
        r = parse_nl_query("art. 3 cost.")
        assert r.act_type == "costituzione"

    def test_cost_no_dot(self):
        r = parse_nl_query("art. 3 cost")
        assert r.act_type == "costituzione"

    def test_cds(self):
        r = parse_nl_query("art. 142 cds")
        assert r.act_type == "codice della strada"

    def test_cod_civ(self):
        r = parse_nl_query("art. 2043 cod. civ.")
        assert r.act_type == "codice civile"


class TestFlexibleDateFormats:
    """AC: Flexible date formats: "1990", "7/8/1990", "7 agosto 1990", "07-08-1990"."""

    def test_year_only(self):
        r = parse_nl_query("l. 241/1990 art. 1")
        assert r.date == "1990"

    def test_slash_date(self):
        r = parse_nl_query("art. 1 legge 7/8/1990 n. 241")
        assert r.date == "1990-08-07"

    def test_italian_date(self):
        r = parse_nl_query("art. 1 legge 7 agosto 1990 n. 241")
        assert r.date == "1990-08-07"

    def test_dash_date(self):
        r = parse_nl_query("art. 1 legge 07-08-1990 n. 241")
        assert r.date == "1990-08-07"

    def test_iso_date(self):
        r = parse_nl_query("art. 1 legge 1990-08-07 n. 241")
        assert r.date == "1990-08-07"


class TestActNumberFormats:
    """AC: Act numbers: "241/90", "241/1990", "241 del 1990"."""

    def test_slash_short_year(self):
        r = parse_nl_query("art. 1 legge 241/90")
        assert r.act_number == "241"
        assert r.date == "1990"

    def test_slash_full_year(self):
        r = parse_nl_query("art. 1 legge 241/1990")
        assert r.act_number == "241"
        assert r.date == "1990"

    def test_del_year(self):
        r = parse_nl_query("art. 7 d.lgs. 196 del 2003")
        assert r.act_number == "196"
        assert r.date == "2003"

    def test_n_dot_number(self):
        r = parse_nl_query("art. 1 legge n. 241")
        assert r.act_number == "241"
        assert r.act_type == "legge"

    def test_two_digit_year_21st_century(self):
        r = parse_nl_query("art. 1 d.lgs. 36/23")
        assert r.act_number == "36"
        assert r.date == "2023"


class TestComplexInputs:
    """Integration tests with realistic legal input patterns."""

    def test_dlgs_with_slash(self):
        r = parse_nl_query("d.lgs. 196/2003 art. 7")
        assert r.act_type == "decreto legislativo"
        assert r.act_number == "196"
        assert r.date == "2003"
        assert r.article == "7"

    def test_legge_full_name_with_date(self):
        r = parse_nl_query("articolo 1 legge 241/1990")
        assert r.act_type == "legge"
        assert r.act_number == "241"
        assert r.date == "1990"
        assert r.article == "1"

    def test_codice_civile_full(self):
        r = parse_nl_query("articolo 2043 codice civile")
        assert r.act_type == "codice civile"
        assert r.article == "2043"

    def test_dpr(self):
        r = parse_nl_query("art. 1 d.p.r. 380/2001")
        assert r.act_type == "decreto del presidente della repubblica"
        assert r.act_number == "380"
        assert r.date == "2001"

    def test_regio_decreto(self):
        r = parse_nl_query("art. 1 r.d. 262/1942")
        assert r.act_type == "regio decreto"
        assert r.act_number == "262"

    def test_costituzione(self):
        r = parse_nl_query("art. 3 costituzione")
        assert r.act_type == "costituzione"
        assert r.article == "3"


class TestGracefulFallback:
    """AC: Graceful fallback for unrecognized input."""

    def test_empty_string(self):
        assert parse_nl_query("") is None

    def test_whitespace_only(self):
        assert parse_nl_query("   ") is None

    def test_gibberish(self):
        assert parse_nl_query("hello world random text") is None

    def test_number_only(self):
        assert parse_nl_query("12345") is None


class TestToApiParams:
    def test_full_query(self):
        r = parse_nl_query("art. 2043 cc")
        params = r.to_api_params()
        assert params["act_type"] == "codice civile"
        assert params["article"] == "2043"
        assert "date" not in params
        assert "act_number" not in params

    def test_complete_params(self):
        r = parse_nl_query("art. 7 d.lgs. 196/2003")
        params = r.to_api_params()
        assert params["act_type"] == "decreto legislativo"
        assert params["article"] == "7"
        assert params["act_number"] == "196"
        assert params["date"] == "2003"


class TestInputLimits:
    """Verify input length cap prevents excessive regex processing."""

    def test_very_long_input_returns_none(self):
        assert parse_nl_query("art. 1 cc " * 100) is None

    def test_max_length_boundary(self):
        # 500 chars is the cap
        short = "art. 2043 cc"
        assert parse_nl_query(short) is not None
        long_input = "a" * 501
        assert parse_nl_query(long_input) is None


class TestResolveNlQuery:
    """Test _resolve_nl_query integration logic."""

    def _make_controller(self):
        from visualex_api.app import NormaController
        return NormaController.__new__(NormaController)

    def test_none_data_returns_none(self):
        ctrl = self._make_controller()
        assert ctrl._resolve_nl_query(None) is None

    def test_empty_dict_returns_empty(self):
        ctrl = self._make_controller()
        assert ctrl._resolve_nl_query({}) == {}

    def test_no_query_field_passthrough(self):
        ctrl = self._make_controller()
        data = {"act_type": "codice civile", "article": "2043"}
        assert ctrl._resolve_nl_query(data) == data

    def test_query_parsed_into_fields(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({"query": "art. 2043 cc"})
        assert result["act_type"] == "codice civile"
        assert result["article"] == "2043"

    def test_explicit_act_type_skips_nl_merge(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({
            "query": "art. 2043 cc",
            "act_type": "codice penale",
        })
        assert result["act_type"] == "codice penale"
        # NL parser fields not merged because act_type conflicts
        assert "article" not in result

    def test_unrecognized_query_passthrough(self):
        ctrl = self._make_controller()
        data = {"query": "gibberish text", "act_type": "legge"}
        result = ctrl._resolve_nl_query(data)
        assert result == data


class TestResolverInNlParser:
    def test_denominato_fills_type_number_and_date_together(self):
        got = parse_nl_query("art. 18 statuto dei lavoratori")
        assert got is not None
        assert got.article == "18"
        assert got.act_number == "300"
        assert got.date and got.date.startswith("1970")

    def test_existing_abbreviations_are_unchanged(self):
        got = parse_nl_query("art. 2043 cc")
        assert got.act_type == "codice civile"
        assert got.article == "2043"


class TestEuActs:
    """EU acts are cited year/number since 2015 ("Regolamento (UE) 2016/679",
    "Regolamento (UE) 2024/2847") and Italian practice also writes the pair
    the other way round ("reg. ue 679/2016"). Both must resolve, and the
    official "(UE)" marker in parentheses is not noise."""

    def test_regolamento_ue_year_first(self):
        r = parse_nl_query("Regolamento (UE) 2024/2847 art. 1")
        assert r.to_api_params() == {
            "act_type": "regolamento ue", "date": "2024", "act_number": "2847", "article": "1",
        }

    def test_regolamento_ue_without_article(self):
        r = parse_nl_query("Regolamento (UE) 2024/2847")
        assert r is not None
        assert (r.act_type, r.act_number, r.date, r.article) == ("regolamento ue", "2847", "2024", None)

    def test_reg_ue_abbreviation_without_parentheses(self):
        r = parse_nl_query("Reg. UE 2024/2847 art. 1")
        assert (r.act_type, r.act_number, r.date) == ("regolamento ue", "2847", "2024")

    def test_italian_order_number_first(self):
        r = parse_nl_query("reg. ue 2847/2024 art. 1")
        assert (r.act_type, r.act_number, r.date) == ("regolamento ue", "2847", "2024")

    def test_n_dot_before_the_pair(self):
        r = parse_nl_query("Regolamento (UE) n. 2016/679 art. 5")
        assert (r.act_type, r.act_number, r.date, r.article) == ("regolamento ue", "679", "2016", "5")

    def test_article_before_the_act(self):
        r = parse_nl_query("art. 5 regolamento (ue) 2016/679")
        assert (r.act_type, r.act_number, r.date, r.article) == ("regolamento ue", "679", "2016", "5")

    def test_ce_regulation_maps_to_eu_type(self):
        r = parse_nl_query("Regolamento (CE) n. 1/2003 art. 3")
        assert (r.act_type, r.act_number, r.date) == ("regolamento ue", "1", "2003")

    def test_cee_regulation_two_digit_year(self):
        r = parse_nl_query("Regolamento (CEE) n. 2913/92 art. 4")
        assert (r.act_type, r.act_number, r.date) == ("regolamento ue", "2913", "1992")

    def test_both_halves_year_like_before_2015_is_number_first(self):
        # Regulation (EC) No 2006/2004: number 2006, year 2004.
        r = parse_nl_query("Regolamento (CE) n. 2006/2004 art. 3")
        assert (r.act_number, r.date) == ("2006", "2004")

    def test_direttiva_ue_new_numbering(self):
        r = parse_nl_query("Direttiva (UE) 2016/680 art. 3")
        assert (r.act_type, r.act_number, r.date, r.article) == ("direttiva ue", "680", "2016", "3")

    def test_old_directive_trailing_ce_marker(self):
        r = parse_nl_query("Direttiva 2002/58/CE art. 5")
        assert (r.act_type, r.act_number, r.date) == ("direttiva ue", "58", "2002")

    def test_old_directive_two_digit_year(self):
        r = parse_nl_query("Direttiva 95/46/CE art. 6")
        assert (r.act_type, r.act_number, r.date) == ("direttiva ue", "46", "1995")

    def test_direttiva_italian_order(self):
        r = parse_nl_query("dir. ue 2555/2022 art. 21")
        assert (r.act_type, r.act_number, r.date) == ("direttiva ue", "2555", "2022")

    def test_italian_acts_keep_number_first(self):
        r = parse_nl_query("l. 241/1990 art. 1")
        assert (r.act_type, r.act_number, r.date) == ("legge", "241", "1990")

    def test_parentheses_do_not_break_other_acts(self):
        r = parse_nl_query("art. 2043 (codice civile)")
        assert r.act_type == "codice civile"


class TestEuActsHardening:
    def test_day_month_year_date_is_not_an_eu_pair(self):
        assert parse_nl_query("direttiva 1/2/2016 art. 1") is None

    def test_pair_with_no_year_half_is_refused(self):
        assert parse_nl_query("reg. ue 123/456 art. 1") is None

    def test_ce_marker_keeps_old_numbering(self):
        # Regulation (EC) No 2015/2006 of 19 December 2006.
        r = parse_nl_query("Regolamento (CE) n. 2015/2006 art. 1")
        assert (r.act_number, r.date) == ("2015", "2006")

    def test_implementing_regulation(self):
        r = parse_nl_query("regolamento di esecuzione (UE) 2015/2447 art. 3")
        assert (r.act_type, r.act_number, r.date, r.article) == ("regolamento ue", "2447", "2015", "3")

    def test_delegated_regulation(self):
        r = parse_nl_query("Regolamento delegato (UE) 2015/2446 art. 1")
        assert (r.act_type, r.act_number, r.date) == ("regolamento ue", "2446", "2015")

    def test_three_letter_trailing_marker(self):
        r = parse_nl_query("Direttiva 93/13/CEE art. 3")
        assert (r.act_type, r.act_number, r.date) == ("direttiva ue", "13", "1993")

    def test_three_digit_second_half_is_not_a_year(self):
        r = parse_nl_query("legge 241/456 art. 1")
        assert r.act_type == "legge"
        assert r.date is None


class TestEuPairRule:
    """The rule table behind resolve_eu_year_and_number, with the year injected."""

    def test_year_then_serial(self):
        assert resolve_eu_year_and_number("2024", "2847", current_year=2026) == ("2024", "2847")

    def test_serial_then_year(self):
        assert resolve_eu_year_and_number("679", "2016", current_year=2026) == ("2016", "679")

    def test_serial_below_the_floor_is_not_a_year(self):
        assert resolve_eu_year_and_number("1907", "2006", current_year=2026) == ("2006", "1907")

    def test_both_year_like_from_2015_is_year_first(self):
        assert resolve_eu_year_and_number("2016", "1953", current_year=2026) == ("2016", "1953")

    def test_both_year_like_before_2015_is_number_first(self):
        assert resolve_eu_year_and_number("2006", "2004", current_year=2026) == ("2004", "2006")

    def test_old_marker_never_reads_new_numbering(self):
        assert resolve_eu_year_and_number("2015", "2006", old_marker=True, current_year=2026) == ("2006", "2015")

    def test_next_year_is_still_a_year(self):
        assert resolve_eu_year_and_number("2027", "5", current_year=2026) == ("2027", "5")

    def test_no_year_half_is_refused(self):
        assert resolve_eu_year_and_number("2028", "5", current_year=2026) is None
        assert resolve_eu_year_and_number("123", "456", current_year=2026) is None

    def test_two_digit_year_after_long_serial(self):
        assert resolve_eu_year_and_number("2913", "92", current_year=2026) == ("1992", "2913")

    def test_trailing_marker_is_year_first(self):
        assert resolve_eu_year_and_number("95", "46", kind="direttiva", trailing_marker=True, current_year=2026) == ("1995", "46")

    def test_two_two_digit_halves_follow_the_kind(self):
        assert resolve_eu_year_and_number("45", "01", current_year=2026) == ("2001", "45")
        assert resolve_eu_year_and_number("93", "13", kind="direttiva", current_year=2026) == ("1993", "13")


class TestArticleLists:
    """The API takes lists as "1,2" and ranges as "1-10"; the parser must hand
    it those shapes, not "5 e 6", which parse_article_input rejects as invalid."""

    def test_e_separated_list(self):
        assert parse_nl_query("artt. 5 e 6 cc").article == "5,6"

    def test_comma_and_e_list(self):
        r = parse_nl_query("artt. 1, 2 e 3 cc")
        assert (r.article, r.act_type) == ("1,2,3", "codice civile")

    def test_range(self):
        r = parse_nl_query("artt. 1-10 cc")
        assert (r.article, r.act_type) == ("1-10", "codice civile")

    def test_list_with_suffix(self):
        assert parse_nl_query("artt. 2 bis e 3 cc").article == "2-bis,3"

    def test_list_on_an_eu_act(self):
        r = parse_nl_query("reg. ue 2016/679 artt. 5 e 6")
        assert (r.article, r.act_number, r.date) == ("5,6", "679", "2016")


class TestCommaClauses:
    """"comma 1" and "lett. b" qualify the article; they are not the act number."""

    def test_comma_is_not_the_act_number(self):
        r = parse_nl_query("art. 5, comma 1, cc")
        assert (r.article, r.act_type, r.act_number) == ("5", "codice civile", None)

    def test_comma_and_letter(self):
        r = parse_nl_query("art. 6, comma 1, lett. b) gdpr")
        assert (r.article, r.act_number, r.date) == ("6", "679", "2016")

    def test_co_abbreviation(self):
        r = parse_nl_query("art. 2, co. 3, d.lgs. 196/2003")
        assert (r.article, r.act_number, r.date) == ("2", "196", "2003")


class TestDateSanity:
    def test_impossible_month_is_not_a_date_and_does_not_feed_the_pair(self):
        r = parse_nl_query("art. 1 legge 31/13/1990 n. 400")
        assert (r.act_number, r.date) == ("400", "1990")

    def test_search_goes_on_after_an_impossible_date(self):
        r = parse_nl_query("art. 1 legge 31/13/1990 del 12 agosto 1991 n. 400")
        assert r.date == "1991-08-12"


class TestTrailingMarkerOnRegulations:
    def test_trailing_marker_on_a_regulation_says_nothing_about_the_order(self):
        assert resolve_eu_year_and_number("1049", "2001", kind="regolamento", trailing_marker=True, current_year=2026) == ("2001", "1049")
