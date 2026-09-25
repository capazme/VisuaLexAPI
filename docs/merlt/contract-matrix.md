# Matrice contratto BFF → MERL-T

Il browser parla solo con il BFF Node (`/api/merlt/*`). Il BFF autentica l'utente VisuaLex, applica i guard e inietta `user_id` nel corpo o nella query verso MERL-T. Non inoltra né il JWT né alcun header `X-User-ID`.

Ogni client BFF invia `MERLT_API_KEY` come `X-API-Key` quando la variabile è impostata. MERL-T rende `verify_api_key` opzionale: `merlt/merlt/app.py` fa `app.dependency_overrides[verify_api_key] = optional_api_key`. La chiave serve quindi solo alle route `require_role("admin")`, marcate **ADMIN** qui sotto. **OPT** vuol dire che MERL-T accetta la richiesta anche senza chiave: su quelle route il solo cancello è il BFF, e per questo `:8000` non va mai esposto.

Fonte di verità: `backend/src/routes/merlt/index.ts` (montaggio e feature flag) e i router in `backend/src/routes/merlt/*.ts`. Le tabelle elencano le route effettivamente montate al 2026-09-25.

**Legenda guard:**

| Guard | Cosa richiede | Altrimenti |
|---|---|---|
| `auth` | JWT | — |
| `consent` | consenso `basic` o `full` | 403 `consent_required` |
| `contrib` | consenso `full` | 403 `contribution_consent_required` |
| `valid` | consenso `full` | 403 `validation_consent_required` |
| `admin` | utente admin | 403 `admin_required` |
| `internal` | `X-Internal-Secret` uguale a `MERLT_INTERNAL_SECRET` | — |
| `owner` | la risorsa appartiene al chiamante | 404, mai 403 |

**Legenda flag:** il kill switch `MERLT_ENABLED` vale per tutte le route. La colonna «Flag» indica il sotto-flag che, se spento, fa rispondere la route con 404 `merlt_disabled`.

## Base (solo kill switch)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/health` | GET | nessuno | `GET /health` | pubblico | hub (`useHubData` → `getMerltHealth`), `GraphCard` |
| `/consent` | GET, POST, DELETE | `auth` | nessuno: Prisma `MerltUserPreference` + `MerltConsentAudit` | — | `ConsentProvider` (`fetchMerltConsent`, `setMerltConsent`, `revokeMerltConsent`) |
| `/profile` | GET | `auth` | `GET /api/v1/profile/full?user_id=` (via `authorityCache`, TTL 1 h) | OPT | hub `ProfileCard` (`fetchMerltProfile`) |
| `/events/article-viewed` | POST | `auth` + `consent` | `POST /api/v1/tracking/events`; poi `GET /api/v1/graph/check-article` e, se assente, `POST /api/v1/graph/ingest-article` | OPT | `useArticleViewedTracker` |
| `/events/highlight-annotation` | POST | `auth` + `consent` | `POST /api/v1/tracking/events` | OPT | `useHighlightAnnotationTracker` |
| `/events/dossier-bookmark` | POST | `auth` + `consent` | `POST /api/v1/tracking/events` | OPT | `useDossierBookmarkTracker` |
| `/events/citation-clicked` | POST | `auth` + `consent` | `POST /api/v1/tracking/events` | OPT | `useCitationTracker` |
| `/events/forum-signal` | POST | `auth` + `consent` | `POST /api/v1/tracking/events` | OPT | `useForumSignalTracker` |

## Q&A esperti (`experts.ts`, solo kill switch)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/experts/query` | POST | `auth` + `consent` | `POST /api/v1/experts/query` (sync, timeout `MERLT_EXPERTS_TIMEOUT_MS`) | OPT | nessuno nel FE: `qaApi.askQuestion` non è usato, perché il FE chiede in async. Serve per curl, e2e e smoke |
| `/experts/query/async` | POST | `auth` + `consent` | `POST /api/v1/experts/query/async` (`bff_job_id`) | OPT | `useQaThread.askAsync` su `/grafo` |
| `/experts/jobs/:jobId/status` | GET | `auth` + `owner` | nessuno: Prisma `MerltQaJob` | — | polling di `useQaThread` |
| `/experts/history` | GET | `auth` + `consent` | `GET /api/v1/experts/history?user_id=&limit=` | OPT | `QaHistoryPanel` |
| `/experts/trace/:traceId` | GET | `auth` + `consent` + `owner` | `GET /api/v1/experts/trace/{id}?caller_consent=` | OPT | dettagli di un turno riaperto (`qaApi`) |
| `/experts/refine` | POST | `auth` + `consent` + `owner` | `POST /api/v1/experts/feedback/refine` | OPT | `RefineField` → `useQaThread.refine` |
| `/experts/feedback/inline` | POST | `auth` + `contrib` + `owner` | `POST /api/v1/experts/feedback/inline` | OPT | `DeliberationColumn` (👍/👎) |
| `/experts/feedback/source` | POST | `auth` + `contrib` + `owner` | `POST /api/v1/experts/feedback/source` | OPT | `QaSourceChip` (pertinenza) |
| `/experts/feedback/detailed` | POST | `auth` + `contrib` + `owner` | `POST /api/v1/experts/feedback/detailed` | OPT | valutazione dettagliata in `DeliberationColumn` |
| `/experts/feedback/preference` | POST | `auth` + `contrib` + `owner` | `POST /api/v1/experts/feedback/preference` | OPT | «Mi convince» (canone preferito) |
| `/experts/feedback/relation` | POST | `auth` + `contrib` + `owner` | `POST /api/v1/experts/feedback/relation` | OPT | steer per relazione su `/grafo` |
| `/experts/confirm-source` | POST | `auth` + `contrib` | `POST /api/v1/enrichment/confirm-source` | OPT | «Ricorda nel grafo» su `QaSourceChip` (nodi `live:`) |
| `/internal/qa-callback` | POST | `internal` | chiamata da merlt-api (`BFF_QA_CALLBACK_URL`) | — | — |

**Owner sulle tracce** (`callerOwnsTrace`): passa se vale una di queste prove, altrimenti 404 `trace_not_found`.

1. Un `MerltQaJob` del chiamante porta quel trace id.
2. La traccia memorizzata nomina il chiamante.
3. Il trace id compare tra gli ultimi 100 turni della sua history.

**Dedup in memoria:** i canali preference, relation e confirm-source sono deduplicati per 10 minuti.

## Grafo (`graph.ts`, flag `MERLT_GRAPH_ENABLED`)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/graph/article/:urn` | GET | `auth` | `GET /api/v1/graph/subgraph?root_urn=&depth=&max_nodes=` (depth 1..3, limit 1..200; `subgraphCache`) | OPT | side rail, `/grafo` (`graphApi`) |
| `/graph/search` | GET | `auth` | `GET /api/v1/graph/entities/search?q=&limit=` (autocomplete fuzzy) | OPT | `GraphSearchBox` |
| `/graph/provisional-review` | GET | `auth` + `valid` | `GET /api/v1/graph/provisional-review?limit=` | OPT | `ProvisionalReviewSection` su `/merlt/valida` |
| `/graph/provisional-review/:nodeId` | POST | `auth` + `valid` | `POST /api/v1/graph/provisional-review/{node_id}` (`approve` o `reject`) | OPT | `ProvisionalReviewSection` |
| `/graph/ingest` | POST | `auth` + `consent` | `POST /api/v1/graph/ingest-article` (RQ `merlt_ingest`, job id `ingest-<sha256[:40]>`) | OPT | side rail, `/grafo` |
| `/graph/jobs/:jobId/status` | GET | `auth` + `owner` | nessuno: Prisma `MerltIngestionJob` | — | `useIngestionJob` |
| `/internal/job-callback` | POST | `internal` | chiamata da merlt-worker (`BFF_CALLBACK_URL`) | — | — |

## Contributi (`contrib.ts`, flag `MERLT_CONTRIBUTION_ENABLED`)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/contrib/documents` | POST (multipart, ≤50 MB, PDF/TXT/DOCX) | `auth` + `contrib` | `POST /api/v1/documents/upload` | OPT | `UploadDropzone` (`uploadContribDocument`) |
| `/contrib/documents/:id/extract` | POST | `auth` + `contrib` + `owner` | `GET /api/v1/documents/{id}` (proprietà), poi `POST /api/v1/documents/{id}/extract-async` (RQ `merlt_extract`) | OPT | `ContribPage` |
| `/contrib/documents/:id/candidates` | GET | `auth` + `contrib` + `owner` | `GET /api/v1/documents/{id}/candidates?user_id=` | OPT | `CandidateReviewList` |
| `/contrib/jobs/:jobId/status` | GET | `auth` + `owner` | nessuno: Prisma `MerltExtractionJob` | — | `useExtractionJob` |
| `/contrib/me/jobs` | GET | `auth` | nessuno: Prisma `MerltExtractionJob` | — | `contribApi` |
| `/contrib/candidates/:id/promote` | POST | `auth` + `contrib` + `owner` + gate copyright | `GET /api/v1/candidates/{id}`, `POST /api/v1/enrichment/propose-entity` o `propose-relation`, `POST /api/v1/candidates/{id}/mark-promoted` | OPT | `CandidateCard` |
| `/internal/extraction-callback` | POST | `internal` | chiamata da merlt-worker (`BFF_EXTRACTION_CALLBACK_URL`) | — | — |

Il controllo `owner` di questa sezione confronta `uploaded_by` del documento MERL-T con il chiamante. Per il promote risale dal candidato al suo documento. Sul promote di una relazione, il BFF accetta solo endpoint già risolti: un URN o URL `urn:nir:`, oppure un id `<tipo>:<slug>`. Altrimenti risponde 400 `unresolved_endpoint`.

## Validazione (`validate.ts`, flag `MERLT_VALIDATION_ENABLED`)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/validate/pending` | GET | `auth` + `valid` | `GET /api/v1/enrichment/pending` | OPT | `ValidationPage` |
| `/validate/entity` | POST | `auth` + `valid` | `POST /api/v1/enrichment/validate-entity` | OPT | `ValidationCard` |
| `/validate/relation` | POST | `auth` + `valid` | `POST /api/v1/enrichment/validate-relation` | OPT | `ValidationCard` |

Un voto che chiude il consenso aggiorna la cache authority del votante.

## NER (`ner.ts`)

| Route BFF | Metodo | Guard | Flag | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|---|
| `/ner/feedback` | POST | `auth` + `contrib` | contribution (solo questo path esatto) | `POST /api/v1/ner/feedback` (`context_window` ≤1200) | OPT | `CitationNerFeedback` (`article_xref`), `QaSynthesisWithCitations` (`qa_chip`), `ArticleTabContent` (`implicit`) |
| `/ner/feedback/stats` | GET | `auth` + `admin` | ops | `GET /api/v1/ner/feedback/stats` | OPT | `NerOpsCard` |
| `/ner/training/start` | POST | `auth` + `admin` | ops | `POST /api/v1/ner/training/start` (RQ `merlt_ner_train`) | OPT | `NerOpsCard` |
| `/ner/training/jobs/:jobId` | GET | `auth` + `admin` | ops | `GET /api/v1/ner/training/jobs/{id}` | OPT | `NerOpsCard` |

## Ops (`ops.ts` e `opsIngestion.ts`, flag `MERLT_OPS_ENABLED`)

| Route BFF | Metodo | Guard | Endpoint MERL-T | Auth MERL-T | Consumer FE |
|---|---|---|---|---|---|
| `/ops/rlcf/training/start` | POST | `auth` + `admin` | `POST /api/v1/rlcf/training/start` (corpo inoltrato così com'è) | **ADMIN** | `OpsTrainingButton` (`startMerltTraining`) |
| `/ops/graph/hygiene` | POST | `auth` + `admin` | `POST /api/v1/admin/graph/hygiene` | OPT | `OpsHygieneButton` |
| `/ops/config` | GET | `auth` + `admin` | `GET /api/v1/admin/config` | OPT | `OpsConfigPanel` |
| `/ops/config/:key` | PUT | `auth` + `admin` | `PUT /api/v1/admin/config/{key}` | OPT | `OpsConfigPanel` |
| `/ops/engine/reinitialize` | POST | `auth` + `admin` | `POST /api/v1/admin/engine/reinitialize` (timeout 30 s) | OPT | `OpsConfigPanel` |
| `/ops/ingestion/run` | POST | `auth` + `admin` | `POST /api/v1/ingestion/mechanical/run` | **ADMIN** | `IngestionAdminPanel` (tab «Ingestione» in `/admin`) |
| `/ops/ingestion/batches` | GET | `auth` + `admin` | `GET /api/v1/ingestion/mechanical/batches` | **ADMIN** | `IngestionAdminPanel` |
| `/ops/ingestion/batches/:batchId` | GET | `auth` + `admin` | `GET /api/v1/ingestion/mechanical/batches/{id}` | **ADMIN** | `IngestionAdminPanel` |
| `/ops/ingestion/batches/:batchId/promote` | POST | `auth` + `admin` | `POST /api/v1/ingestion/mechanical/batches/{id}/promote` | **ADMIN** | `IngestionAdminPanel` |
| `/ops/ingestion/batches/:batchId/reject` | POST | `auth` + `admin` | `POST /api/v1/ingestion/mechanical/batches/{id}/reject` | **ADMIN** | `IngestionAdminPanel` |

Come rispondono le route ops quando MERL-T rifiuta la chiave:

- `ops.ts` risponde 503 `merlt_auth_misconfigured` a un 401/403 upstream.
- `opsIngestion.ts` lascia passare solo 404 e 409; ogni altro 4xx diventa 503 `merlt_unavailable`.

## Note di contratto

- **Errori.** Un errore di rete, un timeout o un 5xx di MERL-T diventa 503 `merlt_unavailable`. I 4xx di MERL-T passano invariati sulle route experts. I corpi invalidi rispondono 400 `invalid_body`, con gli `issues` di Zod.
- **Consenso.** È persistito lato server (Prisma `MerltUserPreference` più l'audit append-only `MerltConsentAudit`). Il `localStorage` del frontend è solo una cache di avvio. L'audit non è consultabile da alcuna route.
- **Upload.** È multipart: multer lo valida nel BFF, che poi lo inoltra a MERL-T come `multipart/form-data`.
- **Callback verso il BFF.** Le tre route `/internal/*` vogliono lo stesso `MERLT_INTERNAL_SECRET` che compose passa a merlt-api e a merlt-worker (default `dev-internal-secret`).

## Non montato sul BFF

Questi endpoint esistono in MERL-T ma nessuna route BFF li inoltra:

- `/api/v1/dashboard/*`.
- Buffer, pesi e policy RLCF: `/api/v1/rlcf/training/{status,stop}`, `/api/v1/rlcf/buffer/status`, `/api/v1/rlcf/policies/{weights,history}`.
- `/api/v1/pipeline/*`, `/api/v1/regression/*` e la quarantena del feedback (`/api/v1/feedback/*`).
- La ricerca semantica `POST /api/v1/graph/search`.
- `POST /api/v1/experts/feedback/router`.
- L'export dei dossier: `/api/v1/enrichment/dossier-training-export*`.
- Il report A/B del training NER: `GET /api/v1/ner/training/report/latest` (OPT; 404 `no_report` prima del primo run).

`GET /api/v1/features` non è mai esistito: il frontend deriva le capability in `useMerltFeatures.ts`.

`frontend/src/services/merltService.ts` contiene ancora funzioni legacy che chiamano route BFF mai montate e che nessun modulo importa fuori dai test:

- enrichment: `checkMerltArticle`, `runMerltLiveEnrichment`, `getMerltPendingQueue`, `validateMerltEntity`, `validateMerltRelation`, `proposeMerltEntity`, `proposeMerltRelation`;
- grafo: `graphSearchMerlt`, `getMerltArticleRelations`, `getMerltArticleEntities`, `getMerltSubgraph`;
- profilo: `getMerltProfile`, `getMerltAuthority`;
- documenti e dossier: `exportMerltDossierTraining`, `uploadMerltDocument`, `parseMerltDocument`;
- ops e stato: `getMerltOpsOverview`, `getMerltStatus`, `getMerltFeedbackMappings`;
- Q&A: `askMerlt`, `sendMerltInlineFeedback`, `sendMerltDetailedFeedback`, `sendMerltSourceFeedback`, `refineMerltAnswer`.

Se venissero usate, risponderebbero 404.
