# Sprint Plan: MERL-T Slice 2c — "Apprendi dai miei appunti"

**Branch:** `visualex-merlt-main` · **Design:** `docs/superpowers/specs/2026-05-26-merlt-slice2c-learn-from-notes-design.md`
**Dipende da:** Slice 2a (grafo + worker), Slice 2b (consenso `full` + hub).
**Obiettivo:** upload appunti → estrazione LLM async → revisione per-item → promozione RLCF (`pending_*`) verso il grafo centrale; più snapshot personale locale.

## Executive Summary

11 storie (+1 opzionale) su 3 layer: MERL-T Python (2c.1-2c.3), BFF Node (2c.4-2c.6), Frontend (2c.7-2c.10). Ordine bottom-up: prima lo staging + worker + endpoint MERL-T, poi i proxy BFF (job/upload/promote con copyright-gate), infine la UI. TDD; code-review + fix di tutti gli issue dopo ogni storia; commit per storia (mai auto-commit/push).

> ⚠️ Le storie 2c.1-2c.3 modificano `VisuaLexAPI/merlt/` → diverge dall'upstream: tracciare in `docs/merlt-upstream-sync.md`.

## Story Inventory

### MERLT-2c.1 — MERL-T: tabella `extraction_candidates` + migration
- **Scope:** modello + migration Alembic (vedi §5.1 design): `document_id`, `contributor_id varchar(100)`, `candidate_type`, testo entità/relazione, `verbatim_excerpt`, `suggested_descrizione`, `llm_confidence`, `potential_duplicate_of`, `dup_check_done`, `status` (draft|promoted|expired), `expires_at`.
- **AC:** migration applica/rollback pulita; nessun impatto su `pending_*`.
- **Test:** pytest model + migration smoke.
- **Skill:** `database-architect`, `tdd`.

### MERLT-2c.2 — MERL-T: worker task `extract_to_staging`
- **Scope:** task RQ (`merlt-worker`) che riusa `DocumentParserService` ma **redirige** i candidati in `extraction_candidates` (NON `pending_*`); esegue duplicate-check (mechanical+LLM) e popola `potential_duplicate_of`; callback BFF a fine job.
- **AC:** parse non scrive più in `pending_*` in questo path; candidati con dedup hint; idempotente (job_id = sha256(docId)).
- **Test:** pytest (estrazione→staging, dedup popolato, no pending_* write).
- **Skill:** `scraper-builder`(async), `tdd`.

### MERLT-2c.3 — MERL-T: endpoint extract-async / candidates / mark-promoted + purge
- **Scope:** `POST /documents/{id}/extract-async` (enqueue), `GET /documents/{id}/candidates?contributor_id=`, `GET /candidates/{id}`, `POST /candidates/{id}/mark-promoted`; job di purge (status=expired/oltre TTL + file `UserDocument` post-estrazione).
- **AC:** candidates scoped per contributore; mark-promoted flippa status; purge rimuove staging+file.
- **Test:** pytest endpoint + purge.
- **Skill:** `api-designer`, `tdd`.

### MERLT-2c.4 — BFF: Prisma `MerltExtractionJob` + contribClient + upload/extract
- **Scope:** Prisma `MerltExtractionJob` (mirror `MerltIngestionJob`, `@@map merlt_extraction_jobs`); `services/merlt/contribClient.ts`; `routes/merlt/contrib.ts` con `POST /contrib/documents` (multipart, valida ext/size ≤50MB pre-forward) e `POST /contrib/documents/:id/extract` (crea job + enqueue). Montare in `routes/merlt/index.ts` **prima** dei catch-all auth.
- **AC:** upload forwarda con `user_id=req.user.id`; estrazione crea job pending; ext/size invalidi → 400/413 prima del forward.
- **Test:** vitest+supertest (nock MERL-T): upload ok/ext-invalida/oversize, extract→job.
- **Skill:** `tdd`, `api-designer`.

### MERLT-2c.5 — BFF: candidates / job status / callback
- **Scope:** `GET /contrib/documents/:id/candidates` (scoped `contributor_id=req.user.id`, no IDOR), `GET /contrib/jobs/:jobId/status` (owner-scoped), estensione `POST /internal/job-callback` (internalAuth) per gli extraction job → flip `MerltExtractionJob`.
- **AC:** un utente non vede candidati altrui; callback aggiorna lo status corretto.
- **Test:** vitest+supertest (IDOR negato, callback internalAuth ok/secret errato).
- **Skill:** `tdd`, `security-audit`.

### MERLT-2c.6 — BFF: promote + copyright-gate
- **Scope:** `POST /contrib/candidates/:id/promote` (auth+consentGuard:full): **gate server-side** = `fonte` non vuota **AND** testo riformulato ≠ verbatim **AND** `attested===true`; poi `propose-entity/relation` (contributed_by=userId, fonte=`utente:<file>`, source_document_id) + `mark-promoted`.
- **AC:** i 3 casi di violazione → 422 con motivo; caso valido → crea `pending_*` e marca promosso.
- **Test:** vitest+supertest (4 casi del gate + happy path con nock).
- **Skill:** `tdd`, `security-audit`.

### MERLT-2c.7 — FE: UploadDropzone + useExtractionJob + api/types
- **Scope:** `features/merlt/contrib/{UploadDropzone.tsx,useExtractionJob.ts,contribApi.ts,types.ts}`. Dropzone valida ext/size client-side; `useExtractionJob` poll 2s (pattern `useIngestionJob`: stop su terminale, cleanup, derivazione nel render per `set-state-in-effect`).
- **AC:** upload→extract→poll→completed; errori gestiti; flag+consenso gateano.
- **Test:** vitest (useExtractionJob poll/terminale/cleanup; dropzone validazione).
- **Skill:** `tdd`, `react-patterns`.

### MERLT-2c.8 — FE: CandidateReviewList + CandidateCard
- **Scope:** lista candidati; per item: verbatim a fianco (read-only), hint dedup (`potential_duplicate_of`), campo `fonte`, textarea riformulazione, checkbox attestazione, "Promuovi" (single) + selezione multipla. "Promuovi" disabilitato finché gate UI non soddisfatto.
- **AC:** UX di revisione chiara; gate UI rispecchia il gate server; multi-select promuove per-item in sequenza.
- **Test:** vitest (gate UI; promote chiama API; multi-select).
- **Skill:** `tdd`, `frontend-design`.

### MERLT-2c.9 — FE: snapshot locale export/import
- **Scope:** `features/merlt/contrib/snapshotIO.ts`: `exportSlice()` (download JSON dei nodi/archi di sessione), `importSlice()` (parse + render G6 read-only riusando il transform di 2a).
- **AC:** round-trip export→import fedele; render read-only senza chiamate server.
- **Test:** vitest (round-trip; transform).
- **Skill:** `tdd`.

### MERLT-2c.10 — FE: hub card live + route `/merlt/contribuisci`
- **Scope:** la card *Contributi RLCF* dell'hub 2b diventa live; route `/merlt/contribuisci` (code-split, `React.lazy`), gated `VITE_FEATURE_MERLT` + `consentLevel==='full'`. Wiring upload→review→promote→snapshot.
- **AC:** flusso completo raggiungibile dall'hub; gating consenso corretto.
- **Test:** vitest (gating; rendering flusso).
- **Skill:** `frontend-design`, `tdd`.

### MERLT-2c.x — (OPZIONALE) Salva query sul grafo centrale
- **Scope:** Prisma `MerltSavedGraphQuery`; BFF `GET/POST/DELETE /contrib/saved-queries`; FE "Salva questa vista" su `/grafo` + lista nell'hub. **Droppabile.**
- **Skill:** `tdd`.

### MERLT-2c.11 — Chiusura Slice 2c
- **Scope:** smoke checklist "Slice 2c" (richiede stack Docker MERL-T + worker), `CLAUDE.md`, nota `docs/merlt-upstream-sync.md`, fix di tutti gli issue di review + errori pre-esistenti incontrati.
- **AC:** Done criteria del design spuntati; suite MERL-T/BFF/FE verde.
- **Skill:** `code-review`, `scribe`.

## Cross-cutting
- **Feature flag:** `VITE_FEATURE_MERLT` + gate `consentLevel==='full'` per la contribuzione.
- **Sicurezza:** `consentGuard:full` su upload/extract/promote; copyright-gate server-side; IDOR-scoping su candidates/jobs; internalAuth sui callback.
- **user_id:** sempre stringa VisuaLex verso MERL-T (varchar(100), no FK).
- **Done Slice 2c:** vedi §7 del design doc.
