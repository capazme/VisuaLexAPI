"""Tests for natural language input parser — 30+ input variations."""

import pytest
from visualex_api.tools.nl_parser import parse_nl_query, ParsedQuery


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
