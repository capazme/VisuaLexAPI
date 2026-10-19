# MERL-T ↔ VisuaLex — Slice 2c Design: "Apprendi dai miei appunti"

**Branch:** `visualex-merlt-main` · **Data:** 2026-05-26 · **Dipende da:** Slice 2a (grafo + worker), Slice 2b (consenso + hub)

---

## 1. Goal e framing

Permettere all'utente di **caricare propri file di studio** (appunti, schemi, estratti di manuali) → estrazione LLM **asincrona** di candidati nodi/archi → **revisione per-item** → **promozione** come proposte RLCF (`pending_*`) verso il **grafo centrale**, con voto/validazione della community prima del merge.

### Riallineamento (decisione utente)
Il fine **non** è un grafo personale persistito sul server. Motivo: **risorse/costo** — il grafo centrale è enorme e già costoso; **non possiamo ospitare il grafo di ogni utente**. Il server offre tre affordance economiche:

1. **Pushare nodi per l'approvazione** → contrib → `pending_*` *(core di questo slice)*.
2. **Salvare una query sul grafo centrale** → puntatore leggero (salva i **parametri**, non i dati; si ri-esegue sul centrale) *(storia opzionale)*.
3. **Esportare lo slice personale in locale** → snapshot JSON scaricabile + reload/render G6 client-side *(in MVP)*.

Conseguenza: i file caricati e i candidati estratti sono **transitori server-side** (purgati dopo promozione o TTL); il "grafo personale" dell'utente vive **client-side + snapshot locale**.

---

## 2. Cosa esiste già (verificato — non reinventare)

| Area | Endpoint / asset MERL-T | Note |
|------|--------------------------|------|
| Upload | `POST /api/v1/documents/upload` | multipart, **PDF/TXT/DOCX, 50MB** (`MAX_UPLOAD_SIZE_MB`), dedup SHA-256, salva su disco + tabella `UserDocument` (`uploaded_by` = user_id stringa), auth `api_key`. |
| Parse | `POST /api/v1/documents/{id}/parse` | ⚠️ **SINCRONO** e scrive **dritto in `pending_*`**. Non riusabile così com'è. |
| Proposte RLCF | `POST /api/v1/enrichment/propose-entity` / `propose-relation` | Creano righe `pending_*`. Riusati in promozione. |
| Validazione | `validate-entity` / `validate-relation`, `GET /pending`, `duplicate-check` (mechanical + LLM) | Pipeline community completa. |
| Schema | `pending_entities` / `pending_relations` | Hanno già: `source_document_id`, `fonte varchar(50)`, `contributed_by varchar(100)`, `llm_confidence/model/reasoning`, `duplicate_check_*`, `potential_duplicate_of`, `validation_status`, scores, `consensus_reached`, trigger DB che auto-flippano lo status al consenso. |
| Dedup substrate | `bridge_table` (chunk→URN, confidence, metadata jsonb) | Grounding/dedup. |
| Provenienza nodi | campo `fonte` | Valori esistenti: `Normattiva`, `Brocardi`, `manuale:Torrente-libroiv`, `community_validation`, `VisualexAPI`. `utente:<file>` ci sta (≤50 char). |
| Worker / job | pattern `MerltIngestionJob` + `/api/merlt/internal/job-callback` (internalAuth) | Template per l'estrazione async. |

### Scostamenti critici (= lavoro nuovo)
- **L'estrazione è sincrona** → va resa **async (worker RQ)**.
- **Non esiste livello di staging**: il parse scrive in `pending_*`. Serve una **tabella `extraction_candidates`** (effimera) dove l'estrazione deposita i candidati **senza** toccare `pending_*`.

---

## 3. Decisioni architetturali load-bearing

| # | Decisione | Motivazione |
|---|-----------|-------------|
| C1 | **Mai auto-merge.** Human-in-the-loop obbligatorio: promozione per-item → `pending_*` → voto RLCF → merge. | L'estrazione LLM da testo libero è rumorosa. |
| C2 | **Estrazione asincrona su worker RQ.** BFF crea un `MerltExtractionJob`, MERL-T accoda, il worker scrive in `extraction_candidates` e richiama `/internal/job-callback`. | PDF 50MB + LLM = minuti; sync rischia timeout. Riusa il pattern di 2a. |
| C3 | **Staging effimero, purgato.** `extraction_candidates` vive solo durante lavorazione+revisione; purge dopo promozione o TTL (default 48h). | Vincolo costo: il server tiene solo grafo centrale + `pending_*`. |
| C4 | **Il verbatim non entra mai in `pending_*`.** Lo staging tiene il testo grezzo; la promozione crea righe `pending_*` dal testo **riformulato**. | Confine copyright difendibile. |
| C5 | **Copyright-gate enforced sul BFF** (non solo UI): per promuovere servono `fonte` non vuota **AND** testo proposto ≠ verbatim **AND** flag `attested=true`. | Forza consapevolezza + traccia provenienza; non rileva il plagio ma alza la barriera. |
| C6 | **Promozione per-item** (single o multi-select di item già revisionati), mai batch dell'intero set grezzo. | Anti-rumore + copyright. |
| C7 | **`user_id` passato come stringa VisuaLex** ovunque verso MERL-T (`varchar(100)`, nessuna FK). | Gotcha noto (`legacy_libro_iv_recovery`). |
| C8 | **BFF unico canale.** `authenticate` + `consentGuard` (assicura che il consenso esista) + **check di livello `full` al route layer** (`contributionEnabled`, come il pattern Slice 1 per i forum-signal) + `internalAuth` per i callback worker. | Invariante di sicurezza. Il `consentGuard` esistente verifica solo `none` vs non-`none`; il requisito `full` per la contribuzione si controlla esplicitamente nella route (o con un helper `requireConsentLevel('full')`). |
| C9 | **"Grafo personale" = client-side + snapshot locale.** Niente persistenza server-side per-utente. | Vincolo costo. |

---

## 4. Flusso end-to-end

```
[FE] UploadDropzone (PDF/TXT/DOCX ≤50MB)
  └─ POST /api/merlt/contrib/documents (multipart, authenticate + consentGuard:full)
       └─ BFF forward → MERL-T /documents/upload (user_id = VisuaLex id stringa, api_key)
            └─ ritorna document_id
[FE] "Estrai"
  └─ POST /api/merlt/contrib/documents/:id/extract
       └─ BFF crea MerltExtractionJob(pending) → MERL-T enqueue task (job_id = sha256(docId))
            └─ [worker] extract_to_staging: LLM → righe extraction_candidates(doc, contributor)
                 └─ callback BFF /internal/job-callback (internalAuth) → job=completed
[FE] useExtractionJob poll (2s) → completed → GET /api/merlt/contrib/documents/:id/candidates
  └─ CandidateReviewList: per ogni candidato → CandidateCard
       (verbatim a fianco, hint dedup via duplicate-check / potential_duplicate_of,
        campo fonte, textarea riformulazione, checkbox attestazione)
[FE] "Promuovi" (per-item / multi-select)
  └─ POST /api/merlt/contrib/candidates/:id/promote { reformulatedText, descrizione, fonte, attested }
       └─ BFF copyright-gate (fonte≠"" AND testo≠verbatim AND attested) →
            MERL-T propose-entity/relation (contributed_by=userId, fonte=utente:<file>, source_document_id)
            → pending_* (RLCF) → voto community (trigger) → merge canonico
[FE] "Esporta slice" → download JSON (client-side) · "Carica slice" → render G6 read-only
[server] purge: candidati promossi rimossi subito; resto via TTL 48h; file upload rimosso dopo estrazione
```

---

## 5. Componenti

### 5.1 MERL-T (`VisuaLexAPI/merlt/`) — ⚠️ diverge dall'upstream (disciplina `docs/merlt-upstream-sync.md`)

- **Tabella `extraction_candidates`** (nuova, Postgres MERL-T): `id`, `document_id` (FK UserDocument), `contributor_id varchar(100)`, `candidate_type` (entity|relation), `entity_text`/`relation_*`, `verbatim_excerpt text`, `suggested_descrizione text`, `llm_confidence`, `potential_duplicate_of`, `dup_check_done bool`, `status` (draft|promoted|expired), `created_at`, `expires_at`. Migration Alembic.
- **Task worker `extract_to_staging`** (RQ, container `merlt-worker`): riusa `DocumentParserService` ma **redirige** i candidati in `extraction_candidates` invece di `pending_*`. Esegue duplicate-check e popola `potential_duplicate_of`. Callback BFF.
- **Endpoint nuovi** (`document_router` o nuovo `contrib` router, prefix `/api/v1`):
  - `POST /documents/{id}/extract-async` → enqueue, ritorna `{ task_id }`.
  - `GET /documents/{id}/candidates?contributor_id=` → lista candidati (scoped contributore).
  - `GET /candidates/{id}` → dettaglio (incl. verbatim).
  - `POST /candidates/{id}/mark-promoted` → status=promoted (chiamato dal BFF dopo propose-* ok).
- **Purge**: job schedulato (o on-access) che elimina `status=expired`/oltre `expires_at` + i file `UserDocument` dopo estrazione completata.
- **Riuso invariato**: `propose-entity/relation`, `duplicate-check`, `/upload`.

### 5.2 BFF Node (`backend/src/`)

- **`routes/merlt/contrib.ts`** (nuovo, montato in `routes/merlt/index.ts` **prima** dei catch-all auth — gotcha #1):
  - `POST /contrib/documents` (multipart, `authenticate` + `consentGuard` + check livello `full`): valida ext (PDF/TXT/DOCX) + size ≤50MB **prima** del forward; forward a MERL-T `/documents/upload` con `user_id=req.user.id`.
  - `POST /contrib/documents/:id/extract` (auth + consentGuard + check `full`): crea `MerltExtractionJob`, chiama MERL-T `extract-async`.
  - `GET /contrib/documents/:id/candidates` (auth): proxy scoped `contributor_id=req.user.id` (no IDOR).
  - `GET /contrib/jobs/:jobId/status` (auth, owner-scoped).
  - `POST /contrib/candidates/:id/promote` (auth+consentGuard): **copyright-gate** server-side → `propose-*` → `mark-promoted`.
  - `POST /internal/job-callback` esteso per gli extraction job (riusa internalAuth).
- **`services/merlt/contribClient.ts`** (nuovo): mirror di `graphClient.ts` (fetch + AbortController + gerarchia errori). Metodi: `uploadDocument`, `extractAsync`, `listCandidates`, `getCandidate`, `proposeEntity/Relation`, `markPromoted`.
- **Prisma `MerltExtractionJob`** (mirror `MerltIngestionJob`): `id`, `documentId`, `userId`, `status` (enum `MerltJobStatus` riusato), `taskId`, `candidatesCreated`, `errorMessage`, timestamps. `@@map merlt_extraction_jobs`.

### 5.3 Frontend (`frontend/src/features/merlt/contrib/`)

- `UploadDropzone.tsx` — drag&drop, valida ext/size client-side, mostra stato upload.
- `useExtractionJob.ts` — poll 2s (riusa il pattern di `useIngestionJob` di 2a: stop su terminale, cleanup unmount, derivazione nel render per `set-state-in-effect`).
- `CandidateReviewList.tsx` + `CandidateCard.tsx` — per candidato: verbatim a fianco (read-only), hint dedup ("simile a <nodo>" da `potential_duplicate_of`), campo `fonte`, textarea riformulazione, checkbox attestazione, azione "Promuovi" (single) + selezione multipla.
- `snapshotIO.ts` — `exportSlice()` (download JSON dei nodi/archi della sessione) + `importSlice()` (parse + render read-only riusando il transform G6 di 2a).
- `contribApi.ts` + `types.ts` — client BFF tipati + tipi.
- **Hub**: la card *Contributi RLCF* di 2b diventa live → route `/merlt/contribuisci` (code-split, `React.lazy`), gated da `VITE_FEATURE_MERLT` + `consentLevel==='full'`.

### 5.4 (Opzionale) Salva query sul grafo centrale
- Prisma `MerltSavedGraphQuery` (`userId`, `label`, `params` JSON — urn/depth/layout/filtri). BFF `GET/POST/DELETE /contrib/saved-queries`. FE: pulsante "Salva questa vista" su `/grafo`, lista nell'hub. **Storia droppabile** (`2c.x opzionale`).

---

## 6. Testing strategy

- **MERL-T (pytest):** `extract_to_staging` (candidati in staging, non in `pending_*`), endpoint candidates (scope contributore), purge/TTL.
- **BFF (vitest+supertest, nock MERL-T):** route contrib (upload validazione ext/size, extract→job, candidates IDOR-scoped, **copyright-gate** sui 3 casi di rifiuto + caso ok, callback internalAuth), `MerltExtractionJob` lifecycle.
- **FE (vitest):** `useExtractionJob` (poll/terminale/cleanup), `CandidateCard` (gate UI: promuovi disabilitato finché fonte+riformulazione+attestazione), `snapshotIO` (round-trip export/import).
- **Smoke E2E:** sezione "Slice 2c" in `docs/merlt-smoke-checklist.md` (richiede stack Docker MERL-T + worker).

---

## 7. Done criteria

- [ ] Upload (PDF/TXT/DOCX ≤50MB) via BFF, validato lato BFF.
- [ ] Estrazione async su worker; staging in `extraction_candidates`, **mai** in `pending_*`.
- [ ] Revisione per-item con hint dedup + verbatim a fianco.
- [ ] Promozione per-item → `pending_*` con `fonte`/`contributed_by`/`source_document_id`; copyright-gate **server-side**.
- [ ] Snapshot locale export/import (render G6 read-only).
- [ ] Purge staging (post-promozione + TTL) e file upload post-estrazione.
- [ ] Test MERL-T/BFF/FE verdi; lint/tsc/mypy puliti; fix di eventuali errori pre-esistenti incontrati.
- [ ] CLAUDE.md + smoke checklist Slice 2c + nota upstream-sync MERL-T.

---

## 8. Out of scope

- Editing diretto del grafo canonico senza RLCF.
- Condivisione automatica di contenuti caricati.
- Persistenza server-side del grafo personale (per costo) — sostituita da snapshot locale + saved-query.
- Estrazione di emendamenti/multivigenza (il parser li supporta ma fuori scope qui).

---

## 9. Rischi

- **Divergenza upstream MERL-T**: nuova tabella + task + endpoint vanno tracciati in `docs/merlt-upstream-sync.md` per il re-sync da ALIS_CORE.
- **Qualità estrazione LLM**: rumore alto → la revisione per-item è la mitigazione; mostrare `llm_confidence`.
- **Costo LLM** per estrazione: l'async + il dedup pre-promozione limitano il lavoro; valutare cap su #candidati/documento.
