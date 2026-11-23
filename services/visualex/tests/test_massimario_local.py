"""The reviews' records on real volumes (design 2026-10-30-rassegne-without-merlt §5, §10).

The raw archive is local only (the repository is public, and the reviews' text is the Office's):
set `MASSIMARIO_ARCHIVE` to its folder (`<dir>/json/<volume>/…`) to run this module, and
`MASSIMARIO_VOLUMES` (e.g. "96,99") to keep it to some volumes. Without it the module is
skipped; the same checks run on the synthetic volume in `test_massimario_records.py`. No
request leaves: year-only acts stay unresolved here.
"""
import os
from pathlib import Path

import pytest

from visualex_api.services.massimario.records import build_records
from visualex_api.services.massimario.volume import archive_volumes, load_archive_volume
from visualex_api.tools.sources import normalize_norm_urn

ARCHIVE = Path(os.environ["MASSIMARIO_ARCHIVE"]) if os.getenv("MASSIMARIO_ARCHIVE") else None
pytestmark = pytest.mark.skipif(ARCHIVE is None, reason="MASSIMARIO_ARCHIVE not set (real volumes are local only)")


def _volumes():
    if ARCHIVE is None:
        return []
    chosen = os.getenv("MASSIMARIO_VOLUMES", "")
    return [int(v) for v in chosen.split(",") if v.strip()] or archive_volumes(ARCHIVE)


@pytest.mark.parametrize("volume_id", _volumes())
def test_a_real_volume(volume_id):
    out = build_records(load_archive_volume(ARCHIVE / "json" / str(volume_id)), resolved={})
    keys = [r["paragraph_key"] for r in out.records]
    assert len(keys) == len(set(keys)) == out.report["paragrafi"]
    assert [r["ordine"] for r in out.records] == sorted(r["ordine"] for r in out.records)
    for r in out.records:
        assert "\n" not in r["text"]  # the projection anchors would count, if ever decided (§4)
        assert r["pieces"][0][0] == 0 and r["pieces"][-1][1] == len(r["text"])
        for n in r["norme"]:
            assert normalize_norm_urn(n["urn"]) == n["urn"]  # §5: every stored URN is a fixed point
            assert r["text"][n["start"]:n["end"]] == n["citazione"]
