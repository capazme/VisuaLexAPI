"""Where an exported PDF is cached.

The name is built from the URN, and the URN is written by the caller: the guard on
/export_pdf only checks the host, so everything after it is untrusted. A `;../../x` in
the URN used to become a directory part of the path the PDF is read from and copied to.
"""
import os
from datetime import date

import pytest

import app as app_module
from app import NormaController
from visualex_api.services.pdfextractor import sweep_exported_pdfs
from visualex_api.tools.urngenerator import pdf_cache_path, pdf_urn_in_force, urn_to_filename

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
TODAY = "2026-10-21"


@pytest.fixture
def fixed_today(monkeypatch):
    import visualex_api.app as api_module

    for module in (app_module, api_module):
        monkeypatch.setattr(module, "today_in_rome", lambda: date(2026, 10, 21))


@pytest.mark.parametrize(
    "urn, expected",
    [
        (BASE + "legge:1990-08-07;241", "legge_1990-08-07_241.pdf"),
        (BASE + "decreto.legislativo:2001-06-08;231", "decreto.legislativo_2001-06-08_231.pdf"),
        (BASE + "regio.decreto:1942-03-16;262:2~art2043", "regio.decreto_1942-03-16_262_2.pdf"),
        (BASE + "costituzione:1947-12-27", "costituzione_1947-12-27.pdf"),
        (BASE + "legge:1990-08-07;241!vig=2026-10-21", "legge_1990-08-07_241_vig_2026-10-21.pdf"),
        (BASE + "regio.decreto:1942-03-16;262:2~art2043!vig=2020-01-01", "regio.decreto_1942-03-16_262_2_vig_2020-01-01.pdf"),
        (BASE + "legge:1990-08-07;241@originale", "legge_1990-08-07_241_originale.pdf"),
    ],
)
def test_a_legitimate_act_keeps_a_readable_name(urn, expected):
    assert urn_to_filename(urn) == expected


def test_acts_and_versions_never_share_a_file():
    # The name used to be the number and the year alone: «241_1990.pdf» for all of these.
    urns = [BASE + "legge:1990-08-07;241", BASE + "decreto.legislativo:1990-08-07;241",
            BASE + "legge:1990-08-07;241:1", BASE + "legge:1990-08-07;241!vig=2020-01-01",
            BASE + "legge:1990-08-07;241@originale"]
    assert len({urn_to_filename(urn) for urn in urns}) == len(urns)


POISONING = [
    # The browser resolves the path's «..»: this reads the d.lgs. 231/2001. A name read from
    # anywhere in the address cached it as the l. 241/1990, for everyone who exported that.
    "https://www.normattiva.it/x/stato:legge:1990-08-07;241~/../../uri-res/N2Ls?"
    "urn:nir:stato:decreto.legislativo:2001-06-08;231",
    "https://www.normattiva.it/atto/caricaDettaglioAtto?urn:nir:stato:legge:1990-08-07;241",
    "https://www.normattiva.it/uri-res/N2Ls;x?urn:nir:stato:legge:1990-08-07;241",
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241#stato:legge:1990;1",
    "https://www.normattiva.it/uri-res/N2Ls?q=urn:nir:stato:legge:1990-08-07;241",
    "https://www.normattiva.it/",
    # The same act, another version: the name must be the version the page is.
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1&x=!vig=2020-01-01",
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241!vig=2020-01-01!vig=2026-10-21",
    "urn:nir:stato:legge:1990-08-07;241@originale!vig=2020-01-01",
]


@pytest.mark.parametrize("urn", POISONING)
def test_only_the_query_of_a_n2ls_address_names_the_file(urn):
    with pytest.raises(ValueError):
        urn_to_filename(urn)


def test_a_bare_urn_still_names_its_file():
    assert urn_to_filename("urn:nir:stato:legge:1990-08-07;241!vig=2020-01-01") == \
        "legge_1990-08-07_241_vig_2020-01-01.pdf"


@pytest.mark.parametrize("server", ["root", "api"])
async def test_an_address_that_could_poison_the_cache_is_refused_before_the_browser(
        tmp_path, monkeypatch, fixed_today, server):
    import visualex_api.app as api_module

    module, route = (app_module, "/export_pdf") if server == "root" else (api_module, "/api/export_pdf")
    monkeypatch.chdir(tmp_path)
    (tmp_path / "download").mkdir()
    asked = []

    async def fake_extract(urn):
        asked.append(urn)
        raise AssertionError("the browser must not be opened")

    monkeypatch.setattr(module, "extract_pdf", fake_extract)
    client = module.NormaController().app.test_client()
    response = await client.post(route, json={"urn": POISONING[0]})
    assert response.status_code == 400
    assert asked == []


@pytest.mark.parametrize(
    "urn, expected",
    [
        (BASE + "legge:1990-08-07;241", BASE + "legge:1990-08-07;241!vig=2026-10-21"),
        (BASE + "legge:1990-08-07;241~art2", BASE + "legge:1990-08-07;241~art2!vig=2026-10-21"),
        (BASE + "legge:1990-08-07;241!vig=", BASE + "legge:1990-08-07;241!vig=2026-10-21"),
        (BASE + "legge:1990-08-07;241!vig=2020-01-01", BASE + "legge:1990-08-07;241!vig=2020-01-01"),
        (BASE + "legge:1990-08-07;241@originale", BASE + "legge:1990-08-07;241@originale"),
    ],
)
def test_an_undated_export_reads_the_text_in_force_today(urn, expected):
    # G-355: Normattiva answers an undated URN with its latest version, also one not in force yet.
    assert pdf_urn_in_force(urn, TODAY) == expected


TRAVERSAL = [
    BASE + "legge:1990-08-07;../../../../tmp/evil",
    BASE + "legge:1990-08-07;..\\..\\evil",
    BASE + "legge:1990-08-07;/etc/passwd",
    BASE + "legge:../..-08-07;241",  # the year part is the caller's too
    BASE + "legge:1990-08-07;.hidden",
    BASE + "legge:1990-08-07;" + "a" * 400,
    BASE + "../../x/y",
]


@pytest.mark.parametrize("urn", TRAVERSAL)
def test_no_part_of_the_urn_becomes_a_directory(urn, tmp_path):
    # Most of these are no URN at all, refused outright; what passes is a bare file name.
    try:
        name = urn_to_filename(urn)
    except ValueError:
        return
    assert name == os.path.basename(name)
    assert "/" not in name and "\\" not in name and "\x00" not in name
    assert not name.startswith(".")
    assert name.endswith(".pdf")
    assert len(name) <= 150
    assert os.path.dirname(pdf_cache_path(urn, str(tmp_path))) == str(tmp_path)


async def test_the_export_never_writes_outside_the_download_folder(tmp_path, monkeypatch, fixed_today):
    work = tmp_path / "work"
    (work / "download").mkdir(parents=True)
    monkeypatch.chdir(work)
    asked = []

    async def fake_extract(urn):
        asked.append(urn)
        target = work / "download" / "export-1.pdf"
        target.write_bytes(b"%PDF-1.4 test")
        return str(target)

    monkeypatch.setattr(app_module, "extract_pdf", fake_extract)
    client = NormaController().app.test_client()

    # Not a URN: refused before the browser, nothing written.
    response = await client.post("/export_pdf", json={"urn": BASE + "legge:1990-08-07;../../evil"})
    assert response.status_code == 400
    assert asked == [] and list(tmp_path.rglob("*evil*")) == []

    # A URN with a leading dot in its number: a bare, visible file inside the download folder.
    response = await client.post("/export_pdf", json={"urn": BASE + "legge:1990-08-07;.hidden"})
    assert response.status_code == 200
    assert (await response.get_data()).startswith(b"%PDF")
    assert [p.name for p in (work / "download").iterdir()] == ["legge_1990-08-07_.hidden_vig_2026-10-21.pdf"]

    # The second request is served from that cache, from the same folder.
    again = await client.post("/export_pdf", json={"urn": BASE + "legge:1990-08-07;.hidden"})
    assert again.status_code == 200
    assert len(asked) == 1


@pytest.mark.parametrize("server", ["root", "api"])
async def test_an_undated_export_is_dated_today_and_cached_under_that_name(tmp_path, monkeypatch, fixed_today, server):
    import visualex_api.app as api_module

    module, route = (app_module, "/export_pdf") if server == "root" else (api_module, "/api/export_pdf")
    work = tmp_path / "work"
    (work / "download").mkdir(parents=True)
    monkeypatch.chdir(work)
    asked = []

    async def fake_extract(urn):
        asked.append(urn)
        target = work / "download" / "suggested.pdf"
        target.write_bytes(b"%PDF-1.4 test")
        return str(target)

    monkeypatch.setattr(module, "extract_pdf", fake_extract)
    client = module.NormaController().app.test_client()

    response = await client.post(route, json={"urn": BASE + "legge:1990-08-07;241"})
    assert response.status_code == 200
    assert asked == [BASE + "legge:1990-08-07;241!vig=2026-10-21"]
    # Moved, not copied: no second file under the name Normattiva suggested.
    assert sorted(p.name for p in (work / "download").iterdir()) == ["legge_1990-08-07_241_vig_2026-10-21.pdf"]

    dated = await client.post(route, json={"urn": BASE + "legge:1990-08-07;241!vig=2020-01-01"})
    assert dated.status_code == 200
    assert asked[-1] == BASE + "legge:1990-08-07;241!vig=2020-01-01"


def test_the_sweep_deletes_only_old_pdfs_directly_in_the_folder(tmp_path):
    now = 1_800_000_000
    old, recent = now - 3 * 24 * 3600, now - 3600
    (tmp_path / "cache").mkdir()
    files = {"old.pdf": old, "recent.pdf": recent, "old.json": old, "cache/old.pdf": old}
    for name, mtime in files.items():
        (tmp_path / name).write_bytes(b"x")
        os.utime(tmp_path / name, (mtime, mtime))
    os.symlink(tmp_path / "recent.pdf", tmp_path / "link.pdf")
    os.utime(tmp_path / "link.pdf", (old, old), follow_symlinks=False)

    assert sweep_exported_pdfs(str(tmp_path), now=now) == 1
    assert not (tmp_path / "old.pdf").exists()
    assert {"recent.pdf", "old.json", "cache/old.pdf", "link.pdf"} == {
        str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*") if p.is_file() or p.is_symlink()}
    assert sweep_exported_pdfs(str(tmp_path / "missing"), now=now) == 0


async def test_the_api_twin_exports_through_extract_pdf(tmp_path, monkeypatch, fixed_today):
    # visualex_api/app.py (the /api server) called `setup_driver` and `close_drivers`,
    # which PlaywrightManager does not have: every export that missed the cache was a
    # 500 (inventory row 1.7). It now extracts as the root app does.
    import visualex_api.app as api_module

    work = tmp_path / "work"
    (work / "download").mkdir(parents=True)
    monkeypatch.chdir(work)
    asked = []

    async def fake_extract(urn):
        asked.append(urn)
        target = work / "download" / "suggested.pdf"
        target.write_bytes(b"%PDF-1.4 test")
        return str(target)

    monkeypatch.setattr(api_module, "extract_pdf", fake_extract)
    client = api_module.NormaController().app.test_client()

    urn = BASE + "legge:1990-08-07;241!vig=2026-10-21"
    response = await client.post("/api/export_pdf", json={"urn": urn})

    assert response.status_code == 200
    assert (await response.get_data()).startswith(b"%PDF")
    assert asked == [urn]
    assert (work / "download" / "legge_1990-08-07_241_vig_2026-10-21.pdf").read_bytes() == b"%PDF-1.4 test"

    # Served from the cache the second time: no new extraction.
    again = await client.post("/api/export_pdf", json={"urn": urn})
    assert again.status_code == 200
    assert asked == [urn]

    refused = await client.post("/api/export_pdf", json={"urn": "http://127.0.0.1:5000/"})
    assert refused.status_code == 400
    assert asked == [urn]
