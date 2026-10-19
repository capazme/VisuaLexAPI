# services/merlt/tests/scripts/test_build_rv_bands.py
import json

from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.scripts.build_rv_bands import load_archive_volume, main, samples
from tests.pipeline.massimario_fixture import volume_9001


def write_archive(root):
    raw = volume_9001()
    vdir = root / "json" / "9001"
    vdir.mkdir(parents=True)
    wrap = lambda data: json.dumps({"valid": True, "objectData": data})
    (vdir / "index.json").write_text(wrap(raw["index"]), encoding="utf-8")
    for cid, data in raw["capitoli"].items():
        (vdir / f"capitolo_{cid}.json").write_text(wrap(data), encoding="utf-8")
    for sid, data in raw["sezioni"].items():
        (vdir / f"sezione_{sid}.json").write_text(wrap(data), encoding="utf-8")
    return vdir


def test_loads_a_volume_from_the_archive(tmp_path):
    raw = load_archive_volume(write_archive(tmp_path))
    assert raw["volume_id"] == 9001 and set(raw["capitoli"]) == {9101, 9102}


def test_samples_are_explicit_cassazione_citations_only(tmp_path):
    found = sorted(samples(load_archive_volume(write_archive(tmp_path))))
    # 1234/2024 (two Rv.), 567/2023, 89/2022; not the implicit 4321, not the Consulta
    assert found == [("civile", 2022, 664001), ("civile", 2023, 668001),
                     ("civile", 2024, 670001), ("civile", 2024, 670001)]


def test_cli_writes_a_loadable_table(tmp_path):
    write_archive(tmp_path)
    out = tmp_path / "bands.json"
    main(["--archive", str(tmp_path), "--out", str(out), "--min-samples", "1"])
    bands = RvBands.load(out)
    assert bands.contains("civile", 2024, 670001)
    assert not bands.contains("civile", 2024, 600000)


def test_from_samples_trims_the_tails():
    data = [("civile", 2020, n) for n in range(100)]
    lo, hi = RvBands.from_samples(data).bands[("civile", 2020)]
    assert (lo, hi) == (2, 97)
    assert RvBands.from_samples(data[:10]).bands == {}
