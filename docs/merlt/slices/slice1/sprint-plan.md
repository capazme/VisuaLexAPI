# Sprint Plan: MERL-T Integration Slice 1

**Date:** 2026-05-22
**Scrum Master:** gpuzio
**Project Level:** 3 (sub-deliverable di Visualex Platform)
**Total Stories:** 12
**Total Points:** 42 (25 Sprint MERLT-1a + 17 Sprint MERLT-1b)
**Planned Sprints:** 2 (MERLT-1a, MERLT-1b)
**Sprint Length:** 2 weeks
**Team Capacity:** 30 points/sprint
**Branch:** `visualex-merlt-main`

---

## Executive Summary

Lo Slice 1 attua l'integrazione VisuaLex ↔ MERL-T ↔ RLCF chiudendo il loop di eventi utente verso il backend MERL-T (FastAPI+RLCF+FalkorDB+Qdrant esistente in `ALIS_CORE/merlt`). 12 story BMAD-compliant suddivise su 2 sprint dedicati (4 settimane wall-clock), seguendo *vertical slice approach* (Approach B): `article:viewed` end-to-end nella Sprint 1a, poi replica del pattern sugli altri 4 eventi nella Sprint 1b via `ralph-loop`.

**Cosa NON viene fatto in Slice 1**: knowledge graph visualization (Slice 2), Q&A multi-expert UI (Slice 3), admin/training ops (Slice 4+).

**Reference docs**:
- Design: `./design.md`
- Execution plan: `~/.claude/plans/cozy-stargazing-parnas.md`
- Reference ALIS_CORE: `/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/docs/PIANO_DEFINITIVO_INTEGRAZIONE.md`

**Key Metrics:**
- Total Stories: 12
- Total Points: 42
- Sprints: 2 (25pt + 17pt)
- Team Capacity: 30 points/sprint
- Target Completion: 2026-06-18 (~4 settimane)

---

## Sprint Allocation

### Sprint MERLT-1a (Sprint #2) — Fondamenta + Vertical Slice

**Goal:** Avere VisuaLex+MERL-T che girano insieme via docker-compose, BFF Zod-tipizzato con consenso DB-persisted, e l'evento `article:viewed` che arriva da frontend a MERL-T end-to-end. Smoke E2E manuale verde + code review.

**Stories:** 6 (25 punti, 83% capacity utilization)

| Story | Title | Pt | Priority | Skill Driver |
|-------|-------|----|----------|--------------|
| MERLT-1.0 | Runtime baseline & MERL-T copy | 5 | P0 | `bmad:dev-story` + `feature-dev:code-architect` |
| MERLT-1.1 | Cleanup commit 81be277 | 2 | P0 | `bmad:dev-story` + `verify` |
| MERLT-1.2 | Prisma schema + migration | 3 | P0 | `bmad:dev-story` (ruolo database-architect inline) |
| MERLT-1.3 | Zod schemas + eventMapper + merltClient | 5 | P0 | `superpowers:test-driven-development` |
| MERLT-1.4 | Consent API + consentGuard middleware | 5 | P0 | `superpowers:tdd` |
| MERLT-1.5 | Vertical slice `article:viewed` E2E | 5 | P0 | `superpowers:tdd` + `superpowers:requesting-code-review` |

**Gate finale Sprint MERLT-1a (post-1.5)**: **STRONG GATE** — `superpowers:requesting-code-review` dispatcha `feature-dev:code-reviewer`; smoke E2E manuale (apri articolo, leggi 5s, verify SQL su Postgres MERL-T trace `article_viewed`). Bloccante per Sprint MERLT-1b.

**Risks:**
- Docker compose con 5 servizi dipendenti (FalkorDB, Qdrant, Redis, Postgres MERL-T, MERL-T API): smoke runtime potrebbe richiedere debugging iterativo
- Drift tra contratto MERL-T atteso e endpoint reale (`tracking_router.py`): mapping da adeguare in Story 1.3

**Dependencies:**
- `ALIS_CORE/merlt/` deve essere accessibile per Story 1.0 (copy)
- Docker daemon attivo
- Playwright installato (per scraper VisuaLex preesistente)

---

### Sprint MERLT-1b (Sprint #3) — Plugin Host + Replica + Closure

**Goal:** Disaccoppiare la UI MERL-T da `ArticleTabContent` via plugin host; replicare il pattern di Story 1.5 sugli altri 4 eventi (highlight+annotation, dossier+bookmark, citation:clicked, forum signals); doc finali; PR pronto.

**Stories:** 7 (17 punti, 57% capacity utilization — bassa perché ralph-loop comprime il tempo)

| Story | Title | Pt | Priority | Skill Driver |
|-------|-------|----|----------|--------------|
| MERLT-1.6 | Plugin host minimo (disaccoppiamento) | 3 | P1 | `feature-dev:code-architect` + `bmad:dev-story` |
| MERLT-1.7 | Event highlight + annotation | 3 | P1 | `ralph-loop:ralph-loop` |
| MERLT-1.8 | Event dossier + bookmark | 3 | P1 | `ralph-loop:ralph-loop` |
| MERLT-1.9 | Event citation:clicked | 2 | P1 | `ralph-loop:ralph-loop` |
| MERLT-1.10 | Event forum (like/download/suggestion_decided) | 3 | P1 | `superpowers:brainstorming` + `bmad:dev-story` |
| MERLT-1.11 | Doc finali + smoke E2E completo | 2 | P0 | `superpowers:verification-before-completion` |
| MERLT-1.12 | PR ready + solutioning gate | 1 | P0 | `bmad:solutioning-gate-check` + `commit-commands:commit-push-pr` |

**Ralph-Loop setup (Story 1.7-1.9)**:
- Template input: diff Story 1.5
- Iterazioni: 3
- Done condition per iter: `npm test --grep <event>` verde + smoke UI verde + coverage ≥80%
- Stop manuale: schema MERL-T diverge / >2 fallimenti / coverage <80% / `/ralph-loop:cancel-ralph`

**Risks:**
- Story 1.10 forum richiede decisione architetturale su `target_author_id` (open question §10.3 del design) — può sforare il sprint se il brainstorming si dilunga
- Ralph-loop edge cases (es. URN `-bis` formatting): test cases dal design §7 obbligatori

**Dependencies:**
- Sprint MERLT-1a completato e GATE FORTE superato

---

## Story Inventory

### MERLT-1.0 — Runtime baseline & MERL-T copy

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 5

**User Story:**
Come dev che lavora su Slice 1
voglio un comando unico che avvii VisuaLex+MERL-T con tutte le dipendenze
così che posso iterare sull'integrazione senza setup manuale ricorrente.

**Acceptance Criteria:**
- [ ] `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/merlt/` esiste come copia integrale di `/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/`
- [ ] Tag git `merlt-baseline-from-alis-core` creato sul commit di import
- [ ] `docker-compose.merlt.yml` esteso con: `merlt-api`, `falkordb`, `qdrant`, `redis-merlt`, `postgres-merlt` (5 servizi)
- [ ] Healthcheck definito per ogni servizio
- [ ] `start.sh` rispetta `MERLT_ENABLED` / `MERLT_COMPOSE_ENABLED` env vars
- [ ] `MERLT_ENABLED=true ./start.sh` → `curl http://localhost:8000/health` ritorna 200 entro 60s
- [ ] `MERLT_ENABLED=false ./start.sh` → solo VisuaLex + dipendenze base partono, MERL-T NON parte
- [ ] `docs/merlt-upstream-sync.md` creato e dichiara `VisuaLexAPI/merlt/` come single source of truth

**Technical Notes:**
- Riusa la logica `MERLT_ENABLED` già presente nel commit `81be277` (start.sh)
- Path `ALIS_CORE` da configurare: l'utente potrebbe averla in altra posizione
- `postgres-merlt` separato da Postgres VisuaLex per coerenza con scelta architetturale (due DB)

**Dependencies:** Nessuna

---

### MERLT-1.1 — Cleanup commit 81be277

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 2

**User Story:**
Come dev che ricostruisce su fondamenta pulite
voglio rimuovere lo scaffolding hardcoded del commit 81be277
così che il nuovo codice sia organizzato senza debt residuo.

**Acceptance Criteria:**
- [ ] `backend/src/routes/merlt.ts` (~696 righe) eliminato dal repo
- [ ] `backend/tests/merlt.test.ts` (~261 righe) spostato in `backend/tests/_archived_pre_slice1/merlt.test.ts.bak`
- [ ] `backend/src/app.ts` rimuove l'import e mount di routes/merlt.ts (se presente)
- [ ] `npm run build` verde post-rimozione
- [ ] Eventuali altri import orfani identificati e fixati

**Technical Notes:**
- Eseguire `grep -r "routes/merlt" backend/src` per trovare import orfani prima di rimuovere
- Storia git preserva il file eliminato (recuperabile via `git log --follow`)

**Dependencies:** MERLT-1.0

---

### MERLT-1.2 — Prisma schema + migration

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 3

**User Story:**
Come BFF che deve gestire consenso e authority MERL-T per utente
voglio le tabelle Prisma corrispondenti
così che il consenso e l'authority cache vivano su DB persistente.

**Acceptance Criteria:**
- [ ] `backend/prisma/schema.prisma` ha i 3 nuovi modelli: `MerltConsent`, `MerltConsentAudit`, `MerltUserAuthorityCache` (esatto schema da design doc §5.3)
- [ ] `npx prisma migrate dev --name add_merlt_consent` genera migration
- [ ] Migration applicata a DB locale, `prisma migrate status` mostra "Database schema is up to date"
- [ ] `npx prisma generate` rigenera client TypeScript
- [ ] `npm run build` verde

**Technical Notes:**
- Nessuna relazione cross-DB con Postgres MERL-T (i due DB sono separati per design)
- Indici su `userId` e `createdAt` in `MerltConsentAudit` per query performance

**Dependencies:** MERLT-1.0

---

### MERLT-1.3 — Zod schemas + eventMapper + merltClient

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 5

**User Story:**
Come BFF che riceve eventi VisuaLex e li inoltra a MERL-T
voglio Zod schemas validati, mapper VisuaLex→MERL-T centralizzato, HTTP client tipizzato
così che ogni evento abbia validazione e traduzione single-source-of-truth.

**Acceptance Criteria:**
- [ ] `backend/src/schemas/merlt/events.ts` con Zod schemas per i 5 eventi (article:viewed, highlight/annotation, dossier/bookmark, citation:clicked, forum)
- [ ] `backend/src/schemas/merlt/consent.ts` con Zod schemas per consent endpoints
- [ ] `backend/src/services/merlt/eventMapper.ts` con funzioni `toMerlt<EventName>()` per ogni evento — traduce VisuaLex types (URN, NormaVisitata, articleId) → MERL-T schema (article_urn, user_id, dwell_ms)
- [ ] `backend/src/services/merlt/merltClient.ts` HTTP client tipizzato con timeout configurabile, error mapping
- [ ] Unit test coverage ≥80% sui 3 moduli (`backend/tests/unit/merlt/*.test.ts`)
- [ ] Mock MERL-T via `nock` per test merltClient
- [ ] Test edge case: URN con suffisso `-bis`, articleId malformato, payload null fields
- [ ] Riuso di `articleIds.ts` utilities (`getUniqueArticleId`, `findArticleByNormalizedId`) per il mapping URN

**Technical Notes:**
- Driver: TDD — scrivi test PRIMA, implementazione DOPO
- Hook PostToolUse auto-runa vitest sui file modificati → feedback loop veloce

**Dependencies:** MERLT-1.0, MERLT-1.2

---

### MERLT-1.4 — Consent API + consentGuard middleware

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 5

**User Story:**
Come avvocato che usa VisuaLex
voglio dare/revocare consenso al tracking MERL-T in modo esplicito
così che il mio dato venga inviato a MERL-T solo se ho acconsentito.

**Acceptance Criteria:**
- [ ] `backend/src/routes/merlt/consent.ts` con `GET /api/merlt/consent`, `POST /api/merlt/consent`, `DELETE /api/merlt/consent`
- [ ] `backend/src/routes/merlt/index.ts` mount router su `/api/merlt` con `authenticate` middleware
- [ ] `backend/src/services/merlt/consentGuard.ts` middleware Express che blocca con `403 consent_required` se `MerltConsent.consentBase = false` o `revokedAt != null`
- [ ] Audit log: ogni transizione consenso (accepted_base, accepted_full, revoked, upgraded) crea record in `MerltConsentAudit` con ip + userAgent
- [ ] Integration test `backend/tests/integration/merlt/consent-lifecycle.test.ts` verde: POST → query DB → DELETE → audit row presente
- [ ] Coverage ≥80% su `services/merlt/consentGuard.ts`

**Technical Notes:**
- Riusa il middleware `authenticate` esistente in `backend/src/middleware/`
- Riusa `backend/tests/setup.ts` (esistente dal commit 81be277) per integration test

**Dependencies:** MERLT-1.2, MERLT-1.3

---

### MERLT-1.5 — Vertical slice `article:viewed` end-to-end

**Sprint:** MERLT-1a
**Priority:** P0
**Points:** 5
**Gate:** STRONG — code review + smoke E2E manuale

**User Story:**
Come dev che valida il loop VisuaLex→MERL-T→RLCF
voglio l'evento article:viewed funzionare end-to-end con consenso, mapping, persistenza MERL-T
così che il pattern sia replicabile sugli altri 4 eventi.

**Acceptance Criteria:**
- [ ] `backend/src/routes/merlt/events.ts` con `POST /api/merlt/events/article-viewed` (middleware chain: authenticate → consentGuard → Zod validate → handler → eventMapper.toMerlt → merltClient.sendEvent)
- [ ] `backend/src/routes/merlt/health.ts` con `GET /api/merlt/health` (proxy verso MERL-T `:8000/health`)
- [ ] `backend/src/routes/merlt/profile.ts` con `GET /api/merlt/profile` (proxy + cache `MerltUserAuthorityCache`)
- [ ] `backend/src/services/merlt/authorityCache.ts` cache reads + sync con MERL-T
- [ ] `frontend/src/features/merlt/tracking/useArticleViewedTracker.ts` hook React: IntersectionObserver per dwell ≥3s OR scroll ≥30%; emette evento su unmount/tab switch con `{ articleUrn, dwellMs, scrollMaxPct, sessionId, normaVisitataId }`
- [ ] `frontend/src/features/merlt/tracking/trackingEventBus.ts` event bus tipizzato (rework dal commit 81be277)
- [ ] `frontend/src/features/merlt/merltService.ts` rework: solo chiamate BFF, no diretto a `:8000`
- [ ] `frontend/src/features/merlt/consent/{ConsentContext.tsx, ConsentDialog.tsx, useConsent.ts}` minimi ma funzionali
- [ ] Integration test `backend/tests/integration/merlt/article-viewed.test.ts`: consent ON → 202+trace_id; consent OFF → 403; MERL-T down (nock blocca) → 503 + dead-letter log
- [ ] Frontend test `frontend/src/features/merlt/tracking/__tests__/useArticleViewedTracker.test.tsx`: mount + viewport visible 3s → POST called; unmount → POST con dwellMs corretto
- [ ] `docs/merlt-smoke-checklist.md` creato con 6 step (vedi design doc §verification)
- [ ] **Smoke E2E manuale eseguito**: login → consent → apri articolo → leggi 5s → query SQL Postgres MERL-T trace presente
- [ ] **Code review eseguita** via `feature-dev:code-reviewer` agent + report fixato
- [ ] Coverage ≥80% su `backend/src/services/merlt/*`

**Technical Notes:**
- Questa story è il **template** per ralph-loop Story 1.7-1.9
- Riusa `ConfirmDialog variant="danger"` per consent revoca (pattern consolidato)
- Riusa toast system per "Consenso accettato/revocato" UX

**Dependencies:** MERLT-1.3, MERLT-1.4

---

### MERLT-1.6 — Plugin host minimo (disaccoppiamento)

**Sprint:** MERLT-1b
**Priority:** P1
**Points:** 3

**User Story:**
Come dev che vuole testare VisuaLex senza MERL-T acceso
voglio un feature flag che disabiliti tutta la UI MERL-T senza toccare ArticleTabContent
così che il disaccoppiamento sia pulito e MERL-T sia un plugin vero, non hardcoded.

**Acceptance Criteria:**
- [ ] `frontend/src/plugins/{registry.tsx, types.ts}` rifattorizzati e tipizzati
- [ ] `frontend/src/plugins/slots/ArticleMerltSlot.tsx` esporta lo slot React
- [ ] `frontend/src/components/features/search/ArticleTabContent.tsx` usa `<PluginSlot id="article-merlt"/>` invece di import diretto del componente MERL-T
- [ ] Feature flag `VITE_FEATURE_MERLT=false` in `frontend/.env` → nessun componente MERL-T renderizzato; app gira come vanilla
- [ ] Feature flag `VITE_FEATURE_MERLT=true` → slot MERL-T rendera normalmente
- [ ] Smoke manuale: toggle flag, restart frontend, verifica UI

**Technical Notes:**
- Riusa il plugin registry già abbozzato nel commit 81be277, ma rifattorizza per essere tipizzato e disaccoppiato
- `MERLT_ENABLED` (env start.sh) e `VITE_FEATURE_MERLT` (env frontend) sono indipendenti per design

**Dependencies:** MERLT-1.5

---

### MERLT-1.7 — Event highlight + annotation

**Sprint:** MERLT-1b
**Priority:** P1
**Points:** 3
**Driver:** ralph-loop (template = diff Story 1.5)

**User Story:**
Come avvocato che evidenzia/annota un articolo
voglio che il segnale arrivi a MERL-T come candidate entity proposal
così che RLCF impari quali porzioni di testo sono semanticamente rilevanti.

**Acceptance Criteria:**
- [ ] Hook `frontend/src/features/merlt/tracking/useHighlightAnnotationTracker.ts` (pattern Story 1.5)
- [ ] Handler nel router `routes/merlt/events.ts`: `POST /api/merlt/events/highlight` e `POST /api/merlt/events/annotation`
- [ ] Mapping in `eventMapper.ts`: `{ anchorText, startOffset, articleUrn, color?, noteText? }` → `{ event_type: "highlight"|"annotation", entity_text, article_urn, user_id }`
- [ ] Schema Zod in `schemas/merlt/events.ts`
- [ ] Test unit + integration verdi
- [ ] Smoke UI: highlight su articolo → trace_id ricevuto + record MERL-T

**Technical Notes:**
- Integrazione con `SelectionPopup` esistente (dove l'utente attiva highlight/annotation)
- `anchorText` arriva già dallo store annotations

**Dependencies:** MERLT-1.5, MERLT-1.6

---

### MERLT-1.8 — Event dossier + bookmark

**Sprint:** MERLT-1b
**Priority:** P1
**Points:** 3
**Driver:** ralph-loop

**User Story:**
Come avvocato che salva un articolo in dossier/bookmark
voglio il segnale di salvataggio arrivi a MERL-T come "articolo utile per X"
così che RLCF pesi articoli di rilevanza pratica diversa dai meri article:viewed.

**Acceptance Criteria:**
- [ ] Hook `useDossierBookmarkTracker.ts` (intercetta `dossierService.addItem` e `bookmarkService.create`)
- [ ] Handler `POST /api/merlt/events/dossier-add` e `POST /api/merlt/events/bookmark-add`
- [ ] Mapping: `{ articleUrn, dossierId?, tags? }` → `{ event_type: "saved_for_use", article_urn, context }`
- [ ] Test + smoke

**Dependencies:** MERLT-1.5, MERLT-1.6

---

### MERLT-1.9 — Event citation:clicked

**Sprint:** MERLT-1b
**Priority:** P1
**Points:** 2
**Driver:** ralph-loop

**User Story:**
Come avvocato che clicca su una citazione tra articoli
voglio che il segnale arrivi a MERL-T come relazione confermata
così che RLCF rafforzi edges RIFERIMENTO/MODIFICA nel knowledge graph.

**Acceptance Criteria:**
- [ ] Hook `useCitationTracker.ts` (intercetta il click sul citation linker esistente)
- [ ] Handler `POST /api/merlt/events/citation-clicked`
- [ ] Mapping: `{ sourceArticleUrn, targetArticleUrn, citationText }` → `{ event_type: "citation_followed", source_urn, target_urn }`
- [ ] Test + smoke

**Dependencies:** MERLT-1.5, MERLT-1.6

---

### MERLT-1.10 — Event forum (like / download / suggestion_decided)

**Sprint:** MERLT-1b
**Priority:** P1
**Points:** 3
**Driver:** brainstorming → bmad:dev-story (NO ralph-loop)

**User Story:**
Come piattaforma con segnali community (forum SharedEnvironment)
voglio che like/download/suggestion accept-decline siano segnali authority RLCF
così che chi produce contenuti di qualità abbia track record alto.

**Acceptance Criteria:**
- [ ] **Decisione architetturale tracciata**: chi è `target_author_id` quando un'item è preso da suggestion (originalAuthorId del SharedEnvironment? sourceSuggestionId?). Riferimento gotcha #21 di CLAUDE.md
- [ ] Hook `useForumSignalTracker.ts`
- [ ] 3 handler: `POST /api/merlt/events/forum-like`, `forum-download`, `forum-suggestion-decided`
- [ ] Mapping: `{ sharedEnvId, action, originalAuthorId }` → `{ event_type: "community_signal", action, target_author_id }`
- [ ] Test + smoke

**Technical Notes:**
- Open question §10.3 del design doc da risolvere PRIMA dell'implementazione
- Usa `superpowers:brainstorming` per chiarire l'authoring

**Dependencies:** MERLT-1.5, MERLT-1.6

---

### MERLT-1.11 — Doc finali + smoke E2E completo

**Sprint:** MERLT-1b
**Priority:** P0
**Points:** 2

**User Story:**
Come futuro dev (o futuro me)
voglio doc aggiornati che riflettano lo stato post-Slice 1
così che non serva rileggere la storia git per capire come funziona.

**Acceptance Criteria:**
- [ ] `CLAUDE.md` aggiornato con sezione MERL-T integration (entry points, gotchas Slice 1, file rules)
- [ ] `docs/merlt-upstream-sync.md` finalizzato (policy di sync con ALIS_CORE)
- [ ] `docs/merlt-smoke-checklist.md` esteso con 5 eventi (1 article:viewed + 4 nuovi)
- [ ] **Smoke E2E manuale eseguito** per tutti i 5 eventi, log + screenshot salvati in `docs/smoke-evidence/2026-06-XX-merlt-slice1/`
- [ ] Coverage finale `≥80%` su `backend/src/services/merlt/*` e `backend/src/routes/merlt/*`

**Dependencies:** MERLT-1.7, MERLT-1.8, MERLT-1.9, MERLT-1.10

---

### MERLT-1.12 — PR ready + solutioning gate

**Sprint:** MERLT-1b
**Priority:** P0
**Points:** 1

**User Story:**
Come team che chiude un slice
voglio una PR ben documentata aperta verso main
così che la review e il merge siano traccia formale del lavoro.

**Acceptance Criteria:**
- [ ] `bmad:solutioning-gate-check` superato (compliance Phase 4)
- [ ] PR aperta `visualex-merlt-main` → `main` con summary delle 12 story
- [ ] PR body include link a design doc, sprint plan, smoke evidence
- [ ] Build + test + coverage verdi su CI (se presente)

**Dependencies:** MERLT-1.11

---

## Epic Traceability

Lo Slice 1 introduce un nuovo "epic" non presente nel PRD originale (che è anteriore alla decisione MERL-T):

| Epic ID | Epic Name | Stories | Total Points | Sprint |
|---------|-----------|---------|--------------|--------|
| EPIC-MERLT-1 | MERL-T Integration — Slice 1 (RLCF event capture) | MERLT-1.0 → 1.12 (12 story) | 42 | MERLT-1a, MERLT-1b |

**Future epics (out of scope Slice 1)**:
- EPIC-MERLT-2: Knowledge Graph visualization + entity proposal drawers
- EPIC-MERLT-3: Q&A multi-expert UI
- EPIC-MERLT-4: Admin/training ops
- EPIC-MERLT-5: Document upload + dossier→training export

---

## Definition of Done

Per ogni story:
- [ ] Code implementato e committato (Conventional Commits)
- [ ] Unit test scritti e passing (coverage ≥80% su moduli core)
- [ ] Integration test passing dove applicabile
- [ ] Code reviewed (almeno via `feature-dev:code-reviewer` agent)
- [ ] Documentation aggiornata (`CLAUDE.md` o file dedicato)
- [ ] Branch `visualex-merlt-main` aggiornato (no push automatico)
- [ ] Acceptance criteria della story validati

Per il Slice 1 nel complesso:
- [ ] Tutti gli 8 done criteria del design doc §8 verdi
- [ ] Smoke E2E manuale completato con evidence
- [ ] PR aperta + solutioning gate superato

---

## Risks and Mitigation

**High:**
- **MERL-T docker compose fragility** (5 servizi dipendenti): smoke gate hard dopo Story 1.0; troubleshooting documented in `docs/merlt-smoke-checklist.md`
- **Story 1.10 forum decision overflow**: max 2 giorni per brainstorming + decisione, escalation a utente se sfora

**Medium:**
- **Hook PostToolUse auto-test rallenta** se vitest suite >30s: configura `vitest related <file>` (file-scoped)
- **Ralph-loop edge case** (URN `-bis`): test cases obbligatori prima di chiudere iterazione

**Low:**
- **Drift `VisuaLexAPI/merlt/` vs `ALIS_CORE/merlt/`** post-copia: gestito da `docs/merlt-upstream-sync.md` + tag git

---

## Dependencies

**External:**
- `ALIS_CORE/merlt/` source accessibile per Story 1.0
- Docker daemon attivo
- Playwright + chromium installato (preesistente)

**Internal:**
- Sprint 1 (PRD originale) COMPLETED — ✅
- Branch `visualex-merlt-main` attivo — ✅
- Design doc approvato — ✅
- Execution plan approvato — ✅

---

## Next Steps

**Immediate:** Generare le 12 story files in `docs/stories/` via `bmad:create-story`, poi avviare `bmad:dev-story MERLT-1.0`.

**Sprint cadence:**
- Sprint length: 2 settimane
- Sprint review: fine settimana 2 (post-Story 1.5 GATE FORTE) e fine settimana 4 (post-Story 1.12)
- Retrospective: dopo MERLT-1b chiuso, prima di rientrare in PRD-Sprint-2 (ex Sprint 2)

---

**This plan was created using BMAD Method v6 - Phase 4 (Implementation Planning) for MERL-T Slice 1 sub-deliverable.**
