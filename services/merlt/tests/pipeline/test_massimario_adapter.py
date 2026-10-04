# services/merlt/tests/pipeline/test_massimario_adapter.py
import pytest

from merlt.pipeline.massimario.adapter import MassimarioAdapter, parse_source_ref
from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.pipeline.mechanical_ingestion.parser import get_adapter
from tests.pipeline.massimario_fixture import volume_9001


class FakeVisuaLex:
    def __init__(self):
        self.raw = volume_9001()
        self.calls = []

    async def fetch_massimario(self, kind, element_id):
        self.calls.append((kind, element_id))
        if kind == "index":
            return self.raw["index"]
        return (self.raw["capitoli"] if kind == "capitolo" else self.raw["sezioni"])[element_id]

    async def resolve_act_dates(self, urns):
        self.calls.append(("resolve", tuple(urns)))
        return {u: u.replace("1983;", "1983-05-04;") for u in urns}


async def test_parse_walks_the_volume_and_resolves_dates():
    client = FakeVisuaLex()
    adapter = MassimarioAdapter(client=client, bands=RvBands({("civile", 2024): (669000, 673000)}))
    out = await adapter.parse('{"volume": 9001}')
    assert client.calls == [
        ("index", 9001), ("capitolo", 9101), ("capitolo", 9102), ("sezione", 9201),
        ("resolve", ("urn:nir:stato:legge:1983;184",)),
    ]
    assert set(out) == {"nodes", "edges", "extras", "report"}
    assert any(n["id"].endswith("legge:1983-05-04;184") for n in out["nodes"])


@pytest.mark.parametrize("ref", ['{"volume": "96"}', "[]", "nope", '{"volume": true}', '{"volume": 0}', "{}"])
def test_bad_source_ref(ref):
    with pytest.raises(ValueError):
        parse_source_ref(ref)


def test_registered_as_a_mechanical_source():
    assert isinstance(get_adapter("massimario"), MassimarioAdapter)
