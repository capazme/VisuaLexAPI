# services/merlt/tests/pipeline/test_massimario_citations.py
"""The citation grammar, one test per form (spec §5.5). Synthetic citations only."""
import time

import pytest

from merlt.pipeline.massimario.citations import _norm_section, parse_citations
from merlt.pipeline.massimario.identity import DecisionIdentity
from merlt.pipeline.massimario.rv_bands import RvBands

BANDS = RvBands({
    ("civile", 2012): (620000, 630000),
    ("civile", 2013): (624000, 629000),
    ("civile", 2024): (669000, 673000),
})


def scan(text, *, year=2024, archivio="civile", bands=BANDS):
    return parse_citations(text, review_year=year, archivio=archivio, bands=bands)


def only(text, **kw):
    result = scan(text, **kw)
    assert len(result.decisions) == 1, result.decisions
    return result.decisions[0]


class TestCivil:
    def test_slash_with_rapporteur(self):
        d = only("In tema di danno, Sez. U, n. 13319/2024, Rossi, Rv. 671516-02, ha affermato")
        assert d.identity.key == "cassazione:civile:13319:2024"
        assert (d.sezione, d.relatore, d.rv, d.forma) == ("U", "Rossi", ["671516-02"], "slash")
        assert d.label == "Sez. U, n. 13319/2024 · Rv. 671516-02"

    def test_leading_zeros_and_no_rapporteur(self):
        d = only("un passato indirizzo (Sez. 1, n. 04912/2017, Rv. 644441-01), a dire")
        assert d.identity.key == "cassazione:civile:4912:2017"
        assert d.relatore is None

    def test_number_del_year(self):
        d = only("(pronuncia conforme a Sez. L., n. 28928 del 2019, Rv. 655701-01)")
        assert (d.identity.key, d.sezione, d.forma) == ("cassazione:civile:28928:2019", "L", "del_anno")

    def test_number_without_n(self):
        d = only("si segnala Sez. L, 09136/2024, Bianchi, Rv. 670602-01, secondo cui")
        assert d.identity.key == "cassazione:civile:9136:2024"

    def test_rv_without_dash(self):
        assert only("Sez. U., n. 04353/2023, Verdi, Rv. 66701301, la S.C.").rv == ["667013-01"]

    def test_two_digit_year(self):
        assert only("in Sez. 1, n. 18161/19, Neri, Rv. 654543 – 01 secondo").identity.anno == 2019

    def test_section_written_in_two_ways_is_one_identity(self):
        a = only("Sez. T, n. 24471/2022, Gialli, Rv. 665000-01")
        b = only("Sez. 5, n. 24471/2022, Gialli, Rv. 665000-01")
        assert a.identity == b.identity
        assert (a.sezione, b.sezione) == ("T", "5")


class TestCriminal:
    def test_deposit_year_wins_over_hearing_year(self):
        d = only("Sez. 1, n. 1399 del 15/12/1999, dep. 2000, Neri, Rv. 215228-01", archivio="penale", year=2010)
        assert d.identity.key == "cassazione:penale:1399:2000"
        assert (d.data_udienza, d.relatore) == ("1999-12-15", "Neri")

    def test_hearing_year_without_deposit(self):
        d = only("Sez. 6, n. 23742 del 08/07/2020 Gialli, Rv. 279458-01", archivio="penale", year=2020)
        assert d.identity.key == "cassazione:penale:23742:2020"

    def test_date_before_number(self):
        d = only("(Sez. VI, 12 novembre 2008, n. 44877, Blu, Rv. 241853); il", archivio="penale", year=2010)
        assert (d.identity.key, d.sezione, d.data_udienza) == ("cassazione:penale:44877:2008", "VI", "2008-11-12")

    def test_date_before_number_with_deposit(self):
        d = only("Sez. I, 1 dicembre 2006 - dep. 8 gennaio 2007, n. 103, Rosa, Rv. 235341;", archivio="penale", year=2010)
        assert d.identity.key == "cassazione:penale:103:2007"
        assert d.data_udienza == "2006-12-01"  # the hearing, not the deposit

    def test_an_earlier_deposit_does_not_move_the_year(self):
        result = scan("Sez. 1, n. 5 del 01/01/2010, dep. 2011, e Sez. 2, n. 7 del 03/03/2012, Bianchi, Rv. 252000-01",
                      archivio="penale", year=2012)
        assert [d.identity.key for d in result.decisions if d.rv] == ["cassazione:penale:7:2012"]

    def test_month_in_words_after_del(self):
        d = only("Sez. U, n. 49935 del 28 settembre 2023, Viola, Rv. 285517-01", archivio="penale", year=2023)
        assert (d.identity.key, d.forma) == ("cassazione:penale:49935:2023", "del_data")


class TestStructure:
    def test_several_rv_for_one_decision(self):
        result = scan("Sez. U, n. 19883/2019, Conti, Rv. 644838-01, Rv. 644838-02, secondo")
        assert len(result.decisions) == 1
        assert result.decisions[0].rv == ["644838-01", "644838-02"]
        assert (result.rv_total, result.rv_recognized) == (2, 2)

    def test_list_separated_by_semicolons(self):
        result = scan("(Sez. 1, n. 100/2020, Rossi, Rv. 657000-01; Sez. 2, n. 200/2021, Bianchi, Rv. 661000-01)")
        assert [d.identity.key for d in result.decisions] == [
            "cassazione:civile:100:2020", "cassazione:civile:200:2021",
        ]

    def test_archive_written_in_the_citation(self):
        d = only("(Sez. 1 civ., n, 15724 del 11/06/2019, Rv. 654456)", archivio=None, year=2019)
        assert d.identity.key == "cassazione:civile:15724:2019"

    def test_unknown_archive_has_no_identity(self):
        d = only("Sez. 1, n. 100/2020, Rossi, Rv. 657000-01", archivio=None)
        assert d.identity is None and d.motivo_senza_identita == "archivio_ignoto"

    def test_number_zero_has_no_identity(self):
        d = only("Sez. 5, n. 0/2015, Rossi, Rv. 634000-01")
        assert d.identity is None and d.motivo_senza_identita == "numero_non_valido"

    def test_year_out_of_range_has_no_identity(self):
        d = only("Sez. 3, n. 30521/2919, Iannello, Rv. 655971-03, ha")
        assert d.identity is None and d.motivo_senza_identita == "anno_fuori_intervallo"


class TestImplicitYear:
    def test_inside_the_range_takes_the_review_year(self):
        d = only("con le pronunzie Sez. 3, n. 2103 (Rv. 621670) e", year=2012)
        assert d.identity.key == "cassazione:civile:2103:2012"
        assert d.anno_implicito and d.forma == "implicito"

    def test_outside_the_range_is_a_reference_without_identity(self):
        d = only("con le pronunzie Sez. 3, n. 2103 (Rv. 599999) e", year=2012)
        assert d.identity is None and d.motivo_senza_identita == "anno_non_verificato"
        assert d.anno is None and d.label == "Sez. 3, n. 2103 · Rv. 599999"

    def test_without_bands_nothing_is_assumed(self):
        d = only("Sez. 3, n. 2103 (Rv. 621670)", year=2012, bands=None)
        assert d.identity is None


class TestNotDecisions:
    def test_act_number_is_not_a_decision(self):
        result = scan("ai sensi della legge n. 89 del 2001 (Rv. 655555-01). Inoltre")
        assert result.decisions == []
        assert (result.rv_total, result.rv_recognized) == (1, 0)

    def test_article_number_is_not_a_decision(self):
        assert scan("dell'art. 360, n. 5, c.p.c. (Rv. 655555-01)").decisions == []

    def test_prose_sezione_is_not_a_citation(self):
        assert scan("nella sezione 3 della legge n. 89/2001 si prevede").decisions == []

    def test_rv_alone_is_counted_and_sampled(self):
        result = scan("«massima riportata» (Rv. 251820). Al riguardo")
        assert result.decisions == [] and result.rv_total == 1
        assert "Rv. 251820" in result.unrecognized[0]


class TestOtherForms:
    def test_cassazione_without_rv(self):
        d = only("come affermato da Sez. U, n. 123/2020, le spese")
        assert (d.identity.key, d.forma, d.rv, d.relatore) == ("cassazione:civile:123:2020", "senza_rv", [], None)

    def test_a_citation_with_rv_is_not_read_twice(self):
        assert len(scan("Sez. U, n. 13319/2024, Rossi, Rv. 671516-02").decisions) == 1

    def test_corte_costituzionale(self):
        result = scan("Corte cost., sent. n. 1 del 2014, e Corte costituzionale n. 238/2014 hanno")
        assert [d.identity.key for d in result.decisions] == [
            "corte_costituzionale:1:2014", "corte_costituzionale:238:2014",
        ]
        assert result.decisions[0].label == "Corte cost., n. 1/2014"

    def test_corte_costituzionale_number_zero_has_no_identity(self):
        d = only("Corte cost., ord. n. 0/2014 ha")
        assert d.identity is None and d.motivo_senza_identita == "numero_non_valido"


ACT_FORMS = [
    "L. n. 89 del 2001",
    "Reg. UE n. 1215/2012",
    "reg. (CE) n. 44/2001",
    "R.D. n. 267 del 1942",
    "T.U. n. 380 del 2001",
    "D.M. 10 marzo 2014, n. 55",
    "d.m. n. 55 del 2014",
    "d.P.C.M. n. 5 del 2020",
    "dir. 2000/31/CE, n. 5",
    "art. 2 bis, comma 3, n. 5",
]


class TestActForms:
    @pytest.mark.parametrize("form", ACT_FORMS)
    def test_act_number_is_not_a_decision(self, form):
        result = scan(f"ai sensi del {form} (Rv. 621670-01)", year=2012)
        assert result.decisions == []
        assert result.rv_recognized == 0

    @pytest.mark.parametrize("text, key, year", [
        ("Sez. L., n. 28928 del 2019, Rv. 655701-01", "cassazione:civile:28928:2019", 2024),
        ("Sez. L, 09136/2024, Bianchi, Rv. 670602-01", "cassazione:civile:9136:2024", 2024),
        ("(Sez. U, n. 13319/2024, Rossi, Rv. 671516-02)", "cassazione:civile:13319:2024", 2024),
        ("come affermato da Sez. U, n. 123/2020, le spese", "cassazione:civile:123:2020", 2024),
        ("la sentenza n. 11633 (Rv. 626925)", "cassazione:civile:11633:2012", 2012),
    ])
    def test_a_real_citation_is_still_a_decision(self, text, key, year):
        assert only(text, year=year).identity.key == key


AFTER_AN_ACT = [
    ("ai sensi dell'art. 2087 cod. civ. (sez. L, n. 14375, Rv. 624033).", 2012, "civile",
     "cassazione:civile:14375:2012"),
    ("l'art. 4 della legge 23 luglio 1991, n. 223, Sez. n. 1315 (Rv. 625077), est. Rossi.", 2013, "civile",
     "cassazione:civile:1315:2013"),
    ("dell'art. 2389 cod. civ. (Sez. trib., n. 20265, Rv. 628116, est. Rossi).", 2013, "civile",
     "cassazione:civile:20265:2013"),
    ("dell'art. 8 d.lgs. 31 dicembre 1992, n. 546, la sentenza n. 4522 (Rv. 625683), est. Rossi, ha chiarito",
     2013, "civile", "cassazione:civile:4522:2013"),
    ("presso le A.S.L. Nel medesimo contesto, va ricordata la sentenza n. 3360 (Rv. 625267), est. Rossi.",
     2013, "civile", "cassazione:civile:3360:2013"),
    ("dall'art. 12 del d.lgs. 18 dicembre 1997, n. 472 (sentenza n. 5897, Rv. 625953, est. Rossi).",
     2013, "civile", "cassazione:civile:5897:2013"),
    ("è stato fatto proprio da Sez. 6 – L., n. 21986/2018, Rossi, Rv. 650500-01.", 2019, "civile",
     "cassazione:civile:21986:2018"),
    ("previsti dalla legge si è espressa Sez, 4, n. 53356 del 27/09/2016, Rossi, Rv. 268680-01.", 2017, "penale",
     "cassazione:penale:53356:2016"),
    ("dall'art. 16, comma primo, n. 3, l. fall., con la decisione n. 12946 del 25/2/2020, Rossi, Rv. 278887-01.",
     2020, "penale", "cassazione:penale:12946:2020"),
    ("dell'art. 9 L. FALL. (Cass., sez. 1, n. 4343/2020, Rossi, Rv. 657079-02).", 2020, "civile",
     "cassazione:civile:4343:2020"),
    ("ai sensi dell'art. 111 Cost. (Cass., sez. 1, n. 4346/2020, Bianchi, Rv. 657080-01).", 2020, "civile",
     "cassazione:civile:4346:2020"),
    ("dello stesso decreto. Secondo Sez, 2, n. 26701/2020, Rossi, Rv. 659687-01, il conducente", 2020, "civile",
     "cassazione:civile:26701:2020"),
    ("ex art. 108, comma 2, l.fall. (ratione temporis applicabile), S.U., n. 07337/2024, Rossi, Rv. 670507-02 hanno",
     2024, "civile", "cassazione:civile:7337:2024"),
    ("i cui prodromi si possono leggere tra le righe di n. 23846 del 2008, Rv. 604659) per cui", 2010, "civile",
     "cassazione:civile:23846:2008"),
]


class TestAfterAnAct:
    @pytest.mark.parametrize("text, year, archivio, key", AFTER_AN_ACT)
    def test_a_decision_word_or_sentenza_after_an_act_is_still_a_decision(self, text, year, archivio, key):
        result = scan(text, year=year, archivio=archivio)
        assert key in [d.identity.key for d in result.decisions if d.identity], result.decisions

    def test_a_section_with_a_subsection_is_one_label(self):
        result = scan("è stato fatto proprio da Sez. 6 – L., n. 21986/2018, Rossi, Rv. 650500-01.", year=2019)
        found = [d for d in result.decisions if d.identity and d.identity.key == "cassazione:civile:21986:2018"]
        assert found and found[0].sezione == "6-L"

    def test_a_section_typo_is_no_decision_number(self):
        result = scan("(Sez. n. 6-2, 06820/2021, Rossi, Rv. 660941-01)", year=2021,
                      bands=RvBands({("civile", 2021): (658000, 664000)}))
        assert "cassazione:civile:6:2021" not in [d.identity.key for d in result.decisions if d.identity]

    def test_an_act_number_after_a_section_label_stays_an_act_number(self):
        result = scan("Sez. U, n. 13319/2024, sull'art. 360, n. 5 (Rv. 671516-02)")
        assert 5 not in [d.numero for d in result.decisions]

    def test_norm_section_writes_one_dash(self):
        assert _norm_section("6 – L.") == "6-L"
        assert _norm_section("6 - 3") == "6-3"


HOSTILE = [
    pytest.param("Corte cost." + " " * 1_000_000, id="consulta_then_spaces"),
    pytest.param("Corte costituzionale" + " " * 1_000_000, id="consulta_long_then_spaces"),
    pytest.param("n" + " " * 1_000_000, id="n_then_spaces"),
    pytest.param("Sez. U" + " " * 1_000_000, id="sezione_then_spaces"),
    pytest.param("Rv. " * 250_000, id="rv_repeated"),
    pytest.param("Sez. 1, n. " * 100_000, id="sezione_n_repeated"),
    pytest.param("del " * 250_000, id="del_repeated"),
    pytest.param("Corte cost., " * 80_000, id="consulta_repeated"),
    pytest.param("n, " * 300_000, id="n_comma_repeated"),
]


class TestHostileText:
    """About 1 MB of text built to make a backtracking pattern quadratic or worse."""

    @pytest.mark.parametrize("text", HOSTILE)
    def test_the_scan_stays_linear(self, text):
        started = time.perf_counter()
        result = scan(text)
        elapsed = time.perf_counter() - started
        assert elapsed < 2.0, f"{elapsed:.1f} s"
        assert result.decisions == []

    def test_an_act_word_before_a_long_word_stays_linear(self):
        # The act guard reads up to six words after an act word; a long word that the guard
        # cannot finish on (the colon) must not be split in every possible way.
        text = ("legge " + "a" * 40 + ": n. 5 (Rv. 621670-01) ") * 200
        started = time.perf_counter()
        result = scan(text)
        elapsed = time.perf_counter() - started
        assert elapsed < 2.0, f"{elapsed:.1f} s"
        assert len(result.decisions) <= 200


def test_identity_is_validated():
    with pytest.raises(ValueError):
        DecisionIdentity("cassazione", 1, 2020, None)
    with pytest.raises(ValueError):
        DecisionIdentity("corte_costituzionale", 1, 2020, "civile")
    with pytest.raises(ValueError):
        DecisionIdentity("tar", 1, 2020, None)
