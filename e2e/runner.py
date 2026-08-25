"""CLI entrypoint: preflight -> sequential flows -> report (blueprint §1+§5).

Usage:
  python -m e2e.runner                          # full suite
  python -m e2e.runner --preflight-only
  python -m e2e.runner --fast                   # no scrapers/LLM/worker/slow
  python -m e2e.runner --only dossier --only forum
  python -m e2e.runner --skip external_scraper --wait-for-stack 300

Exit code: number of failed flows (0 = green), 2 on preflight hard failure.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time

from e2e.client import ApiClient
from e2e.config import CONFIG, Config
from e2e.context import Context
from e2e.flows import FLOW_REGISTRY, get_flow
from e2e.preflight import quick_stack_status, run_preflight
from e2e.report import FlowSkipped, Report, StepFailure

FAST_SKIP_TAGS = frozenset(
    {"external_scraper", "slow", "needs_llm", "needs_worker", "costs_money"}
)

BRING_UP_HINT = """
Stack non avviato o incompleto — lancialo in un altro terminale:

  cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI
  # prima volta / dopo modifiche a merlt/ (il codice e' baked nell'immagine):
  docker compose -f docker-compose.merlt.yml --profile api-in-docker build

  MERLT_ENABLED=true MERLT_COMPOSE_ENABLED=true MERLT_API_IN_DOCKER=true \\
  ADMIN_PASSWORD='<admin-pw>' OPENROUTER_API_KEY='<key-or-empty>' ./start.sh

Poi rilancia il runner (opzionale: --wait-for-stack 300 per attendere il boot).
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m e2e.runner",
        description="VisuaLex E2E harness: preflight + sequential user-journey flows.",
    )
    parser.add_argument("--preflight-only", action="store_true",
                        help="run the 13 stack checks and exit")
    parser.add_argument("--skip", action="append", default=[], metavar="TAG",
                        help="skip flows carrying TAG (repeatable), e.g. --skip slow")
    parser.add_argument("--only", action="append", default=[], metavar="FLOW",
                        choices=[name for name, _ in FLOW_REGISTRY],
                        help="run only FLOW (repeatable); 'auth' is always included")
    parser.add_argument("--fast", action="store_true",
                        help=f"preset: skip {', '.join(sorted(FAST_SKIP_TAGS))}")
    parser.add_argument("--include-refine", action="store_true",
                        help="also run the Q&A refine follow-up (second LLM call)")
    parser.add_argument("--include-ner-training", action="store_true",
                        help="also run NER training start + poll (slow, needs worker)")
    parser.add_argument("--wait-for-stack", type=float, default=0.0, metavar="SECONDS",
                        help="poll preflight checks 1/2/3 every 5s until green or timeout")
    return parser.parse_args()


async def _wait_for_stack(cfg: Config, max_wait: float) -> None:
    deadline = time.monotonic() + max_wait
    while True:
        py_ok, bff_ok, merlt_ok, detail = await quick_stack_status(cfg)
        if py_ok and bff_ok and merlt_ok:
            print(f"stack up ({detail})")
            return
        if time.monotonic() >= deadline:
            print(f"wait-for-stack: timeout after {max_wait:.0f}s ({detail}) "
                  "- proceeding to preflight")
            return
        print(f"waiting for stack... ({detail})")
        await asyncio.sleep(5)


async def _run_flows(cfg: Config, report: Report, skip_tags: set[str],
                     only: list[str], include_refine: bool,
                     include_ner_training: bool) -> None:
    admin = ApiClient(cfg, report, "admin")
    user_a = ApiClient(cfg, report, "user_a")
    user_b = ApiClient(cfg, report, "user_b")
    ctx = Context(cfg=cfg, admin=admin, user_a=user_a, user_b=user_b)
    ctx.cap("include_refine", include_refine)
    ctx.cap("include_ner_training", include_ner_training)

    await asyncio.gather(admin.start(), user_a.start(), user_b.start())
    try:
        for name, _module in FLOW_REGISTRY:
            if only and name not in only:
                continue
            try:
                run_fn, tags = get_flow(name)
            except Exception as e:
                report.start_flow(name)
                report.end_flow(name, "FAIL", f"import error: {e!r}")
                continue
            matched = tags & skip_tags
            if matched:
                report.start_flow(name)
                report.end_flow(name, "SKIPPED", f"tag {sorted(matched)}")
                continue
            report.start_flow(name)
            try:
                await run_fn(ctx, report)
            except FlowSkipped as e:
                report.end_flow(name, "SKIPPED", e.reason)
            except StepFailure as e:
                print(json.dumps(e.dump, indent=2, ensure_ascii=False, default=str))
                report.end_flow(name, "FAIL", str(e))
            except Exception as e:
                report.end_flow(name, "FAIL", f"unhandled: {e!r}")
            else:
                report.end_flow(name, "PASS")
    finally:
        await asyncio.gather(admin.close(), user_a.close(), user_b.close())


async def _main() -> int:
    args = parse_args()
    cfg = CONFIG
    print(f"run id: {cfg.run_id}")

    if args.wait_for_stack > 0:
        await _wait_for_stack(cfg, args.wait_for_stack)

    hard_failures, preflight_skips = await run_preflight(cfg)
    if args.preflight_only:
        return 2 if hard_failures else 0
    if hard_failures:
        print(BRING_UP_HINT)
        return 2

    skip_tags = set(preflight_skips) | set(args.skip)
    if args.fast:
        skip_tags |= FAST_SKIP_TAGS
    if skip_tags:
        print(f"active skip tags: {sorted(skip_tags)}")

    only = list(args.only)
    if only and "auth" not in only:
        # flow_auth provisions the identities every other flow depends on
        only.insert(0, "auth")
        print("note: 'auth' added to the --only selection (provisions identities)")

    cfg.require_admin_password()
    report = Report(cfg.run_id)
    try:
        await _run_flows(cfg, report, skip_tags, only,
                         args.include_refine, args.include_ner_training)
    finally:
        print(report.summary())
        path = report.write_json()
        print(f"\nreport: {path}")
    return report.failed_flow_count


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
