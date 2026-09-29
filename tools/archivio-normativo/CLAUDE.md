# Archive CLI — tools/archivio-normativo

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

## Archivio normativo (`tools/archivio-normativo/archivio_normativo/`)

A CLI that builds a local archive of the acts in `tools/archivio-normativo/archivio_normativo/manifest.yaml`
through this API: `python -m archivio_normativo build [--dry-run] [--only …]
[--enrich …]`. One SQLite record per article/recital plus one Markdown per act,
in `archivio_out/` (gitignored). Update runs refetch only the articles whose AKN
fingerprint moved. Text and structure come from VisuaLex; case law and authority
practice from the `legal-it` MCP server (optional, `requirements-archivio.txt`).
Spec: `docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`; how to
run: `tools/archivio-normativo/archivio_normativo/README.md`. Tests: `tests/archivio/`.
