# MERL-T Q&A asincrono progressivo — contratto congelato

**Obiettivo.** Superare il mismatch «motore fino a 11 min vs timeout BFF 120s». Il Q&A diventa
**submit → poll** con aggiornamenti **progressivi per-esperto** (i canoni compaiono man mano
che finiscono, sul pannello di deliberazione e sul canvas del grafo).

**Architettura scelta.** Submit+Poll (non SSE) — riusa lo scaffold job già collaudato
(ingest/estrazione) e sopravvive al load balancer (`trust proxy`). Il lavoro pesante gira
**in-process nel processo FastAPI** (`asyncio.create_task`) per tenere caldo l'orchestrator
singleton (niente cold-start di un worker RQ). Il progresso viaggia MERL-T→BFF via callback
autenticato (`X-Internal-Secret`), il FE fa polling solo sul BFF.

```
FE ──POST /experts/query/async──▶ BFF ──POST /api/v1/experts/query/async──▶ MERL-T
   ◀────── 202 {jobId} ──────────    (crea MerltQaJob, best-effort enqueue)     │ asyncio.create_task
                                                                                ▼
FE ──GET /experts/jobs/:id/status─▶ BFF (legge la riga)          run_query_progressive()
   ◀─ {status,partials,result} ──                                    │  on ogni esperto → callback
                                     BFF ◀──POST /internal/qa-callback──┘  on fine → callback (result)
```

## Tipi condivisi

```ts
// Un esperto completato (payload progressivo). Combacia con ExpertContribution del FE.
QaPartialExpert = {
  expert: 'literal' | 'systemic' | 'principles' | 'precedent'  // = ExpertResponse.expert_type
  thesis: string        // = ExpertResponse.interpretation
  confidence: number    // 0..1
  weight: number        // peso gating se disponibile, altrimenti = confidence
}

// Stato job. Riusa l'enum MerltJobStatus esistente.
QaJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout'

// ExpertQueryResponse = la STESSA forma restituita oggi dal path sync (invariata).
```

## 1. FE → BFF — submit
`POST /api/merlt/experts/query/async`  (authenticate + consentGuard)
```jsonc
// body
{ "query": string, "mode": "convergent"|"divergent", "maxExperts"?: number, "context"?: {...come sync...} }
// 202
{ "jobId": string, "status": "pending" }
```

## 2. FE → BFF — poll
`GET /api/merlt/experts/jobs/:jobId/status`  (authenticate, owner-scoped → 404 se non proprietario)
```jsonc
{
  "jobId": string,
  "status": QaJobStatus,
  "partials": QaPartialExpert[],          // accumulati, ordinati per art.12 preleggi
  "result": ExpertQueryResponse | null,   // valorizzato solo su "completed"
  "error": string | null
}
```

## 3. BFF → MERL-T — enqueue
`POST :8000/api/v1/experts/query/async`  (X-API-Key)
```jsonc
{ "query": string, "user_id": string, "consent_level": "anonymous"|"basic"|"full",
  "max_experts": number, "context": {...}, "include_trace": true, "bff_job_id": string }
// 202
{ "accepted": true, "trace_id"?: string }
```

## 4. MERL-T → BFF — callback
`POST /api/merlt/internal/qa-callback`  (header `X-Internal-Secret` = `MERLT_INTERNAL_SECRET`)
```jsonc
// per-esperto (n volte)
{ "bffJobId": string, "status": "running", "partialExpert": QaPartialExpert }
// terminale ok
{ "bffJobId": string, "status": "completed", "result": ExpertQueryResponse }
// terminale ko
{ "bffJobId": string, "status": "failed"|"timeout", "error": string }
```
URL letto da env `BFF_QA_CALLBACK_URL` sul servizio `merlt-api` (accanto a `BFF_CALLBACK_URL`).

## 5. Prisma — nuovo modello (BFF)
```prisma
model MerltQaJob {
  id           String         @id @default(uuid())
  userId       String
  query        String
  mode         String
  consentLevel String                          // catturato al submit (no downgrade post-hoc)
  status       MerltJobStatus @default(pending)
  traceId      String?
  partials     Json?                           // QaPartialExpert[]
  result       Json?                           // ExpertQueryResponse
  errorMessage String?
  createdAt    DateTime       @default(now())
  startedAt    DateTime?
  completedAt  DateTime?
  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("merlt_qa_jobs")
}
```
+ back-ref `merltQaJobs MerltQaJob[]` su `User`. `jobWatchdog` sweepa anche questa tabella
(pending/running più vecchi della soglia → `timeout`).

## Invarianti / gotcha
- **Ordine canoni**: `partials` sempre riordinati per art.12 preleggi (letterale→sistematico→
  principî→precedente); il FE keya su `expert` (no remount a metà stream).
- **Sintesi/dissenso sono terminali**: `disagreement_analysis`, `synthesis`, `confidence`
  arrivano SOLO in `result` (mai dai partial → niente flash a confidenza 0).
- **latest-wins + Annulla**: il poll loop ricontrolla il token del turno a ogni tick e ferma
  l'intervallo su cancel. I turni non-`completed` NON vengono persistiti (reload non deve
  ripristinare una deliberazione a metà).
- **Refactor sync = pura estrazione**: il builder condiviso `ExpertQueryResponse` non cambia il
  comportamento del path `/query` sincrono (che resta come fallback).
- **Consent redaction** rispetta `consentLevel` catturato al submit.
- **Callback best-effort ma affidabile**: se un callback per-esperto fallisce, il job prosegue;
  il callback terminale è quello che sblocca il poll. Il watchdog è la rete di sicurezza.
```
