# services/visualex/visualex_api/services/massimario/build.py
"""Build the reviews' store (design 2026-10-30-rassegne-without-merlt §3 (a), §8).

    python -m visualex_api.services.massimario.build --archive <dir> [--volume N ...] [--no-resolve]
    python -m visualex_api.services.massimario.build --portal --volume N [--volume M ...]
    python -m visualex_api.services.massimario.build --remove N [--remove M ...]
    python -m visualex_api.services.massimario.build --list

Run from `services/visualex`. Two sources:
- `--archive <dir>`: a local folder in the portal's own JSON (`<dir>/json/<volume>/index.json`,
  `capitolo_<id>.json`, `sezione_<id>.json`): no request to the portal. Every volume it holds
  unless `--volume` names some.
- `--portal`: the portal itself, through the paced client (≥ 1.5 s a request, a stop at the
  first firewall rejection): a few dozen requests a volume. Only the volumes `--volume` names.

Acts cited by year only are completed through Normattiva's resolver (`act_dates`), except the
ones the store already resolved; `--no-resolve` asks nothing, and their links stay unresolved
(counted in the report). The other volumes in the store are kept; the new store is put in place
whole at the end, or not at all. `--store <file>` (or `RASSEGNE_STORE`) names another file.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Optional

from .. import act_dates
from . import store
from .records import build_records
from .rv_bands import RvBands
from .volume import archive_volumes, fetch_volume, load_archive_volume, year_only_acts


async def resolve_acts(acts: set[str], known: dict[str, str], *, ask: bool) -> dict[str, Optional[str]]:
    """The year-only acts of a volume → their full URN (None when unknown), asking Normattiva
    only for those `known` lacks, and only when `ask`."""
    found: dict[str, Optional[str]] = {a: known[a] for a in acts if a in known}
    missing = sorted(a for a in acts if a not in known and act_dates.is_year_only(a))
    if ask:
        for i in range(0, len(missing), act_dates.MAX_URNS):
            found.update(await act_dates.resolve_many(missing[i:i + act_dates.MAX_URNS]))
    return found


def _summary(report: dict) -> str:
    v, c, n = report["volume"], report["citazioni"], report["norme"]
    return (f"vol. {v['id']} «{v['titolo']}»: {report['paragrafi']} paragrafi, "
            f"Rv. {c['rv_riconosciute']}/{c['rv_totali']} ({c['copertura_pct']} %), "
            f"{n['riferimenti']} rinvii a norme ({n['non_risolte']} non risolti, "
            f"{n['normalizzate']} riscritti da normalize_norm_urn)")


async def build(path: Path, *, archive: Optional[Path], portal: bool, volumes: list[int],
                ask: bool, out=None) -> None:
    out = out or sys.stdout
    if archive is not None:
        ids = volumes or archive_volumes(archive)
        if not ids:
            raise SystemExit(f"nessun volume in {archive / 'json'}")
    else:
        ids = volumes
    bands = RvBands.load()
    known = store.known_resolutions(path)
    try:
        with store.rewrite(path, ids) as new:
            for volume_id in ids:
                if archive is not None:
                    raw, source = load_archive_volume(archive / "json" / str(volume_id)), "archivio"
                else:
                    raw, source = await fetch_volume(volume_id), "portale"
                resolved = await resolve_acts(year_only_acts(raw), known, ask=ask)
                known.update({k: v for k, v in resolved.items() if v})
                volume = build_records(raw, resolved=resolved, bands=bands)
                new.add(volume, source)
                new.remember(resolved)
                print(_summary(volume.report), file=out, flush=True)
    finally:
        if portal or ask:
            from ..http_client import http_client
            await http_client.close()
    print(f"{path}: {path.stat().st_size / 1_000_000:.1f} MB, {len(store.list_volumes(path))} volumi", file=out)


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", type=Path, help="a local archive in the portal's JSON")
    source.add_argument("--portal", action="store_true", help="read the volumes from the portal")
    source.add_argument("--remove", type=int, action="append", metavar="VOLUME", help="take a volume out")
    source.add_argument("--list", action="store_true", help="the volumes in the store")
    parser.add_argument("--volume", type=int, action="append", default=[], metavar="VOLUME")
    parser.add_argument("--no-resolve", action="store_true", help="do not ask Normattiva for year-only acts")
    parser.add_argument("--store", type=Path, default=None, help="the store file (default: RASSEGNE_STORE or data/)")
    args = parser.parse_args(argv)
    path = args.store or store.default_path()

    if args.list:
        for v in store.list_volumes(path):
            print(f"{v['id']}\t{v['titolo']}\t{v['paragrafi']} paragrafi\tparser {v['parser_version']}"
                  f"\t{v['source']}\t{v['built_at']}")
        return
    if args.remove:
        store.remove_volumes(path, args.remove)
        print(f"{path}: tolti {sorted(set(args.remove))}; restano {len(store.list_volumes(path))} volumi")
        return
    if args.portal and not args.volume:
        parser.error("--portal vuole almeno un --volume")
    if len(set(args.volume)) != len(args.volume):
        parser.error("lo stesso --volume due volte")
    asyncio.run(build(path, archive=args.archive, portal=args.portal, volumes=args.volume,
                      ask=not args.no_resolve))


if __name__ == "__main__":
    main()
