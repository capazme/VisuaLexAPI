"""The reviews' store, its build command and its two routes (design 2026-10-30-rassegne-without-merlt
§2, §3 (a), §10), on synthetic volumes. No request leaves: the year-only acts come resolved, or
the build is told not to ask."""
import copy
import json
import sqlite3

import pytest

from app import NormaController
from tests.massimario_fixture import volume_9001
from visualex_api.services.massimario import build as build_cli
from visualex_api.services.massimario import store
from visualex_api.services.massimario.records import build_records
from visualex_api.services.massimario.rv_bands import RvBands
from visualex_api.services.massimario.urns import NORMATTIVA_PREFIX

BANDS = RvBands({("civile", 2024): (669000, 673000)})
RESOLVED = {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
CC_2043 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
CC_1453 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


def volume(volume_id=9001, year=2024, kind="CIVILE"):
    """The synthetic volume, renumbered: another volume id (its elements too) and another year."""
    raw = volume_9001()
    text = json.dumps(raw).replace("9001", str(volume_id))
    raw = json.loads(text)
    raw["volume_id"] = volume_id
    raw["index"]["items"][0]["text"] = f"Massimario {year} {kind} Vol. 1"
    raw["capitoli"] = {int(k): v for k, v in raw["capitoli"].items()}
    raw["sezioni"] = {int(k): v for k, v in raw["sezioni"].items()}
    return raw


def records(raw=None):
    return build_records(raw or volume(), resolved=RESOLVED, bands=BANDS)


@pytest.fixture
def path(tmp_path):
    return tmp_path / store.STORE_NAME


def read(path, urn=CC_2043, **kw):
    return store.by_norma(path, urn, **{"anno": None, "archivio": None, "offset": 0, "limit": 10, **kw})


# --- Reading ----------------------------------------------------------------------------------

def test_no_store_reads_as_no_paragraph(path):
    assert read(path) == {"urn": CC_2043, "total": 0, "anni": [], "archivi": [], "anno": None,
                          "items": [], "next_cursor": None}
    assert store.volume_records(path, 9001) is None and store.list_volumes(path) == []


def test_a_norm_cited_by_stored_paragraphs(path):
    store.write_volumes(path, [(records(), "archivio")])
    answer = read(path)
    assert answer["total"] == 2 and answer["anni"] == [{"anno": 2024, "passi": 2}]
    assert answer["archivi"] == ["civile"] and answer["anno"] == 2024 and answer["next_cursor"] is None
    first, second = answer["items"]
    assert first["id"] == "massimario|9001|9111|0" and second["id"] == "massimario|9001|9121|0"
    assert set(first) == {"id", "anno", "archivio", "volume", "parte", "capitolo", "sezione", "autori",
                          "url", "testo", "evidenziazioni", "pronunce", "fonte"}
    assert first["capitolo"] == {"nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ"}
    assert first["autori"] == ["Anna Rossi", "Bruno Verdi"]
    (mark,) = first["evidenziazioni"]
    assert first["testo"][mark["start"]:mark["end"]] == "art. 2043 c.c." and mark["comma"] is None
    assert first["pronunce"][0] == {"key": "cassazione:civile:1234:2024", "corte": "cassazione",
                                    "archivio": "civile", "numero": 1234, "anno": 2024, "sezione": "U",
                                    "rv": ["670001-01"]}
    # the paragraph also cites art. 1453: only this article's citation is highlighted
    assert [m["citazione"] for m in second["evidenziazioni"]] == ["art. 2043 c.c."]


def test_years_newest_first_and_a_page_per_year(path):
    store.write_volumes(path, [(records(volume(9001, 2024)), "archivio"), (records(volume(9002, 2019)), "archivio")])
    answer = read(path)
    assert answer["anni"] == [{"anno": 2024, "passi": 2}, {"anno": 2019, "passi": 2}] and answer["total"] == 4
    assert answer["anno"] == 2024 and {i["anno"] for i in answer["items"]} == {2024}
    older = read(path, anno=2019)
    assert older["anno"] == 2019 and [i["volume"]["id"] for i in older["items"]] == [9002, 9002]
    assert read(path, anno=2001)["anno"] == 2024  # a year with no paragraph: the newest


def test_paging(path):
    store.write_volumes(path, [(records(), "archivio")])
    first = read(path, limit=1)
    assert len(first["items"]) == 1 and first["next_cursor"] == "1"
    second = read(path, limit=1, offset=1)
    assert second["items"][0]["id"] == "massimario|9001|9121|0" and second["next_cursor"] is None


def test_the_archive_filter(path):
    store.write_volumes(path, [(records(volume(9001, 2024, "CIVILE")), "archivio"),
                               (records(volume(9002, 2023, "PENALE")), "archivio")])
    assert read(path)["archivi"] == ["civile", "penale"]
    penale = read(path, archivio="penale")
    assert penale["anni"] == [{"anno": 2023, "passi": 2}] and penale["archivi"] == ["civile", "penale"]
    assert read(path, archivio="penale", anno=2024)["anno"] == 2023


def test_an_unknown_schema_is_unavailable(path):
    store.write_volumes(path, [(records(), "archivio")])
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    with pytest.raises(store.StoreUnavailable):
        read(path)
    with pytest.raises(store.StoreUnavailable):
        store.volume_records(path, 9001)


def test_an_unreadable_store_is_unavailable(path):
    path.write_bytes(b"not a database at all" * 100)
    with pytest.raises(store.StoreUnavailable):
        read(path)
    with pytest.raises(store.StoreUnavailable):  # and a build does not drop what it cannot read
        store.write_volumes(path, [(records(), "archivio")])
    assert path.read_bytes().startswith(b"not a database")


# --- Building ---------------------------------------------------------------------------------

def test_a_volume_build_keeps_the_other_volumes(path):
    store.write_volumes(path, [(records(volume(9001)), "archivio"), (records(volume(9002, 2019)), "archivio")])
    changed = volume(9002, 2019)
    changed["capitoli"][9102]["sezioni"][0]["testo"] = "<p>Nulla da citare.</p>"
    store.write_volumes(path, [(records(changed), "portale")])
    listed = {v["id"]: v for v in store.list_volumes(path)}
    assert set(listed) == {9001, 9002} and listed[9002]["source"] == "portale"
    assert read(path, anno=2019)["total"] == 3  # 9002 lost one paragraph citing 2043; 9001 kept both
    assert read(path, urn=CC_1453)["anni"] == [{"anno": 2024, "passi": 1}]  # 9002's citation is gone


def test_remove_a_volume(path):
    store.write_volumes(path, [(records(volume(9001)), "archivio"), (records(volume(9002, 2019)), "archivio")])
    store.remove_volumes(path, [9001])
    assert [v["id"] for v in store.list_volumes(path)] == [9002]
    assert read(path)["anni"] == [{"anno": 2019, "passi": 2}]
    with sqlite3.connect(path) as conn:
        for table in ("sections", "paragraphs", "norm_links", "decision_links"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table} WHERE volume_id = 9001").fetchone()[0] == 0


def test_volume_records_for_merlt(path):
    built = records()
    store.write_volumes(path, [(built, "archivio")], resolved=RESOLVED)
    answer = store.volume_records(path, 9001)
    assert answer["volume"] == built.report["volume"] and answer["source"] == "archivio"
    assert answer["parser_version"] == built.report["parser_version"] and answer["built_at"]
    assert answer["records"] == built.records and answer["report"] == built.report


def test_decision_links_and_resolutions_are_stored(path):
    store.write_volumes(path, [(records(), "archivio")], resolved={**RESOLVED, "urn:nir:stato:legge:1999;1": None})
    with sqlite3.connect(path) as conn:
        keys = {r[0] for r in conn.execute("SELECT decision_key FROM decision_links")}
    assert {"cassazione:civile:1234:2024", "corte_costituzionale:12:2024"} <= keys
    assert store.known_resolutions(path) == RESOLVED  # an act not found is asked again next time
    store.write_volumes(path, [(records(volume(9002)), "archivio")])
    assert store.known_resolutions(path) == RESOLVED  # kept across builds


def test_a_build_removes_older_schema_files_only(path):
    older = path.with_name("rassegne-v0.sqlite3")
    newer = path.with_name(f"rassegne-v{store.SCHEMA_VERSION + 1}.sqlite3")
    older.write_bytes(b"old")
    newer.write_bytes(b"a newer release's")
    store.write_volumes(path, [(records(), "archivio")])
    assert not older.exists() and path.exists() and newer.exists()


def test_an_empty_list_changes_nothing(path):
    store.write_volumes(path, [(records(volume(9001)), "archivio"), (records(volume(9002, 2019)), "archivio")])
    store.write_volumes(path, [])
    store.remove_volumes(path, [])
    with store.rewrite(path, []):
        pass
    assert [v["id"] for v in store.list_volumes(path)] == [9001, 9002]
    assert read(path)["total"] == 4


def test_a_record_that_does_not_parse_is_unavailable(path):
    store.write_volumes(path, [(records(), "archivio")])
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE paragraphs SET record = '{broken' WHERE key = 'massimario|9001|9111|0'")
    with pytest.raises(store.StoreUnavailable):
        read(path)
    with pytest.raises(store.StoreUnavailable):
        store.volume_records(path, 9001)


def test_a_failed_build_leaves_the_store_as_it_was(path):
    store.write_volumes(path, [(records(), "archivio")])
    before = path.read_bytes()
    with pytest.raises(RuntimeError):
        with store.rewrite(path, [9001]) as new:
            raise RuntimeError("the portal stopped answering")
    assert path.read_bytes() == before
    assert not list(path.parent.glob(".rassegne-*"))


def test_two_builds_never_run_at_once(path):
    with store.rewrite(path, [9001]) as new:
        new.add(records(), "archivio")
        with pytest.raises(store.StoreBusy):
            with store.rewrite(path, [9002]):
                pass


def test_a_volume_added_that_was_not_announced_is_refused(path):
    with pytest.raises(ValueError):
        with store.rewrite(path, [9002]) as new:
            new.add(records(), "archivio")
    assert not path.exists()


# --- The build command, from a local archive ----------------------------------------------------

def _archive(root, raw):
    folder = root / "json" / str(raw["volume_id"])
    folder.mkdir(parents=True)
    wrap = lambda data: json.dumps({"valid": True, "objectData": data})  # noqa: E731
    (folder / "index.json").write_text(wrap(raw["index"]))
    for cid, data in raw["capitoli"].items():
        (folder / f"capitolo_{cid}.json").write_text(wrap(data))
    for sid, data in raw["sezioni"].items():
        (folder / f"sezione_{sid}.json").write_text(wrap(data))


def test_the_command_builds_from_an_archive_without_a_request(tmp_path, path, capsys, monkeypatch):
    _archive(tmp_path / "archivio", volume(9001))
    _archive(tmp_path / "archivio", volume(9002, 2019))

    async def no_request(urns):
        raise AssertionError("no request with --no-resolve")

    monkeypatch.setattr(build_cli.act_dates, "resolve_many", no_request)
    build_cli.main(["--archive", str(tmp_path / "archivio"), "--no-resolve", "--store", str(path)])
    assert [v["id"] for v in store.list_volumes(path)] == [9001, 9002]
    out = capsys.readouterr().out
    assert "vol. 9001" in out and "1 non risolti" in out and "MB, 2 volumi" in out
    build_cli.main(["--remove", "9002", "--store", str(path)])
    assert [v["id"] for v in store.list_volumes(path)] == [9001]
    build_cli.main(["--list", "--store", str(path)])
    assert "9001\tMassimario 2024 CIVILE Vol. 1\t6 paragrafi" in capsys.readouterr().out


def test_the_command_resolves_only_what_the_store_does_not_know(tmp_path, path, monkeypatch):
    _archive(tmp_path / "archivio", volume(9001))
    asked = []

    async def resolve_many(urns):
        asked.append(list(urns))
        return {u: RESOLVED.get(u) for u in urns}

    monkeypatch.setattr(build_cli.act_dates, "resolve_many", resolve_many)
    build_cli.main(["--archive", str(tmp_path / "archivio"), "--volume", "9001", "--store", str(path)])
    assert asked == [["urn:nir:stato:legge:1983;184"]]
    assert read(path, urn=NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184")["total"] == 1
    build_cli.main(["--archive", str(tmp_path / "archivio"), "--volume", "9001", "--store", str(path)])
    assert len(asked) == 1  # the second build found it in the store


def test_the_command_reads_the_portal_through_the_paced_client(tmp_path, path, monkeypatch):
    raw = volume(9003)
    served = []

    async def fetch_element(kind, element_id):
        served.append((kind, element_id))
        return {"index": raw["index"], "capitolo": raw["capitoli"].get(int(element_id)),
                "sezione": raw["sezioni"].get(int(element_id))}[kind]

    monkeypatch.setattr(build_cli.act_dates, "resolve_many", lambda urns: _resolved(urns))
    from visualex_api.services import massimario_portal
    monkeypatch.setattr(massimario_portal, "fetch_element", fetch_element)
    build_cli.main(["--portal", "--volume", "9003", "--store", str(path)])
    assert served == [("index", "9003"), ("capitolo", "9101"), ("capitolo", "9102"), ("sezione", "9201")]
    assert store.list_volumes(path)[0]["source"] == "portale"


async def _resolved(urns):
    return {u: RESOLVED.get(u) for u in urns}


# --- The routes -------------------------------------------------------------------------------

@pytest.fixture
def client(path, monkeypatch):
    monkeypatch.setenv("RASSEGNE_STORE", str(path))
    return NormaController().app.test_client()


async def test_route_without_a_store_answers_nothing_to_show(client):
    response = await client.get("/fetch_rassegne", query_string={"urn": CC_2043})
    assert response.status_code == 200
    assert (await response.get_json())["total"] == 0


async def test_route_normalises_the_urn(client, path):
    store.write_volumes(path, [(records(), "archivio")])
    # Normattiva's alias form of the code, with a version marker
    spelled = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043!vig=2024-01-01"
    response = await client.get("/fetch_rassegne", query_string={"urn": spelled, "limit": "1"})
    body = await response.get_json()
    assert response.status_code == 200 and body["urn"] == CC_2043
    assert body["total"] == 2 and len(body["items"]) == 1 and body["next_cursor"] == "1"


@pytest.mark.parametrize("query,field", [
    ({}, "urn"),
    ({"urn": "x" * 501}, "urn"),
    ({"urn": CC_2043, "anno": "1899"}, "anno"),
    ({"urn": CC_2043, "anno": "duemila"}, "anno"),
    ({"urn": CC_2043, "archivio": "tributario"}, "archivio"),
    ({"urn": CC_2043, "cursor": "-1"}, "cursor"),
    ({"urn": CC_2043, "cursor": "1234567"}, "cursor"),
    ({"urn": CC_2043, "limit": "51"}, "limit"),
    ({"urn": CC_2043, "limit": "0"}, "limit"),
])
async def test_route_validation(client, query, field):
    response = await client.get("/fetch_rassegne", query_string=query)
    body = await response.get_json()
    assert response.status_code == 400 and body["detail"] == "richiesta_non_valida" and field in body["errori"]


async def test_route_unknown_schema_is_a_503(client, path):
    store.write_volumes(path, [(records(), "archivio")])
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
    response = await client.get("/fetch_rassegne", query_string={"urn": CC_2043})
    assert response.status_code == 503
    assert (await response.get_json()) == {"detail": "rassegne_non_disponibili"}


async def test_route_records_of_a_volume(client, path):
    built = records()
    store.write_volumes(path, [(built, "archivio")])
    response = await client.get("/massimario/volume/9001/records")
    body = await response.get_json()
    assert response.status_code == 200 and body["records"] == built.records
    assert (await client.get("/massimario/volume/9002/records")).status_code == 404
    assert (await client.get("/massimario/volume/abc/records")).status_code == 400


def test_the_routes_never_reach_merlt():
    # §2.2: no MERL-T hop on the reader's path and no MERL-T import in the package
    import pathlib

    package = pathlib.Path(store.__file__).parent
    for source in package.glob("*.py"):
        text = source.read_text(encoding="utf-8")
        assert "import merlt" not in text and "from merlt" not in text, source.name
