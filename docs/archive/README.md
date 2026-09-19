# Archive

Documents that recorded a decision at the time they were written, and are kept
for that record only. **Nothing here is maintained.** Where an archived document
contradicts the code, the code is right — and where it contradicts `CLAUDE.md`
or the live documents in `docs/`, those are right.

Read one of these to answer "why was it built this way", never "how does it work
now".

## `bmad-2026-03/` — the platform design cycle (March–April 2026)

The BMAD pass that produced the Visualex Platform: product brief → PRD →
architecture → UX design → sprint plan, plus the design critique that followed.
Sprint 1 shipped from this material (Redis, rate limiting, circuit breakers, NL
parser, aliases, citation linker). The cross-references inside these files point
at each other's original `docs/` paths from before the move.

The cycle's two status files stayed in `docs/` — `bmm-workflow-status.yaml` and
`sprint-status.yaml` are tool state that `bmad/config.yaml` still points at, not
documents.

## `polish-2026-04/` — the polish-era audits (April 2026)

Flow audits and a streaming-UX plan from the per-page polish rounds. The rounds
they informed (norma, dossier, environments, forum) all shipped; what survived
of their conclusions lives in `CLAUDE.md` under the UI conventions and gotchas.

## What is still live

`docs/architecture.md`, `docs/deployment.md`, `docs/user_guide.md`,
`docs/backend/`, `docs/frontend/`, `docs/design/` (decided-but-unapplied visual
work), and `docs/superpowers/` (specs and plans for work in flight).

A `docs/merlt/` directory may appear in your working tree — it belongs to
`visualex-merlt-main` and is not part of `main`.
