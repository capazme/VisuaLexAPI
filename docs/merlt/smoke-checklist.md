# MERL-T: Smoke E2E Checklist

**Scope:** verifica manuale end-to-end di ogni superficie MERL-T (Slice 1 → Slice 4, Loop β, NER, ops, ingestion).
**Quando:** dopo ogni modifica che tocca una superficie, e prima di dichiarare «fatto» un lavoro MERL-T.
**Ambiente:** dev locale (VisuaLex più il sidecar MERL-T in Docker, modalità `api-in-docker`).

Questa è la copia canonica. `docs/merlt-smoke-checklist.md` è solo un puntatore. Il runbook di avvio è [integration.md](./integration.md); le route con guard e flag sono in [contract-matrix.md](./contract-matrix.md).

Salva log e screenshot di ogni esecuzione in `docs/smoke-evidence/YYYY-MM-DD-merlt/`.

---

## Setup (una volta per sessione)

1. **Reset di MERL-T (clean slate, opzionale).** Distrugge anche grafo, vettori e checkpoint.
   ```bash
   docker compose -f docker-compose.merlt.yml --profile api-in-docker down -v
   ```

2. **Avvia lo stack.** `api-in-docker` è il default. Al primo avvio alza il gate: build delle immagini e seed richiedono minuti.
   ```bash
   MERLT_ENABLED=true ./start.sh
   # primo avvio: MERLT_ENABLED=true MERLT_HEALTH_TIMEOUT=600 ./start.sh
   ```
   Righe attese nel log:
   - `[1/3] Starting VisuaLex API (port 5000)…`
   - `[2/3] Starting Platform Backend (port 3001)…`
   - `[3/3] Starting Frontend (port 5173)…`
   - `[4/4] Starting MERLT stack (deps + API in Docker)…`
   - `MERLT /health OK after Ns`

   Non deve comparire `merlt-worker is not running`.

3. **Container su.**
   ```bash
   docker compose -f docker-compose.merlt.yml --profile api-in-docker ps
   docker inspect visualex-merlt-worker --format '{{join .Config.Cmd " "}}'
   ```
   I 7 servizi devono essere `running`, e healthy dove c'è un healthcheck. Il comando del worker contiene `merlt_ingest merlt_extract merlt_ner_train`.

4. **MERL-T raggiungibile.**
   ```bash
   curl -s http://localhost:8000/health
   curl -s http://localhost:3001/api/merlt/health
   ```
   - Il primo mostra `dependencies` (postgresql, falkordb, qdrant, redis) e `graph.nodes`.
   - Il secondo risponde 200 con `"merlt":"reachable"` e l'`upstream`.
   - Il gate di `start.sh` passa anche con `"status":"degraded"`: controlla le dipendenze a mano.

5. **Boot di merlt-api.**
   ```bash
   docker logs visualex-merlt-api 2>&1 | grep -E "Admin API key|seed_loader|Graph hygiene loop|Consensus triggers"
   ```
   Righe attese: chiave admin seminata (o già presente), seed caricato (o `seed_loader.skip`), trigger di consenso installati, loop di igiene avviato con `interval_hours=24`.

---

## Story MERLT-1.5: `article:viewed` end-to-end

### 1. Login e consenso
- Apri `http://localhost:5173` ed entra con l'admin seminato (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).
- Imposta il consenso `basic` dall'hub (`/merlt` → «Gestisci»), oppure via API:
  ```bash
  TOKEN=$(... obtain JWT ...)
  curl -X POST http://localhost:3001/api/merlt/consent \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"level":"basic"}'
  ```
  Risposta 200 con `level:"basic"`, i tre toggle (`contributionEnabled`, `graphEnabled`, …) e `lastAuditAt`.

### 2. Apri un articolo e genera `article:viewed`
- Cerca un articolo (es. `art. 2043 c.c.`).
- Tienilo visibile per almeno 3 s, oppure scorrilo fino a rivelarne almeno il 30 %. La percentuale si misura nella colonna di lettura che scorre, non sull'elemento articolo.
- Chiudi la tab o naviga altrove.
- DevTools: `POST /api/merlt/events/article-viewed` → 202 `{received, timestamp}`, e `ingestionJob` se l'articolo non è nel grafo.

### 3. Verifica la riga in MERL-T
```bash
docker exec -it visualex-merlt-postgres \
  psql -U merlt -d merlt \
  -c "SELECT event_type, user_id, payload->>'article_urn' AS article_urn,
             payload->>'dwell_ms' AS dwell_ms, payload->>'scroll_max_pct' AS scroll_pct, created_at
      FROM tracking_events ORDER BY created_at DESC LIMIT 5;"
```
Riga attesa:
- `event_type = 'article:viewed'`;
- `user_id` = l'id dell'utente;
- `article_urn` con `-bis`/`-ter` normalizzati;
- `dwell_ms ≥ 3000`, oppure `scroll_pct ≥ 30`.

### 4. Revoca il consenso: nessun nuovo evento
```bash
curl -X DELETE http://localhost:3001/api/merlt/consent -H "Authorization: Bearer $TOKEN"
```
Riapri l'articolo, leggi per 5 s, chiudi e ripeti la query del passo 3. Non deve comparire nessuna riga nuova.

### 5. MERL-T fermo: il sistema degrada con grazia
```bash
docker stop visualex-merlt-api
```
Con il consenso attivo, riapri l'articolo: la UI non si blocca. Poi controlla il log dead-letter:
```bash
tail backend/logs/merlt-dead-letter.jsonl
```
Atteso: una riga con `event: "article-viewed"` e un `error` di rete o di timeout.
```bash
docker start visualex-merlt-api
```

### 6. Feature flag FE
In `frontend/.env` metti `VITE_FEATURE_MERLT=false` e riavvia il frontend. L'app funziona normalmente e il browser non fa nessuna chiamata a `/api/merlt/*`. Poi ripristina.

---

## Story MERLT-1.7: highlight e annotation

### Highlight
1. Apri un articolo con il consenso attivo.
2. Seleziona del testo: compare il SelectionPopup. Clicca «Evidenzia».
3. Scegli un colore: compare il toast.
4. Network: `POST /api/merlt/events/highlight-annotation` → 202 `{"received":1,"timestamp":"..."}`.
5. Il payload contiene `kind:"highlight"`, `anchorText`, `color` e `articleUrn`.

### Annotation
1. Stessa selezione, poi «Aggiungi nota» dal SelectionPopup.
2. Scrivi la nota e conferma.
3. Network: `POST /api/merlt/events/highlight-annotation` con `kind:"annotation"`, `noteText` e `anchorText`.

### Consenso Nessuno
`DELETE /api/merlt/consent`, poi ripeti highlight e annotation: non deve partire nessuna chiamata. Il tracker in `GlobalMerltSlot` controlla `canTrack`.

---

## Story MERLT-1.8: dossier e bookmark

### Bookmark
1. Apri un articolo e clicca l'icona segnalibro.
2. Network: `POST /api/merlt/events/dossier-bookmark` → 202, con `kind:"bookmark"` e `articleUrn`.

### Aggiunta a un dossier
1. Dall'articolo, «Aggiungi a dossier» (`AddToDossierPopover`), poi scegli un dossier.
2. Network: `POST /api/merlt/events/dossier-bookmark` → 202, con `kind:"dossier"` e `dossierId`.
3. Un solo POST anche con più card aperte: i tracker vivono una volta sola, in `GlobalMerltSlot`.

### Caso negativo
Aggiungere a un dossier una **nota** (type `note`) non deve emettere nulla: si tracciano solo le norme con URN.

---

## Story MERLT-1.9: `citation:clicked`

1. Apri un articolo con citazioni (es. art. 1175 c.c.).
2. Clicca un riferimento sottolineato: parte `handleOpenCitationInTab`.
3. Network: `POST /api/merlt/events/citation-clicked` → 202, con `sourceArticleUrn`, `citationText` e `targetArticleUrn:null` (la risoluzione avviene dopo, via `triggerSearch`).
4. Parte anche la superficie NER `implicit`: `POST /api/merlt/ner/feedback` con `surface:'implicit'`, ma solo con consenso `full`.

---

## Story MERLT-1.10: segnali forum

### Like
1. Forum → Esplora → cuore su un ambiente condiviso.
2. Network: `POST /api/merlt/events/forum-signal` → 202, con `action:"like"`, `sharedEnvId` e `originalAuthorId`.
3. Togliere il like non emette nulla.

### Download (import)
«Importa» su un ambiente condiviso → `POST /api/merlt/events/forum-signal` 202, con `action:"download"`.

### Suggerimento accettato o rifiutato
1. Forum → Suggerimenti → ricevuti → apri un suggerimento.
2. **Take** di un item → `action:"suggestion_accepted"`, con `sharedEnvId` uguale all'id dell'**ambiente** (non del suggerimento) e `originalAuthorId` uguale a chi ha proposto (vedi [decisions/forum-authoring.md](./decisions/forum-authoring.md)).
3. **Decline** di un item → idem, con `action:"suggestion_declined"`.

### Da qualunque route
I segnali forum partono dallo slot globale (`Layout`). Vai sul Forum senza aver aperto nessun articolo e metti un like: l'evento parte comunque.

---

# Slice 2a: Grafo

**Scope:** il grafo in sola lettura su due superfici (side rail e pagina `/grafo`) più l'ingestion lazy.
**Prerequisiti:** `VITE_FEATURE_MERLT_GRAPH` non a `false`; sidecar su; seed Libro IV caricato.

### Boot e seed
1. Nel log di `visualex-merlt-api` compare il seed loader. Al primo boot carica circa 27.7k nodi in qualche minuto; ai boot successivi lo salta (idempotente). Con `MERLT_SKIP_EMBEDDINGS=true` (default) manca il retrieval semantico sul seed, ma il grafo c'è.

### Side rail (nell'articolo)
2. Apri **art. 2043 c.c.** A destra compare la linguetta «Grafo»: cliccala. Il pannello mostra l'ego-network a profondità 1, con al massimo 25 nodi (canvas G6).
3. Apri un articolo fuori dal seed (es. **art. 73 c.p.**). Compare «Sto indicizzando l'articolo nel grafo…»; dopo qualche decina di secondi il worker finisce e il grafo si popola. Se l'articolo non è indicizzabile compare «Articolo non indicizzabile».
4. Clicca un nodo **Norma** → si apre `/grafo?urn=…`.
5. Flag spento: con `VITE_FEATURE_MERLT_GRAPH=false` il side rail non si registra, la voce «Grafo» della sidebar sparisce e `/grafo` mostra «Grafo non disponibile».

### Pagina `/grafo`
6. Voce **«Grafo»** nella sidebar (visibile con entrambi i flag MERL-T accesi) → pagina a tutta tela.
7. Digita «2043» nella search box: dopo circa 300 ms compare l'autocomplete. Con frecce e Invio, o con un clic, il grafo si centra su quell'URN.
8. Clic su un nodo → si apre `NodeDetailsDrawer`. «Centra qui» sposta il centro e la BreadcrumbHistory mostra 2 voci; la prima breadcrumb riporta al centro precedente.
9. Profondità 2→3 → refetch. Cambio di layout → ridisegno senza refetch.
10. L'URL contiene `?urn=…&depth=…&layout=…`. Un refresh ricarica lo stesso stato.
11. Un URN non ancora nel grafo avvia l'ingestion: banner di indicizzazione, poi grafo popolato; se resta vuoto, «Riprova».

### Rete (DevTools)
- `GET /api/merlt/graph/article/<urn>?depth=&limit=` → 200 `{nodes,edges,metadata}`, oppure 503 se MERL-T è giù. `limit` massimo 200.
- `GET /api/merlt/graph/search?q=&limit=` → 200, un array di entità.
- `POST /api/merlt/graph/ingest {urn}` → 202 `{jobId}`, poi `GET /api/merlt/graph/jobs/:jobId/status` ogni 2 s fino a `completed`; il polling si arrende dopo 60 s.
- Due lettori sullo stesso articolo in ingestion: ciascuno riceve un proprio `jobId`, ed entrambi arrivano a `completed` (callback fan-out).

---

# Slice 2b / Slice 3: Hub e consenso

Prerequisiti: backend (3001) e MERL-T (8000) su, utente loggato, `VITE_FEATURE_MERLT` acceso.

## Consenso (fonte di verità: il server)
- [ ] Utente nuovo: su `/merlt` («Assistente» nella sidebar) l'header mostra «Consenso: Nessuno».
- [ ] «Gestisci» → **Base** → Salva. DevTools: `POST /api/merlt/consent {level:'basic'}` → 200. L'header passa a «Base».
- [ ] Ricarica la pagina: il livello resta «Base», perché viene da `GET /api/merlt/consent` e non dal localStorage.
- [ ] Passa a **Completo**: la card Consenso mostra contribuzione e validazione attive.
- [ ] Revoca (dialog → Nessuno → Salva) → header «Nessuno».

## Banner al primo uso
- [ ] Con consenso Nessuno, leggi un articolo (almeno 3 s o il 30 %): compare il banner non bloccante.
- [ ] «Non ora» → sparisce e non ricompare nella sessione.
- [ ] Gli eventi passivi da soli (solo scroll, selezione di testo) non fanno comparire il banner.

## Hub e gating (decisione D2: leggere è libero, chiedere richiede Base, insegnare richiede Completo)
- [ ] Card Profilo: `GET /api/merlt/profile` → 200 con l'authority e la voce «Livello di autorevolezza»; con MERL-T giù, stato degradato.
- [ ] La card Grafo è visibile a chiunque abbia il flag grafo, **indipendentemente dal consenso**, e mostra il numero di nodi preso da `/health`.
- [ ] Card Q&A: con consenso Nessuno mostra «Consenso base» e «Per fare domande serve almeno il consenso base»; con Base o Completo apre `/grafo`.
- [ ] Le card **«Ops (admin)»** e **«Regolazione motore (admin)»** sono visibili solo all'admin.
- [ ] Con `VITE_FEATURE_MERLT=false`, `/merlt` mostra «MERL-T non è disponibile in questa configurazione.»

## Tracker (regressione)
- [ ] Con consenso Nessuno, leggere un articolo non produce `POST /api/merlt/events/article-viewed`. Con Base o Completo lo produce.

---

# Slice 2c: «Apprendi dai miei appunti» e validazione

Prerequisiti: stack Docker attivo, BFF (3001), consenso **Completo**, `OPENROUTER_API_KEY` impostata per compose (l'estrazione reale la usa).

## Contributo (upload → estrazione → revisione → promozione)
- [ ] `/merlt/contribuisci` con consenso sotto Completo → messaggio che serve il consenso Completo.
- [ ] Carica un `.txt`, `.pdf` o `.docx` (≤50 MB) → `POST /api/merlt/contrib/documents` 201 `{documentId}`.
- [ ] L'estrazione asincrona parte: spinner, poi polling di `/contrib/jobs/:id/status` fino a `completed`. Un fallimento (file già eliminato, estrattori tutti in errore) arriva come `failed` con un motivo, non come «0 candidati».
- [ ] Compaiono i candidati (`/contrib/documents/:id/candidates`): entità con il tipo come badge e relazioni con i nomi grezzi (`source_text`/`target_text`) e lo stato di risoluzione degli estremi. Se `potential_duplicate_of` è valorizzato compare l'hint di duplicato.
- [ ] Promozione: il pulsante resta disabilitato finché non ci sono **Norma di riferimento** (`NormaPicker`), **Fonte**, una **riformulazione diversa dal verbatim** e l'**attestazione**. Poi `POST /contrib/candidates/:id/promote` → 200 con `created:true` e `pendingId`. Se il gate fallisce, 422.
- [ ] Duplicato: MERL-T risponde `created:false`, `duplicateActionRequired:true` più i duplicati. La card chiede conferma con «Invia comunque», che salta il dedup ma mai il gate copyright.
- [ ] Nome rifiutato da MERL-T: `created:false` con il `message`; la card mostra il motivo e non dice «inviata».
- [ ] Relazione con estremi non risolti → 400 `unresolved_endpoint`.
- [ ] Proprietà: un altro utente che chiama extract, candidates o promote sullo stesso documento riceve 404 (`document_not_found` / `candidate_not_found`).
- [ ] Purge: dopo la promozione o la scadenza (48 h) le righe non ricompaiono; il file caricato viene eliminato dopo l'estrazione, salvo quando non è stato messo in staging nulla.

## Validazione della community
- [ ] `/merlt/valida` con consenso sotto Completo → messaggio sul consenso.
- [ ] Con Completo: la lista delle proposte (`GET /api/merlt/validate/pending`) mostra provenienza (`fonte`, `source_reference`, data reale), link alla norma e «Rifiuta» con un tocco.
- [ ] Il voto 👍/👎 fa `POST /api/merlt/validate/{entity|relation}` 200 e l'item sparisce. Il voto che chiude il consenso aggiorna subito l'authority nell'hub.
- [ ] Sezione **nodi provvisori**: `GET /api/merlt/graph/provisional-review` elenca i nodi che l'igiene ha messo in revisione. Approva o rifiuta → `POST /api/merlt/graph/provisional-review/:nodeId`.

## Snapshot locale (su `/grafo`)
- [ ] Apri una porzione di grafo, poi «Esporta slice»: scarica un `.json`.
- [ ] «Carica slice» con quel file → banner «Slice locale (sola lettura)» e render sul canvas. «Chiudi» torna alla vista normale.

### Rete
- `POST /api/merlt/contrib/documents/:id/extract` → 202 `{jobId}`. Il worker lavora sulla coda `merlt_extract`, con `job_timeout` di 1800 s.
- Callback dal worker al BFF: `POST /api/merlt/internal/extraction-callback`, con `X-Internal-Secret`.

---

# Slice 4 / Loop β: Q&A esperti su `/grafo`

La Q&A vive su `/grafo`; `/merlt/chiedi` e `/merlt/qa` reindirizzano lì. **Per chiedere basta il consenso Base; per insegnare serve Completo.**

## Chiedere
- [ ] Consenso Nessuno: il campo «Chiedi al grafo» mostra «Per chiedere al grafo serve il consenso base.»
- [ ] Consenso Base: poni una domanda (es. «art. 1453 c.c. risoluzione per inadempimento»).
  - `POST /api/merlt/experts/query/async` → 202 `{jobId, status:'pending'}`.
  - Polling di `GET /api/merlt/experts/jobs/:jobId/status` ogni 2 s.
  - I canoni compaiono uno per volta nell'ordine letterale, sistematico, principî, precedente; poi arriva la sintesi.
- [ ] Il toggle «Modalità di risposta» (convergente o divergente) cambia davvero la risposta. Un divergente con meno di due esperti utili torna a convergente e lo dice.
- [ ] Sul canvas si accendono i nodi canone e le fonti colorate per provenienza (seed, validata, confermata, provvisoria); se c'è disaccordo compaiono gli archi di contrasto.
- [ ] **«Approfondisci questa risposta»** su un turno concluso → `POST /api/merlt/experts/refine` 200 con un nuovo `trace_id`, nella stessa modalità.
- [ ] **Cronologia:** la vista storico nella colonna del dibattito (`GET /api/merlt/experts/history`) riapre un turno, e i dettagli arrivano da `GET /api/merlt/experts/trace/:traceId`.
- [ ] **Persistenza:** ricarica la pagina e il thread attivo è ancora lì (localStorage `merlt-qa-thread-v1`).
- [ ] MERL-T fermo al momento dell'invio: la risposta è 202 `{status:'failed'}` e il turno si chiude al primo poll, senza spinner infinito.
- [ ] Con consenso Base i controlli di insegnamento **non** compaiono: al loro posto c'è l'invito a passare a Completo.

## Insegnare (consenso Completo)
- [ ] 👍/👎 sulla risposta → `POST /api/merlt/experts/feedback/inline` 200. Se fallisce, il voto torna indietro e compare un Toast.
- [ ] Valutazione dettagliata sui 3 livelli → `POST .../feedback/detailed`; conferma solo dopo la risposta del server.
- [ ] Pertinenza di una fonte → `POST .../feedback/source`.
- [ ] Tesi a confronto: «Mi convince» su un canone → `POST .../feedback/preference`. Un secondo clic entro 10 minuti risponde `deduped:true`.
- [ ] Preferenza di relazione → `POST .../feedback/relation`.
- [ ] Su una fonte **provvisoria** (`live_unconfirmed` con `node_id`): «Ricorda nel grafo» → `POST /api/merlt/experts/confirm-source` 200 → «Ricordata». Un articolo Normattiva viene ingerito; ogni altra fonte diventa una proposta in `/merlt/valida`.
- [ ] **`qa_chip`:** nella sintesi, la barra ✓ / ✗ / Correggi su una citazione → `POST /api/merlt/ner/feedback` con `surface:'qa_chip'`.
- [ ] Traccia di un altro utente: `GET /experts/trace/<id altrui>` e i feedback su quel `traceId` → 404 `trace_not_found`.

## Verifica backend (curl)
- [ ] Con `consent {level:'basic'}`: `POST /api/merlt/experts/query {query:'art 1453 cc'}` → **200**, con `trace_id`, `synthesis`, `retrieved_sources[]`, `pipeline_trace`. Può servire da 30 a 120 s.
- [ ] Sempre con Base, ogni `POST /experts/feedback/*` → 403 `contribution_consent_required`.
- [ ] Con `consent {level:'full'}`, su quel `trace_id`, ogni canale risponde 200 e scrive in `qa_feedback`:
  - `feedback/inline {traceId, rating: 1|5}`
  - `feedback/source {traceId, sourceId, relevance: 1..5 int}`
  - `feedback/detailed {traceId, retrievalScore, reasoningScore, synthesisScore: 0..1 float}`
  - `feedback/preference {traceId, preferredExpert: literal|systemic|principles|precedent}`
  - `feedback/relation {traceId, relationType}`
- [ ] `GET /experts/history?limit=5` → 200; il primo `trace_id` è l'ultimo turno.
- [ ] `POST /experts/confirm-source {nodeId:'live:0000...', entityText:'...'}` su un nodo inesistente → 404 dall'upstream.

### Rete
- Tutte le route passano da `authenticate`. Le domande (query, query/async, history, trace, refine) vogliono `consentGuard`, cioè Base o Completo. Gli insegnamenti (`feedback/*`, confirm-source) vogliono `contributionGuard`, cioè Completo.
- MERL-T giù → 503 `merlt_unavailable`; i 4xx passano invariati.
- Timeout: `MERLT_EXPERTS_TIMEOUT_MS` (sync, 120 s) e `MERLT_EXPERTS_ASYNC_TIMEOUT_MS` (submit, 10 s). Il watchdog chiude come `timeout` un job Q&A rimasto senza callback per 20 minuti.

---

# Loop β #2: NER (4 superfici più training)

## Le superfici
- [ ] **`article_xref`:** dal popup di una citazione, ✓ / ✗ / Correggi → `POST /api/merlt/ner/feedback` con `surface:'article_xref'`. Per una `correction` serve anche `correctReference: {actType, article, ...}`. Atteso: 202 `{received, feedback_id, sample_weight}` e una riga in `ner_feedback`.
- [ ] **`qa_chip`:** dalla colonna del dibattito su `/grafo` (vedi sopra).
- [ ] **`implicit`:** aprire una citazione in una nuova tab emette una `confirmation`.
- [ ] **`search_mining`** (automatico, solo con consenso `full`): `POST /api/merlt/experts/query {query:'art 1453 cc'}`. Poi `SELECT * FROM ner_feedback WHERE source_surface='search_mining' AND user_id='<id>'` restituisce 1 riga con `feedback_id='ner-mining-<sha>'`. Rilanciando la stessa query la riga resta una.
- [ ] **Consenso Base:** `POST /experts/query` → 200 ma **nessuna** nuova riga `search_mining`; `POST /ner/feedback` → 403 `contribution_consent_required`.
- [ ] **Flag:** `POST /ner/feedback` segue `MERLT_CONTRIBUTION_ENABLED`; `/ner/feedback/stats` e `/ner/training/*` seguono `MERLT_OPS_ENABLED`.

## Training (admin)
- [ ] `GET /api/merlt/ner/feedback/stats` → 200 `{total, untrained, by_type, by_surface}`.
- [ ] `POST /api/merlt/ner/training/start {nIter:5, onlyUntrained:true}` → 202 `{task_id, status:'queued'}`.
- [ ] Polling di `GET /api/merlt/ner/training/jobs/:task_id`: lo stato passa da `queued` a `started` a `finished`.
- [ ] Il risultato ha `trained=true`, `checkpoint_path` e un `ab_report` con `baseline` (spans di `ARTICLE_PATTERNS` più gli offset di `extract_citations` di VisuaLex), `learned`, `combined` e `by_surface`. Se VisuaLex non è raggiungibile, `baseline` è `null`, `baseline_available` è `false`, `baseline_status.reason` spiega perché, e il training gira lo stesso.
- [ ] Report persistito: `docker exec visualex-merlt-worker ls /app/models/legal_ner_reports/` mostra `latest.json`; `curl http://localhost:8000/api/v1/ner/training/report/latest` lo restituisce (404 `no_report` prima del primo run).

---

# Ops e ingestion (admin)

## Training RLCF
- [ ] **Prerequisito:** `MERLT_API_KEY` impostata in `backend/.env` e ricreazione di merlt-api, così la chiave viene seminata come `admin`. Nel log compare `Admin API key seeded from environment`, oppure la chiave era già presente.
- [ ] Card «Ops (admin)» → avvio del training → `POST /api/merlt/ops/rlcf/training/start` → 202 `{success, training_id?, message, config?}`. Con il buffer insufficiente risponde `{success:false, message:"Buffer insufficiente (N/…)"}`, ed è atteso: la soglia minima è 50 esperienze.
- [ ] Il buffer sopravvive a un recreate di merlt-api: sta in `/app/checkpoints/rlcf/replay_buffer.json` e, se manca, viene reidratato al boot da `qa_feedback`.
- [ ] Chiave assente o sbagliata → 503 `merlt_auth_misconfigured`, non «non raggiungibile».

## Igiene del grafo
- [ ] Card «Ops (admin)» → «Esegui pulizia del grafo» → `POST /api/merlt/ops/graph/hygiene` 200. Il messaggio riporta i quattro conteggi: riconciliati, decaduti, in revisione, rimossi.
- [ ] Un nodo provvisorio confermato con «Ricorda nel grafo» non viene mai rimosso dalla pulizia: al massimo va in revisione.

## Regolazione motore
- [ ] Card «Regolazione motore (admin)»: `GET /api/merlt/ops/config` elenca i parametri; `PUT /api/merlt/ops/config/:key` ne cambia uno; «Riavvia motore» fa `POST /api/merlt/ops/engine/reinitialize`.

## Ingestion meccanica
- [ ] `/admin`, tab «Ingestione»: avvia un batch (`POST /api/merlt/ops/ingestion/run`, sorgente `visualex_tree` o `italia_corpus`).
- [ ] Il batch passa in revisione con il report dei conflitti (`urn_conflicts`, `node_updates`, `node_new`).
- [ ] Promuovi: 409 finché ci sono conflitti non risolti. Rifiuta: 409 `batch_status_changed_concurrently` se nel frattempo lo stato è cambiato.

## Feature flag del BFF
- [ ] `MERLT_GRAPH_ENABLED=false` → `/api/merlt/graph/*` e `/internal/job-callback` rispondono 404 `merlt_disabled`; `/consent` e `/events/*` continuano a funzionare.
- [ ] `MERLT_OPS_ENABLED=false` → `/ops/*` e i route NER di admin rispondono 404, mentre `POST /ner/feedback` resta attivo.
- [ ] `MERLT_ENABLED=false` nell'ambiente del BFF → tutto `/api/merlt` risponde 404 `merlt_disabled`.

---

## Troubleshooting

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| `curl /api/merlt/health` → 401 | `merltRoutes` montato dopo i router con auth catch-all | Gotcha 1 di Slice 1 in `CLAUDE.md` |
| `compose up` fallisce su `vendor/mcp-legal-it` | submodule non inizializzato | `git submodule update --init --recursive vendor/mcp-legal-it` (`start.sh` lo fa da solo) |
| MERL-T `ImportError: No module named 'merlt.models'` | sotto-package escluso da rsync | Commit `ef2bd25` e [upstream-sync.md](./upstream-sync.md) |
| MERL-T 503 all'avvio del container | mancano `ENRICHMENT_DB_*` / `RLCF_DATABASE_URL` | Commit `1fdb3d5`; oggi sono tutti nel file compose |
| Timeout del gate di `start.sh` | primo boot lento (build, seed, caricamento modelli) | `MERLT_HEALTH_TIMEOUT=600` |
| Job «in corso» fino al timeout | callback rifiutata (500 `internal_auth_not_configured` o 401), worker fermo, sotto-flag spento | Allinea `MERLT_INTERNAL_SECRET` fra BFF e compose; controlla `docker compose ... ps`; nel log del worker cerca `BFF callback refused` |
| Ops → 503 `merlt_auth_misconfigured` | `MERLT_API_KEY` vuota o diversa dalla chiave seminata | Imposta la chiave in `backend/.env`, poi ricrea merlt-api (la seed usa `MERLT_ADMIN_API_KEY`) |
| Il training NER resta `queued` | il worker non ascolta `merlt_ner_train` | Controlla il `command` del worker, poi `docker compose ... up -d --no-deps --force-recreate merlt-worker` |
| Nodi ingeriti o co-evoluti spariti dopo un recreate | volume FalkorDB montato fuori da `/var/lib/falkordb/data` | Il compose attuale monta lì e salva con `--appendonly yes`. Verifica con `docker inspect visualex-merlt-falkordb` |
| Il training RLCF risponde sempre `Buffer insufficiente` | buffer sotto soglia (minimo 50) | Atteso finché non si raccolgono abbastanza feedback |
| Il frontend chiama `/api/merlt/features` | dipendenza legacy | Risolto in Slice 2b: il gating è derivato lato client in `useMerltFeatures`, l'endpoint non esiste |
