#!/usr/bin/env python3
"""datakit — export and import every VisuaLex data store.

  backup  [--out DIR]          one dated folder: a native export per store + manifest.json
  restore DIR [--force]        check the manifest, load the stores, compare the counts
  verify  DIR                  compare the live counts and the files with the manifest
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datakit import manifest  # noqa: E402
from datakit.stores import falkordb, postgres, qdrant, volumes  # noqa: E402
from datakit.target import REPO_ROOT, Target  # noqa: E402

STORES = {"postgres": postgres, "falkordb": falkordb, "qdrant": qdrant, "volumes": volumes}


def _split(value):
    return tuple(value.split(",")) if value else None


def _target(args) -> Target:
    return Target.for_stack(
        args.stack, pg_container=args.pg_container, pg_user=args.pg_user, databases=_split(args.databases),
        falkor_container=args.falkor_container, qdrant_url=args.qdrant_url,
        volume_prefix=args.volume_prefix, volumes=_split(args.volumes),
    )


def _git_commit() -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _live_counts(t: Target, name: str, entry: dict) -> dict:
    if name == "postgres":
        t = replace(t, databases=tuple(entry["databases"]))
    elif name == "volumes":
        t = replace(t, volumes=tuple(entry["counts"]))
    return STORES[name].count(t)


def _compare(t: Target, m: dict, names) -> list[str]:
    problems = []
    for name in names:
        entry = m["stores"][name]
        problems += [f"{name}: {p}" for p in manifest.compare_counts(entry["counts"], _live_counts(t, name, entry))]
    return problems


def new_backup_folder(out: Path) -> Path:
    """The backup folder, readable by its owner only: it holds password hashes,
    notes and uploads. The mode is set explicitly, whatever the umask."""
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    out.chmod(0o700)
    return out


def cmd_backup(args) -> int:
    t = _target(args)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.umask(0o077)  # every file this process writes: owner only
    out = new_backup_folder(Path(args.out or Path.home() / "visualex-backups" / f"{t.stack}-{stamp}").expanduser())
    stores = {}
    for name in args.stores.split(","):
        print(f"== backup {name}", file=sys.stderr)
        stores[name] = STORES[name].backup(t, out)
    manifest.write(out, {
        "format": manifest.FORMAT,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {"stack": t.stack, "git_commit": _git_commit()},
        "stores": stores,
        "files": manifest.index_files(out),
    })
    print(out)
    return 0


def cmd_restore(args) -> int:
    src = Path(args.folder).expanduser()
    m = manifest.read(src)
    damaged = manifest.verify_files(src, m)
    if damaged:
        print("\n".join(damaged), file=sys.stderr)
        return 2
    t = _target(args)
    names = [n for n in (args.stores.split(",") if args.stores else m["stores"]) if n in m["stores"]]
    # Every store is checked before any is written: a refusal leaves the stack as it was.
    for name in names:
        STORES[name].check(t, m["stores"][name], args.force)
    for name in names:
        print(f"== restore {name}", file=sys.stderr)
        STORES[name].restore(t, src, m["stores"][name], args.force)
    problems = _compare(t, m, names)
    print("\n".join(problems) if problems else "restore verified: counts match", file=sys.stderr)
    return 1 if problems else 0


def cmd_verify(args) -> int:
    src = Path(args.folder).expanduser()
    m = manifest.read(src)
    problems = manifest.verify_files(src, m) + _compare(_target(args), m, list(m["stores"]))
    print("\n".join(problems) if problems else "verified: files intact, counts match", file=sys.stderr)
    return 1 if problems else 0


def main(argv=None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--stack", help="Compose stack (default: $VISUALEX_STACK or visualex)")
    common.add_argument("--pg-container")
    common.add_argument("--pg-user")
    common.add_argument("--databases", help="comma-separated (default visualex_platform,merlt)")
    common.add_argument("--falkor-container")
    common.add_argument("--qdrant-url")
    common.add_argument("--volume-prefix")
    common.add_argument("--volumes", help="comma-separated logical names")
    parser = argparse.ArgumentParser(prog="datakit", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    backup = sub.add_parser("backup", parents=[common])
    backup.add_argument("--out")
    backup.add_argument("--stores", default="postgres,falkordb,qdrant,volumes")
    restore = sub.add_parser("restore", parents=[common])
    restore.add_argument("folder")
    restore.add_argument("--force", action="store_true")
    restore.add_argument("--stores")
    verify = sub.add_parser("verify", parents=[common])
    verify.add_argument("folder")
    args = parser.parse_args(argv)
    return {"backup": cmd_backup, "restore": cmd_restore, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
