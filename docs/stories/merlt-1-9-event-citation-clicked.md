---
story_id: MERLT-1.9
title: Event citation:clicked (RLCF tracking)
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P1
points: 2
status: not_started
depends_on: [MERLT-1.5, MERLT-1.6]
gate: smoke evento verde
skill_driver: "ralph-loop:ralph-loop"
---

# MERLT-1.9 — Event citation:clicked

## User Story
Come avvocato che clicca su una citazione tra articoli (citation linker già attivo in VisuaLex)
voglio che il segnale arrivi a MERL-T come "relazione confermata"
così che RLCF rafforzi edges RIFERIMENTO/MODIFICA nel knowledge graph.

## Acceptance Criteria
- [ ] Hook `frontend/src/features/merlt/tracking/useCitationTracker.ts`:
  - Intercetta il click sul citation linker esistente (`citation_linker.py` produce span; il frontend ha click handler)
- [ ] Handler `POST /api/merlt/events/citation-clicked`
- [ ] Mapping: `{ sourceArticleUrn, targetArticleUrn, citationText, clickedAt }` → `{ event_type: "citation_followed", source_urn, target_urn, citation_text, user_id, user_authority }`
- [ ] Schema Zod + test unit + integration
- [ ] Smoke UI: clicca una citazione in un articolo → trace MERL-T presente con `source_urn` e `target_urn` corretti
- [ ] Coverage ≥80%

## Technical Notes
- Driver: ralph-loop iter 3 (l'ultima del loop automatico)
- Lo `targetArticleUrn` può essere null se il citation linker non è riuscito a risolvere la citazione → l'evento si emette comunque con `target_urn = null` (segnale utile: utente ha tentato di seguire una citazione non risolvibile)

## Dependencies
- MERLT-1.5, MERLT-1.6

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Smoke UI verde
- [ ] Commit `feat(merlt): wire citation:clicked event to MERL-T`
