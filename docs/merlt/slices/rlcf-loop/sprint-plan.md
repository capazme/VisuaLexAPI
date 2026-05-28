# Sprint Plan — Chiusura del loop RLCF + relazioni da note

**Data:** 2026-05-27
**Branch:** `visualex-merlt-main`
**Contesto:** dopo Slice 1→2c, VisuaLex ha costruito la METÀ in ingresso del ciclo RLCF
(cattura segnali, contributi, voto di validazione). Le fasi di CHIUSURA del ciclo
(persistenza, aggregazione, promozione, authority, reward) sono in parte presenti
nel codice MERL-T vendored ma **non innescate**, in parte assenti. Questo piano le chiude.

Modello di riferimento: le 8 fasi RLCF di `ALIS_CORE` (vedi `papers/markdown/DA GP - RLCF.md`,
`core_docs/ARCHITETTURA.md`, `TRACE_SCHEMA.md`).

## Decisioni già prese (kickoff)

- **Scope sessione:** chiudere il loop RLCF (Epic A) + completare i contributi con le relazioni (Epic B).
  FUORI scope ora: hardening/deploy/smoke, e lo Stage 8 (Q&A di ritorno utente → "Slice 3" a sé).
- **Trigger aggregazione (fase 5):** **a soglia** — quando un `pending_*` raggiunge N voti pesati
  per authority, parte lo scrutinio; se c'è consenso si accende `consensus_reached` → promozione.
- **Training RL (fase 7):** **solo wiring manuale** (endpoint admin), nessun auto-training al boot.

## STATO: COMPLETATO + LOOP CHIUSO E2E CON DATI REALI (2026-05-28 PM)

Sessione di chiusura: oltre ai 6 goal originali, sistemati i pezzi che mancavano per
trasformare il loop "tecnicamente cablato" in **collaborazione reale**:

| Pezzo aggiunto | Cosa fa | Test |
|----------------|---------|------|
| Fix `propose-entity` payload | aggiunto `user_id` (MERL-T Pydantic lo richiedeva → 422 mascherato come 503) | contrib-routes 23 |
| `GET /api/merlt/contrib/me/jobs` | endpoint owner-scoped per la lista contributi recenti | (parte di suite) |
| `MyContributionsCard` (FE) | widget nel hub: status, candidati, click→deeplink | render via hub test |
| ContribPage `?documentId=N` | il refresh non perde più lo stato; deeplink dal hub funziona | ContribPage 4 |
| Worker callback retry+backoff | 3 attempts 1s/3s/8s + raise-for-status + log success/failure (entrambi extract+ingest) | runtime (no regress) |
| `sweepStuckJobs` watchdog | job pending/running >10min → 'timeout' (BFF startup + ogni 5min) | jobWatchdog 4 |

**E2E reale verificato con i dati dell'utente:**
- Note `test-notes-e2e.txt` → upload → estrazione (B1) → 21 entità + **11 relazioni** semanticamente coerenti
- Candidato 2 (`Risoluzione del contratto per inadempimento`) → promosso con copyright gate → `pending_entity`
- 4 voti via `POST /api/v1/enrichment/validate-entity` con user_id distinti, authority 0.5 ciascuno
- Trigger Postgres acceso a net_score=2.0 → `consensus_reached=True`, `consensus_type='approved'`
- Vote handler MERL-T scrive il nodo in FalkorDB → `:Entity:Concetto {id: 'concetto:risoluzione_del_contratto_per_inadempimento'}` collegato `[:DISCIPLINA]` a `:Norma {URN: urn:nir:stato:regio.decreto:1942-03-16;262~art1453}`

**Test totali post-chiusura:** BFF merlt 207 (era 198) + FE merlt 166 + MERL-T container 18.

**Durabilità:** immagini `merlt-api` e `merlt-worker` rebuildate dopo i fix retry; il codice è ora baked.

## STATO: COMPLETATO (2026-05-28) — implementato e verificato con TDD

Tutti i 6 goal chiusi su `visualex-merlt-main`. Test: MERL-T 18 (container),
BFF merlt 198, FE merlt 166. **Diagnosi A2 corretta:** la causa reale NON era
"aggregazione mai invocata" ma i **trigger PostgreSQL di consenso (migrations 001+002)
mai installati** nel DB del container (`create_tables()` crea solo le tabelle, non i
trigger). Fix: `merlt/storage/enrichment/consensus_triggers.py` (idempotente) +
aggancio al lifespan. Il flusso voto→consenso→promozione era già cablato in
`enrichment_router.py:1217`, solo irraggiungibile senza i trigger.

| Goal | Stato | Test |
|------|-------|------|
| A2 trigger consenso | ✅ | 3 (consensus) |
| A3 promozione grafo | ✅ | 2 (promotion, grafo isolato) |
| A1 persistenza tracking | ✅ | 3 (tracking_events) |
| A4 authority post-consenso | ✅ | 1 + wiring `validate_entity` |
| A5 training manuale | ✅ | BFF 8 + FE 2 |
| B1 relazioni da note | ✅ | 7 (extractor + staging) |

**⚠️ Durabilità MERL-T:** le modifiche Python sono attive nel container via `docker cp`
(effimere) e i trigger/tabella sono già nel Postgres live. Per renderle permanenti serve
`docker compose -f docker-compose.merlt.yml --profile api-in-docker build` + recreate di
`merlt-api` E `merlt-worker` (il worker ha l'estrattore relazioni + document_parser).

## Stato attuale delle 8 fasi (sintesi, PRE-intervento)

| # | Fase | Stato oggi | Goal |
|---|------|-----------|------|
| 1 | Cattura segnali | ⚠️ in-memory, evapora al riavvio | **A1** |
| 2 | Authority/reputazione | ✅ aggiornata in MERL-T | **A4** (verifica e2e + refresh cache VisuaLex) |
| 3 | Generazione proposte | ✅ entità; relazioni assenti | **B1** |
| 4 | Validazione/voto | ✅ superficie attiva | — |
| 5 | Aggregazione/consenso | ❌ codice presente, mai invocato | **A2** |
| 6 | Promozione nel grafo | ⚠️ cablata ma irraggiungibile (manca chi accende `consensus_reached`) | **A3** |
| 7 | Reward/training RL | ❌ trainer dormienti (endpoint manuale già esiste) | **A5** |
| 8 | Ritorno all'utente (Q&A) | ❌ assente | rinviato (Slice 3) |

---

# EPIC A — Chiudere il loop RLCF

## Goal A1 — Persistere i segnali di tracking (fase 1)

**Obiettivo:** i 5 segnali Slice 1 (article-viewed, highlight/annotation, dossier-bookmark,
citation, forum) oggi arrivano a MERL-T ma finiscono in un buffer in RAM che si svuota a ogni
riavvio del container. Vanno persistiti, altrimenti l'intera Slice 1 è cosmetica.

**Dove (MERL-T Python):**
- `merlt/merlt/api/tracking_router.py:6` (commento "future: PostgreSQL"), `:50` `_event_buffer: List`,
  `:59` `receive_tracking_events`, `:79` truncation a `_MAX_BUFFER`.
- Modello/migrazione nuovi sotto `merlt/merlt/storage/enrichment/models.py` (+ migration, stile `005`).

**Cosa fare:**
1. Nuova tabella `tracking_events` (o `qa_traces` se si vuole allineare a `TRACE_SCHEMA.md`):
   `id, user_id (varchar100), event_type, payload JSON, authority_at_event NUMERIC?, created_at`.
2. `receive_tracking_events` scrive su DB invece (o oltre) al buffer; mantenere l'endpoint idempotente/batch.
3. Creazione tabella al boot via lifespan `create_tables()` (come lo staging di Slice 2c).
4. Endpoint di lettura/export per debug (opzionale).

**Criteri di accettazione:**
- POST `/api/v1/tracking/events` persiste su DB; conteggio sopravvive al restart del container.
- Test (TDD): inserimento batch → righe in tabella; `user_id` salvato come stringa (gotcha Slice 2c #2).

**Dipendenze:** nessuna. Foundational — farlo per primo.

**Decisioni aperte:** nome/forma tabella (`tracking_events` minimale vs `qa_traces` allineato a TRACE_SCHEMA).
Default consigliato: `tracking_events` minimale ora, `qa_traces` quando arriva lo Stage 8.

---

## Goal A2 — Motore di aggregazione a soglia (fase 5) — *l'anello mancante*

**Obiettivo:** trasformare i voti accumulati in una DECISIONE. Oggi `run_periodic_aggregation()`
e la logica di consenso esistono ma non sono chiamate da nessuno; i voti si accumulano senza
che nulla accenda `consensus_reached`.

**Dove (MERL-T Python):**
- `merlt/merlt/rlcf/feedback_aggregation_service.py:259` `run_periodic_aggregation`, `:99` `DISAGREEMENT_THRESHOLD=0.4`,
  `:101` `aggregate_trace_feedback`, `:151` `aggregate_component_feedback`.
- `merlt/merlt/rlcf/aggregation.py:152` `aggregate_with_uncertainty(db, task_id)` (entropia di Shannon pesata authority).
- `merlt/merlt/rlcf/edit_merge.py:102` `aggregate_edit_votes`, `:487` ("Chiamato quando il consensus_reached diventa True").
- Handler di voto in `merlt/merlt/api/enrichment_router.py` (intorno a `:1131`–`:1217`).

**Cosa fare (scelta: a soglia):**
1. Nell'handler di voto su `pending_entity`/`pending_relation`: dopo aver registrato il voto,
   contare i voti pesati per authority; se ≥ N (config, default es. 3) lanciare l'aggregazione
   (`aggregate_with_uncertainty` / `aggregate_edit_votes`).
2. Se il consenso supera la soglia di accordo (disagreement ≤ 0.4) → settare `consensus_reached=True`
   e `validation_status="approved"`; altrimenti lasciare in `pending`/`needs_revision` (uncertainty preserved).
3. Soglia N e logica configurabili via env (`RLCF_CONSENSUS_MIN_VOTES`, `RLCF_DISAGREEMENT_THRESHOLD`).

**Criteri di accettazione:**
- Con < N voti: `consensus_reached=False`, nessuna promozione.
- Con ≥ N voti concordi: `consensus_reached=True`, `validation_status="approved"`.
- Con ≥ N voti ma disagreement > soglia: resta non approvato (incertezza preservata).
- Test (TDD): simulare voti con authority diverse e verificare la decisione + il flag.

**Dipendenze:** i voti esistono già (BFF `routes/merlt/validate.ts`). Sblocca A3.

**Decisioni aperte:** soglia N di default e se pesare i voti per authority fin da subito
(consigliato sì: è il cuore di RLCF) o partire conteggio semplice.

---

## Goal A3 — Verifica end-to-end voto → consenso → promozione nel grafo (fase 6)

**Obiettivo:** la promozione è GIÀ cablata (`enrichment_router.py:1217 if entity.consensus_reached:`
→ scrittura FalkorDB via `entity_writer.py`), ma oggi non scatta mai perché manca A2.
Una volta fatto A2, verificare che il candidato approvato diventi davvero un nodo/arco nel grafo
e compaia su `/grafo`.

**Dove:**
- `merlt/merlt/api/enrichment_router.py:1217` (guardia di promozione), `merlt/merlt/storage/graph/entity_writer.py` (`write_entity`, dedup 3 livelli).
- Verifica lato VisuaLex: il nodo promosso deve essere visibile su `/grafo` (FE `graph/` Slice 2a).

**Cosa fare:**
1. Test d'integrazione: pending approvato (post-A2) → `_write_entity_to_graph` chiamato → nodo in FalkorDB.
2. Smoke manuale: contribuisci entità → fai votare fino a soglia → ricarica `/grafo` → il nodo c'è.
3. Verificare la dedup (non duplicare nodi già nel seed Libro IV).

**Criteri di accettazione:**
- Un'entità che raggiunge il consenso compare come nodo reale e navigabile su `/grafo`.
- Nessun duplicato rispetto al seed esistente.

**Dipendenze:** A2.

---

## Goal A4 — Aggiornamento authority post-validazione, end-to-end (fase 2)

**Obiettivo:** l'authority si aggiorna in MERL-T (`authority.py:162 update_authority_score`,
chiamata da `orchestrator.py:331 _update_user_authority`). Verificare che (a) si aggiorni davvero
in seguito agli esiti di validazione/contributo, e (b) VisuaLex rilegga il valore aggiornato
nella `MerltUserAuthorityCache` e lo mostri all'utente.

**Dove:**
- MERL-T: `merlt/merlt/rlcf/authority.py:162`, `merlt/merlt/rlcf/orchestrator.py:331`, `domain_authority.py`.
- VisuaLex BFF: `backend/src/services/merlt/authorityCache.ts` (TTL 1h), `routes/merlt/profile.ts`.
- VisuaLex FE: card profilo su `pages/MerltHubPage.tsx`.

**Cosa fare:**
1. Verificare/agganciare che l'esito di un voto (A2) e di una promozione (A3) inneschi `update_authority_score`
   per chi ha contribuito e per chi ha votato in linea col consenso.
2. Confermare che `GET /api/v1/profile/full` restituisca il punteggio aggiornato e che la cache VisuaLex lo aggiorni.
3. FE: mostrare il punteggio (e magari il delta) nella card profilo dell'hub.

**Criteri di accettazione:**
- Dopo un contributo validato, l'authority dell'utente cambia in MERL-T ed è visibile su `/merlt`.
- Test: outcome di validazione → `update_authority_score` invocata; profilo BFF riflette il nuovo valore.

**Dipendenze:** A2, A3.

---

## Goal A5 — Training RL: wiring manuale (fase 7)

**Obiettivo:** esporre il training del modello come operazione admin on-demand. L'endpoint MERL-T
**esiste già** (`rlcf_router.py:295 POST /api/v1/rlcf/training/start`, e `training_router.py`),
serve solo esporlo in sicurezza e poterlo lanciare dall'hub. NIENTE auto-training al boot.

**Dove:**
- MERL-T: `merlt/merlt/api/rlcf_router.py:295`, `merlt/merlt/api/training_router.py:9`,
  `merlt/merlt/rlcf/training_scheduler.py:662 start_auto_training` (NON agganciare al lifespan).
- VisuaLex BFF: nuova route admin sotto `routes/merlt/` protetta da `middleware/merlt/requireAdmin.ts` (già esistente),
  proxy verso MERL-T `/rlcf/training/start`.
- VisuaLex FE: la card ops admin su `pages/MerltHubPage.tsx` (oggi placeholder, `opsVisible`).

**Cosa fare:**
1. BFF: `POST /api/merlt/ops/training/start` (authenticate + requireAdmin) → proxy a MERL-T.
2. FE: bottone "Avvia training" nella card ops, visibile solo admin (`useMerltFeatures().opsVisible`), con conferma.
3. Mostrare lo stato/ultimo run se l'endpoint MERL-T lo restituisce.

**Criteri di accettazione:**
- Solo admin vede e può lanciare il training; non-admin → 403 `admin_required`.
- Il lancio inoltra a MERL-T e ritorna lo stato; nessun training parte automaticamente al boot.
- Test BFF: 403 senza admin; proxy corretto con admin.

**Dipendenze:** idealmente A1 (feedback persistito da cui addestrare). Indipendente da A2/A3 per il wiring.

**Decisioni aperte:** se il pulsante debba essere bloccato finché non c'è abbastanza feedback persistito.

---

# EPIC B — Completare i contributi: relazioni da note

## Goal B1 — Estrazione di RELAZIONI da testo libero (Slice 2c #5)

**Obiettivo:** oggi l'estrazione dalle note produce solo ENTITÀ. Il percorso relazioni (schema staging,
`CandidateCard`, `proposeRelation` lato BFF/FE) è completo, ma manca chi PRODUCE candidati-relazione
dagli appunti. Serve un estrattore LLM di relazioni su testo libero.

**Dove (MERL-T Python):**
- `merlt/merlt/pipeline/document_parser.py` (oggi `extract_entities=True, extract_amendments=False`,
  `persist_target="staging"`; `MechanisticExtractor` è solo Brocardi-structured).
- `merlt/merlt/worker/extraction_tasks.py` (`extract_to_staging`, oggi solo entità).
- Modello `ExtractionCandidate` (`candidate_type="relation"`, già previsto: `relation_type`, `source_node_urn`, `target_entity_id`).

**Cosa fare:**
1. Nuovo estrattore LLM di relazioni (concept→concept, entità→norma, ecc.) su testo libero,
   con confidenza e `verbatim_excerpt` per il copyright gate.
2. Agganciarlo in `extract_to_staging` (flag `extract_relations=True`), scrivendo candidati con `candidate_type="relation"`.
3. Best-effort dedup come per le entità (`EntityDeduplicator`/equivalente per relazioni).
4. Verifica del percorso esistente FE/BFF: `CandidateCard` mostra le relazioni, `proposeRelation` le promuove a `pending_relation`.

**Criteri di accettazione:**
- Un upload di note che descrive relazioni genera candidati-relazione in staging.
- I candidati passano dal copyright gate (`promotionGate.ts`) come le entità.
- Promozione → `pending_relation` → (con A2) validazione → grafo.
- Test (TDD): testo con relazione nota → almeno un candidato relazione con `relation_type` corretto.

**Dipendenze:** indipendente da Epic A (può procedere in parallelo); la promozione finale nel grafo richiede A2/A3.

**Decisioni aperte:** quale modello/prompt per l'estrazione relazioni (research-grade); set di `relation_type` ammessi.

---

# Ordine consigliato

```
A1 (persistenza)  ──┐
A2 (aggregazione) ──┼──> A3 (promozione e2e) ──> A4 (authority e2e)
                    │
A5 (training man.) ─┘   (dipende soft da A1)

B1 (relazioni) ── parallelo ── la promozione richiede A2/A3
```

Sequenza pragmatica: **A1 → A2 → A3 → A4 → A5**, con **B1** in parallelo da subito.

# Fuori scope (questa sessione)

- Stage 8 — Q&A di ritorno all'utente con incertezza calibrata + avvocato del diavolo (= "Slice 3").
- Auto-training al boot (fase 7 automatica).
- Hardening/deploy: strategia seed 39MB, smoke E2E browser, pulizia working tree, push/PR.

# Promemoria operativi

- Le modifiche al codice in `merlt/` sono **baked nell'immagine** al build → serve
  `docker compose --profile api-in-docker build` + recreate (gotcha Slice 2c #6). Le nuove tabelle
  si auto-creano al boot via lifespan `create_tables()`.
- `user_id` verso MERL-T è sempre `varchar(100)` (stringa), mai FK (gotcha Slice 2c #2).
- RQ job id non possono contenere `:` (gotcha Slice 2c #4) — usare `-`.
- `merlt-api` deve avere `RQ_REDIS_URL` se enqueua (gotcha Slice 2c #5).
