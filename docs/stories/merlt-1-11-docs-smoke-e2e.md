---
story_id: MERLT-1.11
title: Doc finali + smoke E2E completo
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P0
points: 2
status: not_started
depends_on: [MERLT-1.7, MERLT-1.8, MERLT-1.9, MERLT-1.10]
gate: smoke evidence + coverage
skill_driver: "superpowers:verification-before-completion + code-review"
---

# MERLT-1.11 — Doc finali + smoke E2E completo

## User Story
Come futuro dev (o futuro me)
voglio doc aggiornati che riflettano lo stato post-Slice 1
così che non serva rileggere la storia git per capire come funziona il loop RLCF.

## Acceptance Criteria
- [ ] `CLAUDE.md` aggiornato con sezione **"MERL-T Integration (Slice 1)"** che include:
  - Entry points BFF (`backend/src/routes/merlt/*`, `services/merlt/*`)
  - Entry points frontend (`frontend/src/features/merlt/*`, `plugins/slots/ArticleMerltSlot.tsx`)
  - Feature flags (`MERLT_ENABLED`, `VITE_FEATURE_MERLT`)
  - Gotcha Slice 1 da aggiungere alla lista esistente
  - Riferimento a `docs/merlt-smoke-checklist.md`
- [ ] `docs/merlt-upstream-sync.md` finalizzato: policy esplicita di sync con `ALIS_CORE/merlt` (single source of truth = `VisuaLexAPI/merlt`), procedura per pull da upstream
- [ ] `docs/merlt-smoke-checklist.md` esteso con 5 sezioni (una per evento) + sezione "feature flag verification"
- [ ] **Smoke E2E manuale eseguito** per tutti i 5 eventi:
  1. article:viewed
  2. highlight + annotation
  3. dossier + bookmark
  4. citation:clicked
  5. forum (like/download/suggestion_decided)
- [ ] Log + screenshot salvati in `docs/smoke-evidence/2026-06-XX-merlt-slice1/`
- [ ] Coverage finale `≥80%` su `backend/src/services/merlt/*` e `backend/src/routes/merlt/*`
- [ ] Frontend coverage `≥80%` su `frontend/src/features/merlt/*`

## Technical Notes
- Riusa il format dei gotcha esistenti in `CLAUDE.md` (vedi sezione "Gotchas and Known Issues")
- Per smoke evidence: cattura console output + screenshot UI + query SQL output

## Dependencies
- MERLT-1.7, MERLT-1.8, MERLT-1.9, MERLT-1.10 (tutti gli eventi devono essere completi prima dello smoke completo)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Doc revisionati con vista fresca
- [ ] Commit `docs(merlt): update CLAUDE.md + smoke checklist + upstream sync policy`
