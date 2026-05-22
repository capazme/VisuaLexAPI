---
story_id: MERLT-1.5
title: Vertical slice article:viewed end-to-end
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 5
status: not_started
depends_on: [MERLT-1.3, MERLT-1.4]
gate: "STRONG — code review + smoke E2E manuale"
skill_driver: "superpowers:tdd + superpowers:requesting-code-review"
---

# MERLT-1.5 — Vertical slice `article:viewed` end-to-end

## User Story
Come dev che valida il loop VisuaLex→MERL-T→RLCF
voglio l'evento `article:viewed` funzionare end-to-end con consenso, mapping, persistenza MERL-T
così che il pattern sia replicabile sugli altri 4 eventi (Story 1.7-1.10).

## Acceptance Criteria

### Backend
- [ ] `backend/src/routes/merlt/events.ts` con `POST /api/merlt/events/article-viewed` (middleware chain: `authenticate → consentGuard → Zod validate → handler → eventMapper.toMerlt → merltClient.sendEvent`)
- [ ] `backend/src/routes/merlt/health.ts` con `GET /api/merlt/health` (proxy verso MERL-T `:8000/health` + status BFF reachability)
- [ ] `backend/src/routes/merlt/profile.ts` con `GET /api/merlt/profile` (proxy + cache `MerltUserAuthorityCache`)
- [ ] `backend/src/services/merlt/authorityCache.ts` cache reads + sync con MERL-T `/api/profile/full?user_id=`
- [ ] Integration test `backend/tests/integration/merlt/article-viewed.test.ts`:
  - consent ON → `202 { trace_id }`
  - consent OFF → `403 { error: "consent_required" }`
  - MERL-T down (nock blocca) → `503` + dead-letter log

### Frontend
- [ ] `frontend/src/features/merlt/tracking/useArticleViewedTracker.ts` hook React:
  - IntersectionObserver per dwell ≥3s OR scroll ≥30%
  - Emette evento su unmount/tab switch con `{ articleUrn, dwellMs, scrollMaxPct, sessionId, normaVisitataId }`
- [ ] `frontend/src/features/merlt/tracking/trackingEventBus.ts` event bus tipizzato (rework dal commit 81be277)
- [ ] `frontend/src/features/merlt/merltService.ts` rework: solo chiamate BFF, no diretto a `:8000`
- [ ] `frontend/src/features/merlt/consent/{ConsentContext.tsx, ConsentDialog.tsx, useConsent.ts}`:
  - ConsentContext = React context per stato consenso
  - ConsentDialog = dialog onboarding (consent_base + consent_full opzionale, link a privacy policy)
  - useConsent hook = legge consenso da BFF + funzione `revoke()`
- [ ] Frontend test `useArticleViewedTracker.test.tsx`: mount + viewport visible 3s → POST chiamato; unmount → POST con dwellMs corretto

### Smoke E2E & Docs
- [ ] `docs/merlt-smoke-checklist.md` creato con 6 step:
  1. `./start.sh` → container UP (verifica con `docker ps`)
  2. `curl http://localhost:3001/api/merlt/health` → 200
  3. Login + accept consent → SQL query mostra `MerltConsent.consentBase=true`
  4. Apri articolo, leggi 5s → query `SELECT * FROM qa_traces WHERE event_type='article_viewed' ORDER BY created_at DESC LIMIT 1` su Postgres MERL-T mostra trace con `article_urn` corretto e `dwell_ms ≥ 3000`
  5. Revoca consenso, ripeti step 4 → nessun nuovo record
  6. `docker stop merlt-api`, ripeti step 4 → frontend non blocca, BFF logga dead-letter
- [ ] **Smoke E2E manuale eseguito** + log/screenshot in `docs/smoke-evidence/2026-XX-XX-merlt-1-5/`
- [ ] **Code review eseguita** via `feature-dev:code-reviewer` agent + report fixato

### Coverage
- [ ] Coverage ≥80% su `backend/src/services/merlt/*` e `backend/src/routes/merlt/*`

## Technical Notes
- Questa story è il **template** per ralph-loop su Story 1.7-1.9 — strutture il codice in modo che il pattern sia chiaro
- Riusa `ConfirmDialog variant="danger"` per consent revoca (pattern consolidato del progetto)
- Riusa toast system per "Consenso accettato/revocato" UX
- Hook `useArticleViewedTracker` viene chiamato da `ArticleTabContent.tsx` (per ora tramite import diretto; Story 1.6 lo metterà dentro plugin slot)
- Dead-letter log: scrive in `backend/logs/merlt-dead-letter.log` con timestamp + event payload (no PII)

## Dependencies
- MERLT-1.3 (eventMapper, merltClient, Zod)
- MERLT-1.4 (consent + consentGuard)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] **STRONG GATE**: code review report letto e fixato + smoke E2E manuale verde
- [ ] Coverage ≥80%
- [ ] Commit `feat(merlt): wire article:viewed event end-to-end (vertical slice)`
