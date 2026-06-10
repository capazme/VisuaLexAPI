# MERL-T Slice 1 — Smoke E2E Checklist

**Scope:** end-to-end manual verification per ogni Story di Slice 1.
**Frequency:** dopo ogni chiusura di Story con AC "smoke verde".
**Target environment:** dev locale (VisuaLex + MERL-T sidecar Docker).

Salva log/screenshot di ogni esecuzione in `docs/smoke-evidence/YYYY-MM-DD-merlt-slice1/`.

---

## Setup (una volta per sessione)

1. Reset Postgres MERL-T (clean slate):
   ```bash
   docker compose -f docker-compose.merlt.yml --profile api-in-docker down -v
   ```

2. Start full stack:
   ```bash
   MERLT_ENABLED=true MERLT_COMPOSE_ENABLED=true MERLT_API_IN_DOCKER=true ./start.sh
   ```
   Aspetta:
   - `[1/3] Starting VisuaLex API (port 5000)…`
   - `[2/3] Starting Platform Backend (port 3001)…`
   - `[3/3] Starting Frontend (port 5173)…`
   - `[4/4] Starting MERLT stack (deps + API in Docker)…`
   - `MERLT /health OK after Ns`

3. Verifica container UP:
   ```bash
   docker ps --filter "name=visualex-merlt" --format "table {{.Names}}\t{{.Status}}"
   ```
   Tutti i 5 container devono essere `Up X (healthy)`.

4. Verifica MERL-T reachable:
   ```bash
   curl http://localhost:8000/health
   curl http://localhost:3001/api/merlt/health
   ```
   Entrambi 200, e il secondo include `"merlt":"reachable"`.

---

## Story MERLT-1.5 — `article:viewed` end-to-end

### 1. Login + accept consent

- Apri `http://localhost:5173`
- Login con `admin@visualex.it` + password (vedi `backend/.env`)
- Trigger accept consenso `basic`:
  ```bash
  TOKEN=$(... obtain JWT ...)
  curl -X POST http://localhost:3001/api/merlt/consent \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"level":"basic"}'
  ```
  Risposta 200 con `level:"basic"`, `graphEnabled:true`.

  Verifica DB:
  ```bash
  psql postgresql://gpuzio@localhost:5432/visualex_platform \
       -c "SELECT user_id, consent_level FROM merlt_user_preferences;"
  ```

### 2. Open article → trigger article:viewed

- Cerca un articolo (es. `art. 2043 c.c.`)
- Lascia visibile in viewport ≥3s (oppure scrolla ≥30%)
- Chiudi la tab o naviga via

### 3. Verify trace in MERL-T Postgres

```bash
docker exec -it visualex-merlt-postgres \
  psql -U merlt -d merlt \
  -c "SELECT id, event_type, user_id, payload::jsonb -> 'article_urn' AS article_urn,
             payload::jsonb -> 'dwell_ms' AS dwell_ms, created_at
      FROM qa_traces ORDER BY created_at DESC LIMIT 5;"
```

Atteso: una riga con
- `event_type = 'article_viewed'`
- `user_id` = il tuo UUID di admin
- `article_urn` = URN dell'articolo aperto (con `-bis`/`-ter` normalizzati)
- `dwell_ms ≥ 3000`
- `created_at` recente

### 4. Revoke consent → no new event

```bash
curl -X DELETE http://localhost:3001/api/merlt/consent \
     -H "Authorization: Bearer $TOKEN"
```

Apri di nuovo l'articolo, leggi 5s, chiudi. Ripeti la query SQL del passo 3.
Atteso: nessuna nuova riga (il countdown dei record non cambia).

### 5. Stop MERL-T → degraded gracefulness

```bash
docker stop visualex-merlt-api
```

Apri di nuovo l'articolo (con consent attivo). UI non si blocca.
Verifica dead-letter log:
```bash
tail backend/logs/merlt-dead-letter.jsonl
```
Atteso: una riga con `event: "article-viewed"` e `error` che riporta MerltServerError o MerltTimeoutError.

```bash
docker start visualex-merlt-api
```

### 6. Feature flag verification

In `frontend/.env`:
```
VITE_FEATURE_MERLT=false
```
Restart frontend (`Ctrl+C` poi `./start.sh`). L'app deve girare normalmente; nessuna chiamata `/api/merlt/*` dal browser.

Riimposta a `true` e riavvia.

---

## Story MERLT-1.7 — highlight + annotation

### Highlight
1. Apri un articolo (consent attivo).
2. Seleziona del testo nel body → SelectionPopup compare → click "Evidenzia".
3. Scegli un colore (es. yellow). Toast "Testo evidenziato in yellow".
4. In DevTools → Network: `POST /api/merlt/events/highlight-annotation` con status `202` e body `{"received":1,"timestamp":"..."}`.
5. Request payload `kind:"highlight"`, `anchorText:"..."` (il testo selezionato), `color:"yellow"`, `articleUrn:"..."`.

### Annotation
1. Stessa selezione + click "Aggiungi nota" da SelectionPopup.
2. Scrivi nota nel composer, conferma. Toast "Nota ancorata al testo".
3. Network: `POST /api/merlt/events/highlight-annotation` con `kind:"annotation"`, `noteText:"...testo nota...", anchorText:"...testo selezionato..."`.

### Consent OFF
- `DELETE /api/merlt/consent`. Ripeti highlight/annotation → nessuna chiamata `/events/highlight-annotation` (il subscriber gate-checks).

---

## Story MERLT-1.8 — dossier + bookmark

### Bookmark
1. Apri articolo → click sull'icona bookmark (o quick norm pin nella toolbar).
2. Toast "Aggiunto ai segnalibri" (o "Aggiunto alle norme rapide").
3. Network: `POST /api/merlt/events/dossier-bookmark` 202, `kind:"bookmark"`, `articleUrn:"..."`.

### Dossier add
1. Apri sidebar Dossier → seleziona un dossier esistente (o creane uno).
2. Apri articolo → menu → "Aggiungi a dossier" → scegli dossier.
3. Toast "Aggiunto al dossier".
4. Network: `POST /api/merlt/events/dossier-bookmark` 202, `kind:"dossier"`, `dossierId:"<uuid>"`.

### Negative case
- Aggiungere una **nota** a dossier (type='note') NON deve emettere — solo le norme con URN sono tracciate.

---

## Story MERLT-1.9 — citation:clicked

1. Apri un articolo che contiene citazioni (es. art. che riferisce ad altri articoli — c.c. art. 1175 cita 1218).
2. Il citation linker ha sottolineato i riferimenti. Cliccaci sopra → click handler `handleOpenCitationInTab`.
3. Network: `POST /api/merlt/events/citation-clicked` 202, `sourceArticleUrn:"..."`, `targetArticleUrn:null` (resolution avviene dopo via triggerSearch), `citationText:"art. 1218 c.c."` (o equivalente).
4. La tab successiva aprirà l'articolo target tramite il normale flow `triggerSearch`.

---

## Story MERLT-1.10 — forum signals

### Like
1. Vai a Forum → tab Esplora.
2. Click cuore su un SharedEnvironment qualunque. Il count aumenta.
3. Network: `POST /api/merlt/events/forum-signal` 202, `action:"like"`, `sharedEnvId:"<uuid>"`, `originalAuthorId:"<env.user.id>"`.
4. **Caveat**: unliking (cuore già attivo) NON emette evento — il subscriber gate filtra solo `liked=true`.

### Download (import)
1. Click "Importa" su un SharedEnvironment (richiede consent + scelta del subset di dossier/quick-norms).
2. Network: `POST /api/merlt/events/forum-signal` 202, `action:"download"`, `originalAuthorId:"<env.user.id>"`.

### Suggestion accept / decline
1. Vai a Forum → tab Suggerimenti → ricevuti.
2. Apri una suggestion che ti è stata mandata → SuggestionReviewDialog.
3. **Take** un item → toast "Item preso" → Network: `POST /api/merlt/events/forum-signal` 202, `action:"suggestion_accepted"`, `originalAuthorId:"<suggester.id>"` (NB: chi ha proposto, non chi ospita l'env — vedi `docs/merlt-forum-authoring-decision.md`).
4. **Decline** un item → toast "Item rifiutato" → idem con `action:"suggestion_declined"`.

### Cross-route verification
- I forum events partono dal global plugin slot (`Layout`-level), non dal article slot. Test: vai su Forum SENZA aver mai aperto un articolo → like → l'evento parte comunque. Storia 1.10 ha pensato a questa edge case.

---

# MERL-T Slice 2a — Graph Smoke E2E

**Scope:** grafo read-only su due superfici (side rail + pagina `/grafo`) + lazy ingestion.
**Prereq:** flag `VITE_FEATURE_MERLT_GRAPH` non a `false`; MERL-T sidecar UP; seed Libro IV caricato.

### Boot + seed
1. `MERLT_ENABLED=true ... ./start.sh`. Nel log del container `visualex-merlt-api` compare il seed loader: `... nodes loaded` (~27.7k) entro ~6 min al PRIMO boot, <5s ai successivi (skip idempotente). Se `MERLT_SKIP_EMBEDDINGS=true` (default dev) il retrieval semantico è assente ma il grafo c'è.

### Side rail (in articolo)
2. Apri **art. 2043 c.c.** (Ricerca → fetch). A destra compare la linguetta verticale "Grafo". Click → il pannello si espande (~320px) e mostra l'ego-network depth-1 con ≥10 nodi (Cytoscape).
3. Apri **art. 73 c.p.** (verosimilmente fuori seed). Il side rail mostra lo skeleton "Sto indicizzando l'articolo nel grafo…" + spinner; dopo ~30-60s (worker RQ) il grafo si popola. Se l'articolo non è indicizzabile → "Articolo non indicizzabile".
4. Click su un nodo **Norma** nel side rail → naviga a `/grafo?urn=…&depth=2`. Click "Esplora nel grafo" → idem sull'articolo corrente.
5. Flag off: con `VITE_FEATURE_MERLT_GRAPH=false`, il side rail NON si registra (nessuna linguetta) e la voce Sidebar "Grafo" è nascosta.

### Pagina `/grafo`
6. Click "Grafo" in Sidebar → pagina full-canvas, stato vuoto con search box centrale + tagline "…per iniziare".
7. Digita "2043" nella search box → dopo ~300ms compare l'autocomplete (label + tipo). Frecce su/giù + Invio, oppure click → il grafo si carica centrato su quell'URN.
8. Click su un nodo **Concetto** → si apre il NodeDetailsDrawer a destra (URN/proprietà + relazioni in/out). Doppio click sul nodo (o "Centra qui") → diventa il nuovo centro; la BreadcrumbHistory in alto mostra **2 voci**. Click sulla prima breadcrumb → torna al centro precedente.
9. Cambia **profondità** 2→3 → il grafo si ricarica con più nodi (refetch). Cambia **layout** (Forza/Gerarchico/Ad albero) → ridisegno immediato SENZA refetch.
10. L'URL contiene `?urn=…&depth=3&layout=…`. **Refresh** della pagina → stesso stato ricaricato (deeplink shareable).
11. Cerca un URN non ancora nel grafo → parte l'ingestion: banner "Indicizzazione in corso…" + spinner; a fine job toast "Grafo aggiornato" e il grafo si popola. Se resta vuoto → "Articolo non indicizzabile" + "Riprova".

### Note di verifica rete (DevTools)
- Side rail / pagina: `GET /api/merlt/graph/article/<urn-encoded>?depth=&limit=` → 200 con `{nodes,edges,metadata}` (o 503 se MERL-T down).
- Autocomplete: `GET /api/merlt/graph/search?q=&limit=` → 200 array entità.
- Ingestion: `POST /api/merlt/graph/ingest {urn}` → 202 `{jobId}`; polling `GET /api/merlt/graph/jobs/:jobId/status` ogni 2s fino a `completed`.

---

# MERL-T Slice 2b — Hub & Consent Smoke

Prerequisito: backend (3001) + MERL-T (8000) attivi, utente loggato. `VITE_FEATURE_MERLT` ON.

## Consenso (server SoT)
- [ ] Nuovo utente (nessuna preferenza): vai su `/merlt` → header mostra "Consenso: Nessuno".
- [ ] Apri il dialog ("Gestisci") → scegli **Base** → Salva. DevTools: `POST /api/merlt/consent {level:'basic'}` → 200 con `{level, graphEnabled:true, ...}`. L'header passa a "Base".
- [ ] Ricarica la pagina → il livello resta "Base" (hydrate da `GET /api/merlt/consent`, non da localStorage).
- [ ] Porta a **Completo** → la card Consenso mostra contribuzione/validazione attive.
- [ ] Revoca (dialog → Nessuno / Salva) → `POST {level:'none'}` → header "Nessuno"; localStorage `visualex.merlt.consent` rimosso.

## Banner first-run
- [ ] Con consenso = Nessuno, leggi un articolo (≥3s o scroll ≥30%) → compare il banner non bloccante.
- [ ] "Non ora" → sparisce e non riappare nella sessione (anche dopo altri eventi).
- [ ] Verifica che eventi passivi (solo scroll senza dwell, selezione testo) NON facciano comparire il banner da soli.

## Hub + gating
- [ ] Card Profilo/Authority: `GET /api/merlt/profile` → 200 mostra authority/contributi; se MERL-T down → stato degradato "Dati di authority non disponibili".
- [ ] Card Grafo presente solo se consenso ≥ Base (graphReadable); link → `/grafo`.
- [ ] Card **Ops** visibile SOLO con utente admin (`admin@visualex.it`).
- [ ] `VITE_FEATURE_MERLT=false` → `/merlt` mostra "MERL-T non è disponibile".

## Tracker gating (regressione)
- [ ] Con consenso Nessuno: leggere un articolo NON produce `POST /api/merlt/events/article-viewed` (0 chiamate). Con Base/Completo → la produce.

---

# MERL-T Slice 2c — "Apprendi dai miei appunti" + Validazione Smoke

Prereq: stack Docker MERL-T attivo (`docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d`), BFF Node (3001), consenso **Completo**, e una chiave LLM configurata in MERL-T per l'estrazione reale.

## Contribuzione (upload → estrazione → revisione → promozione)
- [ ] `/merlt/contribuisci` con consenso < Completo → messaggio "serve consenso Completo".
- [ ] Carica un `.txt`/`.pdf`/`.docx` (≤50MB) → `POST /api/merlt/contrib/documents` 201 `{documentId}`.
- [ ] Parte l'estrazione async → spinner "Estrazione in corso" → polling `/contrib/jobs/:id/status` fino a `completed`.
- [ ] Compaiono i candidati (`/contrib/documents/:id/candidates`). Verifica: hint dedup se `potential_duplicate_of` valorizzato (#4); confidenza LLM mostrata.
- [ ] Promuovi un candidato: il pulsante è disabilitato finché non compili **Norma di riferimento** (#6) + **Fonte** + **riformulazione ≠ verbatim** + **attestazione**. → `POST /contrib/candidates/:id/promote` 200 `{pendingId}`; 422 se il gate fallisce.
- [ ] **#3 purge**: dopo la promozione/scadenza, ricaricando i candidati le righe promosse/scadute non ricompaiono; il file caricato è rimosso da `UPLOAD_DIR` dopo l'estrazione.

## Validazione community (#8)
- [ ] `/merlt/valida` con consenso < Completo → messaggio consenso.
- [ ] Con Completo: lista entità/relazioni pending (`GET /api/merlt/validate/pending`).
- [ ] Vota 👍/👎 su un item → `POST /api/merlt/validate/{entity|relation}` 200, l'item sparisce dalla lista.

## Snapshot locale (#7, su `/grafo`)
- [ ] Apri uno slice, "Esporta slice" → scarica un `.json`.
- [ ] "Carica slice" + seleziona il file → banner "Slice locale (sola lettura)" + render nel canvas; "Chiudi" torna alla vista normale.

### Note rete
- `POST /api/merlt/contrib/documents/:id/extract` → 202 `{jobId}`; worker su coda `merlt_extract`.
- Callback worker→BFF: `POST /api/merlt/internal/extraction-callback` con `X-Internal-Secret`.

---

## Troubleshooting comune

| Sintomo | Cause probabile | Fix |
|---------|------------------|-----|
| `curl /api/merlt/health` → 401 | merltRoutes non mountato prima dei router auth catch-all | Vedi gotcha "Express mount order" in CLAUDE.md |
| MERL-T `ImportError: No module named 'merlt.models'` | sub-package escluso da rsync | Vedi commit `ef2bd25` + `docs/merlt-upstream-sync.md` |
| MERL-T 503 al startup container | env vars `ENRICHMENT_DB_*` / `RLCF_DATABASE_URL` mancanti | Vedi commit `1fdb3d5` |
| Health gate timeout in start.sh | MERL-T tarda al primo boot (~30-60s per migrations + model load) | Aumenta `MERLT_HEALTH_TIMEOUT=120` |
| Frontend chiama `/api/merlt/features` | dipendenza legacy | RISOLTO in Slice 2b: il gating è derivato client-side (`useMerltFeatures`), l'endpoint non esiste più |
| `/api/merlt/ops/rlcf/training/start` → 503 `merlt_unavailable` ma MERL-T live OK | `MERLT_API_KEY` mancante in `backend/.env` OPPURE opsClient usa header sbagliato | Aggiungi `MERLT_API_KEY=<plaintext>` (esiste in `api_keys` PG MERL-T con `role=admin`); opsClient DEVE usare `X-API-Key`, non `Authorization: Bearer` (regression guard in `tests/integration/merlt/ops-routes.test.ts`) |
| Job training NER resta in `queued` per sempre | Worker non ascolta la coda `merlt_ner_train` | Verifica `docker inspect visualex-merlt-worker --format '{{join .Config.Cmd " "}}'` → deve contenere `merlt_ner_train`. Se manca: revert/correggi `docker-compose.merlt.yml` (worker `command`), poi `docker compose ... up -d --no-deps --force-recreate merlt-worker` |
| Q&A `/experts/query` torna 403 `contribution_consent_required` | Utente non ha consent `full` | POST `/api/merlt/consent {level:'full'}` per attivare il `contributionGuard` |
| RLCF training reale risponde sempre `Buffer insufficiente (N/50)` | Soglia Pydantic `ge=50` su `buffer_threshold` | Comportamento atteso: serve raccogliere ≥50 feedback `qa_feedback` (inline/source/detailed/preference) prima del training reale |

---

## Story Loop β — Q&A esperti

### 1. Q&A query reale + 4 canali feedback (verifica E2E backend)
- [ ] POST `/api/merlt/consent {level:'full'}` per l'utente di test.
- [ ] POST `/api/merlt/experts/query {query:'art 1453 cc'}` → 200, response ha `trace_id`, `synthesis`, `retrieved_sources[]`, `pipeline_trace`. Tempi ~30-120s (cold-start più lento).
- [ ] Su quel `trace_id`, eserciti tutti e 4 i canali e verifica persistenza:
  - `POST /experts/feedback/inline {traceId, rating: 1|5}` → 200 + riga `qa_feedback.inline_rating`
  - `POST /experts/feedback/source {traceId, sourceId, relevance: 1..5 int}` → 200 + `source_relevance`
  - `POST /experts/feedback/detailed {traceId, retrievalScore/reasoningScore/synthesisScore: 0..1 float, comment?}` → 200 + `retrieval_score`
  - `POST /experts/feedback/preference {traceId, preferredExpert: 'systemic'|'principles'|'precedent'|'literal', comment?}` → 200 + `preferred_expert`
- [ ] GET `/experts/history?limit=5` → 200, array con `trace_id` come primo elemento.
- [ ] POST `/experts/refine {traceId, followUpQuery}` → 200, nuovo `trace_id`, mode `divergent` o `convergent`.
- [ ] POST `/experts/confirm-source {nodeId:'live:0000...'}` su nodo inesistente → 404 passthrough `{detail: "Provisional source node ... not found"}` (verifica della route, non del nodo).

### 2. UI Q&A (browser)
- [ ] Vai a `/merlt/chiedi`. Composer visibile con toggle Sintesi / Tesi-a-confronto.
- [ ] Invia query → spinner → comparsa di turn con sintesi + chip fonti + "Come ci sono arrivato" panel.
- [ ] Click su un `QaSourceChip` → naviga a `/grafo?urn=...` (se URN valido) oppure URL Normattiva.
- [ ] Stelline / pollice rateo → POST `/experts/feedback/inline` (vedi network tab).
- [ ] "Approfondisci..." → text box per follow-up → POST `/experts/refine`.

---

## Story Loop β #2 — NER (4 superfici + training)

### 1. Le 4 superfici di feedback (cURL/network)
- [ ] **`article_xref`**: POST `/api/merlt/ner/feedback` con `surface='article_xref'`, `feedbackType='confirmation'|'correction'|'false_positive'`, `articleUrn`, `selectedText`, offsets, `contextWindow`. Per `correction` serve anche `correctReference: {actType, article, ...}`. Atteso: 202 `{received, feedback_id, sample_weight}` + riga `ner_feedback`.
- [ ] **`qa_chip`**: dalla pagina `/merlt/chiedi`, clicca ✓/✗/Correggi su una citazione inline → stessa POST con `surface='qa_chip'`.
- [ ] **`implicit`**: in `ArticleTabContent`, apri una citazione in nuova tab → POST con `surface='implicit'` (peso basso, fire-and-forget).
- [ ] **`search_mining`** (automatico): POST `/api/merlt/experts/query {query:'art 1453 cc'}` → verifica `SELECT * FROM ner_feedback WHERE source_surface='search_mining' AND user_id='<id>'` → 1 riga con `feedback_id='ner-mining-<sha>'`. Re-firare la stessa query → resta 1 riga (idempotenza per `feedback_id` deterministico).
- [ ] **Gate basic**: POST `/api/merlt/consent {level:'basic'}` poi POST `/experts/query` → 403 `contribution_consent_required`, e nessuna nuova riga `search_mining`.

### 2. Training NER (admin)
- [ ] GET `/api/merlt/ner/feedback/stats` (admin) → 200 `{total, untrained, by_type, by_surface}`.
- [ ] POST `/api/merlt/ner/training/start {nIter:5, onlyUntrained:true}` (admin) → 202 `{task_id, status:'queued'}`.
- [ ] Poll `GET /api/merlt/ner/training/jobs/:task_id` ogni 5-10s → status passa `queued → started → finished` (~20-30s con micro-dataset).
- [ ] Verifica result: `trained=true`, `checkpoint_path` in `models/legal_ner_checkpoints/`, `ab_report` con P/R/F1 (può essere 0 su micro-dataset, è atteso). Verifica `docker exec visualex-merlt-worker ls /app/models/legal_ner_checkpoints/` → trovi i checkpoint + symlink `legal_ner_latest`.
- [ ] **Pre-requisito**: il worker DEVE ascoltare `merlt_ner_train` (vedi troubleshooting sopra). Senza, il job resta in `queued`.

---

## Story Loop-closure A5 — RLCF training (ops)

- [ ] **Pre-requisito**: `MERLT_API_KEY` configurata in `backend/.env`, con plaintext di una chiave `role=admin` esistente in `api_keys` (PG MERL-T).
- [ ] POST `/api/merlt/ops/rlcf/training/start {buffer_threshold:50, epochs:2}` (admin) → 202 con `{success, training_id?, message, config?}`. Su buffer insufficiente: `{success:false, message:"Buffer insufficiente (N/50)..."}` (atteso fino a ≥50 feedback `qa_feedback`).
- [ ] GET `/api/v1/rlcf/policies/weights` (diretto MERL-T, con `X-API-Key`) → JSON con `gating` (4 pesi esperti), `traversal`, `tool_gating` (7+ tool con score 0..1). Pesi `0.25` uniformi = warm-start, valori non-uniformi = pesi appresi.
- [ ] Dopo training reale (con buffer ≥50): riga `weight_versions` in PG MERL-T con `is_active=true` e `config_json` aggiornato. Checkpoint su volume `merlt_checkpoints` (durabile a recreate).
