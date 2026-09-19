"""`python -m archivio_normativo` — build, verify, render, report, export.

`build` is the run: manifest → acts → pipeline → Markdown of what changed →
integrity check → report. Everything else reads the store. Exit codes: 0
clean, 1 when an act did not resolve or a unit failed (so a cron job can
tell), 2 for a usage or manifest error, 130 on Ctrl-C after the partial
report.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import aiohttp

from . import __version__
from .enrich import Enricher
from .manifest import KINDS, Manifest, ManifestError, expand_kinds, load_manifest
from .pipeline import Pipeline, RunOptions, stamp
from .render_md import write_outputs
from .report import format_report
from .sources.legalit import LegalItClient, LegalItError
from .sources.visualex import VisuaLexClient
from .store import Store
from .throttle import Throttle
from .verify import format_findings, verify_store

DEFAULT_MANIFEST = Path(__file__).with_name("manifest.yaml")
DEFAULT_OUT = Path("archivio_out")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="archivio_normativo",
                                     description="Local legal archive built on the VisuaLex API.")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
        p.add_argument("--out", type=Path, default=DEFAULT_OUT)
        p.add_argument("--only", help="comma-separated act ids")
        p.add_argument("--area", help="one of the manifest areas")
        p.add_argument("--log-level", default="INFO")

    build = sub.add_parser("build", help="fetch what changed and update the archive")
    common(build)
    build.add_argument("--enrich", help="comma-separated kinds; replaces the manifest's for this run")
    build.add_argument("--refresh-enrich", action="store_true")
    build.add_argument("--full", action="store_true", help="ignore fingerprints, refetch everything")
    build.add_argument("--resume", nargs="?", const=-1, type=int, metavar="RUN_ID",
                       help="continue an interrupted run (the latest when no id is given)")
    build.add_argument("--dry-run", action="store_true")
    build.add_argument("--rate", type=float, help="articles per second towards VisuaLex")
    build.add_argument("--enrich-rate", type=float, help="calls per second towards legal-it")
    build.add_argument("--batch-size", type=int)
    build.add_argument("--visualex-url", help="override providers.visualex.base_url")

    common(sub.add_parser("verify", help="integrity checks over the store"))
    common(sub.add_parser("render", help="rewrite the Markdown from the store, no network"))
    common(sub.add_parser("report", help="summary of the last run"))
    export = sub.add_parser("export", help="one JSON object per unit")
    common(export)
    export.add_argument("--jsonl", type=Path, required=True)
    return parser


def _setup_logging(level: str, out_dir: Path | None) -> logging.Logger:
    log = logging.getLogger("archivio")
    log.setLevel(getattr(logging, level.upper(), logging.INFO))
    log.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(fmt)
    log.addHandler(stream)
    if out_dir is not None:
        logs = out_dir / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(logs / f"build-{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.log", encoding="utf-8")
        handler.setFormatter(fmt)
        log.addHandler(handler)
    return log


def _select(manifest: Manifest, args) -> tuple:
    only = args.only.split(",") if args.only else None
    return manifest.select(only, args.area)


def _needs_legalit(specs, override) -> bool:
    for spec in specs:
        kinds = override if override is not None else spec.enrich
        if any(k != "brocardi" for k in kinds):
            return True
    return False


async def run_build(args, manifest: Manifest) -> int:
    started = time.monotonic()
    specs = _select(manifest, args)
    override = tuple(expand_kinds(args.enrich.split(","))) if args.enrich else None
    base_url = args.visualex_url or manifest.providers.visualex_base_url
    out_dir: Path = args.out
    log = _setup_logging(args.log_level, None if args.dry_run else out_dir)
    log.info("archivio_normativo %s — %d acts — VisuaLex %s%s", __version__, len(specs), base_url,
             " — DRY RUN" if args.dry_run else "")

    store: Store | None = None
    run_id: int | None = None
    db_path = out_dir / "archivio.sqlite"
    if args.dry_run:
        store = Store(db_path) if db_path.exists() else None
    else:
        store = Store(db_path)

    try:
        if not args.dry_run:
            interrupted = store.mark_running_as_interrupted()
            for rid in interrupted:
                log.warning("run %d was left running (killed?) — marked interrupted; `--resume %d` continues it", rid, rid)
            if args.resume is not None:
                run_id = args.resume if args.resume > 0 else store.latest_interrupted_run()
                if run_id is None or store.get_run(run_id) is None:
                    log.error("no interrupted run to resume")
                    return 2
                store.reopen_run(run_id)
                log.info("resuming run %d", run_id)
            else:
                run_id = store.start_run({k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
                                         stamp(datetime.now))

        options = RunOptions(
            out_dir=out_dir, dry_run=args.dry_run, full=args.full, resume_run_id=run_id if args.resume is not None else None,
            enrich_override=override, refresh_enrich=args.refresh_enrich,
            batch_size=args.batch_size or manifest.defaults.batch_size, enrich_ttl_days=manifest.defaults.enrich_ttl_days,
        )
        throttle = Throttle(args.rate if args.rate is not None else manifest.defaults.rate_per_second)
        enrich_throttle = Throttle(args.enrich_rate if args.enrich_rate is not None else manifest.defaults.enrich_rate_per_second)

        def on_retry(attempt, delay, error):
            log.warning("retry %d in %.1fs: %s", attempt, delay, error)

        reports = []
        status = "done"
        pipeline = None
        try:
            # One NDJSON line carries an article and its Brocardi annotations;
            # aiohttp's default line limit (LineTooLong) is too small for the long ones.
            async with aiohttp.ClientSession(read_bufsize=2**20) as session:
                visualex = VisuaLexClient(base_url, session, throttle, on_retry=on_retry)
                if not args.dry_run and _needs_legalit(specs, override):
                    async with LegalItClient(manifest.providers.legalit_command, enrich_throttle, on_retry=on_retry) as legalit:
                        enricher = Enricher(store=store, legalit=legalit, options=options, run_id=run_id,
                                            log=log, now=datetime.now)
                        pipeline = Pipeline(store=store, visualex=visualex, options=options, run_id=run_id,
                                            log=log, now=datetime.now, enricher=enricher)
                        reports = await pipeline.run(specs)
                else:
                    enricher = None
                    if args.dry_run and _needs_legalit(specs, override):
                        enricher = Enricher(store=store, legalit=None, options=options, run_id=0, log=log, now=datetime.now)
                    pipeline = Pipeline(store=store, visualex=visualex, options=options, run_id=run_id,
                                        log=log, now=datetime.now, enricher=enricher)
                    reports = await pipeline.run(specs)
        except LegalItError as exc:
            log.error("legal-it: %s", exc)
            if store is not None and run_id is not None:
                store.finish_run(run_id, "interrupted", stamp(datetime.now), {"error": str(exc)})
            return 2
        except (KeyboardInterrupt, asyncio.CancelledError):
            status = "interrupted"
            reports = pipeline.reports if pipeline is not None else []
            log.warning("interrupted — the archive holds everything committed so far; `--resume` continues")

        findings = []
        if store is not None and not args.dry_run and run_id is not None:
            findings = verify_store(store, act_ids={s.id for s in specs})
            stats = {
                "acts": len(reports), "unresolved": sum(1 for r in reports if not r.resolved),
                "new": sum(r.new for r in reports), "updated": sum(r.updated for r in reports),
                "unchanged": sum(r.unchanged for r in reports), "failed": sum(r.failed for r in reports),
                "skipped": sum(r.skipped for r in reports), "findings": len(findings),
            }
            # The status must be final before INDICE.md is rendered — it reads
            # the run row straight from the store, and would otherwise always
            # show "(running)".
            store.finish_run(run_id, status, stamp(datetime.now), stats)
            changed = [r.act_id for r in reports if r.changed]
            if changed:
                written = write_outputs(store, out_dir, changed, stamp(datetime.now))
                log.info("rendered %d files", len(written))
            else:
                write_outputs(store, out_dir, [], stamp(datetime.now))
        print(format_report(reports, findings, duration_s=time.monotonic() - started, base_url=base_url,
                            run_id=run_id, dry_run=args.dry_run))
        if status == "interrupted":
            return 130
        if any(not r.resolved for r in reports) or any(r.failed for r in reports):
            return 1
        return 0
    finally:
        if store is not None:
            store.close()


def _open_store(args) -> Store | None:
    path = args.out / "archivio.sqlite"
    if not path.exists():
        print(f"no archive at {path}; run `build` first", file=sys.stderr)
        return None
    return Store(path)


def run_verify(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        findings = verify_store(store, act_ids={s.id for s in _select(manifest, args)})
    print(format_findings(findings))
    return 0


def run_render(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        ids = [s.id for s in _select(manifest, args)] if (args.only or args.area) else None
        written = write_outputs(store, args.out, ids, stamp(datetime.now))
    print(f"rendered {len(written)} files under {args.out}")
    return 0


def run_report(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        run = store.latest_run()
    if run is None:
        print("no run yet")
        return 0
    print(f"run {run['id']}: {run['status']} — started {run['started_at']} — finished {run['finished_at'] or '-'}")
    print(json.dumps(run["stats"] or {}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def run_export(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    wanted = {s.id for s in _select(manifest, args)} if (args.only or args.area) else None
    count = 0
    with store, open(args.jsonl, "w", encoding="utf-8") as fh:
        for row in store.iter_units():
            if wanted is not None and row["act_id"] not in wanted:
                continue
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    print(f"exported {count} units to {args.jsonl}")
    return 0


async def async_main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        if getattr(args, "enrich", None):
            expand_kinds(args.enrich.split(","))
        if args.command == "build":
            return await run_build(args, manifest)
        if args.command == "verify":
            return run_verify(args, manifest)
        if args.command == "render":
            return run_render(args, manifest)
        if args.command == "report":
            return run_report(args, manifest)
        if args.command == "export":
            return run_export(args, manifest)
    except ManifestError as exc:
        print(f"manifest: {exc}", file=sys.stderr)
        return 2
    parser.error(f"unknown command {args.command}")
    return 2


def main(argv: list[str] | None = None) -> int:
    try:
        return asyncio.run(async_main(argv))
    except KeyboardInterrupt:
        return 130
