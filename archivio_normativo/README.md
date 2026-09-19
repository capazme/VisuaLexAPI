# Archivio normativo

A local, updatable archive of the acts listed in `manifest.yaml`: one SQLite
record per article (or recital, for EU acts) and one Markdown file per act,
built on the VisuaLex API. Design and rationale:
`docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`.

## Prerequisites

- The VisuaLex Python API running locally (`source .venv/bin/activate && python app.py`,
  port 5000). The archive never starts it.
- For enrichment beyond Brocardi (case law, Consulta, Garante, EU↔IT): the
  `legal-it` MCP server, reachable through the command in
  `providers.legalit.command` (or `LEGALIT_MCP_COMMAND`, a JSON list), and
  `pip install -r requirements-archivio.txt` in the project venv.

## Commands

```bash
python -m archivio_normativo build --dry-run                 # what would happen, no writes
python -m archivio_normativo build                           # everything in the manifest
python -m archivio_normativo build --only cc,gdpr            # some acts
python -m archivio_normativo build --area privacy-digitale
python -m archivio_normativo build --only dlgs-231-2001 --enrich brocardi,giurisprudenza
python -m archivio_normativo build --full                    # ignore fingerprints (monthly)
python -m archivio_normativo build --resume                  # continue the interrupted run
python -m archivio_normativo verify                          # integrity checks over the store
python -m archivio_normativo render                          # rewrite the Markdown, no network
python -m archivio_normativo report                          # last run
python -m archivio_normativo export --jsonl units.jsonl
```

Output goes to `--out` (default `archivio_out/`, gitignored):
`archivio.sqlite`, `INDICE.md`, one `<area>/<id>.md` per act, `logs/`.

## Running it

Never start two `build`s against the same `--out` at once: both open the same
SQLite store and write to it, and the second one's startup marks the first
run "interrupted" (`store.mark_running_as_interrupted`) even though it is
still going — the run row and the archive end up written by two writers at
once.

A long build (a fresh archive, or `--full`) outlives a terminal session, so
run it detached and check on it separately:

```bash
mkdir -p archivio_out && nohup .venv/bin/python -m archivio_normativo build > archivio_out/build.txt 2>&1 &
python -m archivio_normativo report                # progress / last run's stats
```

If it gets killed (Ctrl-C, a closed terminal, `kill`), the next `report` or
`verify` still reflects everything committed so far — nothing is lost, units
are written per act — and `build --resume` continues the same run rather than
starting over.

## How an update run stays cheap

For Normattiva acts, `/fetch_act_fingerprints` gives a hash per article from
one download of the act; only articles whose hash moved are fetched again.
EU acts are one page each and are re-read on every run. Run `--full` now and
then: fingerprints see content changes, not changes in Normattiva's HTML
rendering.

## Editing the manifest

Every act is an entry under `acts:`; unknown keys are errors. Codici need only
`act_type` (the names VisuaLex knows, see `visualex_api/tools/map.py`);
other acts carry `date` and `act_number`; EU acts carry `celex` and may name a
consolidated version with `celex_consolidated`. `cite` is how you would write
the act in a citation — it composes the references sent to legal-it. Run
`build --dry-run` after editing: an act that does not resolve is listed in
the report, never silently skipped.

## Exit codes

0 clean · 1 an act did not resolve or a unit failed · 2 usage or manifest
error · 130 interrupted (use `--resume`).
