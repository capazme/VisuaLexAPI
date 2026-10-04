# services/merlt/merlt/scripts/build_rv_bands.py
"""Build the `Rv.` range table from a local archive of the reviews (spec §5.2).

    python -m merlt.scripts.build_rv_bands --archive <dir> [--out <file>] [--min-samples 20]

The archive is the raw download kept outside the repository:
<dir>/json/<volume>/index.json, capitolo_<id>.json, sezione_<id>.json, each the
portal's `{"valid": true, "objectData": …}`. Only numbers leave it: for every
explicit Cassazione citation, (archive, year, massima number).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterator

from merlt.pipeline.massimario.citations import parse_citations
from merlt.pipeline.massimario.identity import CASSAZIONE
from merlt.pipeline.massimario.rv_bands import DEFAULT_PATH, RvBands
from merlt.pipeline.massimario.volume import iter_paragraphs


def _object(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["objectData"]


def load_archive_volume(directory: Path) -> dict:
    def by_id(prefix: str) -> dict[int, dict]:
        return {int(p.stem.split("_", 1)[1]): _object(p) for p in directory.glob(f"{prefix}_*.json")}

    return {
        "volume_id": int(directory.name),
        "index": _object(directory / "index.json"),
        "capitoli": by_id("capitolo"),
        "sezioni": by_id("sezione"),
    }


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


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--min-samples", type=int, default=20)
    args = parser.parse_args(argv)
    found = [s for vdir in sorted((args.archive / "json").iterdir()) if vdir.is_dir()
             for s in samples(load_archive_volume(vdir))]
    bands = RvBands.from_samples(found, min_samples=args.min_samples)
    args.out.write_text(json.dumps(bands.to_json(), indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(found)} citazioni esplicite, {len(bands.bands)} fasce → {args.out}")


if __name__ == "__main__":
    main()
