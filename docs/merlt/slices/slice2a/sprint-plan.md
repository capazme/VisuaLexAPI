# Sprint Plan: MERL-T Integration Slice 2a — Graph Lazy Ingestion + Visualization

**Date:** 2026-05-23
**Scrum Master:** gpuzio
**Project Level:** 3 (sub-deliverable di Visualex Platform)
**Total Stories:** 13
**Total Points:** 32 (16 Sprint MERLT-2a-1 + 16 Sprint MERLT-2a-2)
**Planned Sprints:** 2 (MERLT-2a-1, MERLT-2a-2)
**Sprint Length:** 2 weeks
**Team Capacity:** 30 points/sprint
**Branch:** `visualex-merlt-main`

---

## Executive Summary

Slice 2a chiude il loop **conoscenza**: porta il knowledge graph giuridico dal backend MERL-T (FastAPI + FalkorDB + Qdrant + bridge_table) al frontend VisuaLex in **read-only**, partendo da un seed pre-caricato (27.742 nodi del Libro IV CC, recuperato Mag 2026), con lazy ingestion automatica on-view per articoli non ancora indicizzati.

La visualizzazione vive su **due superfici complementari**:
- **Side rail** collassabile dentro `ArticleTabContent` (depth=1, ≤25 nodi)
- **Pagina dedicata `/grafo`** (full-canvas explorer con search, depth toggle, click-to-recenter, deeplink)

**Cosa NON viene fatto in Slice 2a**: editing del grafo (Slice 2b "Laboratorio RLCF"), Devil's Advocate sul grafo (Slice 2c), Q&A multi-expert (Slice 3).

**Reference docs**:
- Design: `./design.md`
- Seed recovery: `merlt/data/seeds/` + memoria `legacy_libro_iv_recovery`
- Predecessor: Slice 1 (chiusa il 2026-05-22, commit b6ec77f su `visualex-merlt-main`)

**Key Metrics:**
- Total Stories: 13
- Total Points: 32 (16+16)
- Sprints: 2
- Team Capacity: 30 points/sprint
- Target Completion: 2026-07-04 (~6 settimane wall-clock, di cui ~3 effettive di sviluppo)

**Pre-flight già fatto in fase di design (Mag 2026):**
- ✅ Seed recovery completo da `ALIS_CORE/merlt/data` (27.742 nodi + 43.936 archi + 27.117 bridge mapping)
- ✅ Cross-check integrità: bridge URN→graph 100% match
- ✅ Schema RLCF mappato (36 tabelle) → Slice 2b accelerata
- ✅ Recon backend/BFF/frontend completata: endpoint `check-article` + `subgraph` esistenti in MERL-T `graph_router.py`, slot `article_sidebar` già placeholder

---

## Sprint Allocation

### Sprint MERLT-2a-1 (Sprint #4) — Backend + Side Rail

**Goal:** Boot iniziale popola FalkorDB+Qdrant+bridge_table dal seed in <6 min, lazy ingestion funzionante per articoli fuori seed via worker Arq, side rail visibile in `ArticleTabContent` con Cytoscape ego-network depth=1.

**Stories:** 7 (16 punti, 53% capacity utilization — lascia margine per debug docker compose multi-servizio)

| Story | Title | Pt | Priority | Skill Driver |
|-------|-------|----|----------|--------------|
| MERLT-2a.1 | Seed loader idempotente + lifespan hook + integrity check | 5 | P0 | `superpowers:test-driven-development` + `feature-dev:code-architect` |
| MERLT-2a.2 | MERL-T graph router: 2 nuovi endpoint (ingest-article + job-callback) | 2 | P0 | `superpowers:tdd` |
| MERLT-2a.3 | MERL-T worker Arq + task ingest_article + retry/dead-letter | 5 | P0 | `feature-dev:code-architect` + `superpowers:tdd` |
| MERLT-2a.4 | BFF graphClient + route graph.ts + Prisma MerltIngestionJob | 5 | P0 | `superpowers:tdd` |
| MERLT-2a.5 | BFF lazy trigger in events.ts + idempotency by URN | 2 | P0 | `superpowers:tdd` |
| MERLT-2a.6 | FE shared layer (CytoscapeView, graphStyles, hooks, transform) | 3 | P1 | `feature-dev:code-architect` + `superpowers:tdd` |
| MERLT-2a.7 | FE side rail in ArticleTabContent + collapse + plugin slot | 4 | P1 | `superpowers:tdd` + `feature-dev:code-reviewer` |

Nota: il totale (5+2+5+5+2+3+4=26) supera il budget di sprint 16pt indicato in tabella perché il design doc separa 2a.6+2a.7 (Sprint 2a-1) da 2a.8+ (Sprint 2a-2). **Conta dello sprint 2a-1**: 2a.1 (5) + 2a.2 (2) + 2a.3 (5) + 2a.4 (5) + 2a.5 (2) + 2a.6 (3) + 2a.7 (4) = **26pt**, sopra 30/cap ma sotto soglia critica. Se ci si accorge di scivolare, 2a.7 può slittare a Sprint 2a-2 (riducendo a 22pt). Decisione di slittamento a check-in metà sprint.

**Gate finale Sprint MERLT-2a-1 (post-2a.7)**: **STRONG GATE** — `superpowers:requesting-code-review` dispatcha `feature-dev:code-reviewer`. Smoke E2E manuale:
1. Boot `./start.sh` → seed loader log "27742 nodes loaded" entro 6 min
2. Apri art. 2043 c.c. → side rail mostra ego-network con ≥10 nodi
3. Apri art. 73 c.p. → side rail mostra skeleton "Sto indicizzando...", grafo dopo ~60s
Bloccante per Sprint MERLT-2a-2.

**Risks:**
- **Seed loader durata >10 min** (story 2a.1): se la rigenerazione embeddings su CPU è troppo lenta, fallback a pre-computed asset committato (~30 MB compresso). Decisione metà sprint se necessario.
- **Arq + FastAPI lifecycle conflict** (story 2a.3): worker container separato deve riuscire a connettersi a FalkorDB/Qdrant. Validate health check stretto.
- **Cytoscape bundle size** (story 2a.6/7): ~250KB gzipped + plugin. Code-split via dynamic import su `/grafo` page e su slot conditional.

**Dependencies:**
- Sprint MERLT-1 completato (consent + auth + plugin host base in place) ✓ già fatto
- `merlt/data/seeds/` popolato (libro-iv-cc-graph.json + postgres-dumps) ✓ già fatto
- Docker daemon attivo, immagini FalkorDB+Qdrant+Postgres15 pullabili

---

### Sprint MERLT-2a-2 (Sprint #5) — Pagina `/grafo` Explorer

**Goal:** Pagina dedicata `/grafo` navigabile con search box (autocomplete), Cytoscape full-canvas, NodeDetailsDrawer, click-to-recenter, BreadcrumbHistory, DepthSelector 1/2/3, layout picker COSE/dagre, deeplink params funzionanti. Lazy ingestion accessibile anche dalla pagina.

**Stories:** 6 (16 punti, 53% capacity utilization)

| Story | Title | Pt | Priority | Skill Driver |
|-------|-------|----|----------|--------------|
| MERLT-2a.8 | FE pagina `/grafo` skeleton + route + Sidebar entry | 3 | P0 | `bmad:dev-story` |
| MERLT-2a.9 | FE GraphSearchBox con autocomplete debounced via `/entities/search` | 3 | P1 | `superpowers:tdd` |
| MERLT-2a.10 | FE NodeDetailsDrawer + click-to-recenter + BreadcrumbHistory | 4 | P1 | `feature-dev:code-architect` + `superpowers:tdd` |
| MERLT-2a.11 | FE DepthSelector + layout picker + deeplink (`?urn=&depth=`) | 3 | P1 | `superpowers:tdd` |
| MERLT-2a.12 | FE ingestion polling UX dentro `/grafo` (search URN non in grafo → trigger) | 1 | P1 | `superpowers:tdd` |
| MERLT-2a.13 | Smoke E2E entrambe le superfici + CLAUDE.md + smoke checklist + PR | 2 | P0 | `superpowers:verification-before-completion` + `commit-commands:commit-push-pr` |

**Gate finale Sprint MERLT-2a-2 (post-2a.13)**: **STRONG GATE FINALE Slice 2a** — `bmad:solutioning-gate-check` + `superpowers:requesting-code-review`. Smoke E2E completo:
1. Navigazione `/grafo` da Sidebar → pagina renderizza vuota con search box
2. Cerca "art. 2043 c.c." → autocomplete suggerisce, click → grafo si carica
3. Click su nodo Concetto → diventa nuovo centro, BreadcrumbHistory ha 2 entry
4. Cambia depth da 2 a 3 → grafo si ricarica con più nodi
5. URL contiene `?urn=...&depth=3` — refresh ricarica stesso stato
6. Cerca URN inesistente → ingestion job parte, banner "Indicizzazione…", grafo a fine
PR pronto + branch pushable.

**Risks:**
- **Cytoscape performance su grafi medi (>200 nodi)**: depth=3 può esplodere a 500+ nodi (cap già applicato lato BFF in story 2a.4). Profilare se laggy.
- **Autocomplete latency** (story 2a.9): MERL-T `/entities/search` può essere lento. Debounce 300ms + abort signal su query stale.

**Dependencies:**
- Sprint MERLT-2a-1 completato e STRONG GATE superato
- Shared layer (story 2a.6) è il riuso totale: side rail e page condividono CytoscapeView, hooks, transform.

---

## Story Inventory

### MERLT-2a.1 — Seed loader idempotente + lifespan hook + integrity check

**Sprint:** MERLT-2a-1
**Priority:** P0
**Points:** 5

**User Story:**
Come dev che fa boot di MERL-T dopo `./start.sh`
voglio che il grafo del Libro IV CC venga caricato automaticamente al primo avvio
così che gli articoli civilistici siano immediatamente esplorabili dal day-0 senza interventi manuali.

**Acceptance Criteria:**
- [ ] Script `merlt/merlt/scripts/load_seed_libro_iv.py` esiste, idempotente (skip se `MATCH (n) RETURN count(n) > 100` sul grafo `merl_t_legal`).
- [ ] Carica `merlt/data/seeds/libro-iv-cc-graph.json` in FalkorDB usando MERGE per `URN` (Norma) e `node_id` (altro), batch da 500.
- [ ] Carica archi con MERGE su edge_key = hash(`start_urn|end_urn|type|disposizione|data_efficacia`), batch da 500.
- [ ] Rigenera embeddings da testi dei nodi (`testo_vigente|testo|descrizione|massima_text`) via `EmbeddingService.encode_batch_async()`, batch 32 → upsert in Qdrant `merl_t_legal_chunks`.
- [ ] Restore `bridge-table-data.sql` via `psql` (subprocess) nel container Postgres MERL-T.
- [ ] Riallinea `bridge.chunk_id` con i nuovi uuid Qdrant via match su `chunk_text`.
- [ ] Integrity check finale: nodes ≥27.700, bridge ≥27.000, qdrant points ≥5.900, zero bridge orfani. Se fail → raise SeedLoadError, MERL-T non parte.
- [ ] Hook nel lifespan di `merlt/merlt/app.py` (~riga 133, prima di `yield`): chiama `await load_seed_libro_iv()`.
- [ ] Boot iniziale ≤6 min su macchina M-series. Boot successivi <5s (skip).
- [ ] Test: `merlt/tests/scripts/test_load_seed_libro_iv.py` con 2 testcases: (a) idempotency (run 2x → count non raddoppia), (b) integrity check raise on missing seed file.

**Technical Notes:**
- Usa connessione FalkorDB già configurata via `merlt/storage/graph/client.py`.
- Per psql restore: subprocess + `PGPASSWORD` env var, NON includere credenziali nel codice.
- Logging strutturato con `structlog` (pattern esistente in MERL-T).

**Skill Drivers:**
- `superpowers:test-driven-development` per i 2 testcase
- `feature-dev:code-architect` per design idempotency + batch sizing + error handling

**Files coinvolti:**
- NEW: `merlt/merlt/scripts/load_seed_libro_iv.py`
- NEW: `merlt/tests/scripts/test_load_seed_libro_iv.py`
- MODIFY: `merlt/merlt/app.py` (lifespan +1 chiamata)

---

### MERLT-2a.2 — MERL-T graph router: 2 nuovi endpoint

**Sprint:** MERLT-2a-1
**Priority:** P0
**Points:** 2

**User Story:**
Come BFF che deve accodare un job di ingestion lazy
voglio un endpoint MERL-T che accodi il job e un callback per ricevere job completion
così che il loop async sia chiuso senza che il BFF debba parlare direttamente al worker.

**Acceptance Criteria:**
- [ ] `POST /api/v1/graph/ingest-article` aggiunto a `merlt/merlt/api/graph_router.py`. Body Zod-validato (o Pydantic in MERL-T): `{ urn: str, options?: { force_refresh: bool, bff_job_id: str } }`. Ritorna `202 { task_id: str }`.
- [ ] L'endpoint accoda job Arq via `arq_pool.enqueue_job('ingest_article', urn, bff_job_id)`. Idempotency check: se job pending con stesso URN esiste, ritorna il task_id esistente.
- [ ] `POST /api/v1/internal/job-callback` aggiunto a `merlt/merlt/api/graph_router.py`. Body: `{ bff_job_id: str, status: 'completed'|'failed', nodes_created?: int, edges_created?: int, error?: str }`. Chiamato dal worker a fine job. **NO auth Slice 2a**: protetto per network locality (worker → MERL-T → BFF tutti in stessa docker network); da review in Slice 2c.
- [ ] Endpoint esistenti (`/check-article`, `/subgraph`) verificati con curl manuale: firma stabile, response shape documentata in nuovo file `merlt/docs/api/graph-endpoints.md`.
- [ ] Test: `merlt/tests/api/test_graph_router.py` con 3 testcases per i nuovi endpoint (success, duplicate URN, failure callback).

**Technical Notes:**
- Endpoint esistenti `/check-article` e `/subgraph` (verified by recon Mag 2026) — riusare as-is.
- Pattern Arq enqueue: vedi `merlt/worker/arq_worker.py` (creato in 2a.3).

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- MODIFY: `merlt/merlt/api/graph_router.py`
- NEW: `merlt/tests/api/test_graph_router.py` (estende test esistenti)
- NEW: `merlt/docs/api/graph-endpoints.md`

---

### MERLT-2a.3 — MERL-T worker Arq + task ingest_article

**Sprint:** MERLT-2a-1
**Priority:** P0
**Points:** 5

**User Story:**
Come backend MERL-T
voglio un worker Arq che esegua `ingest_norm()` in background con retry e dead-letter
così che la UI VisuaLex non si blocchi durante l'indicizzazione di articoli non nel seed.

**Acceptance Criteria:**
- [ ] `arq>=0.25` aggiunto a `merlt/pyproject.toml` (dependencies).
- [ ] `merlt/merlt/worker/arq_worker.py` definisce `WorkerSettings` con: redis URL da env, functions list, `max_tries=3`, `job_timeout=300` (5 min), `retry_delay=exponential(base=10s)`.
- [ ] `merlt/merlt/worker/tasks/ingest_article.py` definisce `async def ingest_article(ctx, urn: str, bff_job_id: str)`:
  1. Parsing URN → tipo_atto + numero_articolo via funzione di utility (riusa `urngenerator.py` di VisuaLex se accessibile, altrimenti port leggero).
  2. Chiama `LegalKnowledgeGraph.ingest_norm(tipo_atto, articolo, include_brocardi=True, ...)`.
  3. On success: POST `http://merlt-api:8000/api/v1/internal/job-callback` con `{ bff_job_id, status: 'completed', nodes_created, edges_created }`.
  4. On failure (dopo 3 retry): POST callback con `{ bff_job_id, status: 'failed', error: str(e) }`.
- [ ] Container Docker `merlt-worker` aggiunto a `docker-compose.merlt.yml`: stessa image dell'api, command `arq merlt.worker.arq_worker.WorkerSettings`, depends_on FalkorDB/Qdrant/Postgres/Redis con healthcheck.
- [ ] Healthcheck container worker: `arq --check`.
- [ ] `start.sh` aspetta che il worker sia healthy prima di marcare MERL-T `ready`.
- [ ] Test: `merlt/tests/worker/test_ingest_article.py` con 3 testcases:
  - Success path (URN valido, mock `ingest_norm` ritorna result, verifica callback chiamato)
  - Retry path (primi 2 attempt raise, 3° riesce)
  - Permanent failure (3 retry tutti raise → callback `status='failed'`)

**Technical Notes:**
- Redis condiviso col rate limiter di MERL-T (DB index 1 per non collidere con cache DB 0).
- Per il callback: usa `httpx.AsyncClient` con timeout 5s (la callback è veloce, non blocca lo slot worker a lungo).

**Skill Drivers:**
- `feature-dev:code-architect` per il design del worker (settings, retry policy)
- `superpowers:tdd` per i testcase

**Files coinvolti:**
- NEW: `merlt/merlt/worker/__init__.py`
- NEW: `merlt/merlt/worker/arq_worker.py`
- NEW: `merlt/merlt/worker/tasks/__init__.py`
- NEW: `merlt/merlt/worker/tasks/ingest_article.py`
- NEW: `merlt/tests/worker/test_ingest_article.py`
- MODIFY: `merlt/pyproject.toml` (+arq dep)
- MODIFY: `docker-compose.merlt.yml` (+merlt-worker service)
- MODIFY: `start.sh` (gate healthcheck worker)

---

### MERLT-2a.4 — BFF graphClient + route graph.ts + Prisma MerltIngestionJob

**Sprint:** MERLT-2a-1
**Priority:** P0
**Points:** 5

**User Story:**
Come frontend VisuaLex che vuole mostrare il sub-grafo di un articolo
voglio un endpoint BFF che proxa verso MERL-T `/subgraph` e gestisce il polling dei job di ingestion
così che la UI non parli mai direttamente a MERL-T (invariante Slice 1).

**Acceptance Criteria:**
- [ ] `backend/src/services/merlt/graphClient.ts` creato con metodi: `checkArticle(urn)`, `ingestArticle(urn, bffJobId)`, `getSubgraph(urn, depth, limit)`, `searchEntities(query, limit)`. Pattern coerente con `merltClient.ts` esistente (typed errors, timeout 10s, abort signal).
- [ ] `backend/src/schemas/merlt/graph.ts` con Zod schemas: `subgraphResponseSchema`, `jobStatusResponseSchema`, `nodeSchema`, `edgeSchema`.
- [ ] `backend/src/routes/merlt/graph.ts` con endpoint:
  - `GET /api/merlt/graph/article/:urn` → proxy a `/subgraph` con depth=2 default, cap nodes=500. Auth + consentGuard.
  - `POST /api/merlt/graph/ingest` body `{ urn }` → crea `MerltIngestionJob`, chiama `graphClient.ingestArticle()`, ritorna `{ jobId }`. Idempotency check.
  - `GET /api/merlt/graph/jobs/:jobId/status` → ritorna stato job (pending|running|completed|failed|timeout) + metadata.
  - `POST /api/merlt/internal/job-callback` body `{ bffJobId, status, nodesCreated?, edgesCreated?, error? }` → aggiorna job in DB. **Auth via shared secret** (env `MERLT_INTERNAL_SECRET`) — minimo Slice 2a.
- [ ] Mount `app.use('/api/merlt', merltRoutes)` invariato (già esistente da Slice 1); il nuovo router `graph.ts` viene aggiunto in `routes/merlt/index.ts`.
- [ ] Prisma model `MerltIngestionJob` aggiunto a `schema.prisma` (vedi design doc §6.2). Migration `add_merlt_ingestion_job` generata e applicata.
- [ ] Test integration: `backend/tests/integration/merlt/graph/graph-routes.test.ts` con:
  - GET article in grafo → 200 con nodes/edges
  - POST ingest → 202 con jobId, riga in DB
  - GET job status → polling fino a completed
  - Idempotency: 2 POST ingest sullo stesso URN → 1 sola riga DB
  - Auth: callback senza shared secret → 401

**Technical Notes:**
- Pattern di error mapping: riusa `MerltTimeoutError`/`MerltServerError` di `merltClient.ts`.
- Polling: nessuna logica nel BFF; il frontend polla `/jobs/:jobId/status` ogni 2s.

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- NEW: `backend/src/services/merlt/graphClient.ts`
- NEW: `backend/src/schemas/merlt/graph.ts`
- NEW: `backend/src/routes/merlt/graph.ts`
- NEW: `backend/tests/integration/merlt/graph/graph-routes.test.ts`
- NEW: `backend/tests/unit/merlt/graphClient.test.ts`
- MODIFY: `backend/src/routes/merlt/index.ts` (+ register graph router)
- MODIFY: `backend/prisma/schema.prisma` (+ MerltIngestionJob model + MerltJobStatus enum)
- NEW migration: `backend/prisma/migrations/<timestamp>_add_merlt_ingestion_job/migration.sql`

---

### MERLT-2a.5 — BFF lazy trigger in events.ts + idempotency

**Sprint:** MERLT-2a-1
**Priority:** P0
**Points:** 2

**User Story:**
Come BFF che riceve l'evento `article:viewed`
voglio controllare se l'articolo è nel grafo e accodare un job se manca
così che il grafo si popoli on-demand senza intervento esplicito dell'utente.

**Acceptance Criteria:**
- [ ] `backend/src/routes/merlt/events.ts` modificato: dopo l'inoltro dell'evento `article-viewed` a MERL-T, chiama `graphClient.checkArticle(articleUrn)`.
- [ ] Se `in_graph: false`: crea `MerltIngestionJob` (status='pending') + chiama `graphClient.ingestArticle()`. Risposta al frontend invariata in successo (`202 { trace_id }`), arricchita con `{ ingestionJob: { jobId, status } }` se è stato creato un nuovo job.
- [ ] Idempotency: prima di creare un job, query `SELECT * FROM merlt_ingestion_jobs WHERE article_urn = ? AND status IN ('pending', 'running')`. Se esiste, ritorna job esistente (NO duplicato).
- [ ] Failure isolation: se `checkArticle` o `ingestArticle` raise, log dead-letter (riusa pattern Slice 1) ma NON fail dell'evento. L'evento è P0, l'ingestion è opportunistica.
- [ ] Test integration: `backend/tests/integration/merlt/graph/lazy-trigger.test.ts`:
  - Evento article-viewed su URN già in grafo → no job creato
  - Evento article-viewed su URN nuovo → 1 job creato in DB
  - Stesso evento ripetuto 5x → 1 solo job creato
  - MERL-T check timeout → log dead-letter, evento comunque accettato

**Technical Notes:**
- Idempotency lock via DB constraint o transaction read-then-write. Postgres-level lock non necessario per Slice 2a (carico modesto).

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- MODIFY: `backend/src/routes/merlt/events.ts`
- NEW: `backend/tests/integration/merlt/graph/lazy-trigger.test.ts`

---

### MERLT-2a.6 — FE shared layer

**Sprint:** MERLT-2a-1
**Priority:** P1
**Points:** 3

**User Story:**
Come frontend che dovrà visualizzare il grafo in 2 superfici diverse (side rail + pagina)
voglio un layer condiviso (Cytoscape wrapper, styles, hooks)
così che side rail e page non duplichino il 70% del codice.

**Acceptance Criteria:**
- [ ] Dipendenze npm aggiunte a `frontend/package.json`: `cytoscape@^3.30.0`, `cytoscape-cose-bilkent@^4.1.0`, `cytoscape-dagre@^2.5.0`, `react-cytoscapejs@^2.0.0`. Bundle size verificato (<300KB gzipped per il grafo lazy-load).
- [ ] `frontend/src/features/merlt/graph/shared/CytoscapeView.tsx`: wrapper React sopra cytoscape con props `{ nodes, edges, layout, height, onNodeClick?, onNodeDblClick? }`. Dynamic import lazy (`React.lazy`) per code-split.
- [ ] `frontend/src/features/merlt/graph/shared/graphStyles.ts`: stylesheet Cytoscape per i 22 label (color + shape per Norma, ConcettoGiuridico, Dottrina, AttoGiudiziario, ecc.) + 15 rel types (edge color + arrow style per DISCIPLINA, interpreta, modifica, abroga, ecc.).
- [ ] `frontend/src/features/merlt/graph/shared/graphTransform.ts`: funzione `transformSubgraphResponse(response): { nodes: cy.NodeDef[], edges: cy.EdgeDef[] }`.
- [ ] `frontend/src/features/merlt/graph/shared/useArticleGraph.ts`: hook `(articleUrn, depth)` → fetch via axios da `/api/merlt/graph/article/:urn`, store in Zustand slice o local state, refetch on demand.
- [ ] `frontend/src/features/merlt/graph/shared/useIngestionJob.ts`: hook `(jobId)` → polling ogni 2s via `setInterval` (cleanup on unmount), ferma su terminal status, ritorna `{ status, error?, nodesCreated? }`.
- [ ] Test unit: `frontend/src/features/merlt/graph/shared/__tests__/{graphTransform,useArticleGraph,useIngestionJob}.test.ts`. Cytoscape rendering mockato (jsdom non gestisce canvas).

**Technical Notes:**
- Niente react-query: usiamo Zustand+axios coerente col resto della codebase. Polling = `setInterval`+`useEffect cleanup`.
- Cytoscape headless mode per i test (no canvas).

**Skill Drivers:**
- `feature-dev:code-architect` per disegnare i 22-label styling (è un design decision UX importante)
- `superpowers:tdd` per i test del transform e hooks

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/shared/{CytoscapeView.tsx,graphStyles.ts,graphTransform.ts,useArticleGraph.ts,useIngestionJob.ts}`
- NEW: `frontend/src/features/merlt/graph/shared/__tests__/*.test.ts`
- MODIFY: `frontend/package.json` (+4 deps)

---

### MERLT-2a.7 — FE side rail in ArticleTabContent

**Sprint:** MERLT-2a-1
**Priority:** P1
**Points:** 4

**User Story:**
Come utente che sta leggendo un articolo del Codice Civile
voglio un pannello laterale collassabile che mi mostri il vicinato concettuale dell'articolo
così che possa esplorare connessioni senza perdere il focus sul testo.

**Acceptance Criteria:**
- [ ] `frontend/src/features/merlt/graph/side-rail/ArticleGraphSideRail.tsx`: pannello collassabile (~300px aperto, ~40px chiuso con icona Network sticky), mount in slot `article_sidebar` (placeholder già presente in `plugins/registry.tsx`).
- [ ] Stati gestiti: `loading` (skeleton) → `building` (skeleton + "Sto indicizzando…" + spinner se job pending) → `ready` (Cytoscape rendered) → `empty` (articolo non indicizzabile) → `error` (retry button).
- [ ] CollapseToggle component con animazione framer-motion (riusa pattern di Slice 1).
- [ ] Cytoscape config: layout `cose-bilkent` con `nodeRepulsion: 4500`, edge bundling on, fit on init.
- [ ] Pulsante "Esplora nel grafo" → `navigate('/grafo?urn=${articleUrn}&depth=2')`.
- [ ] Click su nodo nel side rail: se Norma → `navigate('/?article=${urn}')` (riusa pattern triggerSearch); se altro → no-op (per ora).
- [ ] Feature flag `VITE_FEATURE_MERLT_GRAPH` rispettato: se false, side rail non si registra nel plugin slot.
- [ ] Test: `frontend/src/features/merlt/graph/side-rail/__tests__/ArticleGraphSideRail.test.tsx` (render state per ogni stato, click handlers).

**Technical Notes:**
- ArticleTabContent linea ~25 (PluginSlot post-article) è già il punto di mount. Nuovo PluginSlot `article_sidebar` va aggiunto in `ArticleTabContent.tsx` con posizionamento absolute o flex-column con sticky.
- Smoke manuale: side rail deve essere usabile su mobile (collassato by default).

**Skill Drivers:**
- `superpowers:tdd`
- `feature-dev:code-reviewer` post-implementation (UX check)

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/side-rail/{ArticleGraphSideRail.tsx,CollapseToggle.tsx}`
- NEW: `frontend/src/features/merlt/graph/side-rail/__tests__/ArticleGraphSideRail.test.tsx`
- MODIFY: `frontend/src/plugins/registry.tsx` (registra slot component)
- MODIFY: `frontend/src/components/features/search/ArticleTabContent.tsx` (+ `<PluginSlot slot="article_sidebar" />`)

---

### MERLT-2a.8 — FE pagina `/grafo` skeleton + route + Sidebar entry

**Sprint:** MERLT-2a-2
**Priority:** P0
**Points:** 3

**User Story:**
Come utente che vuole esplorare il grafo intero
voglio una pagina dedicata accessibile dalla sidebar
così che possa fare ricerche e navigazione libera nel grafo, indipendentemente dall'articolo aperto.

**Acceptance Criteria:**
- [ ] `frontend/src/features/merlt/graph/page/GraphExplorerPage.tsx`: layout full-canvas (~80% larghezza Cytoscape, ~20% sidebar dx vuota — riempita in 2a.10).
- [ ] Route `/grafo` aggiunta in `App.tsx` linee 27-41, protetta da `ProtectedRoute`.
- [ ] Voce "Grafo" in `Sidebar.tsx` con icon `Network` (lucide-react), path `/grafo`, posizione dopo "MERLT".
- [ ] Stato iniziale (no URN): mostra search box centrato + tagline "Cerca un articolo o un concetto per iniziare".
- [ ] Stato con URN nei query params: fetch + render grafo via shared `useArticleGraph`.
- [ ] Loading state: skeleton + spinner.
- [ ] Feature flag `VITE_FEATURE_MERLT_GRAPH` rispettato: se false, route 404 + voce sidebar nascosta.
- [ ] Test: `frontend/src/features/merlt/graph/page/__tests__/GraphExplorerPage.test.tsx` (render empty state, render with URN, route guard).

**Skill Driver:** `bmad:dev-story`

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/page/GraphExplorerPage.tsx`
- NEW: `frontend/src/features/merlt/graph/page/__tests__/GraphExplorerPage.test.tsx`
- MODIFY: `frontend/src/App.tsx` (+ route /grafo)
- MODIFY: `frontend/src/components/layout/Sidebar.tsx` (+ NavItem "Grafo")

---

### MERLT-2a.9 — FE GraphSearchBox con autocomplete debounced

**Sprint:** MERLT-2a-2
**Priority:** P1
**Points:** 3

**User Story:**
Come utente sulla pagina `/grafo`
voglio una search box che mi suggerisca articoli e concetti mentre digito
così che possa atterrare velocemente sul nodo che mi interessa.

**Acceptance Criteria:**
- [ ] `frontend/src/features/merlt/graph/page/GraphSearchBox.tsx`: input con debounce 300ms.
- [ ] Chiama `GET /api/merlt/graph/search?q=&limit=10` (nuovo endpoint BFF da aggiungere come parte di 2a.4 retroactively OR creato qui inline — preferisco inline qui).
- [ ] Abort signal: query stale viene cancellata se l'utente continua a digitare.
- [ ] Dropdown autocomplete con highlight match + label tipo (es. "Art. 2043 c.c. · Norma").
- [ ] Selezione → naviga a `/grafo?urn=<urn>&depth=2` (push state, no full reload).
- [ ] Keyboard nav: arrow up/down, Enter conferma, Esc chiude.
- [ ] Test: render + debounce + selection.

**Technical Notes:**
- Endpoint MERL-T `/api/v1/graph/entities/search` esiste già (verified by recon).
- Il BFF è solo proxy + auth/consent. Aggiungere `searchEntities` al `graphClient.ts` (se non già fatto in 2a.4).

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/page/GraphSearchBox.tsx`
- NEW: `frontend/src/features/merlt/graph/page/__tests__/GraphSearchBox.test.tsx`
- MODIFY: `backend/src/routes/merlt/graph.ts` (+ `GET /search` se non in 2a.4)
- MODIFY: `backend/src/services/merlt/graphClient.ts` (+ `searchEntities`)

---

### MERLT-2a.10 — FE NodeDetailsDrawer + click-to-recenter + BreadcrumbHistory

**Sprint:** MERLT-2a-2
**Priority:** P1
**Points:** 4

**User Story:**
Come utente che esplora il grafo
voglio vedere i dettagli del nodo selezionato e potermi spostare cliccandoci sopra
così che la navigazione sia fluida senza dover ridigitare ricerche.

**Acceptance Criteria:**
- [ ] `frontend/src/features/merlt/graph/page/NodeDetailsDrawer.tsx`: drawer destro ~300px, mostra `node.properties` formattate (URN, rubrica, testo_vigente troncato, fonte, ecc.) + lista relazioni in/out raggruppate per type.
- [ ] Click su nodo nel grafo → drawer si apre con dettagli.
- [ ] Double-click su nodo → diventa nuovo centro (ricarica grafo via `useArticleGraph` con nuovo urn). Equivalente: pulsante "Centra qui" nel drawer.
- [ ] Per nodi Norma: pulsante "Apri articolo nel workspace" → deeplink al SearchPage con URN.
- [ ] `frontend/src/features/merlt/graph/page/BreadcrumbHistory.tsx`: barra orizzontale sopra il grafo che mostra gli ultimi 5 centri visitati. Click su breadcrumb → torna a quel centro.
- [ ] State management: BreadcrumbHistory persistito in `sessionStorage` per la durata della sessione browser.
- [ ] Test: drawer render, click-to-recenter flow, breadcrumb add/click/cap a 5.

**Skill Drivers:**
- `feature-dev:code-architect` per design state breadcrumb (history + dedup)
- `superpowers:tdd`

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/page/{NodeDetailsDrawer.tsx,BreadcrumbHistory.tsx}`
- NEW: `frontend/src/features/merlt/graph/page/__tests__/{NodeDetailsDrawer,BreadcrumbHistory}.test.tsx`

---

### MERLT-2a.11 — FE DepthSelector + layout picker + deeplink params

**Sprint:** MERLT-2a-2
**Priority:** P1
**Points:** 3

**User Story:**
Come utente che esplora un grafo denso
voglio poter cambiare la profondità del vicinato e il layout
così che possa adattare la vista alla densità del grafo che sto guardando.

**Acceptance Criteria:**
- [ ] `frontend/src/features/merlt/graph/page/DepthSelector.tsx`: 3 button (depth 1/2/3) + dropdown layout (cose-bilkent/dagre/breadthfirst).
- [ ] Cambio depth → ricarica grafo via `useArticleGraph(urn, newDepth)`.
- [ ] Cambio layout → re-applica layout senza refetch dati.
- [ ] Query params `?urn=X&depth=N&layout=L` sincronizzati con state. Refresh page mantiene lo state.
- [ ] Deeplink shareable: `https://app/grafo?urn=art2043&depth=2&layout=cose-bilkent` ricarica esattamente lo stesso stato.
- [ ] Test: state sync con URL + cambio depth refetcha + cambio layout no-refetch.

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- NEW: `frontend/src/features/merlt/graph/page/DepthSelector.tsx`
- NEW: `frontend/src/features/merlt/graph/page/__tests__/DepthSelector.test.tsx`

---

### MERLT-2a.12 — FE ingestion polling UX dentro `/grafo`

**Sprint:** MERLT-2a-2
**Priority:** P1
**Points:** 1

**User Story:**
Come utente sulla pagina `/grafo` che cerca un URN non ancora nel grafo
voglio che venga avviata l'indicizzazione e che la pagina aspetti il risultato
così che dopo l'attesa veda il grafo invece di un errore.

**Acceptance Criteria:**
- [ ] Se `GraphExplorerPage` riceve un URN che restituisce 404 da `/graph/article/:urn`: trigger `POST /graph/ingest` automatico, mostra banner "Indicizzazione di art. X in corso…" + spinner.
- [ ] Usa `useIngestionJob` (shared layer) per polling.
- [ ] On completion: reload `useArticleGraph` → grafo si popola.
- [ ] Toast custom (esistente) "Grafo aggiornato" su completion.
- [ ] On failure: banner "Articolo non indicizzabile" + pulsante "Riprova".

**Skill Driver:** `superpowers:tdd`

**Files coinvolti:**
- MODIFY: `frontend/src/features/merlt/graph/page/GraphExplorerPage.tsx`

---

### MERLT-2a.13 — Smoke E2E + CLAUDE.md + smoke checklist + PR

**Sprint:** MERLT-2a-2
**Priority:** P0
**Points:** 2

**User Story:**
Come scrum master che chiude Slice 2a
voglio smoke E2E completa, docs aggiornate, PR pronto
così che il branch sia mergiabile e il prossimo dev parte da basi solide.

**Acceptance Criteria:**
- [ ] `docs/merlt-smoke-checklist.md` esteso con sezione "Slice 2a — Graph" (vedi design doc §9.4).
- [ ] Smoke completa: 10 step (boot seed, art 2043, art 73 cp, art inesistente, navigate /grafo, search autocomplete, click recenter, breadcrumb, depth toggle, deeplink refresh). Tutti devono passare.
- [ ] `CLAUDE.md` sezione MERL-T Integration estesa con Slice 2a (architettura, file paths nuovi, gotcha incontrati).
- [ ] `docs/legacy-libro-iv-seed.md` creato: how-to per riprodurre il recovery del seed (per devops futuri o se si vuole estendere a Libro III, V, ecc.).
- [ ] PR aperto verso `main` con: title `feat(merlt): graph lazy ingestion + viz read-only (Slice 2a)`, body con executive summary + screenshot side rail + screenshot pagina `/grafo` + smoke checklist completata.
- [ ] All tests verdi: `npm run test --workspace=backend`, `npm run test --workspace=frontend`, `pytest merlt/tests/`.
- [ ] Code review chiesta via `superpowers:requesting-code-review` (dispatch `feature-dev:code-reviewer`).

**Skill Drivers:**
- `superpowers:verification-before-completion` (per checklist completeness)
- `commit-commands:commit-push-pr` (per il PR final)

**Files coinvolti:**
- MODIFY: `docs/merlt-smoke-checklist.md`
- MODIFY: `CLAUDE.md`
- NEW: `docs/legacy-libro-iv-seed.md`

---

## Cross-cutting Concerns

### Testing piramide (target Slice 2a)

| Livello | Coverage minimo | Tool |
|---------|-----------------|------|
| Unit (BFF) | ≥80% su `services/merlt/graphClient`, `routes/merlt/graph` | vitest |
| Integration (BFF) | Tutti i flow di `graph-routes.test.ts` + `lazy-trigger.test.ts` verdi | vitest + supertest + Postgres test DB |
| Unit (MERL-T) | ≥80% su `worker/tasks/ingest_article`, `scripts/load_seed_libro_iv` | pytest |
| Frontend | Tutti i render states + interactions | vitest + jsdom |
| Smoke E2E | 10 step manuali in `merlt-smoke-checklist.md` | manuale + screenshot |

### Feature flag

`VITE_FEATURE_MERLT_GRAPH` (default `true` come Slice 1):
- `false` → side rail non si registra in plugin slot, route `/grafo` 404, voce Sidebar nascosta
- `true` → tutto attivo

### Dipendenze esterne aggiunte

| Layer | Package | Versione | Bundle impact |
|-------|---------|----------|---------------|
| MERL-T | arq | ^0.25.0 | server-side, no client impact |
| Frontend | cytoscape | ^3.30.0 | ~250KB gzipped (lazy-loaded) |
| Frontend | react-cytoscapejs | ^2.0.0 | ~3KB |
| Frontend | cytoscape-cose-bilkent | ^4.1.0 | ~25KB |
| Frontend | cytoscape-dagre | ^2.5.0 | ~15KB |

Tutti i cytoscape-* sono peer dep di cytoscape — code-split via `React.lazy` su `GraphExplorerPage` e `ArticleGraphSideRail`.

### Decisioni differite a Slice 2b/c

1. **Editing del grafo**: schema RLCF (pending_*, *_votes, *_issue_reports) già in `merlt/data/seeds/postgres-dumps/rlcf-schema.sql` — Slice 2b adatta + wire UI.
2. **Devil's Advocate sul grafo**: schema `devils_advocate_*` esiste ma ancorato a `legal_tasks`. Da ri-ancorare in Slice 2c.
3. **Authority multi-dominio**: tabella `user_domain_authority` esiste ma vuota. Logica di calcolo authority pesata per dominio → Slice 2b/c.

---

## Skill Activation Matrix

| Story | Primary Skill | Secondary Skill | Agent Dispatch |
|-------|---------------|-----------------|-----------------|
| 2a.1 | `superpowers:tdd` | `feature-dev:code-architect` | — |
| 2a.2 | `superpowers:tdd` | — | — |
| 2a.3 | `feature-dev:code-architect` | `superpowers:tdd` | — |
| 2a.4 | `superpowers:tdd` | — | — |
| 2a.5 | `superpowers:tdd` | — | — |
| 2a.6 | `feature-dev:code-architect` | `superpowers:tdd` | — |
| 2a.7 | `superpowers:tdd` | `feature-dev:code-reviewer` | post-impl |
| 2a.8 | `bmad:dev-story` | — | — |
| 2a.9 | `superpowers:tdd` | — | — |
| 2a.10 | `feature-dev:code-architect` | `superpowers:tdd` | — |
| 2a.11 | `superpowers:tdd` | — | — |
| 2a.12 | `superpowers:tdd` | — | — |
| 2a.13 | `superpowers:verification-before-completion` | `commit-commands:commit-push-pr` | `feature-dev:code-reviewer` |

**Story gates strong** (`feature-dev:code-reviewer` review obbligatoria):
- Post 2a.7 (chiude Sprint 2a-1, prima volta che la UI è user-visible)
- Post 2a.13 (chiude Slice 2a, PR ready)

**Story gates light** (self-review + smoke):
- 2a.1 (seed loader: integrity check è il gate)
- 2a.3 (worker: smoke `arq` healthcheck + 1 job E2E)
- 2a.4 (BFF: integration test verdi)

---

## Done Criteria Slice 2a

Replicate da design doc §10:
1. ✅ Seed loader idempotente, 27.700+ nodi a boot, integrity check verde
2. ✅ Endpoint MERL-T `/graph/{ingest-article,job-callback}` + esistenti verificati
3. ✅ Endpoint BFF `/graph/{article/:urn,ingest,jobs/:id/status}` + Zod + idempotency
4. ✅ Prisma `MerltIngestionJob` migrato
5. ✅ Side rail collassabile in `ArticleTabContent`, depth=1, ≤25 nodi
6. ✅ Pagina `/grafo` navigabile: search, recenter, breadcrumb, depth, layout, deeplink
7. ✅ Lazy ingestion E2E: skeleton → grafo dopo ~60s
8. ✅ Failure modes coperti
9. ✅ Worker Arq healthy in container separato
10. ✅ Feature flag `VITE_FEATURE_MERLT_GRAPH=false` → tutto sparisce
11. ✅ Test piramide + smoke E2E
12. ✅ Doc aggiornati + PR ready

---

*Sprint plan generato 2026-05-23, dopo recon dello stato attuale del codice (3 agent Explore in parallelo: MERL-T backend, BFF Node, frontend). Pronto per esecuzione story-by-story con writing-plans skill o esecuzione diretta.*
