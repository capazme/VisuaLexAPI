"""The merged act tables, and the two lookups that were case-broken."""
import pytest

from visualex_api.tools.map import (
    ATTI_DENOMINATI,
    ATTI_NOTI,
    NORMATTIVA,
    NORMATTIVA_SEARCH,
    NORMATTIVA_URN_CODICI,
    BROCARDI_CODICI,
    codice_urn,
    extract_codice_details,
)


class TestNothingWasLost:
    """The merge is additive. These keys existed before and must survive."""

    @pytest.mark.parametrize("key", [
        "regolamento di attuazione del Codice della proprietà industriale",
        "regolamento per l'esecuzione del codice di procedura penale",
    ])
    def test_visualex_only_urn_codici_survive(self, key):
        assert key in NORMATTIVA_URN_CODICI

    def test_visualex_only_brocardi_key_survives(self):
        assert any("28 luglio 1989, n. 271" in k for k in BROCARDI_CODICI)

    def test_the_dotted_urn_table_is_untouched(self):
        # text_op.normalize_act_type(search=False) reads this one; the source
        # repo has no counterpart, so a wholesale replacement would ImportError.
        assert len(NORMATTIVA) == 111

    @pytest.mark.parametrize("key", [
        "codice del Terzo settore",
        "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
        "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    ])
    def test_capitalised_spellings_are_kept_alongside_lowercase(self, key):
        assert key in NORMATTIVA_SEARCH
        assert key.lower() in NORMATTIVA_SEARCH


class TestNewTables:
    def test_atti_noti_size(self):
        assert len(ATTI_NOTI) >= 63

    def test_atti_denominati_size(self):
        assert len(ATTI_DENOMINATI) >= 200

    @pytest.mark.parametrize("alias,numero", [
        ("statuto dei lavoratori", "300"),
        ("legge fallimentare", "267"),
        ("tusl", "81"),
        ("legge fornero", "92"),
    ])
    def test_known_aliases_resolve_to_the_right_act(self, alias, numero):
        assert ATTI_DENOMINATI[alias]["numero_atto"] == numero

    def test_every_row_has_the_three_fields(self):
        for alias, row in {**ATTI_NOTI, **ATTI_DENOMINATI}.items():
            assert set(row) == {"tipo_atto", "data", "numero_atto"}, alias


class TestCaseInsensitiveCodici:
    """The capital-T bug: 6 URN keys carry capitals, every lookup arrives lowered."""

    @pytest.mark.parametrize("name", ["codice del Terzo settore", "codice del terzo settore"])
    def test_codice_urn_is_case_insensitive(self, name):
        assert codice_urn(name) == "decreto.legislativo:2017-07-03;117"

    @pytest.mark.parametrize("name", ["codice del Terzo settore", "codice del terzo settore"])
    def test_extract_codice_details_resolves_either_casing(self, name):
        details = extract_codice_details(name)
        assert details is not None
        assert details["numero_atto"] == "117"
        assert details["data"] == "2017-07-03"

    def test_allegato_bearing_codici_still_resolve(self):
        assert codice_urn("codice civile") == "regio.decreto:1942-03-16;262:2"
        assert extract_codice_details("codice civile")["numero_atto"] == "262"
