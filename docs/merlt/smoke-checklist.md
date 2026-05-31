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

## Q&A esperti — Loop β Fase F (`/merlt/chiedi`)
- [ ] Con consenso < Completo (o flag off) → CTA "serve consenso Completo" + link a `/merlt`.
- [ ] Hub: card "Q&A esperti" mostra "Apri" (non più "In arrivo") quando consenso Completo.
- [ ] Con Completo: poni una domanda (es. «art. 1453 c.c. risoluzione per inadempimento») → sintesi fondata.
- [ ] La risposta mostra una **confidenza** non fissa a 0.9 e i **canoni interpellati**.
- [ ] Pannello "Come ci sono arrivato" → **Fonti consultate** con URN leggibile, badge provenance (fondativa/validata/provvisoria) e affidabilità; il link apre `/grafo?urn=`.
- [ ] 👍/👎 globale → `POST /api/merlt/experts/feedback/inline` 200; lo stato resta evidenziato.
- [ ] "Approfondisci" → nuovo turno in coda via `POST /api/merlt/experts/refine`.
- [ ] Su una fonte **provvisoria** (`live_unconfirmed`): "Ricorda nel grafo" → `POST /api/merlt/experts/confirm-source` → stato "Ricordata"; il nodo poi compare in `/grafo`.
- [ ] Feedback per-fonte (pertinente/non) → `POST .../feedback/source`; valutazione dettagliata 3-layer → `POST .../feedback/detailed`.
- [ ] Modalità "Tesi a confronto" (divergente, quando il disaccordo è alto): tesi per-canone + "Mi convince" → `POST .../feedback/preference`.
- [ ] **Persistenza (#1A):** poni una domanda → **ricarica la pagina** → la conversazione (output completati) è ancora lì (localStorage). "Nuova conversazione" la azzera.
- [ ] **Cronologia (#1B):** "Cronologia" → lista delle conversazioni passate (`GET /api/merlt/experts/history`, server-side, newest-first); clic su una voce → la risposta viene caricata nel thread (read-only; senza il pannello fonti-consultate, non persistito).

### Note rete (Fase F)
- Tutte le rotte sotto `authenticate + contributionGuard` (consenso Completo); 503 `merlt_unavailable` se MERL-T è giù, 4xx passthrough.
- Timeout client lungo: `MERLT_EXPERTS_TIMEOUT_MS` (default 120s) — la query multi-expert può richiedere decine di secondi.

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
