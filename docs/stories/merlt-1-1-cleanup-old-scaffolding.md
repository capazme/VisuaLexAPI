---
story_id: MERLT-1.1
title: Cleanup commit 81be277
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 2
status: not_started
depends_on: [MERLT-1.0]
gate: build verde
skill_driver: "bmad:dev-story + verify"
---

# MERLT-1.1 — Cleanup commit 81be277

## User Story
Come dev che ricostruisce su fondamenta pulite
voglio rimuovere lo scaffolding hardcoded del commit 81be277
così che il nuovo codice sia organizzato senza debt residuo.

## Acceptance Criteria
- [ ] `backend/src/routes/merlt.ts` (~696 righe) eliminato dal repo
- [ ] `backend/tests/merlt.test.ts` (~261 righe) spostato in `backend/tests/_archived_pre_slice1/merlt.test.ts.bak`
- [ ] `backend/src/app.ts` rimuove import e mount di `routes/merlt.ts` (se presente)
- [ ] Eventuali import orfani identificati via `grep -r "routes/merlt" backend/src` e fixati
- [ ] `npm run build` verde post-rimozione
- [ ] `npm test` non rompe (test archiviato non viene più eseguito)

## Technical Notes
- Storia git preserva il file eliminato (recuperabile via `git log --follow -- backend/src/routes/merlt.ts`)
- L'archive `_archived_pre_slice1/` è per consultazione, non per esecuzione
- Verificare anche `frontend/src/features/merlt/merltService.ts` per chiamate orfane verso endpoint del vecchio router

## Dependencies
- MERLT-1.0 (runtime baseline prima del cleanup, così se rompiamo qualcosa lo vediamo subito)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Build + test verdi
- [ ] Commit `chore(merlt): cleanup commit 81be277 stub scaffolding`
