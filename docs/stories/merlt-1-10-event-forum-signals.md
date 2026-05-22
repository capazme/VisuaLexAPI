---
story_id: MERLT-1.10
title: Event forum (like / download / suggestion_decided)
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P1
points: 3
status: not_started
depends_on: [MERLT-1.5, MERLT-1.6]
gate: "decisione target_author_id tracciata + smoke evento verde"
skill_driver: "superpowers:brainstorming → bmad:dev-story (NO ralph-loop)"
---

# MERLT-1.10 — Event forum (like / download / suggestion_decided)

## User Story
Come piattaforma che già produce segnali community (forum `SharedEnvironment` con like, download, suggestion accept/decline)
voglio che questi segnali siano usati come authority signal RLCF
così che chi produce contenuti di qualità (ambienti scaricati e likeati) abbia track record alto in MERL-T.

## Acceptance Criteria

### Decisione architetturale (PRE-implementazione)
- [ ] Decisione tracciata in `docs/merlt-forum-authoring-decision.md`: chi è `target_author_id` quando un'item è preso da suggestion?
  - Opzione A: `originalAuthorId` del `SharedEnvironment` ricevente (chi ha pubblicato l'ambiente)
  - Opzione B: `originalAuthorId` dal `SuggestionItem` (chi ha proposto l'item, anche se proviene da un terzo `sourceSuggestionId`)
  - Opzione C: doppio attribution (entrambi ricevono signal con peso diviso 50/50)
- [ ] Rationale documentato + open question §10.3 del design doc chiusa

### Implementazione
- [ ] Hook `useForumSignalTracker.ts` (intercetta 3 azioni: like, download, suggestion_decided)
- [ ] 3 handler BFF:
  - `POST /api/merlt/events/forum-like` (body: `{ sharedEnvId, originalAuthorId }`)
  - `POST /api/merlt/events/forum-download` (body: `{ sharedEnvId, originalAuthorId }`)
  - `POST /api/merlt/events/forum-suggestion-decided` (body: `{ suggestionId, decision: 'accept'|'decline', originalAuthorId, targetAuthorId }`)
- [ ] Mapping: `{ sharedEnvId, action, originalAuthorId }` → `{ event_type: "community_signal", action, target_author_id, source_user_id, user_authority }` (la decisione architetturale guida il `target_author_id`)
- [ ] Schema Zod + test unit + integration
- [ ] Smoke UI per ognuna delle 3 azioni
- [ ] Coverage ≥80%

## Technical Notes
- **NO ralph-loop**: questa story richiede decisione architetturale che il loop non può prendere
- Riferimento gotcha #21 di `CLAUDE.md`: `sourceSuggestionId` + `originalAuthorId` sono attribution contract, mai mutare
- Il segnale "decline" è importante quanto "accept": un'item declinata indica scarsa qualità (negative training signal)

## Dependencies
- MERLT-1.5, MERLT-1.6
- Decisione architetturale (sub-task PRE)

## Definition of Done
- [ ] Decisione architetturale documentata
- [ ] Tutti gli AC verdi
- [ ] Smoke UI verde
- [ ] Commit `feat(merlt): wire forum community signals (like/download/suggestion) to MERL-T`
