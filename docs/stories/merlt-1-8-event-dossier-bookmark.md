---
story_id: MERLT-1.8
title: Event dossier + bookmark (RLCF tracking)
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P1
points: 3
status: not_started
depends_on: [MERLT-1.5, MERLT-1.6]
gate: smoke evento verde
skill_driver: "ralph-loop:ralph-loop"
---

# MERLT-1.8 — Event dossier + bookmark

## User Story
Come avvocato che salva un articolo in dossier (ricerca strutturata) o in bookmark (uso frequente)
voglio che il segnale arrivi a MERL-T come "articolo giudicato utile per X caso"
così che RLCF pesi articoli di rilevanza pratica diversa dai meri `article:viewed`.

## Acceptance Criteria
- [ ] Hook `frontend/src/features/merlt/tracking/useDossierBookmarkTracker.ts`:
  - Intercetta `dossierService.addItem` (via store action o subscribe)
  - Intercetta `bookmarkService.create`
- [ ] Handler `POST /api/merlt/events/dossier-add` e `POST /api/merlt/events/bookmark-add` (oppure `/events/saved-for-use` con discriminator)
- [ ] Mapping: `{ articleUrn, dossierId?, tags?, savedAt }` → `{ event_type: "saved_for_use", article_urn, context: { dossier_id?, tags? }, user_id, user_authority }`
- [ ] Schema Zod + test unit + integration
- [ ] Smoke UI: aggiungi articolo a dossier → trace MERL-T presente; remove non emette altro evento (è additivo)
- [ ] Coverage ≥80%

## Technical Notes
- Driver: ralph-loop iter 2
- Side effect: il `dossierId` può essere null se l'utente ha appena fatto bookmark senza dossier
- Edge case: rapid-fire dossier-add (utente aggiunge 5 articoli in 2 secondi) → eventi NON debounce, ognuno arriva al BFF (è dato granulare)

## Dependencies
- MERLT-1.5, MERLT-1.6

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Smoke UI verde
- [ ] Commit `feat(merlt): wire dossier+bookmark events to MERL-T`
