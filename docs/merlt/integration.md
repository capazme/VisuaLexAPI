# MERL-T: runbook di integrazione

MERL-T è il sidecar FastAPI (grafo giuridico + RLCF) che esiste solo sul branch `visualex-merlt-main`. Il browser non lo chiama mai: tutto passa dal BFF Node su `/api/merlt/*`.

Questo documento porta da un clone vuoto a uno stack funzionante e spiega come verificare ogni superficie. Per il resto:

- la mappa delle route è in [contract-matrix.md](./contract-matrix.md);
- l'architettura è in [blueprint.md](./blueprint.md);
- la checklist manuale completa è in [smoke-checklist.md](./smoke-checklist.md).

## 1. Cosa gira

`docker-compose.merlt.yml` definisce 7 servizi. Tutte le porte host sono legate a `127.0.0.1`.

| Servizio | Porta host | Quando parte |
|---|---|---|
| `merlt-postgres` | 5436 | sempre |
| `merlt-redis` | 6381 | sempre |
| `merlt-falkordb` | 6382 | sempre |
| `merlt-qdrant` | 6343 (gRPC 6344) | sempre |
| `mcp-legal-it` | 8011 | profilo `api-in-docker` |
| `merlt-api` | 8000 | profilo `api-in-docker` |
| `merlt-worker` | nessuna (RQ su `merlt_ingest merlt_extract merlt_ner_train`) | profilo `api-in-docker` |

- **Il BFF** (Node, :3001) gira sull'host e raggiunge MERL-T su `MERLT_API_URL` (`http://localhost:8000`).
- **api e worker** chiamano il BFF e l'API Python (:5000) tramite `host.docker.internal`, grazie a `extra_hosts: host-gateway`, necessario su Linux.
- **mcp-legal-it** è un submodule git in `vendor/mcp-legal-it`, e compose lo costruisce da lì.

## 2. Da zero

Prerequisiti del prodotto base: Docker con Compose v2, Node con npm 11 (la CI usa Node 24), Python per `.venv`, un Postgres per il BFF. Per le funzioni LLM serve anche una chiave OpenRouter.

1. **Clona e prendi il branch.**
   ```bash
   git clone <url> VisuaLexAPI && cd VisuaLexAPI
   git checkout visualex-merlt-main
   ```

2. **Inizializza il submodule.** `start.sh` lo fa da solo quando trova la cartella vuota; per farlo a mano:
   ```bash
   git submodule update --init --recursive vendor/mcp-legal-it
   ```

3. **Prepara il prodotto base.** `start.sh` controlla che `.venv` esista, che importi `redis` e `playwright`, e che Chromium sia installato.
   ```bash
   python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
   (cd backend && npm ci) && (cd frontend && npm ci)
   ```
   Usa npm 11. Con npm 10, `npm ci` fallisce sui lockfile scritti da npm 11 (`Missing: @esbuild/... from lock file`) e `npm install` li riscrive.

4. **Crea `backend/.env` dall'esempio.**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Poi imposta questi valori:
   - `DATABASE_URL` e `JWT_SECRET`, per il BFF.
   - `MERLT_INTERNAL_SECRET`. L'esempio usa già `dev-internal-secret`, lo stesso default di compose. Se lo cambi, `start.sh` rilegge il valore da `backend/.env` e lo esporta anche a compose, così i due lati restano allineati.
   - `MERLT_API_KEY`: una stringa lunga e casuale. `start.sh` la esporta anche come `MERLT_ADMIN_API_KEY`, e merlt-api la registra al boot come chiave `admin` (per hash, in modo idempotente). Senza chiave, training RLCF e ingestion meccanica rispondono 401 upstream, cioè 503 lato BFF.
   - `MERLT_ENABLED` può restare `"false"`. `MERLT_ENABLED=true ./start.sh` vince comunque, perché dotenv non sovrascrive una variabile già presente nell'ambiente.

5. **Dai la chiave LLM a compose.** Compose legge `OPENROUTER_API_KEY` dalla shell o dal `.env` nella root del repo, che carica da solo. Il modello completo con tutte le variabili di compose è [`.env.merlt.example`](../../.env.merlt.example). Senza chiave il Q&A e l'estrazione dagli appunti non funzionano.

6. **Avvia.** La modalità `api-in-docker` è il default. `ADMIN_PASSWORD` serve solo al primo avvio, per creare l'utente admin.
   ```bash
   ADMIN_PASSWORD='<una password>' MERLT_ENABLED=true ./start.sh
   ```
   Il primo `docker compose --profile api-in-docker up -d` costruisce le immagini (merlt-api e merlt-worker condividono lo stesso build context). L'esempio stima circa 5 minuti: pesano le wheel torch CPU e il modello spaCy `it_core_news_lg`.

   Al primo boot merlt-api carica anche il seed Libro IV (circa 27.7k nodi), e ci mette qualche minuto. Il gate di `start.sh` aspetta 60 s per default e, allo scadere, stampa l'errore e prosegue. Per il primo avvio conviene alzarlo:
   ```bash
   ADMIN_PASSWORD='<una password>' MERLT_ENABLED=true MERLT_HEALTH_TIMEOUT=600 ./start.sh
   ```

7. **Cosa controlla il gate.** `start.sh` interroga `curl -fsS http://localhost:8000/health` finché risponde. MERL-T risponde 200 appena finisce il lifespan, anche con `"status": "degraded"`: il gate prova che l'api è partita, non che le dipendenze siano sane. Subito dopo, lo script stampa un errore se `merlt-worker` non è `running`. Senza worker, ingestion lazy, estrazione appunti e training NER restano «in corso» fino al watchdog.

## 3. Verifica, superficie per superficie

Stack e dipendenze:

```bash
docker compose -f docker-compose.merlt.yml --profile api-in-docker ps
curl -s http://localhost:8000/health
curl -s http://localhost:3001/api/merlt/health
docker inspect visualex-merlt-worker --format '{{join .Config.Cmd " "}}'
docker logs visualex-merlt-api 2>&1 | grep -E "Admin API key|seed_loader|Graph hygiene loop"
```

- **`/health` di MERL-T** riporta `dependencies` (postgresql, falkordb, qdrant, redis) e `graph.nodes`.
- **`/health` del BFF** risponde `{"bff":"ok","merlt":"reachable","upstream":{...}}`, oppure 503 `unreachable`.
- **Il comando del worker** deve contenere tutte e tre le code.
- **I log** mostrano la chiave admin seminata, il seed caricato (o saltato perché il grafo c'è già) e il loop di igiene avviato.

Poi, nel browser (`http://localhost:5173`, dopo il login):

1. **Hub `/merlt` («Assistente» nella sidebar).** Imposta il consenso con «Gestisci». La card Profilo legge `GET /api/merlt/profile`; la card Grafo mostra i nodi presi da `/health`.
2. **Tracking.** Con consenso Base, leggi un articolo per almeno 3 s oppure scorrine almeno il 30 %. DevTools mostra `POST /api/merlt/events/article-viewed` con risposta 202. La riga arriva in `tracking_events` di MERL-T:
   ```bash
   docker exec -it visualex-merlt-postgres psql -U merlt -d merlt \
     -c "SELECT event_type, user_id, created_at FROM tracking_events ORDER BY created_at DESC LIMIT 5;"
   ```
3. **Grafo.**
   - Nell'articolo, la linguetta «Grafo» apre il side rail.
   - La voce «Grafo» della sidebar apre `/grafo`.
   - Se l'articolo non è nel grafo, parte l'ingestion (`POST /api/merlt/graph/ingest`, poi polling di `/graph/jobs/:id/status`).
4. **Q&A su `/grafo`.**
   - Con consenso Base si può chiedere (`POST /api/merlt/experts/query/async`, poi polling di `/experts/jobs/:id/status`).
   - Con Completo compaiono anche i canali di insegnamento: 👍/👎, valutazione dettagliata, pertinenza delle fonti, «Mi convince», «Ricorda nel grafo».
   - «Approfondisci questa risposta» chiama `POST /api/merlt/experts/refine`.
5. **Contributi `/merlt/contribuisci`** (consenso Completo): upload, estrazione, revisione, promozione.
6. **Validazione `/merlt/valida`** (consenso Completo): voto sulle proposte, più la revisione dei nodi provvisori (`/graph/provisional-review`).
7. **Admin.**
   - Card «Ops (admin)» nell'hub: training RLCF, «Esegui pulizia del grafo», NER.
   - Card «Regolazione motore (admin)»: config e riavvio del motore.
   - Tab «Ingestione» in `/admin`: batch di ingestion meccanica.

Il dettaglio di ogni passo, con le chiamate di rete attese, è in [smoke-checklist.md](./smoke-checklist.md).

## 4. Variabili d'ambiente

### BFF (`backend/.env`)

| Variabile | Default | A cosa serve |
|---|---|---|
| `MERLT_ENABLED` | `true` nel codice, `"false"` nell'esempio | Kill switch dell'intero `/api/merlt` (404 `merlt_disabled`) |
| `MERLT_API_URL` | `http://localhost:8000` | Base URL di MERL-T |
| `MERLT_API_KEY` | vuota | Inviata come `X-API-Key` da ogni client. Obbligatoria solo per `/rlcf/training/start` e `/ingestion/mechanical/*` |
| `MERLT_TIMEOUT_MS` | 5000 nei client se assente (l'esempio mette 60000) | Timeout di merltClient, graphClient, opsClient, opsIngestionClient |
| `MERLT_EXPERTS_TIMEOUT_MS` / `MERLT_EXPERTS_ASYNC_TIMEOUT_MS` | 120000 / 10000 | Q&A sync / submit async |
| `MERLT_NER_TIMEOUT_MS` | 10000 | nerClient |
| `MERLT_CONTRIB_TIMEOUT_MS` | poi `MERLT_TIMEOUT_MS`, poi 30000 | contribClient |
| `MERLT_GRAPH_ENABLED`, `MERLT_CONTRIBUTION_ENABLED`, `MERLT_VALIDATION_ENABLED`, `MERLT_OPS_ENABLED` | `true` | Sotto-flag per gruppo di route (vedi [contract-matrix.md](./contract-matrix.md)) |
| `MERLT_INTERNAL_SECRET` | `dev-internal-secret` nell'esempio | Autentica le tre callback `/internal/*`. Deve essere uguale al valore di compose |
| `MERLT_SUBGRAPH_CACHE_TTL_MS` / `MERLT_SUBGRAPH_CACHE_MAX_ENTRIES` | 120000 (limitato a 60000..300000) / 200 | Cache di `/graph/article/:urn` |
| `MERLT_INGEST_STALE_MS` | 600000 | Rete del watchdog e supersede di `lazyIngest` |
| `MERLT_EXTRACT_STALE_MS` | 2700000 | Rete per l'estrazione appunti (deve superare il `job_timeout` RQ di 1800 s) |
| `MERLT_QA_STALE_MS` / `MERLT_QA_RETENTION_DAYS` | 1200000 / 30 | Rete Q&A (su `updatedAt`) e purge dei job terminati |
| `MERLT_DEAD_LETTER_DIR` | `backend/logs` | Dove finisce `merlt-dead-letter.jsonl` |

### Compose (shell o `.env` nella root; modello in `.env.merlt.example`)

| Variabile | Default | Servizio |
|---|---|---|
| `MERLT_POSTGRES_DB` / `_USER` / `_PASSWORD` | `merlt` | postgres, api, worker |
| `MERLT_POSTGRES_PORT`, `MERLT_REDIS_PORT`, `MERLT_FALKOR_PORT`, `MERLT_QDRANT_PORT`, `MERLT_QDRANT_GRPC_PORT`, `MERLT_API_PORT`, `MCP_LEGAL_IT_PORT` | 5436, 6381, 6382, 6343, 6344, 8000, 8011 | porte host |
| `MERLT_INTERNAL_SECRET` | `dev-internal-secret` | api, worker |
| `MERLT_API_KEY` → `MERLT_ADMIN_API_KEY` | vuota (la seed viene saltata) | api (chiave admin seminata al boot) |
| `OPENROUTER_API_KEY` | vuota | api, worker |
| `MERLT_GRAPH_NAME` / `MERLT_QDRANT_COLLECTION` | `merl_t_legal` / `merl_t_legal_chunks` | api, worker |
| `MERLT_SKIP_SEED` / `MERLT_SKIP_EMBEDDINGS` | `false` / `true` | api (il worker ha sempre `MERLT_SKIP_SEED=true`) |
| `MERLT_EXTRACT_JOB_TIMEOUT` | 1800 | api, perché è chi accoda |
| `MERLT_HYGIENE_INTERVAL_HOURS` | 24 (0 nel codice = spento) | api |
| `MERLT_NEURAL_TRAVERSAL_ENABLED`, `MERLT_REACT_ENABLED`, `MERLT_SEMANTIC_SEARCH_ENABLED`, `MERLT_ADVANCED_ROUTING_ENABLED` | `true` | api, worker |
| `MERLT_BFF_CALLBACK_URL`, `MERLT_BFF_EXTRACTION_CALLBACK_URL` / `MERLT_BFF_QA_CALLBACK_URL` | `http://host.docker.internal:3001/api/merlt/internal/...` | worker / api |

Alcuni valori sono fissi nel file compose e non vengono letti dall'ambiente:

- `MERLT_NER_LEARNED_ENABLED=false`;
- `MERLT_RLCF_BUFFER_PATH=/app/checkpoints/rlcf/replay_buffer.json`;
- `MCP_LEGAL_IT_URL=http://mcp-legal-it:8011/mcp`;
- `VISUALEX_API_URL=http://host.docker.internal:5000`;
- `RQ_REDIS_URL=redis://merlt-redis:6379/1`;
- FalkorDB con `FALKORDB_ARGS` di persistenza e volume su `/var/lib/falkordb/data`.

### `start.sh`

| Variabile | Default | Effetto |
|---|---|---|
| `MERLT_ENABLED` | `false` | Accende il sidecar |
| `MERLT_API_IN_DOCKER` | `true` | api, worker e mcp-legal-it in container. Implica `MERLT_COMPOSE_ENABLED=true` |
| `MERLT_COMPOSE_ENABLED` | `false` (forzato a `true` dalla modalità docker) | Avvia le dipendenze con compose |
| `MERLT_HEALTH_TIMEOUT` | 60 | Secondi di attesa di `:8000/health` |
| `MERLT_PORT` / `MERLT_ROOT` / `MERLT_COMPOSE_FILE` | 8000 / `./merlt` / `./docker-compose.merlt.yml` | |
| `MERLT_PYTHON` | `merlt/.venv/bin/python` se esiste, altrimenti `python` | Interprete della modalità locale |
| `ADMIN_PASSWORD` | vuota | Se impostata, esegue `npm run db:seed` (crea l'admin) |

### Frontend

`VITE_FEATURE_MERLT` e `VITE_FEATURE_MERLT_GRAPH` sono accesi quando assenti; `false`, `0` o `""` li spengono. Non compaiono in `frontend/.env.example`. Spegnerli nasconde le superfici FE, ma i sotto-flag del BFF restano indipendenti.

## 5. Modalità sviluppatore locale (`MERLT_API_IN_DOCKER=false`)

Le dipendenze restano in Docker. api e worker girano sull'host da `MERLT_PYTHON`, con hot reload:

```bash
python3.11 -m venv merlt/.venv
merlt/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
merlt/.venv/bin/pip install -e 'merlt[dev]'
MERLT_ENABLED=true MERLT_API_IN_DOCKER=false MERLT_COMPOSE_ENABLED=true ./start.sh
```

`start.sh` esporta il cablaggio che compose dà ai container, con indirizzi host: DB su 5436, redis su 6381 (`RQ_REDIS_URL` sul DB 1), FalkorDB 6382, Qdrant 6343, nome del grafo, collection, URL delle callback verso `localhost:3001`, `VISUALEX_API_URL`. Poi avvia `uvicorn merlt.app:app --reload` e un `rq worker` sulle tre code.

Limiti:

- **Niente mcp-legal-it.** Gira solo sotto il profilo docker, quindi `MERLT_MCP_LEGAL_TOOLS_ENABLED=false` e gli esperti usano i tool interni. Per averlo: `docker compose -f docker-compose.merlt.yml up -d mcp-legal-it` e `MCP_LEGAL_IT_URL=http://localhost:8011/mcp`.
- **Il worker parte solo con `RQ_REDIS_URL`**, cioè con `MERLT_COMPOSE_ENABLED=true` o con la variabile esportata a mano.
- **Il preflight** esce subito se `MERLT_PYTHON` non importa `merlt.app`.

## 6. Il codice MERL-T è dentro l'immagine

Nei container è montato solo `merlt/data`, in sola lettura: il resto di `merlt/` è copiato nell'immagine al build. Dopo qualunque modifica sotto `merlt/` un restart non basta. Bisogna ricostruire e ricreare:

```bash
docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

Cosa sopravvive a un recreate:

- **I volumi** (Postgres, FalkorDB, Qdrant, upload, cache HF, checkpoint RLCF, modelli NER).
- **Il grafo**, perché FalkorDB scrive in `/var/lib/falkordb/data` e il volume è montato lì. Prima era su `/data` e un recreate perdeva i nodi ingeriti e co-evoluti.
- **Il replay buffer RLCF**, che sta sul volume `merlt_checkpoints`.

Redis invece non è durabile: coda RQ e cache si perdono a ogni recreate.

## 7. Test MERL-T

- **In CI:** il job `merlt` di `.github/workflows/ci.yml`, sul branch `visualex-merlt-main`, esegue `python -m pytest tests/ -q` su Python 3.11 contro un Postgres di servizio, dopo `create_tables()` e `ensure_schema_additions()`.
- **In locale:** dalla venv di `merlt/`, puntando `ENRICHMENT_DATABASE_URL` a un Postgres usa e getta. I test su DB scrivono righe, quindi non vanno lanciati sui dati dello stack di sviluppo. Il comando esatto è in [`merlt/CLAUDE.md`](../../merlt/CLAUDE.md).

## 8. Guasti comuni

| Sintomo | Causa | Rimedio |
|---|---|---|
| `compose up` fallisce su `vendor/mcp-legal-it` | submodule non inizializzato | `git submodule update --init --recursive vendor/mcp-legal-it` |
| Job «in corso» fino al timeout | callback rifiutata (500 `internal_auth_not_configured` o 401), worker fermo, o sotto-flag spento (404) | Allinea `MERLT_INTERNAL_SECRET` fra BFF e compose; controlla `docker compose ... ps`; lascia accesi graph/contribution |
| Ops RLCF o ingestion → 503 `merlt_auth_misconfigured` / `merlt_unavailable` | `MERLT_API_KEY` vuota o diversa dalla chiave seminata | Imposta `MERLT_API_KEY` in `backend/.env` e ricrea merlt-api, così la chiave viene seminata |
| Training NER sempre `queued` | il worker non ascolta `merlt_ner_train` | Ripristina la lista code nel `command` del worker e ricrea merlt-worker |
| `curl /api/merlt/health` → 401 | `merltRoutes` montato dopo i router con auth catch-all | Vedi il gotcha 1 di Slice 1 in `CLAUDE.md` |
