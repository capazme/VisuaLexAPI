---
story_id: MERLT-1.12
title: PR ready + solutioning gate finale
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P0
points: 1
status: not_started
depends_on: [MERLT-1.11]
gate: PR aperta verso main
skill_driver: "bmad:solutioning-gate-check + commit-commands:commit-push-pr"
---

# MERLT-1.12 — PR ready + solutioning gate finale

## User Story
Come team che chiude lo Slice 1
voglio una PR ben documentata aperta dal branch `visualex-merlt-main` verso `main`
così che la review e il merge siano traccia formale del lavoro e il deploy possa procedere.

## Acceptance Criteria
- [ ] `bmad:solutioning-gate-check` superato (compliance Phase 4 BMAD)
- [ ] Build verde su entrambi backend e frontend (`npm run build`)
- [ ] Test verde su backend e frontend (`npm test`)
- [ ] Coverage `≥80%` confermato su moduli core (services/merlt, routes/merlt, features/merlt)
- [ ] PR aperta `visualex-merlt-main → main` con titolo Conventional Commits
- [ ] PR body include:
  - Summary delle 12 story chiuse
  - Link a `docs/superpowers/specs/2026-05-22-merlt-integration-slice1-design.md`
  - Link a `docs/sprint-plan-merlt-slice1-2026-05-22.md`
  - Link a `docs/smoke-evidence/2026-06-XX-merlt-slice1/`
  - Test plan checklist (eseguibile dal reviewer)
- [ ] `docs/sprint-status.yaml` aggiornato: `MERLT-1a` e `MERLT-1b` con `status: completed`, `completed_on` data corrente
- [ ] `velocity.sprint_2` e `velocity.sprint_3` calcolati e scritti

## Technical Notes
- NON fare push automatica della PR (CLAUDE.md global: never auto-push)
- Proporre il messaggio della PR all'utente prima di `gh pr create`
- L'utente farà il merge manualmente dopo review

## Dependencies
- MERLT-1.11

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] PR URL ricevuto e condiviso con utente
- [ ] sprint-status.yaml committato con stato finale
- [ ] Commit `chore(merlt): close Slice 1 — sprint MERLT-1a/1b completed`
