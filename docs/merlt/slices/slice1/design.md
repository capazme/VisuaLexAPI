# MERL-T ↔ VisuaLex Integration — Slice 1 Design

**Status**: approved — pending implementation plan
**Date**: 2026-05-22
**Branch**: `visualex-merlt-main`
**Predecessor**: commit `81be277` (abandoned scaffolding, to be partially refactored)
**Reference docs**:
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/docs/PIANO_DEFINITIVO_INTEGRAZIONE.md`
- `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/docs/visualex_merlt_main_execution_plan.md`
- `/Users/gpuzio/Desktop/CODE/ALIS_CORE/visualex-merlt/docs/PLUGIN_ARCHITECTURE.md`

---

## 1. Goal e Framing

Il lavoro **non è** ricostruire MERL-T. Il backend Python (FastAPI multi-expert + RLCF + Knowledge Graph FalkorDB + Qdrant) **esiste già** in `ALIS_CORE/merlt`.

Il lavoro **è** chiudere il loop dati **VisuaLex → MERL-T → RLCF**: far sì che i segnali utente che VisuaLex già produce nativamente (annotation, highlight, dossier, bookmark, citation click, article view, forum like/download/suggestion) diventino training signal RLCF nella forma e con i metadati che gli esperti si aspettano.

**Mode**: linea prodotto, slice-by-slice. Nessuna feature è "done" senza smoke con MERL-T acceso. Fondamenta prima dell'UI.

**Out of scope per Slice 1**: knowledge graph visualization (Slice 2), Q&A multi-expert UI (Slice 3), admin/training ops (Slice 4+).

---

## 2. Decisioni architetturali load-bearing

| Decisione | Scelta | Motivazione |
|-----------|--------|-------------|
| Goal del lavoro | Linea prodotto incrementale | L'utente vuole un prodotto, non una demo accademica |
| Sorte commit 81be277 | Refactor incrementale | Riusa quello che vale, butta lo scaffolding di scarsa qualità |
| MERL-T source location | Copia in `VisuaLexAPI/merlt/` | "Un clone, un avvio". Costo: drift con ALIS_CORE — mitigato da `docs/merlt-upstream-sync.md` |
| Topology | Sidecar HTTP (MERL-T :8000, BFF :3001, FE :5173, VisuaLex Python :5000) | MERL-T resta vergine, BFF è unico punto di contatto |
| Postgres | Due Postgres separati (uno VisuaLex, uno MERL-T) | Coerente con piano ALIS_CORE; user authority sync via HTTP |
| Contract mapping layer | Tutto nel BFF Node (Express) | MERL-T vergine, frontend parla tipi nativi VisuaLex |
| Approach di attuazione | B — Vertical slice | End-to-end su `article:viewed` prima, replica pattern sugli altri 4 eventi |
| Scope grafo | Slice 2 dedicato | Slice 1 resta puro RLCF events, niente scope creep |
| Vecchio `backend/src/routes/merlt.ts` | Eliminato e ricostruito come folder | Il piano stesso lo dichiara anti-pattern |

---

## 3. Architettura runtime

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (utente)                                                │
│ ┌───────────────────┐                                           │
│ │ VisuaLex frontend │  Vite :5173                               │
│ │ React + plugin    │                                           │
│ │ host MERL-T       │                                           │
│ └─────────┬─────────┘                                           │
└───────────┼─────────────────────────────────────────────────────┘
            │ /api/* + /api/merlt/*
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ BFF Node (Express + Prisma)         :3001                       │
│   • routes/* pre-esistenti VisuaLex                             │
│   • routes/merlt/* (nuovo, Zod-tipizzato, mapping VLX→MERLT)    │
│   • Prisma VisuaLex: MerltConsent + MerltConsentAudit + cache   │
└──────┬─────────────────────────────────────┬────────────────────┘
       │ HTTP (sidecar)                      │ Postgres VisuaLex
       ▼                                     ▼
┌──────────────────────┐               ┌──────────────────────────┐
│ MERL-T (FastAPI)     │ :8000         │ Postgres VisuaLex :5432  │
│ VisuaLexAPI/merlt/   │               │ (auth, dossier, consent) │
└──┬─────┬─────┬───┬───┘               └──────────────────────────┘
   │     │     │   │
   ▼     ▼     ▼   ▼
┌──────┐┌──────┐┌──────┐┌──────────────┐
│Falkor││Qdrant││Redis ││Postgres MERLT│ (sidecar di MERL-T)
└──────┘└──────┘└──────┘└──────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ VisuaLex Python API :5000  (INVARIATO)                          │
│ Scraper Normattiva/EUR-Lex/Brocardi                             │
└─────────────────────────────────────────────────────────────────┘
```

**Vincoli runtime:**
- Browser non parla MAI direttamente a MERL-T `:8000`. Sempre via BFF.
- `start.sh` decide cosa avviare via `MERLT_ENABLED` / `MERLT_COMPOSE_ENABLED` env vars (logica già nel commit 81be277, da rifinire). Questo è il flag **runtime container** — se false, il sidecar MERL-T non parte.
- Esiste un flag separato **feature UI** (es. `VITE_FEATURE_MERLT=true` nel frontend) che controlla se il plugin host registra i componenti MERL-T. Se false, l'app gira come vanilla anche se MERL-T è acceso. I due flag sono indipendenti per default — utili per dev (testare frontend senza container) e per stage gradualmente in produzione.
- Health gate: `start.sh` aspetta `GET http://localhost:8000/health` verde prima di proseguire. Se MERLT_ENABLED=false, skip gate.
- VisuaLex Python (5000) resta intoccato — separation of concerns netta.

---

## 4. Eventi RLCF in scope Slice 1

5 eventi, agganciati come **vertical slice**: `article:viewed` per primo end-to-end (settimana 1), gli altri 4 replicano lo stesso pattern.

| # | Evento | Payload VisuaLex | Mapping MERL-T | Note |
|---|--------|------------------|----------------|------|
| 1 | `article:viewed` | `{ articleUrn, normaVisitataId, dwellMs, scrollMaxPct, sessionId }` | `{ event_type:"article_viewed", user_id, article_urn, dwell_ms, scroll_max_pct }` | Trigger: viewport ≥3s OR scroll ≥30%; emesso a unmount/tab-switch |
| 2 | `highlight:created` / `annotation:created` | `{ anchorText, startOffset, articleUrn, color?, noteText? }` | `{ event_type:"highlight\|annotation", entity_text, article_urn, user_id }` | Alto valore RLCF (candidate entity proposal) |
| 3 | `dossier:item:added` / `bookmark:added` | `{ articleUrn, dossierId?, tags? }` | `{ event_type:"saved_for_use", article_urn, context }` | Segnale di rilevanza pratica |
| 4 | `citation:clicked` | `{ sourceArticleUrn, targetArticleUrn, citationText }` | `{ event_type:"citation_followed", source_urn, target_urn }` | Segnale per edges RIFERIMENTO/MODIFICA del KG |
| 5 | Forum: `like` / `download` / `suggestion_decided` | `{ sharedEnvId, action, originalAuthorId }` | `{ event_type:"community_signal", action, target_author_id }` | Authority signal: chi produce contenuti scaricati/likeati ha track record alto |

**Pattern templato unico** per tutti e 5:
```
Frontend hook → POST /api/merlt/events/<name>
  → Zod validate
  → consentGuard (consent_base obbligatorio)
  → eventMapper.toMerlt(payload, user)
  → merltClient.sendEvent(...)
  → response { trace_id } o { error }
```

---

## 5. Componenti

### 5.1 Frontend (`frontend/src/`)

```
features/merlt/
├── consent/
│   ├── ConsentContext.tsx           [NEW] React context per stato consenso
│   ├── ConsentDialog.tsx            [NEW] dialog onboarding (consent_base / consent_full)
│   └── useConsent.ts                [NEW] hook che legge consenso da BFF
├── tracking/
│   ├── useArticleViewedTracker.ts   [NEW] dwell + scroll tracking, fire on unmount
│   ├── useHighlightAnnotationTracker.ts [NEW]
│   ├── useDossierBookmarkTracker.ts [NEW]
│   ├── useCitationTracker.ts        [NEW]
│   ├── useForumSignalTracker.ts     [NEW]
│   └── trackingEventBus.ts          [REWORK] event bus tipizzato (esiste in commit 81be277)
└── merltService.ts                  [REWORK] solo chiamate BFF, no diretto a :8000

plugins/
├── registry.tsx                     [REWORK] esistente da pulire
├── types.ts                         [REWORK] estendere
└── slots/
    └── ArticleMerltSlot.tsx         [REWORK] disaccoppiare da ArticleTabContent

components/features/search/
└── ArticleTabContent.tsx            [MODIFY] usa <PluginSlot id="article-merlt"/>, no import diretto
```

### 5.2 BFF Node (`backend/src/`)

```
routes/merlt/                        [NEW folder — sostituisce routes/merlt.ts]
├── consent.ts                       GET/POST/DELETE /api/merlt/consent
├── events.ts                        POST /api/merlt/events/:eventName  (monta consentGuard)
├── profile.ts                       GET /api/merlt/profile (proxy + cache)
├── health.ts                        GET /api/merlt/health (sidecar reachability)
└── index.ts                         Mount router su /api/merlt + middleware chain

services/merlt/                      [NEW]
├── merltClient.ts                   HTTP client tipizzato verso MERL-T :8000
├── eventMapper.ts                   VisuaLex events → MERL-T tracking schema
├── consentGuard.ts                  middleware Express: blocca event se consent revoked
└── authorityCache.ts                cache + sync con MERL-T per user authority

schemas/merlt/                       [NEW]
├── events.ts                        Zod schemas per ogni evento (5)
└── consent.ts                       Zod schemas consenso

# DA ELIMINARE:
routes/merlt.ts                      [DELETE — anti-pattern, archiviato in storia git]
tests/merlt.test.ts                  [ARCHIVE in tests/_archived_pre_slice1/]
```

**Middleware chain** per `/api/merlt/events/*`: `authenticate` (esiste, JWT) → `consentGuard` (custom, legge `MerltConsent`) → Zod validate body → route handler → `eventMapper.toMerlt()` → `merltClient.sendEvent()` → response. La chain è dichiarata in `routes/merlt/index.ts`.

### 5.3 Prisma VisuaLex (`backend/prisma/schema.prisma`)

```prisma
model MerltConsent {
  userId          String    @id
  consentBase     Boolean   @default(false)    // invio eventi pseudonimizzati
  consentFull     Boolean   @default(false)    // profilo authority calcolato
  consentVersion  Int                           // versione testo legale accettato
  acceptedAt      DateTime
  revokedAt       DateTime?
  updatedAt       DateTime  @updatedAt
}

model MerltConsentAudit {
  id          String   @id @default(cuid())
  userId      String
  action      String   // "accepted_base" | "accepted_full" | "revoked" | "upgraded"
  fromVersion Int?
  toVersion   Int?
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())
  @@index([userId])
  @@index([createdAt])
}

model MerltUserAuthorityCache {
  userId             String   @id
  authorityScore     Float
  baselineQual       String   // "studente" | "laureato" | "professionista"
  trackRecord        Float
  performance        Float
  totalContributions Int
  syncedAt           DateTime
}
```

### 5.4 MERL-T (`VisuaLexAPI/merlt/`)

- Copia integrale da `ALIS_CORE/merlt` come tag baseline `merlt-baseline-from-alis-core`
- **Nessuna modifica MERL-T per Slice 1**: gli endpoint `POST /api/tracking/event` / equivalenti già esistono in `merlt/api/tracking_router.py` (verificare lettura codice all'inizio dell'implementazione). Se non esistono nella forma attesa, il mapping nel BFF si adegua.
- `docs/merlt-upstream-sync.md` dichiara `VisuaLexAPI/merlt` come single source of truth da ora in poi. `ALIS_CORE/merlt` diventa reference read-only.

### 5.5 Docker (`docker-compose.merlt.yml`)

Estendere il compose esistente (già nel commit 81be277):
- Servizi richiesti: `merlt-api`, `falkordb`, `qdrant`, `redis-merlt`, `postgres-merlt`
- Health checks per ogni servizio
- `start.sh` invoca `docker compose -f docker-compose.merlt.yml up -d` quando `MERLT_ENABLED=true`

---

## 6. Data flow (esempio: `article:viewed`)

**Trigger frontend:**
- Componente articolo entra in viewport → IntersectionObserver attiva timer dwell + listener scroll.
- Soglia di "lettura effettiva": viewport visible ≥3s OR scroll ≥30%.
- Su unmount o tab switch: hook emette evento con `dwellMs` + `scrollMaxPct` aggregati.

**Sequence end-to-end:**
1. Frontend `useArticleViewedTracker` → `POST /api/merlt/events/article-viewed` con `{ articleUrn, dwellMs, scrollMaxPct, sessionId, normaVisitataId }`
2. BFF route Zod-valida il body
3. BFF `consentGuard` legge `MerltConsent` per `req.user.id`; se `consent_base=false`, risponde `403 consent_required`
4. BFF `eventMapper.toMerlt()` traduce in `{ event_type:"article_viewed", user_id, article_urn, dwell_ms, scroll_max_pct }` + arricchisce con `user_authority` da `authorityCache`
5. BFF `merltClient.sendEvent()` → `POST http://merlt:8000/api/tracking/event`
6. MERL-T persiste tracking + RLCF interaction accumulator incrementa contatori
7. MERL-T risponde `{ trace_id }`
8. BFF risponde `202 { trace_id }` al frontend
9. Frontend fire-and-forget: niente blocco UI

**Error handling:**
| Caso | Response BFF | Frontend |
|------|--------------|----------|
| Zod validation fail | `400 { error, details }` | Log a console/Sentry, no retry (bug nostro) |
| Consent revocato | `403 consent_required` | Mostra ConsentDialog di riconsenso |
| MERL-T 5xx / timeout | `503 merlt_unavailable` | Fire-and-forget: drop evento, dead-letter log lato BFF |
| User non autenticato | `401` | Frontend già gestisce |
| Authority cache miss | BFF sync inline (1 tentativo) o usa baseline default | Trasparente |

**Pattern templato** (sezione 4): tutti gli altri 4 eventi seguono lo stesso flow, solo il payload e il `event_type` cambiano.

---

## 7. Testing strategy

**Approccio**: piramide pragmatica. Niente Playwright/E2E automatici in Slice 1 (overkill).

### Livello 1 — Unit (vitest, BFF)
`backend/tests/unit/merlt/`
- `eventMapper.test.ts` — URN→article_urn, articleId con suffisso -bis, payload edge cases
- `consentGuard.test.ts` — consent_base true/false/revoked → pass/403, audit log
- `merltClient.test.ts` — URL construction, headers, timeout (MERL-T mockato con `nock`)
- `schemas/*.test.ts` — Zod valid/invalid examples per ogni evento

### Livello 2 — Integration (vitest + supertest + Postgres test DB)
`backend/tests/integration/merlt/`
- `consent-lifecycle.test.ts` — POST → query DB → DELETE → audit row
- `article-viewed.test.ts` — consent attivo → 202 + trace_id; senza → 403; MERL-T down → 503 + dead-letter log
- `authority-cache.test.ts` — sync MERL-T → cache → second call usa cache

### Livello 3 — Contract (vitest, BFF ↔ MERL-T mock)
Verifica che il payload che BFF *manda* a MERL-T rispetti contratto MERL-T. Se MERL-T cambia schema → test rosso = drift segnalato.

### Livello 4 — Smoke E2E manuale
`docs/merlt-smoke-checklist.md`:
1. `./start.sh` → container UP
2. Login + accetta consenso
3. Apri articolo, leggi 5s, chiudi
4. Query SQL su Postgres MERL-T: trace `article_viewed` presente
5. Revoca consenso, ripeti → no nuovo record

### Livello 5 — Frontend (vitest)
`frontend/src/features/merlt/tracking/__tests__/`
- `useArticleViewedTracker.test.tsx` — mount + viewport visible 3s → POST chiamato; unmount → POST con dwellMs corretto
- `useConsent.test.tsx` — context legge da BFF, persiste decisione

### Soglia "done" Slice 1
- Test livelli 1+2+3 verdi (≥80% coverage su `services/merlt/*`)
- Smoke E2E manuale completato + log/screenshot allegati al PR
- Frontend test livello 5 verdi

---

## 8. Done criteria Slice 1

Slice 1 è "done" quando tutti questi sono verdi:

1. ✅ `./start.sh` avvia VisuaLex + MERL-T + dipendenze (FalkorDB, Qdrant, Redis, Postgres MERL-T). Health check `GET /api/merlt/health` risponde con MERL-T reale (non stub).
2. ✅ User accetta consenso via dialog onboarding, persistito in `MerltConsent`. Revoca funziona e blocca eventi successivi (verificabile via integration test).
3. ✅ Apertura articolo + lettura ≥3s → evento `article:viewed` arriva a MERL-T (verificabile via SQL query su Postgres MERL-T).
4. ✅ Stesso pattern funzionante per gli altri 4 eventi: `highlight+annotation`, `dossier+bookmark`, `citation:clicked`, forum signals.
5. ✅ Plugin host: feature flag `MERLT_ENABLED=false` → tutto MERL-T sparisce dall'UI, l'app gira come vanilla. Nessun import diretto di componenti MERL-T da `ArticleTabContent`.
6. ✅ BFF: nessun endpoint critico accetta `Record<string, unknown>` senza schema Zod. Mapping VisuaLex↔MERL-T centralizzato in `eventMapper`.
7. ✅ Test piramide livelli 1+2+3+5 verdi. Smoke E2E manuale completato.
8. ✅ Doc aggiornati: `CLAUDE.md` (sezione MERL-T integration), `docs/merlt-upstream-sync.md`, `docs/merlt-smoke-checklist.md`.

---

## 9. Out of scope (Slice 2+)

- **Slice 2 — Grafo**: `GET /api/merlt/graph/check-article`, badge stato grafo nell'article tab, subgraph viewer (port da `ALIS_CORE/visualex-merlt`), entity proposal drawers (R1/R2), entity search autocomplete (P1.3)
- **Slice 3 — Q&A**: UI conversazionale multi-expert, mode convergent/divergent, fonti cliccabili, feedback multi-dimensional, refine
- **Slice 4 — Admin/Training**: dashboard RLCF, policy weights history, pipeline monitoring, regression runner
- **Slice 5+ — Document upload, dossier-to-training-set export, advanced community signals**

---

## 10. Open questions / decisions deferred

1. **Soglie dwell/scroll**: 3s/30% sono initial guess. Calibrate dopo Slice 1 con dati reali.
2. **Authority sync frequency**: cache reads on-demand inizialmente. Se serve sync push real-time (Slice 4+), rivedere.
3. **Forum events authoring**: chi è "l'autore" quando un suggestion è preso? Da definire mappando lo schema `SuggestionItem` esistente.
4. **GDPR data export/delete**: out of scope Slice 1 ma da pianificare per Slice 3 (necessario per produzione real-world).

---

## 11. Files coinvolti — summary

**Da creare (15 files):**
- `frontend/src/features/merlt/consent/{ConsentContext,ConsentDialog,useConsent}.tsx`
- `frontend/src/features/merlt/tracking/{useArticleViewedTracker,useHighlightAnnotationTracker,useDossierBookmarkTracker,useCitationTracker,useForumSignalTracker}.ts`
- `backend/src/routes/merlt/{consent,events,profile,health}.ts`
- `backend/src/services/merlt/{merltClient,eventMapper,consentGuard,authorityCache}.ts`
- `backend/src/schemas/merlt/{events,consent}.ts`
- `docs/merlt-upstream-sync.md`
- `docs/merlt-smoke-checklist.md`
- `VisuaLexAPI/merlt/` (intera directory, copia da ALIS_CORE)

**Da modificare:**
- `frontend/src/features/merlt/{merltService.ts,tracking/trackingEventBus.ts}`
- `frontend/src/plugins/{registry.tsx,types.ts,slots/ArticleMerltSlot.tsx}`
- `frontend/src/components/features/search/ArticleTabContent.tsx`
- `backend/prisma/schema.prisma` (+ migration)
- `docker-compose.merlt.yml`
- `start.sh`
- `backend/.env.example`, `backend/.env.test`
- `CLAUDE.md`

**Da eliminare (archiviati in storia git):**
- `backend/src/routes/merlt.ts`
- `backend/tests/merlt.test.ts` (sposta in `backend/tests/_archived_pre_slice1/`)

---

*Design approvato sezione per sezione. In attesa di review utente sul doc scritto prima di passare al writing-plans skill.*
