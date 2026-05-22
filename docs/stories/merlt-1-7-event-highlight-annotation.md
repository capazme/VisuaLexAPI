---
story_id: MERLT-1.7
title: Event highlight + annotation (RLCF tracking)
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P1
points: 3
status: not_started
depends_on: [MERLT-1.5, MERLT-1.6]
gate: smoke evento verde
skill_driver: "ralph-loop:ralph-loop (template = diff Story 1.5)"
---

# MERLT-1.7 — Event highlight + annotation

## User Story
Come avvocato che evidenzia/annota una porzione di articolo
voglio che il segnale (testo selezionato + articolo + tipo) arrivi a MERL-T come candidate entity proposal
così che RLCF impari quali porzioni di testo sono semanticamente rilevanti per il dominio giuridico.

## Acceptance Criteria
- [ ] Hook `frontend/src/features/merlt/tracking/useHighlightAnnotationTracker.ts` (replica pattern Story 1.5 `useArticleViewedTracker`)
  - Si aggancia a `useAppStore` actions: `addHighlight`, `addAnnotation`
  - Emette evento con `{ anchorText, startOffset, articleUrn, color?, noteText?, type: 'highlight'|'annotation' }`
- [ ] Handler in `routes/merlt/events.ts`: `POST /api/merlt/events/highlight` e `POST /api/merlt/events/annotation` (oppure unico `/events/text-selection` con discriminator)
- [ ] Mapping in `eventMapper.ts`: `toMerltHighlightAnnotation(payload, user)` → `{ event_type: "highlight"|"annotation", entity_text: anchorText, article_urn, user_id, user_authority }`
- [ ] Schema Zod in `schemas/merlt/events.ts`
- [ ] Test unit + integration: consent ON → 202; consent OFF → 403; MERL-T down → 503
- [ ] Smoke UI: highlight su articolo → trace_id ricevuto + record visibile in Postgres MERL-T `qa_traces` con `event_type='highlight'` o `'annotation'`
- [ ] Coverage ≥80%

## Technical Notes
- Driver: ralph-loop con template diff di Story 1.5
- Si aggancia a `SelectionPopup` esistente (dove l'utente trigger highlight/annotation)
- `anchorText` arriva già dallo store annotations/highlights (non rifarlo)
- Edge case obbligatorio: `anchorText` molto lungo (>500 char) — verifica che MERL-T accetti, oppure tronca lato BFF

## Dependencies
- MERLT-1.5 (template + middleware chain)
- MERLT-1.6 (plugin host, perché l'hook va dentro lo slot)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Coverage ≥80% su nuovi file
- [ ] Smoke UI verde
- [ ] Commit `feat(merlt): wire highlight+annotation events to MERL-T`
