# Matrice Contratto MERLT/RLCF

Questo documento mappa le superfici VisuaLex verso il sidecar MERLT. Il browser parla solo con il BFF Node (`/api/merlt/*`); il BFF autentica l'utente VisuaLex, inoltra `Authorization`, aggiunge `X-User-ID` e usa `X-API-Key` quando configurata.

> ⚠️ **La colonna «Stato» qui sotto è il contratto _inteso_ (upstream), non lo stato reale del BFF.** Gran parte di queste route **non è montata oggi** — in particolare `/features`, tutto `/experts/*` e `/feedback/*`, l'intero `/enrichment/*` (la validazione vive sotto `/validate/*`, il check articolo sotto `/graph/*`), e quasi tutto `/ops/*`. Fonte di verità: i router in `backend/src/routes/merlt/` e la §7 di [system-map.md](./system-map.md).
>
> **Montato oggi sul BFF** (`routes/merlt/index.ts`): `consent` · `events/*` (5 eventi) · `health` · `profile` · `graph/*` (`article/:urn`, `ingest`, `jobs/:id/status`, `search`, `internal/job-callback`) · `contrib/*` (`documents`, `documents/:id/extract`, `documents/:id/candidates`, `jobs/:id/status`, `candidates/:id/promote`, `me/jobs`, `internal/extraction-callback`) · `validate/*` (`pending`, `entity`, `relation`) · `ops/training/start`.

| Area | Endpoint VisuaLex | Endpoint MERLT | Auth | Payload | Consumer UI | Stato |
| --- | --- | --- | --- | --- | --- | --- |
| Feature flags | `GET /api/merlt/features` | Locale BFF | JWT | none | Plugin loader, consent flow | Implementato |
| Health | `GET /api/merlt/health` | `GET /health` | JWT | none | MERLT workspace, admin | Implementato |
| Expert Q&A | `POST /api/merlt/experts/query` | `POST /api/v1/experts/query` | JWT + optional API key | query, article context, mode, trace flag | Expert panel, article slot | Implementato |
| Inline feedback | `POST /api/merlt/experts/feedback/inline` | `POST /api/v1/experts/feedback/inline` | JWT + optional API key | traceId, rating, articleUrn, comment | Expert panel | Implementato |
| Detailed feedback | `POST /api/merlt/experts/feedback/detailed` | `POST /api/v1/experts/feedback/detailed` | JWT + optional API key | detailed RLCF fields | Feedback drawer | Implementato |
| Source feedback | `POST /api/merlt/experts/feedback/source` | `POST /api/v1/experts/feedback/source` | JWT + optional API key | trace/source feedback | Source cards | Implementato |
| Preference/router feedback | `POST /api/merlt/experts/feedback/preference`, `/router` | MERLT equivalent | JWT + optional API key | expert preference/router signal | Divergent compare | Implementato |
| Refine | `POST /api/merlt/experts/feedback/refine` | `POST /api/v1/experts/feedback/refine` | JWT + optional API key | trace + refinement prompt | Conversational expert panel | Implementato |
| Trace | `GET /api/merlt/experts/trace/:traceId` | `GET /api/v1/experts/trace/:traceId` | JWT + optional API key | path traceId | Reasoning/source display | Implementato |
| Implicit feedback | `POST /api/merlt/feedback/interaction` | `POST /api/v1/feedback/interaction` | JWT + optional API key | interaction_type, article_urn, metadata | EventBus bridge | Implementato |
| Batch/session feedback | `POST /api/merlt/feedback/batch`, `/session` | MERLT equivalent | JWT + optional API key | interactions, explicit feedback | Session flush | Implementato |
| Explicit multilevel feedback | `POST /api/merlt/feedback/explicit` | `POST /api/v1/feedback/explicit` | JWT + optional API key | precision/recall/reasoning/synthesis fields | Feedback form | Implementato |
| Feedback mappings | `GET /api/merlt/feedback/mappings` | `GET /api/v1/feedback/mappings` | JWT + optional API key | none | EventBus mapping audit | Implementato |
| Tracking | `POST /api/merlt/tracking/events` | `POST /api/v1/tracking/events` | JWT + optional API key | event payload | EventBus bridge | Implementato |
| Check article | `GET /api/merlt/enrichment/check-article` | `GET /api/v1/enrichment/check-article` | JWT + optional API key | tipo_atto, data, numero_atto, article | Article slot | Implementato |
| Live enrichment | `POST /api/merlt/enrichment/live` | `POST /api/v1/enrichment/live` | JWT + optional API key | article identifiers/text | Article slot, graph preview | Implementato |
| Pending queue | `GET /api/merlt/enrichment/pending` | `GET /api/v1/enrichment/pending` | JWT + optional API key | filters | Validation queue | Implementato |
| Entity validation | `POST /api/merlt/enrichment/validate-entity` | `POST /api/v1/enrichment/validate-entity` | JWT + optional API key | entity id, vote, authority metadata | Validation queue | Implementato |
| Relation validation | `POST /api/merlt/enrichment/validate-relation` | `POST /api/v1/enrichment/validate-relation` | JWT + optional API key | relation id, vote, authority metadata | Validation queue | Implementato |
| Proposals | `POST /api/merlt/enrichment/propose-entity`, `/propose-relation` | MERLT equivalent | JWT + optional API key | proposal payload | Contribution forms | Implementato |
| Issue voting | `POST /api/merlt/enrichment/report-issue`, `/vote-issue` | MERLT equivalent | JWT + optional API key | issue/vote payload | Community validation | Implementato |
| Dossier training export | `POST /api/merlt/enrichment/dossier-training-export(-full)` | MERLT equivalent | JWT + optional API key | dossier payload | Dossier actions | Implementato |
| Load dossier training | `POST /api/merlt/enrichment/load-dossier-training` | `POST /api/v1/enrichment/load-dossier-training` | Admin JWT + API key | training set reference | Admin ops | Implementato |
| NER/citation feedback | `POST /api/merlt/enrichment/ner-feedback`, `/ner-feedback-confirm` | MERLT equivalent | JWT + optional API key | citation feedback | Citation linker | Implementato |
| Graph article entities | `GET /api/merlt/graph/article/:urn/entities` | `GET /api/v1/graph/article/:urn/entities` | JWT + optional API key | urn | Graph workspace | Implementato |
| Graph article relations | `GET /api/merlt/graph/article/:urn/relations` | `GET /api/v1/graph/article/:urn/relations` | JWT + optional API key | urn | Graph workspace | Implementato |
| Graph search | `POST /api/merlt/graph/search` | `POST /api/v1/graph/search` | JWT + optional API key | semantic query | Graph workspace | Implementato |
| Graph subgraph | `GET /api/merlt/graph/subgraph` | `GET /api/v1/graph/subgraph` | JWT + optional API key | node/article params | Graph workspace | Implementato |
| Profile full | `GET /api/merlt/profile/me/full` | `GET /api/v1/profile/full?user_id=...` | JWT + optional API key | user id from auth | Profile tab | Implementato |
| Profile authority | `GET /api/merlt/profile/me/authority` | `GET /api/v1/profile/authority/domains?user_id=...` | JWT + optional API key | user id from auth | Profile tab | Implementato |
| Contribution stats | `GET /api/merlt/profile/me/contributions` | `GET /api/v1/profile/stats/detailed?user_id=...` | JWT + optional API key | user id from auth | Profile tab | Implementato |
| Documents | `POST /api/merlt/documents/upload`, `GET /api/merlt/documents`, `POST /api/merlt/documents/:id/parse` | MERLT documents API | JWT + optional API key | upload/parse/list payloads | Advanced workspace | Implementato |
| RLCF status | `GET /api/merlt/rlcf/status` | training + buffer status | JWT + optional API key | none | Workspace quick status | Implementato |
| Training ops | `GET/POST /api/merlt/ops/rlcf/*` | `/api/v1/rlcf/*` | Admin JWT + API key | status/start/stop/weights/history | Admin MERLT ops | Implementato |
| Pipeline ops | `GET/POST /api/merlt/ops/pipeline/*` | `/api/v1/pipeline/*` | Admin JWT + API key | run/retry/export payloads | Admin MERLT ops | Implementato |
| Dashboard ops | `GET /api/merlt/ops/dashboard/*` | `/api/v1/dashboard/*` | Admin JWT + API key | none/filters | Admin MERLT ops | Implementato |
| Regression ops | `GET/POST /api/merlt/ops/regression/*` | `/api/v1/regression/*` | Admin JWT + API key | run id / config | Admin MERLT ops | Implementato |

## Note Di Contratto

- Gli endpoint admin restano dietro `requireAdmin`; il browser non riceve mai l'URL del sidecar MERLT.
- Gli eventi impliciti devono usare i tipi restituiti da `GET /api/merlt/feedback/mappings`, con `article_urn`, `trace_id` e metadata coerenti.
- Upload documentale via BFF oggi accetta payload JSON; se MERLT richiede multipart puro, va aggiunto un parser multipart dedicato nel BFF.
- Il consenso utente è gestito lato plugin/frontend nella prima integrazione; una futura migration può persisterlo su profilo utente se diventa requisito di audit.
