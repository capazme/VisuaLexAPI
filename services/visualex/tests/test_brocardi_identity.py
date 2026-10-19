"""The Brocardi page of an act is found by identity, never by substring.

do_know used to build "D.lgs. 2001-06-08, n. 231" and look for it inside the
table labels, which spell "(D.lgs. 8 giugno 2001, n. 231)": every act that is
not a codice came back without dottrina and massime — 69 of the 100 sources
listed at brocardi.it/fonti.html. The labels are data; the identity (tipo,
anno, numero) parsed from them is what a norma must be matched against.
"""

import pytest

from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.tools.map import BROCARDI_CODICI, find_brocardi_url, parse_brocardi_estremi
from visualex_api.tools.norma import Norma, NormaVisitata

B = "https://www.brocardi.it"

# Labels without "(tipo giorno mese anno, n. N)" — matched by name only.
LABELS_WITHOUT_ESTREMI = {
    "Costituzione",
    "Preleggi",
    "Contratto Collettivo Nazionale del Lavoro Domestico",
    # Delisted from brocardi.it/fonti.html but the page still answers.
    "Contratto Collettivo Nazionale del Turismo, Pubblici esercizi, Ristorazione collettiva e commerciale, Alberghi",
}


@pytest.fixture(scope="module")
def scraper():
    return BrocardiScraper()


class TestParseBrocardiEstremi:
    def test_decreto_legislativo(self):
        parsed = parse_brocardi_estremi(
            "Disciplina della responsabilità amministrativa delle persone giuridiche(D.lgs. 8 giugno 2001, n. 231)"
        )
        assert parsed == {"tipo_atto": "decreto legislativo", "data": "2001-06-08", "numero_atto": "231"}

    def test_regolamento_ue(self):
        parsed = parse_brocardi_estremi(
            "Regolamento generale sulla protezione dei dati(Reg. UE 27 aprile 2016, n. 679)"
        )
        assert parsed == {"tipo_atto": "regolamento ue", "data": "2016-04-27", "numero_atto": "679"}

    def test_label_without_estremi(self):
        assert parse_brocardi_estremi("Preleggi") is None

    def test_every_label_with_parenthesis_parses(self):
        unparsed = [key for key in BROCARDI_CODICI if "(" in key and parse_brocardi_estremi(key) is None]
        assert unparsed == []

    def test_only_the_known_labels_lack_estremi(self):
        bare = {key for key in BROCARDI_CODICI if parse_brocardi_estremi(key) is None}
        assert bare == LABELS_WITHOUT_ESTREMI


class TestFindBrocardiUrlIdentity:
    def test_every_labelled_entry_round_trips(self):
        mismatches = []
        for key, url in BROCARDI_CODICI.items():
            parsed = parse_brocardi_estremi(key)
            if parsed is None:
                continue
            found = find_brocardi_url(parsed["tipo_atto"], parsed["numero_atto"], parsed["data"])
            if found != url:
                mismatches.append((key, found))
        assert mismatches == []

    def test_statuto_lavoratori(self):
        assert find_brocardi_url("legge", "300", "1970-05-20") == f"{B}/statuto-lavoratori/"

    def test_year_alone_is_enough_as_date(self):
        assert find_brocardi_url("decreto legislativo", "231", "2001") == (
            f"{B}/responsabilita-amministrativa-persone-giuridiche/"
        )

    def test_abbreviated_tipo_is_normalised(self):
        assert find_brocardi_url("d.lgs.", "231", "2001") == (
            f"{B}/responsabilita-amministrativa-persone-giuridiche/"
        )

    def test_same_number_different_year_and_tipo(self):
        assert find_brocardi_url("decreto legislativo", "81", "2008") == f"{B}/testo-unico-sicurezza-sul-lavoro/"
        assert find_brocardi_url("decreto legislativo", "81", "2015") == f"{B}/disciplina-organica-contratti-lavoro/"
        assert find_brocardi_url("legge", "81", "2017") == f"{B}/lavoro-agile/"

    def test_missing_year_with_unique_number_resolves(self):
        assert find_brocardi_url("decreto legislativo", "231") == (
            f"{B}/responsabilita-amministrativa-persone-giuridiche/"
        )

    def test_missing_year_with_ambiguous_number_returns_none(self):
        assert find_brocardi_url("decreto legislativo", "81") is None

    def test_act_not_on_brocardi_returns_none(self):
        assert find_brocardi_url("legge", "89", "2001-03-24") is None  # legge Pinto

    def test_wrong_year_returns_none(self):
        assert find_brocardi_url("legge", "300", "1971") is None

    def test_gdpr(self):
        assert find_brocardi_url("regolamento ue", "679", "2016") == f"{B}/regolamento-privacy-ue/"

    def test_testo_unico_maternita_by_identity(self):
        assert find_brocardi_url("decreto legislativo", "151", "2001") == (
            f"{B}/testo-unico-sostegno-maternita-paternita/"
        )


class TestFindBrocardiUrlByName:
    def test_codice_civile(self):
        assert find_brocardi_url("codice civile") == f"{B}/codice-civile/"

    def test_costituzione(self):
        assert find_brocardi_url("costituzione") == f"{B}/costituzione/"

    def test_preleggi_share_the_codice_civile_estremi(self):
        assert find_brocardi_url("preleggi") == f"{B}/preleggi/"
        assert find_brocardi_url("preleggi", "262", "1942-03-16") == f"{B}/preleggi/"

    def test_codice_name_from_normattiva_urn(self):
        assert find_brocardi_url("codice in materia di protezione dei dati personali") == (
            f"{B}/codice-della-privacy/"
        )
        assert find_brocardi_url("norme in materia ambientale") == f"{B}/codice-dell-ambiente/"

    def test_codice_contratti_pubblici_is_the_current_code(self):
        assert find_brocardi_url("codice dei contratti pubblici") == f"{B}/nuovo-codice-appalti/"

    def test_abrogated_codice_contratti_pubblici_by_explicit_citation(self):
        assert find_brocardi_url("decreto legislativo", "50", "2016") == f"{B}/codice-dei-contratti-pubblici/"

    def test_plain_label_name(self):
        assert find_brocardi_url("statuto dei lavoratori") == f"{B}/statuto-lavoratori/"

    def test_label_name_with_matching_estremi(self):
        assert find_brocardi_url("statuto dei lavoratori", "300") == f"{B}/statuto-lavoratori/"
        assert find_brocardi_url("statuto dei lavoratori", "300", "1970") == f"{B}/statuto-lavoratori/"

    def test_label_name_with_contradicting_estremi_returns_none(self):
        assert find_brocardi_url("statuto dei lavoratori", "267") is None
        assert find_brocardi_url("statuto dei lavoratori", "300", "1971") is None

    def test_explicit_estremi_beat_the_codice_urn(self):
        # "codice dei contratti pubblici" alone is the current code (D.lgs. 36/2023);
        # with the abrogated code's own estremi the caller means D.lgs. 50/2016.
        assert find_brocardi_url("codice dei contratti pubblici", "50", "2016") == (
            f"{B}/codice-dei-contratti-pubblici/"
        )
        assert find_brocardi_url("codice dei contratti pubblici", "36", "2023") == f"{B}/nuovo-codice-appalti/"
        assert find_brocardi_url("codice civile", "999", "1942") is None

    def test_no_duplicate_labels(self):
        import ast
        from pathlib import Path

        import visualex_api.tools.map as map_module

        tree = ast.parse(Path(map_module.__file__).read_text(encoding="utf-8"))
        table = next(
            node.value for node in ast.walk(tree)
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "BROCARDI_CODICI" for t in node.targets
            )
        )
        keys = [k.value for k in table.keys]
        assert len(keys) == len(set(keys)), sorted({k for k in keys if keys.count(k) > 1})

    def test_substring_of_a_label_is_not_a_match(self):
        assert find_brocardi_url("legge") is None
        assert find_brocardi_url("testo unico") is None

    def test_unknown(self):
        assert find_brocardi_url("fantasy_law_xyz") is None


class TestDoKnow:
    """do_know is what the scraper asks before fetching anything."""

    async def test_decreto_legislativo_by_identity(self, scraper):
        nv = NormaVisitata(norma=Norma("decreto legislativo", "2001-06-08", "231"), numero_articolo="6")
        found = await scraper.do_know(nv)
        assert found is not None
        assert found[1] == f"{B}/responsabilita-amministrativa-persone-giuridiche/"

    async def test_year_disambiguates(self, scraper):
        tusl = NormaVisitata(norma=Norma("decreto legislativo", "2008-04-09", "81"), numero_articolo="2")
        jobs = NormaVisitata(norma=Norma("decreto legislativo", "2015-06-15", "81"), numero_articolo="2")
        assert (await scraper.do_know(tusl))[1] == f"{B}/testo-unico-sicurezza-sul-lavoro/"
        assert (await scraper.do_know(jobs))[1] == f"{B}/disciplina-organica-contratti-lavoro/"

    async def test_legge_is_its_own_page(self, scraper):
        nv = NormaVisitata(norma=Norma("legge", "1970-05-20", "300"), numero_articolo="18")
        assert (await scraper.do_know(nv))[1] == f"{B}/statuto-lavoratori/"

    async def test_abbreviated_tipo(self, scraper):
        nv = NormaVisitata(norma=Norma("d.p.r.", "2001-06-06", "380"), numero_articolo="10")
        assert (await scraper.do_know(nv))[1] == f"{B}/testo-unico-edilizia/"

    async def test_codice(self, scraper):
        nv = NormaVisitata(norma=Norma("codice civile"), numero_articolo="2043")
        assert (await scraper.do_know(nv))[1] == f"{B}/codice-civile/"

    async def test_act_not_on_brocardi(self, scraper):
        nv = NormaVisitata(norma=Norma("legge", "2001-03-24", "89"), numero_articolo="2")
        assert await scraper.do_know(nv) is None


class TestResolverAliases:
    """The fonti as brocardi.it/fonti.html names them must resolve."""

    @pytest.mark.parametrize("name", [
        "Regolamento generale sulla protezione dei dati",
        "regolamento generale sulla protezione dei dati",
    ])
    def test_gdpr_full_name(self, name):
        from visualex_api.tools.act_resolver import resolve_atto

        assert resolve_atto(name) == {"tipo_atto": "regolamento ue", "data": "2016", "numero_atto": "679"}

    def test_disposizioni_attuazione_cpp(self):
        from visualex_api.tools.act_resolver import resolve_atto

        assert resolve_atto("disposizioni di attuazione del codice di procedura penale") == {
            "tipo_atto": "decreto legislativo", "data": "1989-07-28", "numero_atto": "271",
        }

    @pytest.mark.parametrize("name, numero", [
        ('Decreto "Sostegni"', "41"),
        ('Decreto "Rilancio"', "34"),
        ('Decreto "Cura Italia"', "18"),
        ('Decreto "Semplificazioni bis"', "77"),
    ])
    def test_quoted_nicknames(self, name, numero):
        from visualex_api.tools.act_resolver import resolve_atto

        result = resolve_atto(name)
        assert result is not None
        assert result["numero_atto"] == numero


@pytest.mark.live
@pytest.mark.asyncio
async def test_every_brocardi_page_answers_and_every_listed_source_is_mapped():
    """Drift detector over BROCARDI_CODICI, run by hand (`-m live`).

    A page Brocardi moved or dropped answers 404 or redirects home, and the act
    it served silently loses its dottrina and massime; a source added to
    brocardi.it/fonti.html shows up here instead of staying unmapped.
    """
    import asyncio
    from urllib.parse import urlparse

    import aiohttp
    from bs4 import BeautifulSoup

    headers = {"User-Agent": "Mozilla/5.0 (compatible; VisuaLexAPI test suite)"}
    sem = asyncio.Semaphore(5)
    failures = []

    async def check(session, label, url):
        async with sem:
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status != 200:
                        failures.append(f"{label}: {url} → HTTP {r.status}")
                    elif urlparse(str(r.url)).path.rstrip("/") != urlparse(url).path.rstrip("/"):
                        failures.append(f"{label}: {url} → redirected to {r.url}")
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{label}: {url} → {type(exc).__name__}")

    async with aiohttp.ClientSession(headers=headers) as session:
        await asyncio.gather(*[check(session, label, url) for label, url in BROCARDI_CODICI.items()])
        async with session.get("https://www.brocardi.it/fonti.html") as r:
            assert r.status == 200
            # Served as ISO-8859-1 whatever the declared charset says.
            soup = BeautifulSoup((await r.read()).decode("latin-1"), "lxml")

    assert not failures, "\n".join([f"{len(failures)} pagine Brocardi non rispondono:"] + failures)

    listed = {
        a["href"] for a in soup.select("a[href]")
        if a["href"].startswith("/") and a["href"].endswith("/") and a["href"].count("/") == 2
    } - {"/chi-siamo/"}
    mapped = {urlparse(url).path for url in BROCARDI_CODICI.values()}
    assert not (listed - mapped), "fonti Brocardi senza mapping: " + ", ".join(sorted(listed - mapped))
