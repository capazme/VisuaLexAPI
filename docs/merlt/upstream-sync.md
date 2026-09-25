# MERL-T Upstream Sync Policy

**Created:** 2026-05-22 (Story MERLT-1.0)
**Status:** Active policy

---

## Single source of truth

Da questo momento, **`VisuaLexAPI/merlt/`** è la single source of truth per il codice MERL-T usato in produzione VisuaLex.

`/Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/` resta come **reference read-only**: storico di sviluppo, snapshot completo (incluso `data/` 317 MB, `models/`, `examples/`, ecc.).

**Baseline import**: tag git `merlt-baseline-from-alis-core` segna il commit di prima copia. Riferimento per audit/regression.

---

## Cosa è stato copiato

`VisuaLexAPI/merlt/` (~5.5 MB, 328 file) contiene tutto il codice Python necessario al runtime:

```
merlt/
├── merlt/              codice Python (api/, app.py, experts/, rlcf/, storage/, ner/, pipeline/, ...)
├── alembic/            DB migrations
├── alembic.ini         Alembic config
├── scripts/            utility scripts
├── config/             config YAML (experts, prompts, etc.)
├── Dockerfile          multi-stage build
├── pyproject.toml      Python deps
├── docker-compose.dev.yml  (compose interno MERL-T, NON usato dal nostro start.sh)
├── api-contract.json   OpenAPI schema (235 KB)
├── docs/               docs MERL-T (architecture/, api/, rlcf/, thesis/, claude-context/, guides/, plans/)
├── README.md, CLAUDE.md, LICENSE
├── tests/              suite mirata alle funzioni integrate in VisuaLex (job CI `merlt`)
├── bandit.yaml, .gitignore, .dockerignore
├── uploads/            runtime dir (uploads/user_documents/)
└── start_dev.sh        script MERL-T standalone (NON usato dal nostro start.sh)
```

## Cosa NON è stato copiato (e perché)

| Path | Size | Motivo esclusione |
|------|------|-------------------|
| `data/` | 317 MB | Knowledge graph + embeddings — ricostruibili, non source code |
| `.venv/` | ~100 MB | Virtual environment — ricreabile via `pip install` |
| `models/` | 32 KB | Contiene `legal_ner_checkpoints/` (NER weights) — ricreabile via training |
| `tests/` | 20 MB | Test pesanti MERL-T standalone, non copiati. L'attuale `merlt/tests/` è un'altra cosa: una suite mirata alle funzioni integrate in VisuaLex, che gira nel job CI `merlt`. |
| `examples/` | 964 KB | Script di sviluppo/test one-off |
| `exports/` | 992 KB | Artifact di export precedenti |
| `docs/experiments/` | 29 MB | Notebooks + risultati esperimenti — reference solo in ALIS_CORE |
| `docs/archive/` | 4.7 MB | Doc archiviati |
| `docs/backup_*/` | 144 KB | Backup precedenti |
| `merlt.egg-info/` | 28 KB | Egg metadata — rigenerabile via `pip install -e .` |
| `.pytest_cache/`, `.ruff_cache/`, `.benchmarks/` | misc | Cache, rigenerabili |
| `__pycache__/`, `*.pyc` | misc | Bytecode Python |
| `.env` | — | Mai committare secrets |
| `frontend-audit.json`, `norma.log`, `trace_output.json` | misc | File runtime/audit one-off |

**Strategia globale**: portiamo codice + config + docs essenziali + API contract. Tutto il resto (dati, modelli, cache, virtual env) si ricostruisce localmente con setup standard.

---

## Procedura di sync con upstream ALIS_CORE

**Quando**: solo se ALIS_CORE/merlt riceve fix critici (bug, security) che vogliamo portare in VisuaLex. Le evoluzioni feature di MERL-T (es. nuovi expert, NER models) restano in VisuaLex come fork dal momento dell'import.

**Procedura**:

1. Dal repo VisuaLexAPI, branch dedicato:
   ```bash
   git checkout -b merlt-upstream-sync-YYYY-MM-DD
   ```

2. Rsync selettivo. **IMPORTANTE**: usa pattern con `/` davanti per ancorare al root, altrimenti rsync matcha ovunque (es. `data/` matcherebbe anche `merlt/disagreement/data/` che contiene codice Python!). Fix scoperto in commit `ef2bd25` (Story MERLT-1.0):
   ```bash
   rsync -a --dry-run \
     --exclude='/data/' \
     --exclude='/.venv/' \
     --exclude='/models/' \
     --exclude='/tests/' \
     --exclude='/examples/' \
     --exclude='/exports/' \
     --exclude='/merlt.egg-info/' \
     --exclude='docs/experiments/' \
     --exclude='docs/archive/' \
     --exclude='docs/backup_*/' \
     --exclude='.pytest_cache/' \
     --exclude='.ruff_cache/' \
     --exclude='.benchmarks/' \
     --exclude='__pycache__/' \
     --exclude='*.pyc' \
     --exclude='.env' \
     --exclude='.DS_Store' \
     --exclude='*.log' \
     --exclude='trace_output.json' \
     --exclude='frontend-audit.json' \
     --exclude='.claude-doc-trigger.json' \
     /Users/gpuzio/Desktop/CODE/ALIS_CORE/merlt/ \
     ./merlt/
   ```
   (rimuovi `--dry-run` per applicare)

   **Pattern senza `/` davanti** (es. `__pycache__/`, `*.pyc`) sono globali e devono restare così — vogliamo escluderli ovunque appaiano.

   **Pattern con `/` davanti** sono ancorati al root della source rsync (cioè a `ALIS_CORE/merlt/`). Vanno usati per escludere SOLO il top-level e non i sub-package omonimi.

3. Review del diff:
   ```bash
   git diff --stat merlt/
   git diff merlt/ | less
   ```

4. Se ci sono modifiche locali in VisuaLex che vanno PRESERVATE (es. fix specifici al BFF integration), risolvere manualmente.

5. Commit + PR verso `visualex-merlt-main` (NON main):
   ```bash
   git commit -m "chore(merlt): sync from upstream ALIS_CORE YYYY-MM-DD"
   ```

6. Smoke E2E manuale + test suite verde prima di merge.

7. Aggiornare il tag baseline se è un import "major":
   ```bash
   git tag -a merlt-baseline-from-alis-core-vN -m "Major sync from ALIS_CORE YYYY-MM-DD"
   ```

---

## Anti-drift safeguards

1. **`docs/merlt/upstream-sync.md`** (questo doc): leggere prima di qualsiasi modifica strutturale a `merlt/`.
2. **Tag baseline** `merlt-baseline-from-alis-core` — riferimento per audit (`git diff merlt-baseline-from-alis-core -- merlt/`).
3. **CODEOWNERS** (futuro, opzionale): assegnare review obbligatorio per modifiche a `merlt/`.

---

## Note

- Il `docker-compose.dev.yml` interno a `merlt/` è MERL-T standalone (per dev MERL-T isolato). Il nostro flusso VisuaLex usa **`docker-compose.merlt.yml` nella root del repo**: 4 dipendenze sempre attive (postgres, redis, falkordb, qdrant) più 3 servizi sotto il profilo `api-in-docker`, che è il default di `start.sh` (`mcp-legal-it`, `merlt-api`, `merlt-worker`).
- `start_dev.sh` interno a `merlt/` analogamente NON viene usato. Il nostro `start.sh` root usa i container. Nella modalità sviluppatore (`MERLT_API_IN_DOCKER=false`) avvia invece `uvicorn merlt.app:app` più un `rq worker` locale sulle tre code, dall'interprete `MERLT_PYTHON`.
- Se `ALIS_CORE/merlt` viene cancellato/spostato, NULLA cambia in VisuaLex: `merlt/` è autocontenuto. Per ricostruire `data/` serve documentazione separata (riferirsi a `merlt/docs/`).

## Divergenze locali da ri-applicare in upstream (Slice 2c — staging "Apprendi dai miei appunti")

Queste modifiche al `merlt/` vendorizzato **sono già deployate sullo stack live locale** (rebuild `visualex-merlt-api`+`worker`; tabella creata al boot via lifespan `create_tables()`, niente Alembic manuale necessario sul live ma la migrazione 005 resta per parità/prod) e vanno portate in upstream `ALIS_CORE/merlt`:
- `merlt/storage/enrichment/models.py` — nuovo modello `ExtractionCandidate` (tabella `extraction_candidates`).
- `alembic/versions/005_add_extraction_candidates.py` — migrazione (down_revision `004_add_weight_versions_table`).
- `merlt/pipeline/document_parser.py` — param `persist_target` ("pending" | "staging") + `document_id`; branch che scrive `ExtractionCandidate` invece di `PendingEntity`.
- `merlt/worker/extraction_tasks.py` — task RQ `extract_to_staging` (coda `merlt_extract`, callback BFF `/api/merlt/internal/extraction-callback`, env `BFF_EXTRACTION_CALLBACK_URL`).
- `merlt/api/document_router.py` — endpoint `POST /documents/{id}/extract-async`, `GET /documents/{id}/candidates`, + nuovo `candidates_router` (`GET /candidates/{id}`, `POST /candidates/{id}/mark-promoted`). Wired in `merlt/api/__init__.py` + `merlt/app.py`.
- `docker-compose.merlt.yml` — 3 fix scoperti durante lo smoke live: (a) `merlt-api` env `RQ_REDIS_URL: redis://merlt-redis:6379/1` (l'api accoda, non solo il worker); (b) worker `command` → `rq worker merlt_ingest merlt_extract` (oggi `merlt_ingest merlt_extract merlt_ner_train`, dopo il Loop β #2); (c) worker env `BFF_EXTRACTION_CALLBACK_URL`. Inoltre: RQ job_id non può contenere `:` (usato `extract-`+sha256), e il worker chiama `init_db()` (niente lifespan).
- Deploy fatto: `docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker && up -d`. Verifica: 4 endpoint in OpenAPI, `extract-async` 202 + worker processa `merlt_extract`, pytest `tests/pipeline/test_extraction_staging.py` 2 passed (in-container). E2E positivo completo (PDF reale→LLM→promote) richiede BFF Node up + chiave LLM.
- Gap-closure (deployata): `document_parser.py` ora setta `expires_at` (env `MERLT_STAGING_TTL_HOURS`) e chiama `EntityDeduplicator.find_duplicates` (best-effort) per `potential_duplicate_of`; `worker/extraction_tasks.py` cancella il file caricato a estrazione completata; `document_router.list_document_candidates` fa lazy-purge di promoted+expired. Nessun nuovo file MERL-T (modifiche ai 3 già elencati).
- #5 (estrazione relazioni da testo libero): *nota storica superata.* Al momento della Slice 2c non era implementata. Dal loop-closure B1 lo è: il worker chiama `parse_document(extract_relations=True)`, che scrive `ExtractionCandidate(candidate_type="relation")` passando da `canonical_relation_type`.

## Divergenze locali della sessione 2026-09-25 (da valutare per upstream)

Tutte in `merlt/`, già nell'immagine dopo il rebuild. `ALIS_CORE/merlt` non le ha.

**Enrichment e provenienza**

- **`confirm-source`.** Nuova route `POST /api/v1/enrichment/confirm-source` in `merlt/api/enrichment_router.py`, con i modelli in `api/models/enrichment_models.py`. Valida il nodo `live:`; ingerisce un articolo Normattiva con l'helper di enqueue condiviso (estratto da `graph_router.ingest_article`, stesso job id `ingest-`); trasforma le altre fonti in pending entity passando dai gate di `propose_entity`. Test: `tests/api/test_confirm_source.py`. (`553a968`)
- **Colonna `source_reference`.** Nuova colonna su `pending_entities` e `pending_relations`, per la provenienza della promozione: Alembic `007_add_pending_source_reference.py` e SQL `storage/migrations/003_pending_source_reference.sql`. `get_pending` restituisce `created_at` UTC reale e la reference. `validate_relation` ricalcola l'authority dopo il consenso. (`553a968`)
- **Estremi delle relazioni.** Sono risolti in staging (`pipeline/document_parser.py`) e scritti per MATCH al consenso (`_write_relation_to_graph`, `_write_deferred_relations_for_entity`). Gli helper stanno in `storage/graph/relation_endpoints.py`. `target_entity_id` passa a `varchar(300)` (Alembic `008_relation_endpoints.py`, `storage/migrations/004_relation_endpoints.sql`). (`c7d0844`)
- **Proposte di relazione.** Il valore wire risolto sostituisce l'Enum. `entity_writer.PLACEHOLDER_ARTICLE_URNS` impedisce che `user_document` diventi una `:Norma`. Le estrazioni fallite mandano una callback `failed`. (`9365353`)

**Boot**

- **`api/api_key_seed.py`.** Semina `MERLT_ADMIN_API_KEY` come chiave `admin` al boot, dal lifespan in `app.py`. (`af803d9`)
- **`storage/enrichment/schema_additions.py`.** `ensure_schema_additions()` al boot, con `ADD COLUMN IF NOT EXISTS` e l'allargamento di `target_entity_id`. Serve perché lo stack live si crea con `create_tables()` e non esegue Alembic. (`553a968`, `c7d0844`)

**Qualità dei dati**

- **Retriever.** La lunghezza del path più corto è letta dal livello giusto del dict (`storage/retriever/retriever.py`). Prima ogni path valeva 0. (`af803d9`)
- **Suffissi degli URN.** In `utils/urn_labels.py` la lista dei suffissi è completa, dalla più lunga alla più corta, con un confine a destra. Prima `2409-terdecies` diventava `2409-ter`. (`af803d9`)
- **Abbreviazioni dei codici.** Il parser dell'ingestion meccanica usa una tabella esplicita, `_CODE_ABBREVIATIONS` in `pipeline/mechanical_ingestion/parser.py`, al posto delle iniziali: «codice del consumo» non è più «c.c.». (`af803d9`)
- **Tolleranza ai conflitti.** Un «Art. N» nudo di una Norma stub non è più un `urn_conflict` contro «Art. N c.c.» dell'adapter (`pipeline/mechanical_ingestion/conflict_report.py`). Le scritture di stato dei batch sono condizionali (`api/ingestion_mechanical_router.py`). (`af803d9`, `2a1d1f4`)

**RLCF e Q&A**

- **Replay buffer.** Viene reidratato da `rlcf/buffer_rehydration.py` quando al boot non c'è un file. Lo salvataggio è durevole e con debounce (`rlcf/training_scheduler.py`, `MERLT_RLCF_BUFFER_PATH`). Test: `tests/rlcf/`. (`abec0f4`)
- **Modalità forzata.** `orchestrator.process(forced_mode)` → `AdaptiveSynthesizer.synthesize(forced_mode=...)`. È un override per richiesta, mai scritto nella config condivisa. Il peso parziale è quello di routing. La lookup di provenienza trova i nodi provvisori per `source_url`. `coevo_served_keys` sta in `full_trace`. (`abec0f4`)
- **`CORRELATO`.** È mappato in `GRAPH_TO_POLICY_RELATION` (`rlcf/policy_gradient.py`). (`75794f5`)
- **Storico delle policy.** `GET /rlcf/policies/history` legge `weight_versions` tramite `WeightStore.list_versions` (`weights/store.py`). (`23bdc47`)

**Grafo e vettori**

- **Collection Qdrant.** Un solo default, `storage/vectors/collection.default_chunks_collection()`, usato da retriever, graph router, pipeline router, dashboard, provisional writer e bootstrap. (`2a1d1f4`)
- **Nome del grafo.** In `storage/graph/config.py` il default è `merl_t_legal`, come quello del seed loader. (`af803d9`)
- **Igiene.** `HUMAN_SIGNAL_PREDICATE` in `pipeline/hygiene.py` fa sì che un nodo garantito con confirm-source non venga mai potato. (`62318b8`)

**NER e pacchetto**

- **NER.** Baseline A/B reale, report persistito e route `GET /ner/training/report/latest` (`worker/ner_training_tasks.py`, `api/ner_router.py`). (`7e3782e`)
- **Packaging.** `pyproject.toml` richiede `sqlalchemy[asyncio]` (greenlet). Il `Dockerfile` copia `tests/` e installa pytest. (`142d25a`, `195b885`)

