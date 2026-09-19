"""From the flat, stateful listing VisuaLex's tree gives, to a place for each
article: LIBRO resets TITOLO/CAPO/SEZIONE, a new annex resets everything, and
a string that is not a heading (an annex label) changes nothing."""
from archivio_normativo.hierarchy import (
    IndexedArticle, classify_heading, normalize_number, walk_tree,
)


class TestNormalizeNumber:
    def test_forms(self):
        assert normalize_number("2043") == "2043"
        assert normalize_number("2 bis") == "2-bis"
        assert normalize_number("2-BIS") == "2-bis"
        assert normalize_number("2bis") == "2-bis"
        assert normalize_number("Art. 2043") == "2043"
        assert normalize_number("art 25 terdecies") == "25-terdecies"
        assert normalize_number("2409 octiesdecies") == "2409-octiesdecies"
        assert normalize_number(" 7. ") == "7"

    def test_unknown_tails_collapse_to_dashes(self):
        assert normalize_number("1 allegato A") == "1-allegato-a"


class TestClassifyHeading:
    def test_levels(self):
        assert classify_heading("LIBRO QUARTO Delle obbligazioni") == ("libro", "LIBRO QUARTO Delle obbligazioni")
        assert classify_heading("Titolo IX Dei fatti illeciti") == ("titolo", "Titolo IX Dei fatti illeciti")
        assert classify_heading("CAPO I") == ("capo", "CAPO I")
        assert classify_heading("  SEZIONE   II  Degli effetti ") == ("sezione", "SEZIONE II Degli effetti")
        assert classify_heading("PARTE I Diritti e doveri dei cittadini") == ("parte", "PARTE I Diritti e doveri dei cittadini")

    def test_non_headings(self):
        assert classify_heading("CODICE CIVILE") is None
        assert classify_heading("Disposizioni sulla legge in generale") is None
        assert classify_heading("Capoluogo") is None  # word boundary: not CAPO
        assert classify_heading("") is None


class TestWalkTree:
    def test_headings_nest_and_reset(self):
        items = [
            "LIBRO QUARTO Delle obbligazioni",
            "TITOLO I Delle obbligazioni in generale",
            "CAPO I Disposizioni preliminari",
            {"numero": "1173", "allegato": "2"},
            "CAPO II Dell'adempimento",
            "SEZIONE I Dell'adempimento in generale",
            {"numero": "1176", "allegato": "2"},
            "TITOLO IX Dei fatti illeciti",
            {"numero": "2043", "allegato": "2"},
            "LIBRO QUINTO Del lavoro",
            {"numero": "2060", "allegato": "2"},
        ]
        out = walk_tree(items)
        assert [a.number for a in out] == ["1173", "1176", "2043", "2060"]
        assert [a.position for a in out] == [0, 1, 2, 3]
        a1173, a1176, a2043, a2060 = out
        assert (a1173.libro, a1173.titolo, a1173.capo, a1173.sezione) == (
            "LIBRO QUARTO Delle obbligazioni", "TITOLO I Delle obbligazioni in generale",
            "CAPO I Disposizioni preliminari", None)
        assert (a1176.capo, a1176.sezione) == ("CAPO II Dell'adempimento", "SEZIONE I Dell'adempimento in generale")
        assert (a2043.titolo, a2043.capo, a2043.sezione) == ("TITOLO IX Dei fatti illeciti", None, None)
        assert (a2060.libro, a2060.titolo) == ("LIBRO QUINTO Del lavoro", None)
        assert all(a.annex == "2" for a in out)

    def test_a_new_annex_resets_every_level_and_labels_do_not(self):
        items = [
            "Disposizioni sulla legge in generale",      # annex label, not a heading
            "CAPO I Delle fonti del diritto",
            {"numero": "1", "allegato": "1"},
            "CODICE CIVILE",                             # annex label
            "LIBRO PRIMO Delle persone e della famiglia",
            {"numero": "1", "allegato": "2"},
            {"numero": "2", "allegato": "2"},
        ]
        out = walk_tree(items)
        assert out[0] == IndexedArticle(number="1", raw_number="1", position=0, annex="1",
                                        parte=None, libro=None, titolo=None,
                                        capo="CAPO I Delle fonti del diritto", sezione=None)
        assert out[1].annex == "2" and out[1].capo is None
        assert out[1].libro == "LIBRO PRIMO Delle persone e della famiglia"
        assert out[2].position == 2

    def test_numbers_are_normalised_and_the_raw_kept(self):
        out = walk_tree([{"numero": "2 bis", "allegato": None}])
        assert out[0].number == "2-bis"
        assert out[0].raw_number == "2 bis"
        assert out[0].annex is None

    def test_eu_items_have_no_annex_key(self):
        out = walk_tree(["CAPO I", {"numero": "1"}, {"numero": "2"}])
        assert [a.annex for a in out] == [None, None]
        assert out[1].capo == "CAPO I"

    def test_parte_sits_above_libro(self):
        out = walk_tree(["PARTE I Diritti e doveri dei cittadini", "TITOLO I Rapporti civili",
                         {"numero": "13"}, "PARTE II Ordinamento della Repubblica", {"numero": "55"}])
        assert (out[0].parte, out[0].titolo) == ("PARTE I Diritti e doveri dei cittadini", "TITOLO I Rapporti civili")
        assert (out[1].parte, out[1].titolo) == ("PARTE II Ordinamento della Repubblica", None)

    def test_non_article_dicts_are_skipped(self):
        out = walk_tree([{"numero": ""}, {"foo": 1}, {"numero": "3"}])
        assert [a.number for a in out] == ["3"]
