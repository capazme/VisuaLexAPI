---
story_id: MERLT-1.3
title: Zod schemas + eventMapper + merltClient
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 5
status: not_started
depends_on: [MERLT-1.0, MERLT-1.2]
gate: TDD red→green completo + coverage ≥80%
skill_driver: "superpowers:test-driven-development"
---

# MERLT-1.3 — Zod schemas + eventMapper + merltClient

## User Story
Come BFF che riceve eventi VisuaLex e li inoltra a MERL-T
voglio Zod schemas validati, mapper VisuaLex→MERL-T centralizzato, HTTP client tipizzato
così che ogni evento abbia validazione e traduzione single-source-of-truth, niente debt diffuso.

## Acceptance Criteria
- [ ] `backend/src/schemas/merlt/events.ts` con Zod schemas per i 5 eventi:
  - `articleViewedEventSchema` (articleUrn, dwellMs, scrollMaxPct, sessionId, normaVisitataId)
  - `highlightAnnotationEventSchema` (anchorText, startOffset, articleUrn, color?, noteText?)
  - `dossierBookmarkEventSchema` (articleUrn, dossierId?, tags?)
  - `citationClickedEventSchema` (sourceArticleUrn, targetArticleUrn, citationText)
  - `forumSignalEventSchema` (sharedEnvId, action, originalAuthorId)
- [ ] `backend/src/schemas/merlt/consent.ts` con Zod schemas per consent (POST body, response, audit entry)
- [ ] `backend/src/services/merlt/eventMapper.ts` con funzioni `toMerlt<EventName>()` per ogni evento (5 funzioni)
- [ ] `backend/src/services/merlt/merltClient.ts` HTTP client tipizzato verso MERL-T :8000 con timeout configurabile (default 5s), error mapping (5xx→503, timeout→503, 4xx→pass-through)
- [ ] Unit test coverage ≥80% sui 3 moduli (`backend/tests/unit/merlt/{eventMapper,merltClient,schemas}.test.ts`)
- [ ] Mock MERL-T via `nock` per merltClient test
- [ ] Test edge case (obbligatori): URN con suffisso `-bis`/`-ter`, articleId malformato, payload null fields
- [ ] eventMapper riusa `articleIds.ts` utilities (`getUniqueArticleId`, `findArticleByNormalizedId`) per il mapping URN

## Technical Notes
- Driver: TDD strict — scrivi test PRIMA, implementazione DOPO
- Hook PostToolUse auto-runa vitest sui file modificati → feedback loop veloce
- Per `merltClient`: usa `fetch` nativo (Node 20+) o `undici`, no axios (per coerenza con resto repo)
- `eventMapper.toMerltArticleViewed(payload, user)` arricchisce con `user_id`, `user_authority` da `authorityCache` (cache stub per ora, vera in Story 1.5)

## Dependencies
- MERLT-1.0 (MERL-T deve girare per integration check del client)
- MERLT-1.2 (cache Prisma client necessario per authorityCache)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Coverage `services/merlt/*` + `schemas/merlt/*` ≥80%
- [ ] Commit `feat(merlt): add Zod schemas, eventMapper and merltClient`
