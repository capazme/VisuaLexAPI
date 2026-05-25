# MERL-T ↔ VisuaLex Integration — Slice 2a Design

**Status**: draft — pending user review
**Date**: 2026-05-23
**Branch**: `visualex-merlt-main` (continuazione)
**Predecessor**: Slice 1 (chiusa il 2026-05-22, design doc `2026-05-22-merlt-integration-slice1-design.md`)
**Reference**:
- Slice 1 design + memoria `merlt_slice1_complete`
- Recovery seed Libro IV CC: memoria `legacy_libro_iv_recovery` + `merlt/data/seeds/`
- `merlt/CLAUDE.md` (4 pilastri RLCF + schema KG)
- `merlt/merlt/core/legal_knowledge_graph.py` (orchestrator `ingest_norm()`)

---

## 1. Goal e framing

Slice 1 ha chiuso il loop **dati**: gli eventi utente VisuaLex finiscono in MERL-T come segnali RLCF in-memory. Slice 2a chiude il loop **conoscenza**: il **grafo giuridico** che il SystemicExpert interroga esiste, è popolato, ed è esposto al frontend in modalità read-only.

**Pilastri di Slice 2a:**

1. **Seed Libro IV pre-caricato**. Il grafo non parte vuoto: al primo boot di MERL-T il seed recuperato (27.742 nodi, 43.936 archi, 27.117 bridge mapping del Codice Civile Libro IV artt. 1173-2059) viene caricato. L'utente apre VisuaLex su un articolo civilistico → vede già le connessioni.
2. **Lazy ingestion on-view per il resto**. Quando un utente apre un articolo che NON è nel grafo (es. art. 100 Cost., art. 73 c.p., art. 2086 c.c. — fuori dal Libro IV), un job asincrono in background lancia `ingest_norm()` per quell'articolo. L'utente non aspetta. Al termine del job, il pannello grafo si popola.
3. **Visualizzazione read-only su due superfici complementari**:
   - **Side rail in-context** dentro `ArticleTabContent`: pannello laterale collassabile (~300px aperto, icona sticky chiusa) che mostra il vicinato dell'articolo corrente con depth=1. Sempre disponibile mentre leggi/annoti.
   - **Pagina dedicata `/grafo`** con accesso da sidebar: explorer full-canvas (~80% larghezza) per esplorare il grafo partendo da una ricerca (URN, testo libero) o atterrando dal side rail via deeplink (`/grafo?urn=<center>&depth=2`). Depth selezionabile 1/2/3, click su nodo → nuovo centro.

   **NESSUN editing**: il proposal layer + voting è scope Slice 2b.

**Out of scope per Slice 2a:**
- **Editing del grafo** (creazione/modifica/cancellazione di nodi/archi via UI) → Slice 2b "Laboratorio RLCF"
- **Devil's Advocate sul grafo** → Slice 2c
- **Q&A multi-expert** → Slice 3
- Visualizzazione dell'intero grafo (panoramica globale): Slice 2a mostra solo il sub-grafo dell'articolo aperto. Esplorazione full-graph è scope Slice 2b/3.

---

## 2. Decisioni architetturali load-bearing

| Decisione | Scelta | Motivazione |
|-----------|--------|-------------|
| Bootstrap | Seed automatico da `merlt/data/seeds/` al primo boot | Cold-start risolto, partiamo con 27.742 nodi. Idempotente: skippa se grafo non vuoto |
| Embeddings seed | Rigenerati da `properties.testo_vigente` (Norma) e affini durante boot | Snapshot Qdrant esistente è in drift di 2 mesi col bridge — confermato dal cross-check Mag 2026 (24% match) |
| Bridge.chunk_id | Ricostruito durante seed loader | Dopo rigenerazione embeddings, mapping testo→uuid Qdrant è nuovo |
| Lazy ingestion trigger | BFF su evento `article:viewed` (già esistente da Slice 1) | Niente nuovo evento frontend, riusiamo pipeline. Il check "è nel grafo?" è una nuova query BFF |
| Worker pool | **RQ (Redis Queue)** — NON arq | **Correzione 2026-05-25**: arq pinna `redis<6`, falkordb pinna `redis>=7.1` → conflitto irrisolvibile (il worker ha bisogno di entrambi). RQ pinna `redis!=6,>=3.5` → compatibile con falkordb 7.x. RQ è sync; il worker chiama `asyncio.run(ingest_norm(...))`. Verificato: redis 7.4.0 + rq 2.9.0 + falkordb coesistono |
| Job callback | Worker → BFF (`POST /api/merlt/internal/job-callback`), **NON in MERL-T** | **Correzione 2026-05-25**: il receiver del callback è nel BFF (story 2a.4), aggiorna `MerltIngestionJob`. MERL-T espone solo `/graph/ingest-article` |
| Job persistence | Prisma model `MerltIngestionJob` in Postgres VisuaLex | Stato job visibile al frontend senza dipendenza da Redis; audit trail; pattern coerente con `Environment`/`Dossier` |
| Idempotency key | `article_urn` | Due richieste sullo stesso URN nello stesso minuto coalescono al primo job pending |
| Libreria viz | **Cytoscape.js** (no React Flow, no sigma.js) | Maturo per grafi densi (100-1000 nodi), layout COSE/dagre/breadthfirst, plugin per tooltips/styling/zoom, già usato in produzione su domini simili |
| Notification "ready" | Polling 2s | Job durata 30-90s, complessità WebSocket non giustificata. Polling stoppa al `status=completed` |
| **Side rail (in-context)** | Ego-network **depth=1** + max 25 nodi visibili, layout COSE compact | Compatto e leggibile in 300px. Pulsante "Esplora" → naviga a `/grafo?urn=<urn>&depth=2` |
| **Pagina `/grafo`** | Full-canvas Cytoscape ~80%, sidebar destra ~20% con dettagli nodo + depth toggle 1/2/3 | Esplorazione interattiva. Cap 500 nodi visibili (sopra è illeggibile anche full-screen). Click su nodo → diventa nuovo centro |
| Layout default | COSE-Bilkent in entrambe le superfici | Force-directed, leggibile su grafi densi; alternative (dagre, breadthfirst) toggleabile in `/grafo` |
| Entry point pagina | Nuovo link in `Sidebar` del Layout (icona network) | Coerente con Forum/Environment/Dossier |
| MERL-T API surface | 3 nuovi endpoint `/api/v1/graph/*` | `check-article`, `ingest-article`, `subgraph` |
| Modifiche a MERL-T core | **Solo nuovi router + worker entrypoint**, niente toccare `LegalKnowledgeGraph.ingest_norm` | Mantiene invariante "MERL-T vergine" di Slice 1 |
| Seed loader location | `merlt/scripts/load_seed_libro_iv.py` chiamato da `merlt/merlt/app.py:~133` (esistente `lifespan`, punto `yield`) | Boot script idempotente. NON migration Alembic — il seed è dati, non schema |
| Endpoint MERL-T riusati | `GET /api/v1/graph/check-article` + `GET /api/v1/graph/subgraph` **esistono già** in `merlt/api/graph_router.py` | Verificare firma esatta e contract con BFF. Nessun lavoro di creazione |
| Endpoint MERL-T nuovi | Solo `POST /api/v1/graph/ingest-article` (trigger worker) + `POST /internal/job-callback` (worker → BFF) | Minimo aggiunto al graph_router esistente |
| Data fetching frontend | **Zustand + axios** (no react-query/TanStack) | Allineato a tutto il resto della codebase VisuaLex. Polling via setInterval+cleanup nei hook |
| Slot plugin host | `article_sidebar` (placeholder già presente in `plugins/registry.tsx`) | Niente nuovo slot da inventare, solo registrare componente lì |

---

## 3. Architettura runtime

Estensione di Slice 1, evidenziati i pezzi nuovi:

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser                                                         │
│ ┌───────────────────┐                                           │
│ │ VisuaLex frontend │ + ArticleGraphPanel (Cytoscape)  [NEW]    │
│ └─────────┬─────────┘                                           │
└───────────┼─────────────────────────────────────────────────────┘
            │ /api/merlt/graph/* (NEW) + Slice 1 routes
            ▼
┌─────────────────────────────────────────────────────────────────┐
│ BFF Node (Express)              :3001                            │
│   + routes/merlt/graph.ts                          [NEW]         │
│   + services/merlt/graphClient.ts                  [NEW]         │
│   + Prisma MerltIngestionJob                       [NEW]         │
│   + Slice 1 routes (consent/events/profile/health) (invariate)  │
└──────┬─────────────────────────────────────┬────────────────────┘
       │ HTTP                                 │ Postgres VisuaLex
       ▼                                      ▼
┌──────────────────────────────────┐    ┌─────────────────────────┐
│ MERL-T FastAPI :8000             │    │ Postgres VisuaLex :5432 │
│  + api/graph_router.py [EXT]     │    │  + MerltIngestionJob    │
│  + scripts/load_seed_libro_iv.py │    └─────────────────────────┘
│  + worker/arq_worker.py [NEW]    │
└──┬───┬───┬───┬───────────────────┘
   │   │   │   │
   ▼   ▼   ▼   ▼
┌────┐┌────┐┌────┐┌──────────────┐
│Falk││Qdrn││Redi││Postgres MERLT│
│DB  ││ant ││s   ││  bridge_table│
└────┘└────┘└────┘└──────────────┘
         ↑
   Arq jobs queue
   (same Redis as Slice 1)
```

**Vincoli runtime aggiuntivi rispetto a Slice 1:**
- Il **worker Arq** è un processo separato dentro il container `merlt-api` (o un container dedicato `merlt-worker` se preferiamo isolation più stretta — vedi §10).
- `start.sh` aspetta che il seed loader abbia finito prima di marcare MERL-T `ready` (gate con `GET /api/v1/graph/seed-status` → `loaded`). Boot iniziale: ~3-5 min (rigenerazione 5.926 embeddings + scrittura grafo + bridge). Successivi boot: <5s (skip se grafo non vuoto).
- Browser non parla mai direttamente a MERL-T (invariante Slice 1).

---

## 4. Seed bootstrap

**Trigger**: `merlt/api/lifespan.py` (startup hook FastAPI) chiama `load_seed_libro_iv()` prima di marcare `ready`.

**Idempotency check**: `MATCH (n) RETURN count(n)` sul grafo `merl_t_legal`. Se > 100 (soglia anti-falso-positivo: il grafo vuoto ha qualche nodo di schema MERL-T), skip.

**Procedura `load_seed_libro_iv.py`:**

1. **Load JSON** da `merlt/data/seeds/libro-iv-cc-graph.json` (27.742 nodi + 43.936 archi).
2. **MERGE nodi** in FalkorDB. Chiave di merge:
   - Per label `Norma`: `URN` (es. `https://www.normattiva.it/...~art2043`).
   - Per tutti gli altri label (Comma, ConcettoGiuridico, Dottrina, AttoGiudiziario, ecc.): `node_id` (es. `concetto:funzione_di_finanziamento_nel_factoring`).
   - Cypher template: `MERGE (n:Norma {URN: $urn}) SET n += $props`.
   - Batch 500 nodi per transazione.
3. **MERGE archi** in FalkorDB. Per ogni edge nel JSON:
   - Risolvi `start` (id FalkorDB legacy) → URN/node_id via lookup nel JSON nodes.
   - `MATCH (a {URN: $start_urn|node_id}), (b {...}) MERGE (a)-[r:$type {key: $edge_key}]->(b) SET r += $props`.
   - `edge_key` = hash(`start_urn|end_urn|type|disposizione|data_efficacia`) per evitare duplicati su rerun.
   - Batch 500 archi per transazione.
4. **Rigenera embeddings**. Per ogni nodo con testo (Norma, Comma, ConcettoGiuridico, Dottrina, PrincipioGiuridico, DefinizioneLegale, AttoGiudiziario):
   - Estrai testo da `properties.testo_vigente | testo | descrizione | massima_text | testo_chunk`.
   - Calcola embedding con `EmbeddingService` (modello: `intfloat/multilingual-e5-large`).
   - Upsert in Qdrant collection `merl_t_legal_chunks` con `chunk_id = uuid4()` e payload `{ article_urn, source_type, text, node_label }`.
   - Batch 32 testi (config default del modello).
5. **Restore bridge_table**. Carica `bridge-table-data.sql` via `psql` nel Postgres MERL-T (`rlcf_dev`). Il file è già in formato `COPY public.bridge_table FROM stdin`, portabile cross-version (15→16).
6. **Riallinea bridge.chunk_id**. Dopo step 4-5: per ogni record bridge, cerca il nuovo `chunk_id` Qdrant via match esatto su `chunk_text`. Aggiorna bridge.
7. **Verifica integrità** (smoke automatico):
   - `MATCH (n) RETURN count(n)` ≥ 27.700
   - `SELECT COUNT(*) FROM bridge_table` ≥ 27.000
   - `GET /collections/merl_t_legal_chunks` → `points_count` ≥ 5.900
   - Bridge orfani (graph_node_urn senza nodo): 0.
   - Se uno fail → log error + raise → MERL-T non parte. Esplicito è meglio di silenzioso.

**Costo stimato boot iniziale**: ~3-5 min (embedding generation è il collo di bottiglia, ~30ms/testo su CPU, GPU se disponibile più veloce). Boot successivi: <5s (skip).

---

## 5. Lazy ingestion on-view

### Trigger

Riusiamo l'evento `article:viewed` di Slice 1 (`useArticleViewedTracker.ts`). Quando arriva a `POST /api/merlt/events/article-viewed`, il BFF:

1. Routes Slice 1 invariate: scrive il tracking event come prima.
2. **Nuovo step**: chiama `graphClient.checkArticle(articleUrn)`. Se la risposta è `{ in_graph: false }`, accoda un job di ingestion.

**Razionale**: evitare nuovo evento frontend. Il backend decide se accodare il job, il frontend non sa nemmeno che esiste la coda. Trasparente.

### Job lifecycle

```
   Frontend                BFF                 MERL-T             Worker
   ────────                ───                 ──────             ──────
   article-viewed   ───►   POST events
                           POST graph/check ──► /check-article
                           ◄──── { in_graph: false }
                           
                           CREATE MerltIngestionJob (Postgres VLX)
                              { id, articleUrn, userId, status: 'pending' }
                           
                           arq.enqueue('ingest_article', { urn, jobId })
                           
                           ◄── 202 { jobId, status: 'pending' }
                           
                                                                   ── pulled job ──►
                                                                   ingest_norm(urn,
                                                                     include_brocardi=True,
                                                                     include_embeddings=True,
                                                                     include_bridge=True,
                                                                     include_multivigenza=True)
                                                                   
                                                                   ◄── result (12-90s)
                           
                                                                   POST /jobs/:id/complete
                           UPDATE MerltIngestionJob.status='completed'
   
   GET /jobs/:id/status ─► (poll 2s)
   ◄── { status: 'completed', nodes_created: 47 }
   
   GET /graph/article/:urn ─► /api/v1/graph/subgraph
                              ◄── { nodes, edges }
   ◄── render Cytoscape
```

### Idempotency

Quando il BFF sta per creare un nuovo `MerltIngestionJob`, prima fa:

```sql
SELECT * FROM merlt_ingestion_jobs
WHERE article_urn = ? AND status IN ('pending', 'running')
LIMIT 1;
```

Se esiste, **non crea nuovo job**: ritorna il job esistente. Il frontend prende il poll su quello. Coalescenza naturale per richieste concorrenti sullo stesso articolo.

### Failure modes

| Failure | Comportamento |
|---------|---------------|
| Job in coda da > 5 min | Marca `status='timeout'`, frontend mostra "Indicizzazione lenta, riprova" |
| MERL-T `ingest_norm` raise (es. scraping Brocardi fallisce, articolo inesistente) | Marca `status='failed'`, salva `error_message`. Frontend mostra "Articolo non indicizzabile" |
| Worker crash mid-job | Arq job ha `max_tries=3` + retry con backoff exponential. Dopo 3 fail → `status='failed'` |
| Job completed ma il check-article ritorna ancora false (race rara) | Frontend re-poll dopo 1s, poi si arrende |

---

## 6. Componenti

### 6.1 MERL-T (`merlt/`)

```
merlt/scripts/
└── load_seed_libro_iv.py            [NEW] boot script idempotente (sez. 4)

merlt/merlt/
└── app.py                           [MODIFY] +1 chiamata in lifespan (riga ~133) per load_seed

merlt/merlt/api/
└── graph_router.py                  [EXTEND] +2 nuovi endpoint (esistente!):
                                        - POST /api/v1/graph/ingest-article (NEW)
                                        - POST /api/v1/internal/job-callback (NEW)
                                      Già presenti (riusati): GET /check-article, GET /subgraph,
                                      GET /article/{urn}/entities|relations, /entities/search,
                                      POST /resolve-norm, /overview, POST /search

merlt/merlt/worker/
├── __init__.py                       [NEW]
├── arq_worker.py                     [NEW] WorkerSettings + functions list
└── tasks/
    ├── __init__.py
    └── ingest_article.py             [NEW] task wrapper di LegalKnowledgeGraph.ingest_norm
```

**Nessuna modifica a:**
- `merlt/merlt/core/legal_knowledge_graph.py` (orchestrator)
- `merlt/merlt/pipeline/ingestion.py` (`IngestionPipelineV2`)
- `merlt/merlt/storage/graph/entity_writer.py`
- `merlt/merlt/storage/graph/client.py` (subgraph extraction `traverse()` già esistente)

Solo nuovi entry points + wrapper, MERL-T core resta intoccato (invariante Slice 1).

**Nuovi endpoint MERL-T** (dettaglio):

```python
# GET /api/v1/graph/check-article?urn=...
# 200 { in_graph: bool, node_count: int, last_updated_at: iso }

# POST /api/v1/graph/ingest-article
# body: { urn: str, options?: { force_refresh: bool } }
# 202 { task_id: str }
# (sincronamente accoda job arq; task_id è lo job id arq, NON l'id MerltIngestionJob)

# GET /api/v1/graph/subgraph?urn=...&depth=2&limit=200
# 200 {
#   center_node: { urn, label, properties },
#   nodes: [{ id, label, properties, distance: 1|2 }, ...],
#   edges: [{ source, target, type, properties }, ...],
#   stats: { total_nodes, total_edges, truncated_at_limit: bool }
# }
```

### 6.2 BFF Node (`backend/src/`)

```
routes/merlt/
└── graph.ts                          [NEW]
    GET    /api/merlt/graph/article/:urn        (subgraph)
    POST   /api/merlt/graph/ingest              (force trigger)
    GET    /api/merlt/graph/jobs/:jobId/status

services/merlt/
└── graphClient.ts                    [NEW] HTTP client tipizzato verso MERL-T :8000

schemas/merlt/
└── graph.ts                          [NEW] Zod schemas (subgraph response, job status)

# MODIFY:
routes/merlt/events.ts                +1 chiamata: dopo aver inoltrato l'evento
                                       article-viewed, controlla in_graph e
                                       crea MerltIngestionJob se manca
```

**Nuova Prisma model:**

```prisma
model MerltIngestionJob {
  id              String   @id @default(cuid())
  articleUrn      String
  userId          String
  status          MerltJobStatus @default(pending)
  arqJobId        String?  // ritornato da MERL-T POST /ingest-article
  attempts        Int      @default(0)
  errorMessage    String?
  nodesCreated    Int?
  edgesCreated    Int?
  createdAt       DateTime @default(now())
  startedAt       DateTime?
  completedAt     DateTime?

  @@index([articleUrn, status])
  @@index([userId])
  @@index([status, createdAt])
}

enum MerltJobStatus {
  pending
  running
  completed
  failed
  timeout
}
```

Pattern coerente con `Environment`/`Dossier`: model per ogni entità persistente lato VisuaLex.

### 6.3 Frontend (`frontend/src/`)

```
features/merlt/graph/
├── shared/                                   [shared between side rail & page]
│   ├── CytoscapeView.tsx              [NEW] wrapper su cytoscape + react binding,
│   │                                       props: { nodes, edges, layout, height,
│   │                                                onNodeClick, onNodeDblClick }
│   ├── graphStyles.ts                 [NEW] style sheet per 22 label + 15 rel
│   │                                       types (color + shape + edge style)
│   ├── useArticleGraph.ts             [NEW] hook: fetch subgraph + invalidate
│   ├── useIngestionJob.ts             [NEW] hook: poll status job ogni 2s
│   └── graphTransform.ts              [NEW] backend response → cytoscape elements
├── side-rail/
│   ├── ArticleGraphSideRail.tsx       [NEW] pannello collassabile in ArticleTab
│   │                                       depth=1, max 25 nodi, "Esplora" CTA
│   ├── CollapseToggle.tsx             [NEW] icon sticky quando chiuso
│   └── __tests__/
│       └── ArticleGraphSideRail.test.tsx
├── page/
│   ├── GraphExplorerPage.tsx          [NEW] route /grafo, full-canvas + sidebar dx
│   ├── GraphSearchBox.tsx             [NEW] search URN o testo libero, debounced
│   │                                       autocomplete via /api/merlt/graph/search
│   ├── NodeDetailsDrawer.tsx          [NEW] sidebar dx: props + "naviga ad articolo"
│   ├── DepthSelector.tsx              [NEW] toggle 1/2/3 + layout picker
│   ├── BreadcrumbHistory.tsx          [NEW] storia di navigazione tra centri
│   └── __tests__/
│       └── GraphExplorerPage.test.tsx

App.tsx                               [MODIFY] route <Route path="/grafo" element=…/>
components/layout/Sidebar.tsx         [MODIFY] +1 entry "Grafo" icona Network
plugins/registry.tsx                  [MODIFY] aggiunto slot 'article_side_rail'
components/features/search/
└── ArticleTabContent.tsx             [MODIFY] usa <PluginSlot id="article_side_rail"/>
                                       in posizione laterale destra del tab
```

**Nuova dipendenza npm:**
```
cytoscape@^3.30.0                   (~250KB gzipped)
cytoscape-cose-bilkent@^4.1.0       (layout force-directed)
cytoscape-dagre@^2.5.0              (layout gerarchico, opt in pagina /grafo)
react-cytoscapejs@^2.0.0            (binding React, peer dep di cytoscape)
```

**Razionale del refactor `shared/`**: side rail e page condividono ~70% del codice (fetch, transform, stili, Cytoscape wrapper). Solo i contenitori (layout/sizing/interactions) differiscono.

### 6.4 Docker (`docker-compose.merlt.yml`)

```yaml
# Estensione, NO breaking changes:
services:
  merlt-api:
    # invariato

  merlt-worker:                       # NEW
    build: .
    command: arq merlt.worker.arq_worker.WorkerSettings
    environment:
      REDIS_URL: redis://merlt-redis:6379/1
      FALKORDB_HOST: merlt-falkordb
      QDRANT_HOST: merlt-qdrant
      POSTGRES_URL: ...
      BFF_CALLBACK_URL: http://host.docker.internal:3001/api/merlt/internal/job-callback
    depends_on:
      - merlt-redis
      - merlt-falkordb
      - merlt-qdrant
      - merlt-postgres
    healthcheck:
      test: ["CMD", "arq", "merlt.worker.arq_worker.WorkerSettings", "--check"]
```

Worker in container separato (più clean per logging e scaling futuro).

---

## 7. Stories Slice 2a

Numerazione MERLT-2a.N coerente con Slice 1. Stima totale: **32 punti** (14 backend + 18 frontend), splittati in **2 sprint** (cap 30pt/sprint, ricalcato sulla velocity di Slice 1).

> Stima ricalibrata dopo recon: `check-article` e `subgraph` già esistono in MERL-T `graph_router.py`. Story 2a.2 ridotta da 3pt a 2pt (verify + 2 endpoint nuovi).

### Sprint MERLT-2a-1 — Backend + side rail (16pt)

| # | Story | Pt | Owner | Blocker |
|---|-------|----|----|---------|
| 2a.1 | Seed loader idempotente + integrity check + lifespan hook | 5 | MERL-T | — |
| 2a.2 | MERL-T graph router: +2 endpoint (ingest-article + job-callback). Verify check-article/subgraph esistenti. | 2 | MERL-T | 2a.1 |
| 2a.3 | MERL-T worker Arq + task ingest_article + callback BFF | 5 | MERL-T | 2a.1 |
| 2a.4 | BFF graphClient + route graph.ts + Prisma MerltIngestionJob | 5 | BFF | 2a.2, 2a.3 |
| 2a.5 | BFF lazy trigger in events.ts + idempotency | 2 | BFF | 2a.4 |
| 2a.6 | FE shared layer (CytoscapeView, graphStyles, hooks, transform) | 3 | FE | 2a.4 |
| 2a.7 | FE side rail in ArticleTabContent + collapse + plugin slot | 4 | FE | 2a.6 |

**Sprint goal**: alla fine dello sprint, aprendo un articolo del Libro IV si vede il side rail con il vicinato; aprendo un articolo nuovo il job parte e il side rail si popola dopo ~60s. La pagina `/grafo` NON è ancora disponibile.

### Sprint MERLT-2a-2 — Pagina dedicata `/grafo` (16pt)

| # | Story | Pt | Owner | Blocker |
|---|-------|----|----|---------|
| 2a.8 | FE pagina `/grafo` skeleton + route + Sidebar entry | 3 | FE | 2a.7 |
| 2a.9 | FE GraphSearchBox con autocomplete debounced | 3 | FE | 2a.8 |
| 2a.10 | FE NodeDetailsDrawer + click-to-recenter + BreadcrumbHistory | 4 | FE | 2a.9 |
| 2a.11 | FE DepthSelector + layout picker (COSE/dagre) + deeplink params | 3 | FE | 2a.10 |
| 2a.12 | FE ingestion polling UX dentro `/grafo` (centro non in grafo → trigger) | 1 | FE | 2a.11 |
| 2a.13 | Smoke E2E entrambe le superfici + CLAUDE.md + smoke checklist | 2 | doc | tutti |

**Sprint goal**: pagina `/grafo` navigabile, ricerca, esplorazione fluida con click-to-recenter, deeplink condivisibile.

**Vertical slice approach**: 2a.1-2a.5 verticale fino al subgraph (curl-testable). Poi 2a.6-2a.7 chiude il primo deliverable user-visible (side rail). Sprint 2 attacca la pagina full che riusa tutto lo shared layer.

---

## 8. Data flow esempi

### 8.1 Articolo nel seed (caso felice)

Utente apre **art. 2043 c.c.** (responsabilità extracontrattuale, dentro Libro IV → nel seed).

```
Frontend                      BFF                    MERL-T
─────                         ────                   ──────
Apre art. 2043
useArticleViewedTracker fires →  POST /events/article-viewed
                              forwards to MERL-T (Slice 1)
                              POST /graph/check-article?urn=...
                                                     ◄── { in_graph: true }
                              (no job created)
                              ◄── 202 { trace_id }
                              
useArticleGraph hook fires  → GET /graph/article/art2043
                              GET /api/v1/graph/subgraph?urn=art2043&depth=2
                                                     ◄── { center, nodes: 24, edges: 38 }
                              ◄── { center, nodes, edges }
                              
ArticleGraphPanel renders Cytoscape
```

UX: pannello "Grafo" della tab articolo mostra subito il sub-grafo. Zero attesa.

### 8.2 Articolo fuori seed (lazy ingestion)

Utente apre **art. 73 c.p.** (concorso aggravato di reati, fuori dal Libro IV CC → non nel seed).

```
Frontend                      BFF                    MERL-T              Worker
─────                         ────                   ──────              ──────
Apre art. 73 c.p.
article:viewed fires    →    POST /events/article-viewed
                              POST /graph/check-article?urn=...
                                                     ◄── { in_graph: false }
                              INSERT MerltIngestionJob status='pending'
                              POST /graph/ingest-article {urn}
                                                     accoda job
                                                     ◄── { task_id: arq-xyz }
                              ◄── 202 { trace_id, ingestion_job_id }
                              
ArticleGraphPanel  → status='pending', shows skeleton "Sto indicizzando..."

useIngestionJob polls (every 2s) → GET /jobs/:id/status
                              ◄── { status: 'pending' }
                                                                          ── pulled ──►
                                                                          ingest_norm(art 73 cp,
                                                                            ...)
                                                                          (45s)
                                                                          
                                                                          POST /internal/job-callback
                              UPDATE MerltIngestionJob status='completed',
                                     nodes_created=23, edges_created=31

useIngestionJob next poll → GET /jobs/:id/status
                              ◄── { status: 'completed', nodes: 23 }
useArticleGraph invalidates → GET /graph/article/art73cp
                              ◄── { center, nodes: 23, edges: 31 }
                              
ArticleGraphPanel renders Cytoscape, toast "Grafo aggiornato"
```

UX: pannello mostra prima skeleton + "Indicizzazione in corso (~30-90s)", poi sostituito dal grafo reale. Utente può continuare a leggere/annotare in parallelo.

### 8.3 Articolo non indicizzabile

Utente apre articolo inesistente o scraping fallisce.

```
Frontend                      BFF                    MERL-T              Worker
─────                         ────                   ──────              ──────
(come 8.2)
                                                                          ── pulled ──►
                                                                          ingest_norm raises
                                                                          ScrapingError
                                                                          (3 retry, tutti falliti)
                                                                          
                                                                          POST /internal/job-callback
                                                                            { status: 'failed',
                                                                              error: 'scraping_failed' }
                              UPDATE status='failed'

useIngestionJob next poll → GET /jobs/:id/status
                              ◄── { status: 'failed', error: 'scraping_failed' }
                              
ArticleGraphPanel renders empty state + "Articolo non indicizzabile" message
```

UX: nessun grafo, messaggio chiaro. L'utente può continuare normalmente — il fallback è "grafo non disponibile per questo articolo", non blocca nulla.

---

## 9. Testing strategy

Piramide identica a Slice 1, focus sulle aree nuove.

### 9.1 Unit (vitest)

**BFF:**
- `services/merlt/graphClient.test.ts` — URL construction per check/ingest/subgraph, timeout, errors mapping
- `routes/merlt/graph.test.ts` — Zod validation + 4xx mapping
- `routes/merlt/events.test.ts` — idempotency: due eventi consecutivi sullo stesso URN non creano 2 job

**MERL-T:**
- `tests/scripts/test_load_seed_libro_iv.py` — idempotency (run 2x, count nodi non raddoppia), batch merge corretto
- `tests/storage/test_subgraph.py` — ego-network depth=1, depth=2, limit cutoff
- `tests/worker/test_ingest_article_task.py` — successo, retry, failure

### 9.2 Integration (vitest + supertest + Postgres test DB + MERL-T mock)

`backend/tests/integration/merlt/graph/`
- `lazy-ingestion-flow.test.ts` — full E2E: event→check→job→poll→complete (MERL-T mockato con nock)
- `idempotency.test.ts` — 5 richieste concorrenti sullo stesso URN → 1 job in DB
- `job-failure.test.ts` — worker fail → status='failed' + errorMessage popolato

### 9.3 Frontend (vitest)

`frontend/src/features/merlt/graph/__tests__/`
- `useArticleGraph.test.ts` — fetch + invalidation on job completion
- `useIngestionJob.test.ts` — polling 2s, stops on terminal status, cleanup on unmount
- `ArticleGraphPanel.test.tsx` — render states (loading/building/ready/empty/error)
- `CytoscapeView.test.tsx` — node click → emit event, hover → tooltip (jsdom mock per cytoscape)

### 9.4 Smoke E2E manuale

Estensione di `docs/merlt-smoke-checklist.md`:
1. `./start.sh` con MERL-T enabled — verifica seed loader completed
2. Apri art. 2043 c.c. → grafo immediato, 20+ nodi visibili
3. Apri art. 73 c.p. → skeleton + "Sto indicizzando...", poi grafo dopo ~60s
4. Apri articolo inesistente → "Articolo non indicizzabile"
5. Query SQL `SELECT * FROM merlt_ingestion_jobs ORDER BY created_at DESC LIMIT 5;` per audit
6. Verifica Cytoscape interaction: zoom, pan, click su nodo Norma → naviga ad articolo collegato

### 9.5 Soglia "done" Slice 2a

- Unit + integration coverage ≥80% su `services/merlt/graphClient`, `routes/merlt/graph`, `worker/tasks/ingest_article`, `scripts/load_seed_libro_iv`
- Smoke checklist completata + screenshot allegati al PR
- Boot iniziale del seed ≤6 min su macchina locale
- Lazy ingestion median ≤90s su articolo "standard" (1 articolo + 2-3 commi + Brocardi)

---

## 10. Done criteria Slice 2a

1. ✅ `./start.sh` esegue seed loader idempotente. Boot iniziale popola FalkorDB (27.700+ nodi) + Qdrant (5.900+ punti) + bridge_table (27.000+ righe). Boot successivi: skip in <5s.
2. ✅ Endpoint MERL-T `/api/v1/graph/{check-article,ingest-article,subgraph}` funzionanti, testati con curl.
3. ✅ BFF endpoint `/api/merlt/graph/{article/:urn, ingest, jobs/:id/status}` funzionanti con Zod validation + idempotency.
4. ✅ Prisma model `MerltIngestionJob` + migration applicata. Audit trail completo.
5. ✅ Frontend **side rail** collassabile in `ArticleTabContent` (depth=1, ≤25 nodi). Pulsante "Esplora" → naviga a `/grafo?urn=<center>&depth=2`.
6. ✅ Frontend pagina **`/grafo`**: search URN/testo + autocomplete, Cytoscape full-canvas, NodeDetailsDrawer, click-to-recenter, BreadcrumbHistory, DepthSelector 1/2/3, layout picker COSE/dagre, deeplink params funzionanti.
7. ✅ Lazy ingestion: apertura di art. fuori seed → skeleton → grafo dopo job completion. Polling stoppa correttamente. Anche da pagina `/grafo` se l'utente cerca un URN non in grafo.
8. ✅ Failure modes coperti: job timeout, MERL-T down, articolo inesistente, retry esauriti.
9. ✅ Worker Arq running in container `merlt-worker` separato. Health check verde.
10. ✅ Plugin host: feature flag `VITE_FEATURE_MERLT_GRAPH=false` → side rail + pagina `/grafo` nascosti, resto MERL-T (Slice 1) funziona.
11. ✅ Test piramide (unit + integration + frontend) verdi. Smoke E2E manuale completato su ENTRAMBE le superfici.
12. ✅ Doc: `CLAUDE.md` aggiornato (sezione Slice 2a), `docs/merlt-smoke-checklist.md` esteso, `docs/legacy-libro-iv-seed.md` creato (spiega come riprodurre il recovery).

---

## 11. Out of scope (Slice 2b+)

**Slice 2b — Laboratorio RLCF:**
- Proposal layer: UI per proporre creazione/modifica/cancellazione di entità e relazioni.
- Voting weighted by `user_domain_authority`.
- Review queue per moderatori ad alta authority.
- Issue reporting su entità/relazioni canoniche.
- **Schema già pronto**: `pending_entities/relations/amendments`, `entity_votes/relation_votes/amendment_votes`, `entity_issue_reports/relation_issue_reports` esistono già nello schema RLCF recuperato. Slice 2b si riduce a adapter + controller + UI, non progettazione da zero.
- Bonus dell'`pending_amendments` recuperato: granularità sub-articolo (`commi_disposizione[]`, `lettere_disposizione[]`, `numeri_disposizione[]`) — perfetta per la tecnica legislativa italiana.

**Slice 2c — Devil's Advocate sul grafo:**
- Trigger automatico per sfidare proposte ad alto consenso.
- Schema `devils_advocate_assignments` esiste ma ancorato a `legal_tasks` (per Q&A originale). Va ri-ancorato al grafo (vedi gotcha schema RLCF #2 in memoria).

**Slice 3+:**
- Q&A multi-expert UI
- Admin/training dashboard
- Document upload → ingestion

---

## 12. Open questions / decisioni deferred

1. **Worker container separato vs in-process MERL-T API**: scelto separato per scaling futuro. Se l'overhead docker è troppo per dev locale, si può unificare via env var `MERLT_WORKER_INLINE=true` come fallback.
2. **Cancellation di job in coda**: nice-to-have. Per ora nessuna API; l'utente può aspettare il timeout. Da valutare se l'UX scopre necessario.
3. **Layout default Cytoscape**: COSE per default (force-directed bello per leggibilità). User-toggle per dagre (gerarchico) può venire dopo se utile.
4. **Refresh forzato (re-ingestion)**: Slice 2a non espone "rigenera questo articolo" all'utente — solo `force_refresh: true` nell'API interna. Va valutato per Slice 2b/admin.
5. **TTL grafo**: i nodi/archi del seed sono "stabili", ma quelli da lazy ingestion del 2025 potrebbero invecchiare. Decidere policy di refresh ricorrente in Slice 2c+.
6. **Seed update flow**: se MERL-T riceve un nuovo seed (es. estendiamo a Libro III CC), come gestiamo l'aggiornamento? Per ora: il loader fa MERGE, quindi un nuovo seed con nodi aggiuntivi si aggiunge senza distruggere quelli esistenti. Open: come gestire DELETE di nodi obsoleti — da definire se serve.

---

## 13. Files coinvolti — summary

**Da creare (~24 files):**

MERL-T:
- `merlt/scripts/load_seed_libro_iv.py`
- `merlt/worker/{__init__,arq_worker}.py`
- `merlt/worker/tasks/{__init__,ingest_article}.py`
- `merlt/storage/graph/subgraph.py`
- `merlt/services/job_callback.py`

BFF:
- `backend/src/routes/merlt/graph.ts`
- `backend/src/services/merlt/graphClient.ts`
- `backend/src/schemas/merlt/graph.ts`

Frontend — shared:
- `frontend/src/features/merlt/graph/shared/{CytoscapeView,graphStyles,graphTransform,useArticleGraph,useIngestionJob}.{tsx,ts}`

Frontend — side rail:
- `frontend/src/features/merlt/graph/side-rail/{ArticleGraphSideRail,CollapseToggle}.tsx`

Frontend — pagina `/grafo`:
- `frontend/src/features/merlt/graph/page/{GraphExplorerPage,GraphSearchBox,NodeDetailsDrawer,DepthSelector,BreadcrumbHistory}.tsx`

Docs:
- `docs/legacy-libro-iv-seed.md` (procedura di riproduzione del recovery, per devops)

**Da modificare:**
- `merlt/api/lifespan.py`
- `merlt/api/graph_router.py`
- `backend/src/routes/merlt/events.ts` (aggiunge check + job creation)
- `backend/prisma/schema.prisma` (+ migration `add_merlt_ingestion_job`)
- `frontend/src/App.tsx` (+ route `/grafo`)
- `frontend/src/components/layout/Sidebar.tsx` (+ entry "Grafo" icona Network)
- `frontend/src/plugins/registry.tsx` (slot `article_side_rail`)
- `frontend/src/components/features/search/ArticleTabContent.tsx`
- `docker-compose.merlt.yml` (nuovo servizio `merlt-worker`)
- `start.sh` (gate health worker)
- `frontend/package.json` (+ cytoscape, cose-bilkent, dagre, react-cytoscapejs)
- `CLAUDE.md`
- `docs/merlt-smoke-checklist.md`

**Da eliminare:** nessuno.

---

*Design draft. In attesa di review utente sezione per sezione prima di scendere nel writing-plans skill per la sprint plan dettagliata (MERLT-2a.1 → 2a.9).*
