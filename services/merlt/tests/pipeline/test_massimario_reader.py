# services/merlt/tests/pipeline/test_massimario_reader.py
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario.reader import RassegneReader, normalize_reader_urn

URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
OTHER = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


def payload(key, anno, norme):
    return {"paragraph_key": key, "anno": anno, "archivio": "civile", "volume": {"id": 1, "numero": 1, "titolo": "T"},
            "parte": None, "capitolo": None, "sezione": {"id": 2, "numero": "1", "titolo": "S"}, "autori": [],
            "url": "u", "text": "Testo con art. 2043 c.c. e art. 1453 c.c.", "decisioni": [], "fonte": "Ufficio del Massimario",
            "norme": norme}


def reader(pages):
    bridge = MagicMock(
        year_counts_for_node=AsyncMock(return_value={2024: 2, 2016: 1}),
        archives_for_node=AsyncMock(return_value=["civile"]),
        page_for_node=AsyncMock(side_effect=pages),
    )
    points = {
        "p1": payload("k1", 2024, [{"urn": URN, "start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None},
                                   {"urn": OTHER, "start": 27, "end": 41, "citazione": "art. 1453 c.c.", "comma": None}]),
        "p2": payload("k2", 2024, [{"urn": URN, "start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None}]),
    }
    qdrant = MagicMock(retrieve=MagicMock(side_effect=lambda **kw: [SimpleNamespace(id=i, payload=points[i]) for i in kw["ids"] if i in points]))
    return RassegneReader(bridge, qdrant, "c"), bridge


async def test_newest_year_first_with_paging():
    r, bridge = reader([[{"chunk_id": "p1"}, {"chunk_id": "p2"}]])
    out = await r.by_norma(URN, anno=None, archivio=None, offset=0, limit=1)
    assert out["total"] == 3 and out["anno"] == 2024
    assert out["anni"] == [{"anno": 2024, "passi": 2}, {"anno": 2016, "passi": 1}]
    assert [i["id"] for i in out["items"]] == ["k1"] and out["next_cursor"] == "1"
    assert bridge.page_for_node.await_args.kwargs["anno"] == 2024


async def test_reader_lists_only_rows_of_the_requested_urn():
    r, _ = reader([[{"chunk_id": "p1"}]])
    (item,) = (await r.by_norma(URN, anno=2024, archivio=None, offset=0, limit=10))["items"]
    assert item["evidenziazioni"] == [{"start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None}]


async def test_nothing_cited():
    r, bridge = reader([])
    bridge.year_counts_for_node.return_value = {}
    out = await r.by_norma(URN, anno=None, archivio=None, offset=0, limit=10)
    assert out == {"urn": URN, "total": 0, "anni": [], "archivi": [], "anno": None, "items": [], "next_cursor": None}


def test_reader_strips_markers_and_adds_prefix():
    bare = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
    assert normalize_reader_urn(bare + "!vig=2020-01-01") == URN
    assert normalize_reader_urn(URN + "@originale") == URN
    assert normalize_reader_urn(" " + URN + " ") == URN
