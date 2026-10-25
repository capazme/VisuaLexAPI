"""The Corte costituzionale's massime under each article: the mapping of `norme` and
`parametri` onto the source convention, the index on disk, how often the source is asked, and
the route (G-281)."""
import asyncio
import io
import json
import pathlib
import zipfile

import pytest

from app import NormaController
from visualex_api.services.decisions import corte_cost_massime
from visualex_api.services.decisions.corte_cost_massime import (
    ATTRIBUTION,
    BUNDLES,
    INDEX_NAME,
    CorteCostMassime,
    MassimeUnavailable,
    build_index,
    massima_text,
    query_index,
    reference_identity,
    search_massime,
)
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError

HERE = pathlib.Path(__file__).parent
# two real records, each cut to one short massima (attribution inside the file)
SAMPLE = json.loads((HERE / "fixtures" / "decisions" / "corte_cost_massime_sample.json")
                    .read_text(encoding="utf-8"))["anni"]
GOLDEN = {n["id"]: n for n in json.loads(
    (HERE.parents[2] / "conventions" / "sources" / "golden.json").read_text(encoding="utf-8"))["norms"]}
R = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
CC_2043 = f"{R}regio.decreto:1942-03-16;262:2~art2043"
CP_131_BIS = f"{R}regio.decreto:1930-10-19;1398:1~art131bis"


def entry(descrizione, articolo="", spec="", numero="", data="", comma=""):
    """An entry of `norme` or `parametri` as the open data write it."""
    return {"specificazione_articolo": spec, "descrizione": descrizione, "comma": comma,
            "numero": numero, "data": data, "articolo": articolo, "specificazione_comma": ""}


# --- the mapping ------------------------------------------------------------------------------

@pytest.mark.parametrize("golden_id, written", [
    ("cc-2043", entry("codice civile", "2043")),
    ("cost-81", entry("Costituzione", "81", comma="1")),
    ("l-241-1990-2", entry("legge", "2", numero="241", data="07/08/1990")),
    ("cpc-183-bis", entry("codice di procedura civile", "183", "bis")),
    ("cpp-191", entry("codice di procedura penale", "191")),
    ("dispatt-cc-3", entry("codice civile (disposizioni di attuazione del)", "3")),
    ("dl-18-2020-1", entry("decreto-legge", "1", numero="18", data="17/03/2020")),
    ("dpr-445-2000-38", entry("decreto del presidente della repubblica", "38", numero="445", data="28/12/2000")),
    ("rd-773-1931-86", entry("regio decreto", "86", numero="773", data="18/06/1931")),
    ("dlgs-385-1993-127", entry("decreto legislativo", "127", numero="385", data="01/09/1993")),
    ("lcost-1-2012-1", entry("legge costituzionale", "1", numero="1", data="20/04/2012")),
    ("dm-55-2014-4", entry("decreto ministeriale", "4", numero="55", data="10/03/2014")),
])
def test_an_entry_names_the_article_the_convention_names(golden_id, written):
    assert reference_identity(written) == GOLDEN[golden_id]["identity"]["article"]["value"]


@pytest.mark.parametrize("written, identity", [
    (entry("codice penale", "131", "bis"), CP_131_BIS),
    (entry("legge", "21", "nonies", numero="241", data="07/08/1990"), f"{R}legge:1990-08-07;241~art21nonies"),
    (entry("legge", "10", "BIS", numero="241", data="7/8/1990"), f"{R}legge:1990-08-07;241~art10bis"),
    (entry("decreto legge", "4", numero="262", data="03/10/2006"), f"{R}decreto.legge:2006-10-03;262~art4"),
    (entry("codice della strada (d.lgs. 30.4.1992, n. 285)", "186"), f"{R}decreto.legislativo:1992-04-30;285~art186"),
    (entry("codice di procedura penale (nuovo)", "444"), f"{R}decreto.del.presidente.della.repubblica:1988-09-22;447~art444"),
    # a part of the article in the suffix's field: the article is the identity
    (entry("Costituzione", "117", "lett.a", comma="2"), f"{R}costituzione~art117"),
    (entry("legge", "2", "n. 1", numero="241", data="07/08/1990"), f"{R}legge:1990-08-07;241~art2"),
    (entry("codice civile", "2043", "e segg."), CC_2043),
    # the number in the suffix's field and the article left empty (s. 156/2020)
    (entry("decreto legislativo", "", "1", numero="28", data="16/03/2015"), f"{R}decreto.legislativo:2015-03-16;28~art1"),
    # a code cited by its enacting decree: its articles are the annex's (the c.p.a., the c.p.)
    (entry("decreto legislativo", "135", numero="104", data="02/07/2010"), f"{R}decreto.legislativo:2010-07-02;104:2~art135"),
    (entry("regio decreto", "575", numero="1398", data="19/10/1930"), f"{R}regio.decreto:1930-10-19;1398:1~art575"),
    (entry("disposizioni sulla legge in generale", "12"), f"{R}regio.decreto:1942-03-16;262:1~art12"),
    (entry("Disposizioni preliminari al codice civile", "11"), f"{R}regio.decreto:1942-03-16;262:1~art11"),
    # no article: the act
    (entry("legge", "", numero="241", data="07/08/1990"), f"{R}legge:1990-08-07;241"),
])
def test_an_entry_is_read_into_an_identity(written, identity):
    assert reference_identity(written) == identity


@pytest.mark.parametrize("written", [
    entry("legge della Regione siciliana", "90", numero="6", data="03/05/2001"),
    entry("statuto regione sicilia", "14"),
    entry("codice di procedura penale 1930", "34"),
    entry("codice civile anteriore (25 luglio 1865)", "1151"),
    entry("convenzione europea dei diritti dell'uomo e delle libertà fondamentali (roma 04/11/1950)", "6"),
    entry("legge", "3", numero="", data="07/08/1990"),  # no number
    entry("legge", "3", numero="241", data=""),  # no date
    entry("legge", "3", numero="241", data="1990"),  # a year only
    entry("legge", "3a", numero="241", data="07/08/1990"),
    entry(""),
    # R.D. 262/1942 holds two codes (the preleggi and the codice civile): which one is not said
    entry("regio decreto", "12", numero="262", data="16/03/1942"),
])
def test_an_entry_visualex_does_not_read_names_nothing(written):
    assert reference_identity(written) is None


def test_the_text_is_kept_as_the_court_wrote_it():
    assert massima_text("  Accolta  in parte qua \r\n - per violazione\r dell'art. 3 Cost. ") == \
        "Accolta  in parte qua \n - per violazione\n dell'art. 3 Cost."
    # a Windows-1252 quote the latin-1 decoding turned into a control character
    assert massima_text("dell\x92art. 3") == "dell’art. 3"


# --- the bundles and the index ----------------------------------------------------------------

def make_bundle(years: dict[str, list[dict]]) -> bytes:
    """A range bundle as the court publishes it: a zip of per-year zips of JSON in latin-1, the
    characters latin-1 has no room for written as JSON escapes."""
    outer_buf = io.BytesIO()
    with zipfile.ZipFile(outer_buf, "w") as outer:
        for year, records in years.items():
            inner_buf = io.BytesIO()
            with zipfile.ZipFile(inner_buf, "w") as inner:
                inner.writestr(f"Cc_OpenData_Massime_{year}.json", json.dumps(
                    {"corte_costituzionale_archiviomassime": records},
                    ensure_ascii=False).encode("latin-1", "backslashreplace"))
            outer.writestr(f"Cc_OpenData_Massime_{year}_json.zip", inner_buf.getvalue())
    return outer_buf.getvalue()


def synthetic(anno: int, numero: int, n_massime: int, refs: list[dict], tipo="O") -> dict:
    return {"numero_pronuncia": str(numero), "anno_pronuncia": str(anno), "tipologia_pronuncia": tipo,
            "data_decisione": f"10/01/{anno}", "data_deposito": f"20/01/{anno}",
            "tipologia_giudizio": "GIUDIZIO DI LEGITTIMITÀ COSTITUZIONALE IN VIA INCIDENTALE",
            "massime": [{"numero": f"{numero}{i:02d}", "titolo": "Responsabilità civile - Danno",
                         "testo": f"Massima {i} della pronuncia {numero}/{anno}: è così.",
                         "norme": refs} for i in range(n_massime)]}


@pytest.fixture
def bundles(tmp_path):
    """The three bundles on disk: the sample in the open one, synthetic decisions in the others."""
    contents = {
        "CC_M_1956_1980_json.zip": make_bundle({"1970": [synthetic(1970, 7, 1, [entry("codice civile", "2043")])]}),
        "CC_M_1981_2000_json.zip": make_bundle({"1990": []}),
        "CC_M_2001_2015_json.zip": make_bundle(SAMPLE),
    }
    for name, data in contents.items():
        (tmp_path / name).write_bytes(data)
    return contents


def test_the_index_answers_the_sample(tmp_path, bundles):
    counts = build_index([tmp_path / name for _, _, name in BUNDLES], tmp_path / "i.sqlite3", "s")
    assert counts["massime"] == 3
    rows, by_role = query_index(tmp_path / "i.sqlite3", CP_131_BIS)
    assert by_role == {"totale": 2, "norma": 2}
    # the newest decision first, its text as published
    assert [r["numero"] for r in rows] == ["47182", "43415"]
    assert rows[0]["testo"].startswith("Va riconosciuta l’ampia discrezionalità del legislatore")
    assert rows[1]["testo"] == SAMPLE["2020"][0]["massime"][0]["testo"].strip()
    assert rows[0]["pronuncia"] == {
        "identita": {"corte": "corte_costituzionale", "numero": 5, "anno": 2026},
        "tipo": "sentenza", "data_decisione": "2025-11-20", "data_deposito": "2026-01-22",
        "url": "https://www.cortecostituzionale.it/scheda-pronuncia/2026/5"}
    assert rows[1]["ruoli"] == ["norma"]
    # art. 27 Cost. is a parameter of the 2020 massima
    rows, by_role = query_index(tmp_path / "i.sqlite3", f"{R}costituzione~art27")
    assert [r["numero"] for r in rows] == ["43415"] and rows[0]["ruoli"] == ["parametro"]
    assert query_index(tmp_path / "i.sqlite3", f"{R}costituzione~art28") == ([], {"totale": 0})


def test_an_article_named_twice_by_one_massima_counts_once(tmp_path):
    twice = [entry("codice civile", "2043", comma="1"), entry("codice civile", "2043", comma="2")]
    (tmp_path / "b.zip").write_bytes(make_bundle({"2001": [synthetic(2001, 3, 1, twice)]}))
    build_index([tmp_path / "b.zip"], tmp_path / "i.sqlite3", "s")
    rows, by_role = query_index(tmp_path / "i.sqlite3", CC_2043)
    assert len(rows) == 1 and by_role["totale"] == 1


def test_the_index_is_paged(tmp_path):
    (tmp_path / "b.zip").write_bytes(make_bundle({"2001": [
        synthetic(2001, n, 1, [entry("codice civile", "2043")]) for n in range(1, 26)]}))
    build_index([tmp_path / "b.zip"], tmp_path / "i.sqlite3", "s")
    first, by_role = query_index(tmp_path / "i.sqlite3", CC_2043, 1)
    second, _ = query_index(tmp_path / "i.sqlite3", CC_2043, 2)
    assert by_role["totale"] == 25 and len(first) == 20 and len(second) == 5
    assert first[0]["pronuncia"]["identita"]["numero"] == 25
    assert second[-1]["pronuncia"]["identita"]["numero"] == 1


def test_the_index_keeps_one_role_when_asked(tmp_path):
    # G-289: on the Costituzione the web asks for the massime where the article is at issue first
    art3 = entry("Costituzione", "3")
    at_issue, measure, both = (synthetic(2001, n, 1, []) for n in (1, 2, 3))
    at_issue["massime"][0]["norme"] = [art3]
    measure["massime"][0]["parametri"] = [art3]
    both["massime"][0]["norme"] = both["massime"][0]["parametri"] = [art3]
    (tmp_path / "b.zip").write_bytes(make_bundle({"2001": [at_issue, measure, both]}))
    build_index([tmp_path / "b.zip"], tmp_path / "i.sqlite3", "s")
    cost_3 = f"{R}costituzione~art3"
    every, counts = query_index(tmp_path / "i.sqlite3", cost_3)
    assert [r["numero"] for r in every] == ["300", "200", "100"]
    assert counts == {"totale": 3, "norma": 2, "parametro": 2}
    norma, same = query_index(tmp_path / "i.sqlite3", cost_3, ruolo="norma")
    assert same == counts
    # a massima naming it both ways keeps both roles
    assert [(r["numero"], r["ruoli"]) for r in norma] == [("300", ["norma", "parametro"]), ("100", ["norma"])]
    parametro, _ = query_index(tmp_path / "i.sqlite3", cost_3, ruolo="parametro")
    assert [r["numero"] for r in parametro] == ["300", "200"]
    assert query_index(tmp_path / "i.sqlite3", cost_3, 2, 1, "norma")[0][0]["numero"] == "100"


def test_an_index_of_an_earlier_version_is_dropped(tmp_path):
    (tmp_path / "massime-v1.sqlite3").write_bytes(b"old")
    (tmp_path / INDEX_NAME).write_bytes(b"current")
    corte_cost_massime._drop_old_indexes(tmp_path)
    assert sorted(p.name for p in tmp_path.iterdir()) == [INDEX_NAME]


def test_a_changed_layout_is_an_error_not_an_empty_index(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as outer:
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as z:
            z.writestr("Cc_OpenData_Massime_2001.json", json.dumps({"altro": []}))
        outer.writestr("Cc_OpenData_Massime_2001_json.zip", inner.getvalue())
    (tmp_path / "b.zip").write_bytes(buf.getvalue())
    with pytest.raises(ValueError):
        build_index([tmp_path / "b.zip"], tmp_path / "i.sqlite3", "s")
    assert not (tmp_path / "i.sqlite3").exists()
    assert list(tmp_path.glob("*.tmp")) == []


# --- how often the source is asked ------------------------------------------------------------

class Clock:
    def __init__(self, now: float):
        self.now = now

    def __call__(self) -> float:
        return self.now


def _serve(monkeypatch, contents: dict[str, bytes], fail: bool = False, gate: asyncio.Event | None = None):
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(url.rsplit("/", 1)[1])
        assert kwargs["text_encoding"] == "latin-1"
        if gate is not None:
            await gate.wait()
        if fail:
            raise NetworkError("down", status_code=503)
        return HttpResult(text=contents[url.rsplit("/", 1)[1]].decode("latin-1"), status=200, headers={})

    monkeypatch.setattr(corte_cost_massime.decisions_http_client, "request", fake_request)
    return calls


@pytest.fixture
def served(bundles):
    return bundles


async def test_the_bundles_are_downloaded_once_and_the_index_answers(monkeypatch, tmp_path, served):
    import time
    cache = tmp_path / "cache"
    calls = _serve(monkeypatch, served)
    reader = CorteCostMassime(cache, clock=Clock(time.time()))
    rows, by_role, built_at = await reader.massime_for(CP_131_BIS)
    assert sorted(calls) == sorted(name for _, _, name in BUNDLES)
    assert by_role["totale"] == 2 and built_at
    rows, _, _ = await reader.massime_for(CC_2043)
    assert [r["pronuncia"]["identita"] for r in rows] == [{"corte": "corte_costituzionale", "numero": 7, "anno": 1970}]
    assert len(calls) == 3  # no request per massima, none per lookup


async def test_a_day_later_only_the_open_bundle_is_asked_again_in_the_background(monkeypatch, tmp_path, served):
    import time
    clock = Clock(time.time())
    calls = _serve(monkeypatch, served)
    reader = CorteCostMassime(tmp_path / "cache", clock=clock)
    await reader.massime_for(CP_131_BIS)
    clock.now += 25 * 3600
    rows, _, _ = await reader.massime_for(CP_131_BIS)  # answered from the index on disk
    assert len(rows) == 2
    await reader._task
    assert calls[3:] == ["CC_M_2001_2015_json.zip"]


async def test_a_failed_refresh_keeps_the_index_and_rests_an_hour(monkeypatch, tmp_path, served):
    import time
    clock = Clock(time.time())
    _serve(monkeypatch, served)
    reader = CorteCostMassime(tmp_path / "cache", clock=clock)
    await reader.massime_for(CP_131_BIS)
    calls = _serve(monkeypatch, served, fail=True)
    clock.now += 25 * 3600
    rows, _, _ = await reader.massime_for(CP_131_BIS)
    await asyncio.gather(reader._task, return_exceptions=True)
    assert len(rows) == 2 and calls == ["CC_M_2001_2015_json.zip"]
    clock.now += 600
    rows, _, _ = await reader.massime_for(CP_131_BIS)
    assert len(rows) == 2 and len(calls) == 1  # resting: not asked again within the hour


async def test_no_index_and_no_source_is_unavailable(monkeypatch, tmp_path, served):
    _serve(monkeypatch, served, fail=True)
    reader = CorteCostMassime(tmp_path / "cache")
    with pytest.raises(MassimeUnavailable) as raised:
        await reader.massime_for(CP_131_BIS)
    assert raised.value.preparing is False


async def test_a_slow_first_build_says_it_is_being_made(monkeypatch, tmp_path, served):
    gate = asyncio.Event()
    _serve(monkeypatch, served, gate=gate)
    reader = CorteCostMassime(tmp_path / "cache", first_build_wait=0.01)
    with pytest.raises(MassimeUnavailable) as raised:
        await reader.massime_for(CP_131_BIS)
    assert raised.value.preparing is True
    gate.set()
    await reader._task  # the build went on in the background
    rows, _, _ = await reader.massime_for(CP_131_BIS)
    assert len(rows) == 2


async def test_a_damaged_index_is_dropped_and_built_again(monkeypatch, tmp_path, served):
    calls = _serve(monkeypatch, served)
    reader = CorteCostMassime(tmp_path / "cache")
    await reader.massime_for(CP_131_BIS)
    reader.index.write_bytes(b"not a database")
    with pytest.raises(MassimeUnavailable) as raised:
        await reader.massime_for(CP_131_BIS)
    assert raised.value.preparing is True and not reader.index.exists()
    rows, _, _ = await reader.massime_for(CP_131_BIS)
    assert len(rows) == 2 and len(calls) == 3  # rebuilt from the bundles on disk, none fetched


# --- the route --------------------------------------------------------------------------------

@pytest.fixture
def client():
    return NormaController().app.test_client()


@pytest.fixture
def reader(monkeypatch, tmp_path, served):
    _serve(monkeypatch, served)
    held = CorteCostMassime(tmp_path / "cache")
    monkeypatch.setattr(corte_cost_massime, "_reader", held)
    return held


async def test_the_route_answers_an_articles_massime(client, reader):
    # the URN the web sends (norma_data.urn), with a version marker the convention cuts
    resp = await client.post("/search_corte_cost_massime", json={
        "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1930-10-19;1398:1~art131bis!vig=2026-10-19"})
    assert resp.status_code == 200
    body = await resp.get_json()
    assert body["esito"] == "risultati" and body["urn"] == CP_131_BIS
    assert (body["totale"], body["pagina"], body["per_pagina"]) == (2, 1, 20)
    assert body["per_ruolo"] == {"norma": 2, "parametro": 0}
    assert body["attribuzione"] == ATTRIBUTION == "Massime: Corte costituzionale — dati aperti, CC BY-SA 3.0"
    assert body["fonte"]["licenza"] == "CC BY-SA 3.0" and body["fonte"]["url"].startswith("https://dati.cortecostituzionale.it/")
    assert set(body["massime"][0]) == {"numero", "titolo", "testo", "ruoli", "pronuncia"}
    assert body["aggiornato_al"]


async def test_the_route_answers_an_article_without_massime(client, reader):
    resp = await client.post("/search_corte_cost_massime", json={"urn": f"{R}regio.decreto:1942-03-16;262:2~art1117"})
    body = await resp.get_json()
    assert resp.status_code == 200 and body["totale"] == 0 and body["massime"] == []


@pytest.mark.parametrize("payload, field", [
    ({"urn": "celex:32016R0679~art5"}, "urn"),
    ({"urn": f"{R}legge:1990-08-07;241"}, "urn"),  # an act, not an article
    ({"urn": "urn:nir:regione.sicilia:legge:2001-05-03;6~art90"}, "urn"),
    ({"urn": 5}, "urn"),
    ({"urn": CC_2043, "pagina": 0}, "pagina"),
    ({"urn": CC_2043, "pagina": "2"}, "pagina"),
    ({"urn": CC_2043, "pagina": True}, "pagina"),
    ({"urn": CC_2043, "ruolo": "entrambi"}, "ruolo"),
    ({"urn": CC_2043, "ruolo": ["norma"]}, "ruolo"),
])
async def test_the_route_names_the_bad_fields(client, reader, payload, field):
    resp = await client.post("/search_corte_cost_massime", json=payload)
    assert resp.status_code == 400
    body = await resp.get_json()
    assert body["esito"] == "richiesta_non_valida" and set(body["errori"]) == {field}


async def test_the_route_keeps_one_role(client, reader):
    resp = await client.post("/search_corte_cost_massime", json={"urn": f"{R}costituzione~art27", "ruolo": "norma"})
    body = await resp.get_json()
    assert resp.status_code == 200 and body["ruolo"] == "norma"
    assert (body["totale"], body["massime"]) == (0, [])
    assert body["per_ruolo"] == {"norma": 0, "parametro": 1}
    resp = await client.post("/search_corte_cost_massime", json={"urn": f"{R}costituzione~art27", "ruolo": "parametro"})
    body = await resp.get_json()
    assert body["totale"] == 1 and [m["numero"] for m in body["massime"]] == ["43415"]
    resp = await client.post("/search_corte_cost_massime", json={"urn": f"{R}costituzione~art27"})
    assert (await resp.get_json())["ruolo"] is None


@pytest.mark.parametrize("payload", [None, [], "x", 3])
async def test_the_route_refuses_a_body_that_is_not_an_object(client, reader, payload):
    resp = await client.post("/search_corte_cost_massime", json=payload)
    assert resp.status_code == 400 and (await resp.get_json())["esito"] == "richiesta_non_valida"


async def test_the_route_says_the_source_is_unreachable(client, monkeypatch, tmp_path, served):
    _serve(monkeypatch, served, fail=True)
    monkeypatch.setattr(corte_cost_massime, "_reader", CorteCostMassime(tmp_path / "cache"))
    resp = await client.post("/search_corte_cost_massime", json={"urn": CC_2043})
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "corte_costituzionale",
                                     "in_preparazione": False}


async def test_the_route_hides_a_bug_behind_a_fixed_body(client, monkeypatch):
    async def broken(*_args, **_kwargs):
        raise RuntimeError("secret detail")
    monkeypatch.setattr("app.search_corte_cost_massime_route", broken)
    resp = await client.post("/search_corte_cost_massime", json={"urn": CC_2043})
    assert resp.status_code == 500 and await resp.get_json() == {"esito": "errore_interno"}


async def test_search_massime_pages(reader):
    answer, status = await search_massime(CP_131_BIS, 2, reader=reader)
    assert status == 200 and answer["pagina"] == 2 and answer["massime"] == [] and answer["totale"] == 2
