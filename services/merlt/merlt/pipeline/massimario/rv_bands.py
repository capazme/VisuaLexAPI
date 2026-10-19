# services/merlt/merlt/pipeline/massimario/rv_bands.py
"""Ranges of `Rv.` numbers per archive and year (spec §5.2).

The CED numbers massime in increasing order, so the explicit citations of the
reviews show which numbers each year used. A citation that leaves out its year
takes the review's year only when its number falls inside that year's range.
The table is numbers only, built from a local archive by
`merlt/scripts/build_rv_bands.py` (Task 7).
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

DEFAULT_PATH = Path(__file__).with_name("rv_bands.json")


@dataclass(frozen=True)
class RvBands:
    bands: dict = field(default_factory=dict)  # (archivio, anno) -> (lo, hi)

    def contains(self, archivio: str, anno: int, rv_base: int) -> bool:
        band = self.bands.get((archivio, anno))
        return band is not None and band[0] <= rv_base <= band[1]

    @classmethod
    def from_samples(cls, samples: Iterable[tuple[str, int, int]], *, min_samples: int = 20) -> "RvBands":
        """2nd–98th percentile of the samples of each (archivio, anno) with enough of them."""
        grouped: dict[tuple[str, int], list[int]] = defaultdict(list)
        for archivio, anno, rv in samples:
            grouped[(archivio, anno)].append(rv)
        bands = {}
        for key, values in grouped.items():
            if len(values) < min_samples:
                continue
            values.sort()
            cut = len(values) // 50
            bands[key] = (values[cut], values[-cut - 1])
        return cls(bands)

    def to_json(self) -> dict:
        out: dict[str, dict[str, list[int]]] = {}
        for (archivio, anno), (lo, hi) in sorted(self.bands.items()):
            out.setdefault(archivio, {})[str(anno)] = [lo, hi]
        return {"version": 1, "bands": out}

    @classmethod
    def from_json(cls, data: dict) -> "RvBands":
        return cls({
            (archivio, int(anno)): (lo, hi)
            for archivio, years in data.get("bands", {}).items()
            for anno, (lo, hi) in years.items()
        })

    @classmethod
    def load(cls, path: Path = DEFAULT_PATH) -> "RvBands":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))
