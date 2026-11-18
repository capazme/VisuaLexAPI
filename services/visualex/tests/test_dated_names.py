"""The fiscal testi unici follow the date (G-577): «tuir», «tur» and «tuiva», and their long names,
name the old act until 31 December 2026 and the new testo unico, the annex of its decree, from
1 January 2027, with a notice in both spans. «tua» names two acts at the same date and asks
which. The golden cases are the table below: every name, the day before and the day of the
change."""
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools import dated_names
from visualex_api.tools.act_resolver import ambiguous_act, known_act_names, resolve_atto
from visualex_api.tools.alias_resolver import get_all_presets, resolve_alias
from visualex_api.tools.dated_names import DATED_NAMES, act_at
from visualex_api.tools.nl_parser import parse_nl_query
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.norm_query import act_names, ambiguous_choices, read_norm_query
from visualex_api.tools.sources import cite_act

BEFORE, ON = date(2026, 12, 31), date(2027, 1, 1)

_DPR, _DLGS = "decreto del presidente della repubblica", "decreto legislativo"
OLD = {
    "tuir": {"tipo_atto": _DPR, "data": "1986-12-22", "numero_atto": "917"},
    "registro": {"tipo_atto": _DPR, "data": "1986-04-26", "numero_atto": "131"},
    "iva": {"tipo_atto": _DPR, "data": "1972-10-26", "numero_atto": "633"},
}
NEW = {
    "tuir": {"tipo_atto": _DLGS, "data": "2026-06-19", "numero_atto": "117", "allegato": "1"},
    "registro": {"tipo_atto": _DLGS, "data": "2025-08-01", "numero_atto": "123", "allegato": "1"},
    "iva": {"tipo_atto": _DLGS, "data": "2026-01-19", "numero_atto": "10", "allegato": "1"},
}
NOTICE_BEFORE = {
    "tuir": "Dal 1° gennaio 2027 si applica il testo unico delle imposte sui redditi "
            "(d.lgs. 19 giugno 2026, n. 117, allegato 1).",
    "registro": "Dal 1° gennaio 2027 si applica il testo unico dell'imposta di registro e degli altri "
                "tributi indiretti (d.lgs. 1° agosto 2025, n. 123, allegato 1).",
    "iva": "Dal 1° gennaio 2027 si applica il testo unico dell'imposta sul valore aggiunto "
           "(d.lgs. 19 gennaio 2026, n. 10, allegato 1).",
}
NOTICE_ON = {
    "tuir": "Dal 1° gennaio 2027 questo nome indica il testo unico delle imposte sui redditi "
            "(d.lgs. 19 giugno 2026, n. 117, allegato 1); il testo precedente è il d.p.r. 22 dicembre 1986, n. 917.",
    "registro": "Dal 1° gennaio 2027 questo nome indica il testo unico dell'imposta di registro e degli altri "
                "tributi indiretti (d.lgs. 1° agosto 2025, n. 123, allegato 1); il testo precedente è il "
                "d.p.r. 26 aprile 1986, n. 131.",
    "iva": "Dal 1° gennaio 2027 questo nome indica il testo unico dell'imposta sul valore aggiunto "
           "(d.lgs. 19 gennaio 2026, n. 10, allegato 1); il testo precedente è il d.p.r. 26 ottobre 1972, n. 633.",
}
NAMES = {
    "tuir": ["tuir", "TUIR", "T.U.I.R.", "testo unico delle imposte sui redditi", "testo unico imposte sui redditi",
             "testo unico imposte redditi", "tu imposte redditi"],
    "registro": ["tur", "TUR", "tu registro", "testo unico registro", "testo unico dell'imposta di registro",
                 "testo unico imposta di registro"],
    "iva": ["tuiva", "TUIVA", "tu iva", "TU IVA", "testo unico iva"],
}
GOLDEN = [(name, act, day) for act, names in NAMES.items() for name in names for day in (BEFORE, ON)]


@pytest.mark.parametrize("name,act,day", GOLDEN, ids=[f"{n}-{d.isoformat()}" for n, _, d in GOLDEN])
def test_every_name_names_its_act_on_each_side_of_the_day(name, act, day):
    if day < ON:
        assert resolve_atto(name, day) == {**OLD[act], "notice": NOTICE_BEFORE[act]}
    else:
        assert resolve_atto(name, day) == {**NEW[act], "notice": NOTICE_ON[act]}


def test_the_table_is_the_golden_names_and_nothing_else():
    assert set(DATED_NAMES) == {name.lower() for names in NAMES.values() for name in names
                                if "." not in name}
    assert act_at("codice civile", ON) is None


def test_the_day_before_is_the_old_act_the_day_after_the_new_one():
    assert resolve_atto("tuir", date(2026, 1, 1))["numero_atto"] == "917"
    assert resolve_atto("tuir", date(2031, 5, 4))["numero_atto"] == "117"


@pytest.mark.parametrize("act", sorted(OLD))
def test_the_notices_cite_the_acts_as_the_convention_does(act):
    old, new = OLD[act], NEW[act]
    assert f"({cite_act(new)}, allegato 1)" in NOTICE_BEFORE[act]
    assert NOTICE_ON[act].endswith(f"il testo precedente è il {cite_act(old)}.")


@pytest.mark.parametrize("today,act", [(date(2026, 11, 18), OLD["tuir"]), (date(2027, 1, 1), NEW["tuir"])])
def test_without_a_day_the_name_is_read_at_today_in_rome(today, act):
    with patch.object(dated_names, "today_in_rome", return_value=today):
        resolved = resolve_atto("tuir")
    assert {k: v for k, v in resolved.items() if k != "notice"} == act


# --- The search's reading ---------------------------------------------------------------------

@pytest.mark.parametrize("query", ["art. 1 tuir", "art. 1 TUIR", "art. 1 del TUIR", "articolo 1 T.U.I.R."])
def test_an_article_of_the_tuir_before_the_day(query):
    params, _ = read_norm_query(query, BEFORE)
    assert params == {"act_type": _DPR, "act_number": "917", "date": "1986-12-22", "article": "1",
                      "notice": NOTICE_BEFORE["tuir"]}


@pytest.mark.parametrize("query", ["art. 1 tuir", "art. 1 TUIR", "art. 1 del TUIR", "articolo 1 T.U.I.R."])
def test_an_article_of_the_tuir_from_the_day_is_the_annexs(query):
    params, _ = read_norm_query(query, ON)
    assert params == {"act_type": _DLGS, "act_number": "117", "date": "2026-06-19", "article": "1",
                      "annex": "1", "notice": NOTICE_ON["tuir"]}


@pytest.mark.parametrize("query,act", [("art. 2 tur", "registro"), ("art. 10 tuiva", "iva"),
                                       ("art. 3 del testo unico iva", "iva")])
def test_the_registro_and_the_iva_follow_the_same_day(query, act):
    before, _ = read_norm_query(query, BEFORE)
    on, _ = read_norm_query(query, ON)
    assert (before["act_number"], before.get("annex")) == (OLD[act]["numero_atto"], None)
    assert (on["act_number"], on["annex"]) == (NEW[act]["numero_atto"], "1")


def test_the_parser_path_reads_the_day_too():
    # A comma keeps the preset aliases out: the reading is the parser's.
    assert read_norm_query("art. 5, comma 2, del tuir", ON)[1] == "nl_parser"
    parsed = parse_nl_query("art. 5, comma 2, del tuir", ON)
    assert (parsed.act_number, parsed.annex, parsed.comma) == ("117", "1", "2")
    assert parsed.notice == NOTICE_ON["tuir"]
    assert parse_nl_query("art. 5, comma 2, del tuir", BEFORE).annex is None


def test_an_annex_typed_by_the_user_is_kept():
    assert read_norm_query("art. 1 tuir allegato 2", ON)[0]["annex"] == "2"


@pytest.mark.parametrize("query,number,annex", [
    ("art. 81 TUIR 917/1986", "917", None), ("art. 10 tur 131/1986", "131", None),
    ("art. 2 testo unico iva 633/1972", "633", None), ("art. 5 tuir 1986", "917", None),
    ("art. 5 tuir 2026", "117", "1"), ("art. 1 tuir 117/2026", "117", "1"),
])
def test_a_name_with_its_acts_number_is_that_act_on_any_day(query, number, annex):
    # A brief written in 2026 cites «art. 81 TUIR 917/1986»: read in 2027 it is still the d.p.r.,
    # never a «d.lgs. 917/1986, allegato 1» that does not exist (review of this PR).
    for day in (BEFORE, ON):
        params, _ = read_norm_query(query, day)
        assert (params["act_number"], params.get("annex")) == (number, annex), day


def test_a_name_with_another_acts_number_reads_nothing():
    assert read_norm_query("art. 1 tuir 123/2025", ON) == (None, None)


def test_the_acts_typed_by_their_numbers_are_never_moved():
    # A saved note keeps the act it was made on: what is saved and fetched is the act's fields.
    for query, number in (("art. 1 d.p.r. 917/1986", "917"), ("art. 1 d.lgs. 117/2026", "117")):
        for day in (BEFORE, ON):
            params, _ = read_norm_query(query, day)
            assert params["act_number"] == number and "notice" not in params


# --- The routes ---------------------------------------------------------------------------------

async def _parse(query, today):
    controller = NormaController()
    nv = NormaVisitata(norma=Norma(tipo_atto="decreto legislativo", data="2026-06-19", numero_atto="117"),
                       numero_articolo="1", allegato="1")
    built = AsyncMock(return_value=[nv])
    with patch.object(dated_names, "today_in_rome", return_value=today), \
            patch.object(controller, "create_norma_visitata_from_data", built):
        response = await controller.app.test_client().post("/parse_query", json={"query": query})
    assert response.status_code == 200
    return await response.get_json(), built


async def test_parse_query_from_the_day_opens_the_annex_and_says_so():
    answer, built = await _parse("art. 1 tuir", ON)
    assert answer["parsed"] == {"act_type": _DLGS, "act_number": "117", "date": "2026-06-19", "article": "1",
                                "annex": "1"}
    assert answer["notice"] == NOTICE_ON["tuir"]
    assert answer["display"] == "art. 1, d.lgs. 19 giugno 2026, n. 117 (Allegato 1)"
    # The notice is the answer's, never a field the URN is built from.
    assert built.await_args.args[0] == answer["parsed"]


async def test_parse_query_before_the_day_says_what_is_coming():
    answer, _ = await _parse("art. 1 tuir", BEFORE)
    assert answer["parsed"]["act_number"] == "917" and "annex" not in answer["parsed"]
    assert answer["notice"] == NOTICE_BEFORE["tuir"]


async def test_parse_query_has_no_notice_for_an_ordinary_act():
    answer, _ = await _parse("art. 1 d.lgs. 117/2026", ON)
    assert "notice" not in answer


async def test_the_batch_puts_the_notice_beside_the_reading():
    controller = NormaController()
    with patch.object(dated_names, "today_in_rome", return_value=ON):
        response = await controller.app.test_client().post("/parse_query_batch", json={"queries": ["art. 1 tuir", "art. 1 c.c."]})
    tuir, cc = (await response.get_json())["results"]
    assert tuir["notice"] == NOTICE_ON["tuir"] and "notice" not in tuir["parsed"]
    assert tuir["parsed"]["annex"] == "1"
    assert "notice" not in cc


def test_the_catalog_lists_them_as_names_the_resolver_knows_not_as_presets():
    # A preset seeds the palette's form with fixed fields and no annex; a dated name is read.
    presets = get_all_presets()
    for name in ("tuir", "testo unico imposte redditi", "testo unico iva", "testo unico registro"):
        assert name not in presets
    assert {"tuir", "tur", "tuiva", "tu iva"} <= set(known_act_names())
    assert {"tuir", "tur", "tuiva", "testo unico iva"} <= set(act_names())


# --- «TUA»: two acts at the same date ---------------------------------------------------------------

@pytest.mark.parametrize("query", ["tua", "TUA", "T.U.A.", "art. 1 tua", "art. 1 del TUA"])
def test_tua_is_read_as_neither_act(query):
    assert read_norm_query(query) == (None, None)
    assert resolve_alias(query) is None


@pytest.mark.parametrize("query,number", [("art. 1 tua 152/2006", "152"), ("art. 1 TUA 504/1995", "504")])
def test_tua_with_an_acts_number_is_that_act(query, number):
    assert read_norm_query(query)[0]["act_number"] == number


def test_tua_with_another_number_reads_nothing():
    assert read_norm_query("art. 1 tua 1/2000") == (None, None)


@pytest.mark.parametrize("query", ["T.U.A.", "art. 1 del T.U.A.", "art. 29, comma 1, TUA", "art. 29, co. 1, tua",
                                   "art. 29 comma 1 TUA", "art. 29 bis, comma 1, TUA"])
def test_every_spelling_of_tua_offers_both_acts(query):
    assert [c["name"] for c in ambiguous_choices(query)] == ["codice dell'ambiente", "testo unico accise"]


def test_tua_offers_both_acts():
    assert ambiguous_act("TUA") == ("codice dell'ambiente", "testo unico accise")
    assert ambiguous_choices("art. 29 TUA") == [
        {"name": "codice dell'ambiente", "display": "d.lgs. 3 aprile 2006, n. 152",
         "parsed": {"act_type": _DLGS, "act_number": "152", "date": "2006-04-03", "article": "29"}},
        {"name": "testo unico accise", "display": "d.lgs. 26 ottobre 1995, n. 504",
         "parsed": {"act_type": _DLGS, "act_number": "504", "date": "1995-10-26", "article": "29"}},
    ]


@pytest.mark.parametrize("name,number", [("codice dell'ambiente", "152"), ("testo unico ambientale", "152"),
                                         ("testo unico accise", "504"), ("tu accise", "504")])
def test_each_act_of_tua_still_answers_its_own_name(name, number):
    assert resolve_atto(name)["numero_atto"] == number


def test_tue_with_dots_offers_both_acts_too():
    choices = ambiguous_choices("art. 13 del T.U.E.")
    assert [c["parsed"]["act_type"] for c in choices] == [_DPR, "TUE"]
    assert all(c["parsed"]["article"] == "13" for c in choices)
    assert ambiguous_choices("art. 13 TUE") is None and ambiguous_choices("art. 1 c.c.") is None


async def test_parse_query_asks_which_act_tua_means():
    response = await NormaController().app.test_client().post("/parse_query", json={"query": "art. 1 tua"})
    answer = await response.get_json()
    assert answer["recognized"] is False and answer["parsed"] is None
    assert [c["display"] for c in answer["ambiguous"]] == ["d.lgs. 3 aprile 2006, n. 152", "d.lgs. 26 ottobre 1995, n. 504"]


async def test_parse_query_answers_an_unknown_name_as_before():
    response = await NormaController().app.test_client().post("/parse_query", json={"query": "zzz qqq"})
    assert await response.get_json() == {"parsed": None, "recognized": False, "identifies_act": False}
