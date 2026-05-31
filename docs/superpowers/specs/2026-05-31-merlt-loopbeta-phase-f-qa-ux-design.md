# Loop β — Phase F: Q&A UX (BFF + FE) — Design

**Branch:** `visualex-merlt-main`
**Date:** 2026-05-31
**Companion plan:** `docs/merlt/slices/loop-beta-coevolution/sprint-plan.md` (Phase F = F.1 + F.2; "Corrections" override the body).
**Status of Loop β before F:** Phases 0 + A + B + C + D + E complete, committed, verified live. Engine produces grounded answers for warm, well-formed queries. Phase F is the bridge that makes the engine usable.

---

## Goal

Give the lawyer a usable Q&A surface over the MERL-T multi-expert engine: ask a legal question → get a synthesized answer with **per-source provenance always visible** (readable URN + provenance + trust), give 👍/👎, refine, and "remember in the graph" a provisional source so it enters `/grafo`. Plus two server-side polish items that the UI depends on (readable URN/provenance — non-negotiable; confidence calibration — lower priority).

## Non-negotiable

**Provenance & URN always visible per source.** A source chip without a readable URN and a provenance badge is meaningless to a lawyer. M6 (server-side) is therefore a prerequisite of the UI, not an afterthought.

---

## Product/UX decisions (locked with the user)

1. **Consent gate:** `full` for everything (asking AND remembering). Matches the other RLCF hub cards (Contribuisci, Valida); single gate. Enforced both at the page (FE) and server-side (BFF `contributionGuard`).
2. **Answer mode:** expose a **convergent/divergent toggle**. Convergent = single synthesis; divergent = the 4 hermeneutic canons' separate interpretations (`alternatives`). This is the soul of the multi-expert product.
3. **Layout:** **conversational thread** — question on top, answer below, refine follow-ups append as a thread. Supports the iterative refinement the engine already offers via `/feedback/refine`.
4. **"Remember in the graph" granularity:** **per-source, only on provisional sources** (`provenance='live_unconfirmed'`). Seed/community sources are already in the graph → no button. Maps 1:1 to the `confirm-source` contract (one provisional node per call).

---

## Architecture decision

**Approach A — server-side polish + thin BFF proxy (chosen).** Polish lives in MERL-T Python (additive); the BFF is a thin proxy mirroring `graphClient.ts`/`validate.ts`; the FE renders. One Python rebuild for all F.0 changes.

Rejected:
- **B — BFF-side provenance enrichment:** the BFF has no FalkorDB access; would require a new MERL-T endpoint. More moving parts, no gain.
- **C — ship FE with chunk-hash URNs, polish later:** violates the non-negotiable; chips would be meaningless.

---

## Code-verified facts (real tree, not assumptions)

**MERL-T (`:8000`, live):**
- `POST /api/v1/experts/query` body: `{ query (≥5 chars), user_id, context?, max_experts? (1..4, default 4), include_trace?, consent_level: "anonymous"|"basic"|"full" (default "basic") }`.
- Response `ExpertQueryResponse`: `{ trace_id, synthesis, mode, alternatives?, sources[], experts_used[], confidence (0..1), execution_time_ms, pipeline_trace?, pipeline_metrics? }`.
- `SourceReference` (already in the model): `{ article_urn, expert, relevance (0..1), excerpt?, provenance?, trust? }`. provenance/trust fields exist; populating them is the M6 gap.
- Feedback: `/feedback/inline` `{trace_id, user_id, rating 1..5}` (reward=(rating-1)/4); `/feedback/detailed` `{...3 scores}`; `/feedback/source` `{trace_id, user_id, source_id, relevance 1..5}`; `/feedback/refine` `{trace_id, user_id, follow_up_query}` → returns a fresh `ExpertQueryResponse`.
- `POST /api/v1/enrichment/confirm-source` body `ConfirmSourceRequest`: `{ node_id: "live:<hash>", user_id, entity_text?, entity_type?, ambito="generale", skip_duplicate_check=false }`.

**The confirm-source / node_id gap (the key finding):**
- The live source dict built in `experts/base.py` (~:641) carries `{ text (markdown), source_id="mcp-legal-it:<tool>", source, tool_name, provenance="live_unconfirmed", expert_type }` — **no explicit url/urn**, and the API exposes only `excerpt` (200 chars truncated).
- The sedimented FalkorDB node id is `live:<sha256(key)[:24]>` where `key` is `"url|<source_url>"` (source_url regex-extracted from the **full markdown**) or `"<source_id>|text|<sha256(text)[:16]>"` (`pipeline/provisional_writer.py::_derive_node_id`).
- ⇒ The FE/BFF **cannot recompute** the node_id from the truncated excerpt. The API must surface the deterministic `node_id` for live sources (M6c).

**Confidence:** `experts/synthesizer.py` already has `_calibrate_confidence` (α-blend of expert confidence + disagreement) and `_compute_confidence_indicator`. The "always 0.9" comes from upstream (constant expert confidence and/or no grounding signal). The polish = factor a **grounding-rate** into the existing calibration; additive, lower-risk than M6, lowest priority of F.

**BFF (`:3001`):**
- `routes/merlt/experts.ts` does NOT exist (net-new).
- Mount order already correct (`graph`/`contrib`/`validate`/`ops` before catch-all auth — gotcha #1). `experts` uses per-route auth → safe to mount in the first group (after `ops`).
- Reference pattern: `routes/merlt/validate.ts` (authenticate + guard + Zod + cached client + 503 on `MerltClientError`).
- `consentGuard` = ≥basic; `validationGuard`/`contributionGuard` = full (validationEnabled/contributionEnabled). Use **`contributionGuard`** on the experts router to honor "full per tutto" server-side.
- Default `MERLT_TIMEOUT_MS=5000` — too short for an experts query; needs a dedicated long timeout.

**FE:**
- `services/merltService.ts` already has `askMerlt` / `sendMerltInlineFeedback` / `sendMerltDetailedFeedback` / `sendMerltSourceFeedback` / `refineMerltAnswer` pointing at `/merlt/experts/*` — but `askMerlt` is article-shaped (`articleText`, `normaData`). The QAPage is standalone (no article) → add `askMerltQuestion` + `confirmMerltSource`, tighten types.
- `MerltHubPage.tsx` has `hub-card-qa` with an "In arrivo" badge to flip.
- Page gate via `useMerltFeatures()` (`canContribute` = level==='full') + `isMerltEnabled()` flag.

---

## F.0 — MERL-T Python polish (ONE rebuild, done first)

Durability rule: `docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker` + `up -d --force-recreate merlt-api merlt-worker`. `experts/base.py` stays CRITICAL → additive only, no signature changes.

| id | change | file | accept |
|---|---|---|---|
| **F.0a (M6a)** | Map `chunk_id → article_urn` from the result's retrieval trace; `_to_source_reference` surfaces the readable URN instead of the chunk hash (fallback to current on miss). **Verify the real `retrieval_trace`/`top_sources` key paths first** (task-0.2 philosophy) before coding. | `api/experts_router.py` | `sources[].article_urn` is a readable URN (e.g. `...~art1453`), not a UUID, for a warm query. |
| **F.0b (M6b)** | Look up `provenance`/`trust` from FalkorDB by `article_urn` (reuse MERL-T's graph client). | `api/experts_router.py` | `sources[].provenance` populated (`seed`/`community_validated`/`live_unconfirmed`); seed source ranks trust 1.0. |
| **F.0c (M6c)** | New optional `node_id` on `SourceReference`; populated for `live_unconfirmed` sources by reusing `provisional_writer._derive_node_id` (same key derivation as the sediment writer). | `api/experts_router.py` (+ import from `pipeline/provisional_writer.py`) | A live source carries `node_id="live:<hash>"` equal to the sedimented node; confirm-source with it succeeds. |
| **F.0d (confidence)** | Factor grounding-rate (real-source count / citation coverage) into the existing `_calibrate_confidence`. Conservative, additive. **Lowest priority** — if risk emerges, defer and log as follow-up. | `experts/synthesizer.py` | A 0-source answer cannot return 0.9; a well-grounded multi-source answer stays high. |

---

## F.1 — BFF `/api/merlt/experts/*` (net-new, Node hot-reload, no rebuild)

**`services/merlt/expertsClient.ts`** — mirror `graphClient.ts`: native `fetch` + `AbortController`, reuse the `merltClient.ts` error hierarchy (`MerltTimeoutError`/`MerltServerError`/`MerltBadRequestError`). **Dedicated long timeout** via `MERLT_EXPERTS_TIMEOUT_MS` (default 120000). Methods:
- `query({ query, user_id, context?, max_experts?, include_trace?, consent_level })` → `ExpertQueryResponse` (`POST /api/v1/experts/query`).
- `feedbackInline({ trace_id, user_id, rating })`, `feedbackDetailed(...)`, `feedbackSource({ trace_id, user_id, source_id, relevance })`.
- `refine({ trace_id, user_id, follow_up_query })` → `ExpertQueryResponse` (`POST /api/v1/experts/feedback/refine`).
- `confirmSource({ node_id, user_id, entity_text?, entity_type?, ambito? })` → confirm response (`POST /api/v1/enrichment/confirm-source`).
- `createExpertsClient(env)` factory + `_resetExpertsClientForTests()`.

**`schemas/merlt/experts.ts`** — Zod for query (`query` min 5, optional `mode`, `maxExperts` 1..4), inline/detailed/source feedback, refine (`followUpQuery` min 5), confirm-source (`nodeId` starts with `live:`).

**`routes/merlt/experts.ts`** — per-route `authenticate + contributionGuard`:
- `POST /experts/query` — Zod → inject `user_id=req.user.id`, `consent_level = mapConsentLevel(level)`, `include_trace=true` (needed for divergent + trace), forward → 200. `mapConsentLevel` (pure, unit-tested): none→anonymous, basic→basic, full→full. Read the user's level once (guard guarantees full, but the mapping stays honest/future-proof).
- `POST /experts/feedback/inline|detailed|source` — Zod → inject user_id → forward → 200.
- `POST /experts/refine` — Zod → inject user_id → forward → 200 (returns a new answer).
- `POST /experts/confirm-source` — Zod → inject user_id → forward → 200.
- Error mapping: `MerltTimeoutError`/`MerltServerError` → 503 `{detail:'merlt_unavailable'}`; `MerltBadRequestError` → passthrough status + body. Mirrors `validate.ts`.

**`routes/merlt/index.ts`** — register `expertsRouter` after `opsRouter`, before `consent`/`profile`/`events` (catch-all auth). Per-route auth → order-safe (gotcha #1).

**Tests** — vitest + supertest + nock (mirror `validate-routes`/`contrib-routes`): auth required (401), consent gate (403 without full), happy path (200, body passthrough, user_id injected), consent mapping, 503 on MERL-T down, 4xx passthrough. expertsClient unit tests with nock for each method incl. timeout.

---

## F.2 — FE QAPage (route `/merlt/chiedi`, lazy, gate full + flag)

**`features/merlt/qa/`:**
- `types.ts` — `QaSource` (article_urn, expert, relevance, excerpt?, provenance?, trust?, node_id?), `QaAnswer` (synthesis, mode, alternatives?, sources, experts_used, confidence, trace_id, execution_time_ms), `QaTurn` (question + discriminated answer state `loading|success|error` + feedback state), `QaMode = 'convergent'|'divergent'`.
- `qaApi.ts` *(or extend `merltService.ts`)* — `askMerltQuestion({ query, mode, maxExperts? })`, `refineMerltAnswer`, feedback fns, `confirmMerltSource({ nodeId })`. Tighten the existing loose `JsonRecord` types.
- `useQaThread.ts` — holds `turns: QaTurn[]`; `ask(query)`, `refine(traceId, followUp)`, `rate(traceId, up|down)`, `confirmSource(turnIdx, source)`. Latest-wins (discard stale responses via a request token; prev-input tracker pattern, never synchronous setState-in-effect — gotcha set-state-in-effect). Fire feedback fire-and-forget; reflect 👍/👎 optimistically.
- `QaComposer.tsx` — textarea + Invia + convergent/divergent toggle (segmented control). Cmd/Ctrl+Enter submits. Disabled while a turn is loading.
- `QaTurn.tsx` — question bubble; on success: synthesis (markdown-safe text), confidence bar + indicator, expert chips (`experts_used`), Fonti list (`QaSourceChip`), 👍/👎, "Approfondisci" (refine composer inline). When `mode==='divergent'` and `alternatives` present: render per-canon sections instead of a single synthesis. **Verify the `alternatives` shape against a real divergent response before finalizing the renderer.**
- `QaSourceChip.tsx` — readable URN (links to `/grafo?urn=<article_urn>`, reusing Slice 2a), provenance badge (seed=neutral, community_validated=green, live_unconfirmed=amber), trust value, excerpt on expand. "Ricorda nel grafo" button **only** when `provenance==='live_unconfirmed' && node_id`. On click → `confirmSource` → optimistic "ricordata" state; on failure (rare async-sediment timing 404) → toast "Riprova tra un istante".
- `QAPage.tsx` — orchestrator. Empty state with example questions. Gated: if `!merltEnabled` → "non disponibile"; if `level!=='full'` → CTA to open `ConsentDialog`.

**Wiring:**
- Route `/merlt/chiedi` in `App.tsx` (lazy, inside authenticated Layout).
- Sidebar entry gated by `isMerltEnabled()` + consent (mirror `/merlt/valida`).
- Flip `hub-card-qa` in `MerltHubPage.tsx`: "In arrivo" → "Apri" link when `canContribute`, else "Richiede consenso Completo".
- Update `docs/merlt/smoke-checklist.md` (Phase F section).

**Tests** — vitest + jsdom: `useQaThread` (ask success/error, refine appends, latest-wins discard, rate optimistic), `QaSourceChip` (button only on live_unconfirmed, link target), a `QAPage` render smoke (gate states).

---

## Tracked risks

1. **M6a mapping** — depends on the real `retrieval_trace`/`top_sources` key paths; verify with a real `include_trace=true` dump before coding (task-0.2 discipline). Fallback keeps current behavior on miss.
2. **Async-sediment timing** — C.2 sediments the provisional node fire-and-forget post-synthesis (seconds). confirm-source on a not-yet-written node → handled FE-side with a friendly retry toast. Acceptable for MVP.
3. **`alternatives` shape (divergent)** — unverified; confirm against a real divergent response before building the per-canon renderer.
4. **`experts/base.py` is CRITICAL** — all F.0 changes additive, no signature changes (per-source node_id surfacing done in `experts_router`, not base.py).
5. **Timeout** — never use the 5s default for query/refine; `MERLT_EXPERTS_TIMEOUT_MS` (120s).

## Build order

F.0 (one rebuild + live-verify) → F.1 (BFF + vitest/supertest/nock) → F.2 (FE + vitest/jsdom). Code-review after each milestone; fix everything before proceeding (per user rule). Commit per milestone (propose message, wait for ok). No push.

---

## ADDENDUM (2026-05-31, post-T1 live verification) — supersedes the source/feedback design above

Task-1 verification against the live stack changed two things. **These override the body where they conflict.**

### A. Provenance lives in the retrieval layer, not the cited sources → "Fonti consultate" panel

Verified facts:
- The live graph is **`merl_t_legal`** (NOT `legal_knowledge_graph`, which is empty/stale). Provenance lookup by exact URN works: distribution `seed 27741 · lazy_ingest 302 · live_unconfirmed 242 · live_confirmed 4 · community_validated 2`.
- The **cited** sources (`combined_legal_basis`) are LLM output: `article_urn` is mangled (`norm_1`, chunk-UUID), `provenance=null`. Only `citation` ("Art. 1453 c.c.") + `excerpt` are readable on them.
- The **real URNs + provenance** live in `pipeline_trace.stages.expert_executions[*].retrieval_trace.top_sources` (list of URN strings; literal expert → Normattiva seed/lazy URNs, precedent expert → Cassazione massime ids). No reliable per-cited-source join.

**Decision (Option A, user-approved):** add an **additive `retrieved_sources`** field to `ExpertQueryResponse`, built server-side from the experts' `top_sources` + a FalkorDB lookup (reusing the configured graph client → matches `merl_t_legal` automatically) returning `{ urn, provenance, trust, node_id }`. The FE renders **these** as the provenance chips (URN → `/grafo` link, badge seed/lazy/community/provisional, trust) + "ricorda nel grafo" on `provenance==='live_unconfirmed'` (passing the node's `node_id`, which already starts with `live:` for sediment nodes). The cited sources still surface `citation`+`excerpt` as readable in-prose references. M6c node_id **derivation is dropped** (the live retrieved node already has a real `node_id` from FalkorDB — no recompute needed).

### B. Full granular feedback surface (all backend channels already exist)

Ship all four in F.2, progressive-disclosure, legal lexicon (no gamification):
- **Always visible:** 👍/👎 global (`/feedback/inline`) + provenance chips.
- **Collapsible "Come ci sono arrivato"** (`<details>`): canons consulted (routing.selected_experts) + retrieved_sources + agreement/disagreement (synthesis.disagreement_analysis). Read-only transparency of the deliberation.
- **Per-source** *pertinente / non pertinente* on each retrieved_source chip → `/feedback/source` (relevance 5/1). Trains traversal+affinity.
- **Canon preference** in divergent mode (which interpretation convinces) → `/feedback/preference`. Trains gating.
- **Detailed 3-layer** retrieval/reasoning/synthesis → `/feedback/detailed`. Inside the panel, the power-user option.

BFF gains two more proxied endpoints: `/experts/feedback/detailed` and `/experts/feedback/preference` (same authenticate+contributionGuard pattern). No MERL-T code change for feedback (channels exist); F.0 Python work is now **only** `retrieved_sources` + grounding-confidence.

## Acceptance (whole phase)

A full-consent user opens `/merlt/chiedi`, asks a legal question, gets a grounded synthesis with per-source readable-URN + provenance chips + confidence, gives 👍/👎, refines, and "remembers in the graph" a provisional source which then appears in `/grafo`. BFF tests + FE tests green; tsc + lint clean; live smoke updated and passing.
