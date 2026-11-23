# services/visualex/visualex_api/services/massimario/rv_bands_build.py
"""Build the `Rv.` range table from a local archive of the reviews (spec §5.2).

    python -m visualex_api.services.massimario.rv_bands_build --archive <dir> [--out <file>] [--min-samples 20]

MERL-T's `merlt/scripts/build_rv_bands.py`, moved with the citation grammar (design
2026-10-30-rassegne-without-merlt §3.1). The archive is the raw download kept outside the
repository: <dir>/json/<volume>/index.json, capitolo_<id>.json, sezione_<id>.json, each the
portal's `{"valid": true, "objectData": …}`. Only numbers leave it: for every explicit
Cassazione citation, (archive, year, massima number).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterator, Optional

from .citations import parse_citations
from .identity import CASSAZIONE
from .rv_bands import DEFAULT_PATH, RvBands
from .volume import archive_volumes, iter_paragraphs, load_archive_volume


def samples(raw: dict) -> Iterator[tuple[str, int, int]]:
    for ctx in iter_paragraphs(raw):
        if ctx.archivio is None:
            continue
        scan = parse_citations(ctx.paragraph.text, review_year=ctx.meta.anno, archivio=ctx.archivio, bands=None)
        for decision in scan.decisions:
            if decision.corte != CASSAZIONE or decision.identity is None or decision.anno_implicito:
                continue
            for rv in decision.rv:
                yield decision.archivio, decision.anno, int(rv[:6])


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--min-samples", type=int, default=20)
    args = parser.parse_args(argv)
    found = [s for volume_id in archive_volumes(args.archive)
             for s in samples(load_archive_volume(args.archive / "json" / str(volume_id)))]
    bands = RvBands.from_samples(found, min_samples=args.min_samples)
    args.out.write_text(json.dumps(bands.to_json(), indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(found)} citazioni esplicite, {len(bands.bands)} fasce → {args.out}")


if __name__ == "__main__":
    main()
