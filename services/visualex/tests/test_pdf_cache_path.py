"""Where an exported PDF is cached.

The name is built from the URN, and the URN is written by the caller: the guard on
/export_pdf only checks the host, so everything after it is untrusted. A `;../../x` in
the URN used to become a directory part of the path the PDF is read from and copied to.
"""
import os

import pytest

import app as app_module
from app import NormaController
from visualex_api.tools.urngenerator import pdf_cache_path, urn_to_filename

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"


@pytest.mark.parametrize(
    "urn, expected",
    [
        (BASE + "legge:1990-08-07;241", "241_1990.pdf"),
        (BASE + "decreto.legislativo:2001-06-08;231", "231_2001.pdf"),
        (BASE + "regio.decreto:1942-03-16;262:2~art2043", "262_2_1942.pdf"),
        (BASE + "costituzione:1947-12-27", "Costituzione_1947-12-27.pdf"),
    ],
)
def test_a_legitimate_act_keeps_a_readable_name(urn, expected):
    assert urn_to_filename(urn) == expected


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
    name = urn_to_filename(urn)
    assert name == os.path.basename(name)
    assert "/" not in name and "\\" not in name and "\x00" not in name
    assert not name.startswith(".")
    assert name.endswith(".pdf")
    assert len(name) <= 150
    assert os.path.dirname(pdf_cache_path(urn, str(tmp_path))) == str(tmp_path)


async def test_the_export_never_writes_outside_the_download_folder(tmp_path, monkeypatch):
    work = tmp_path / "work"
    (work / "download").mkdir(parents=True)
    monkeypatch.chdir(work)

    async def fake_extract(urn):
        target = work / "download" / "suggested.pdf"
        target.write_bytes(b"%PDF-1.4 test")
        return str(target)

    monkeypatch.setattr(app_module, "extract_pdf", fake_extract)
    client = NormaController().app.test_client()

    response = await client.post("/export_pdf", json={"urn": BASE + "legge:1990-08-07;../../evil"})

    assert response.status_code == 200
    assert (await response.get_data()).startswith(b"%PDF")
    outside = [p for p in tmp_path.rglob("*evil*") if p.parent != work / "download"]
    assert outside == []  # nothing above the download folder, nor next to it
    assert len(list((work / "download").glob("*evil*"))) == 1

    # The second request is served from that cache, from the same folder.
    again = await client.post("/export_pdf", json={"urn": BASE + "legge:1990-08-07;../../evil"})
    assert again.status_code == 200
