# MERL-T — NER per estremi normativi appreso via RLCF (rilievo #2) — Design

**Branch:** `visualex-merlt-main`
**Date:** 2026-05-31
**Context:** Loop β rilievo #2 (post Fase F). The other two Fase-F findings are closed: #3 fonti provvisorie (`313c484`), #1 cronologia Q&A (`12db6c8`).
**Related specs:** `docs/superpowers/specs/2026-05-31-merlt-loopbeta-phase-f-qa-ux-design.md`.
**Design references (ALIS_CORE):** `_bmad-output/planning-artifacts/ux-design-specification.md` "Decision 6: NER via RLCF"; `prd.md` Story 6.2 "NER Feedback (F1)"; `TRACE_SCHEMA.md` (NER = stage 1.1); schema `NERFeedback`.

---

## Goal

Make MERL-T's legal-reference extraction (NER) **correct now** and **self-improving over time**. Today the live NER stage (`experts/query_analyzer.py::analyze_query`) is a numbers-only regex that builds a hardcoded *codice civile* URN and feeds that URN to `cite_law` — which wants a human reference ("art. 1453 c.c.") and fails. That is the root cause of #2 (and the reason #3 had to filter error bodies). The fix routes extraction through VisuaLex's existing citation infrastructure, captures user corrections across four surfaces into an authority-weighted RLCF store, and lets an admin-triggered spaCy model augment extraction once the data proves it out.

## Root cause (code-verified, real tree)

- `experts/query_analyzer.py::analyze_query()` extracts only article **numbers** via regex, then `build_article_urn()` hardcodes the 1942 regio-decreto c.c. URN for **every** article (so "art. 1 l. 241/1990" becomes a c.c. URN — wrong act entirely).
- `analyze_query`/`enrich_context` are called once, at `experts/orchestrator.py:470`.
- `experts/base.py` has **no** sanitization layer (no `_build_citation_request`/`_normalize_tool_input`). `_retrieve_live_legal_sources` (`base.py:621/648-651`) passes the raw `norm_references[0]` (URN) straight as `reference`/`riferimento` to `cite_law`/`fetch_law_article` → tool returns "**Errore**: atto '…' non riconosciuto".
- `context.norm_references` (stored in `context.entities`, `base.py:88-95`) is consumed in **two opposite ways**: as **URN** for graph traversal (`base.py:850`) and as **reference** for `cite_law` (`base.py:621/648`). One format cannot serve both.

## Locked decisions (brainstorm, user-approved 2026-05-31)

1. **Injection point:** query-level — replace/augment `analyze_query` at the single call site (`orchestrator.py:470`). All four experts get correct refs in one shot.
2. **Dual-format:** additive parallel field. `norm_references` stays URN (graph untouched); new `context.entities['legal_references']` carries the human/structured form; `base.py` reads the new field **only** to pass the `display` form to `cite_law`. Additive to CRITICAL `base.py`, no signature change.
3. **Labeled store:** new `ner_feedback` table in the **MERL-T enrichment Postgres** (RLCF DB), next to `pending_entities`/`entity_votes`/`user_domain_authority`. Authority-weighted, local to the spaCy trainer. BFF forwards corrections to a new MERL-T endpoint (same pattern as events/votes/confirm-source).
4. **Privacy (Q&A surface):** persist a **±500-char context window** around the citation, **never the raw query**. `user_id` retained for authority-weighting. Consent `full` required, enforced server-side.
5. **Cross-ref UX:** hybrid — implicit positive confirmation from natural use (click-through to open the cited norm) + a discreet "Estremo corretto?" ✓/✗ with an expandable mini-corrector on `CitationPreviewPopup`; missed-entity via the existing `SelectionPopup`.
6. **Scope:** full end-to-end (Phases 1–4) in this cycle. Phase 4 (learned spaCy) ships **behind a flag, OFF by default**, with `parse_query`/regex authoritative until an A/B report proves the learned model improves (cold-start management).

## Architecture overview

A **shared legal-reference extractor** (VisuaLex's citation infra) feeds three consumers — the Q&A experts pipeline, the graph, and the article-tab cross-reference — and every surface collects corrections that flow into one **authority-weighted RLCF store** (`ner_feedback`). An admin-triggered job retrains a spaCy NER that, when confident, **augments** extraction (regex/`parse_query` remain the fallback).

```
                         ┌─────────────── VisuaLex /parse_query, /extract_citations ───────────────┐
                         │                       (shared extractor)                                  │
   Q&A query ────────────┤                                                                           │
   /grafo ingestion ─────┤──► legal_references {display, urn, act_type, article}                      │
   article-tab xref ─────┘            │                          │                                   │
                                       ▼                          ▼                                   │
                              cite_law (display)          graph traversal (urn)                       │
                                                                                                      │
   user corrections (4 surfaces) ──► BFF /api/merlt/ner ──► MERL-T /api/v1/ner/feedback ──► ner_feedback (Postgres)
                                                                                                │
                                                          admin trigger ──► NERTrainer ──► spaCy checkpoint (volume)
                                                                                                │
                                                          flag ON + confident ──► augments extractor ◄──┘
```

---

## Phase 1 — Inference-path fix (immediate cure for #2 / #3-root)

**MERL-T `clients/visualex_client.py`** (currently only scraping methods; NL methods absent):
- Add `async parse_query(text: str) -> Optional[dict]` → `POST {base}/parse_query` (root `app.py` on :5000 already exposes `/parse_query`, no `/api` prefix — verified `app.py:295`). Fail-soft (return `None` on error/timeout, mirroring existing methods).
- Add `async extract_citations(text: str, host_norma: Optional[dict] = None) -> Optional[list]` → `POST /extract_citations`.
  - **To-verify in plan:** root `app.py` exposes `/parse_query` but **not** `/extract_citations` (only `visualex_api/app.py` exposes `/api/extract_citations`, `app.py:141-143`). Reconcile by either (a) adding `/extract_citations` to root `app.py` (reusing `tools/citation_linker.extract_citations`, `citation_linker.py:140`), or (b) pointing this client method at the prefixed server. Decide during planning after confirming which server runs on :5000 (`start.sh`).

**MERL-T `experts/query_analyzer.py` + `orchestrator.py:470`:**
- Keep `analyze_query` (regex) as the **offline fallback** for `legal_concepts` and for when VisuaLex is unreachable.
- In front of it, call `VisuaLexClient.parse_query(query)` and build `legal_references: list[dict]` = `[{display, urn, act_type, article, number?, date?}]`. `display` is the human reference (e.g. "art. 1453 c.c.") suitable for `cite_law`; `urn` is the canonical URN for the graph.
- **To-verify (task-0 discipline, as in Fase F):** dump a real `/parse_query` response and confirm the exact field names (act_type/article/urn) before coding the mapping. Fallback keeps current behavior on miss.

**MERL-T `experts/query_analyzer.py::enrich_context`:**
- Populate `context.entities['norm_references']` = list of **URN** (graph traversal unchanged).
- Populate `context.entities['legal_references']` = the structured list above (carries `display`).

**MERL-T `experts/base.py`** (CRITICAL — additive only, no signature change):
- In `_retrieve_live_legal_sources`, for reference-keyed tools (`cite_law`, `fetch_law_article`), pass the **`display`** form from `legal_references` as `reference`/`riferimento` instead of the raw URN. The traversal at `base.py:850` keeps reading `norm_references` (URN). Guarded: if `legal_references` absent/empty, fall back to current behavior.

**Acceptance P1:** for "art. 1453 c.c." and "art. 1 l. 241/1990", `cite_law` returns the real article body (not "atto non riconosciuto"); a warm query produces grounded sources; graph traversal still resolves URNs.

---

## Phase 2 — Labeled store + API

**MERL-T `storage/enrichment/models.py`** — new `NERFeedback(Base)`, `__tablename__ = "ner_feedback"`:

| column | type | notes |
|---|---|---|
| `feedback_id` | UUID PK | |
| `source_surface` | str | `article_xref` \| `qa_chip` \| `implicit` \| `search_mining` |
| `user_id` | varchar(100) | VisuaLex id (string, never FK — gotcha) |
| `article_urn` | str? | host article (xref surface) |
| `selected_text` | str | the span text |
| `start_offset` / `end_offset` | int? | char offsets within context (when available) |
| `context_window` | text | ±500 char around the citation (Q&A: never the raw query) |
| `feedback_type` | str | `confirmation` \| `correction` \| `false_positive` \| `missed` |
| `original_parsed` | JSON | what the extractor produced |
| `correct_reference` | JSON | `{tipo_atto, numero, anno, articoli}` (corrections/missed) |
| `confidence_before` | float? | extractor confidence |
| `user_authority` | float | computed server-side from `UserDomainAuthority` |
| `sample_weight` | float | derived from authority (0.5–2.0) |
| `created_at` | datetime | server default |

Table auto-creates at API boot via the lifespan `create_tables()` (existing pattern).

**MERL-T API** — new router (e.g. `api/ner_router.py`):
- `POST /api/v1/ner/feedback` — body validated; `user_authority`/`sample_weight` computed server-side (reuse `UserDomainAuthority`); insert row. Returns `{ received }`.
- `GET /api/v1/ner/feedback/stats` — counts by `feedback_type`/`source_surface` (for the admin card).

**BFF (`/api/merlt/ner/*`):**
- `services/merlt/nerClient.ts` — mirror `graphClient.ts` (native fetch + AbortController, reuse `merltClient.ts` error hierarchy). Methods `sendFeedback(...)`, `getStats()`.
- `routes/merlt/ner.ts` — `authenticate + contributionGuard` (full). Zod validates the payload (surface enum, offsets, correct_reference shape). Inject `user_id = req.user.id`. Map MERL-T down → 503; 4xx passthrough. **Register before the catch-all auth routers** (gotcha #1).
- `schemas/merlt/ner.ts` — Zod schemas.

**Tests (BFF):** auth required (401), consent gate (403 without full), happy path (200, user_id injected, body passthrough), 503 on MERL-T down, 4xx passthrough. nerClient unit tests with nock incl. timeout.

---

## Phase 3 — Capture across four surfaces (FE)

**`services/merltService.ts`** (or a `features/merlt/ner/nerApi.ts`): `sendNerFeedback({ surface, ... })` typed client to `/api/merlt/ner/feedback`. Fire-and-forget, gated on `useConsent().canContribute` (full).

1. **Article-tab cross-ref (PRIMARY).** `components/ui/CitationPreviewPopup` (+ `hooks/useCitationPreview`, `utils/citationMatcher.ts`):
   - Discreet row "Estremo corretto?" with ✓ / ✗.
   - "Correggi" expands a minimal corrector (`act_type` select + article field) → `feedback_type=correction` with `correct_reference`.
   - ✗ → `feedback_type=false_positive`.
   - **Implicit confirmation:** `ArticleTabContent.handleOpenCitationInTab` (already emits `citation_click`) also emits `feedback_type=confirmation` (low weight).
   - **Missed-entity:** `SelectionPopup` gains "segnala come citazione" → `feedback_type=missed` with the selected span + `correct_reference`.
   - Payload carries `article_urn` (host), `selected_text`, offsets, and the surrounding text as `context_window` (article body is public legal text — no PII).

2. **Q&A chips.** `features/merlt/qa/QaSourceChip` (and the in-prose citations): same ✓/✗/correggi. `context_window` = ±500 char around the citation **within the answer**, never the raw user query.

3. **Implicit confirmations.** Existing actions already wired to the bus — `cite_law`-ok (server-side, see note), "ricorda nel grafo" (confirm-source), opening a cited norm — emit `confirmation` (low weight). Where the signal is server-side (a successful `cite_law` during a query), record it from MERL-T directly into `ner_feedback` rather than via the FE.

4. **Search mining (bootstrap).** A successful VisuaLex search (`parse_query` → valid URN → article opened/saved) seeds a `confirmation` row (`source_surface=search_mining`). This bootstraps the dataset before explicit corrections accumulate.

**Tests (FE):** `CitationPreviewPopup` correction flow (emits correct payload/feedback_type), `SelectionPopup` missed-entity, `QaSourceChip` correction, gating on consent.

---

## Phase 4 — Learned spaCy NER (behind a flag, OFF by default)

**MERL-T `ner/`** (existing assets: `spacy_model.py::LegalNERModel` with its own `extract_citations`, `training.py::NERTrainer` with authority-weighted `prepare_weighted_training_data`/`_weighted_sample`/`train`/`_save_checkpoint`/`evaluate`, `data_converter.py`):
- New `ner/ner_feedback_buffer.py` — DB-backed adapter (port/adapt the ALIS_CORE class) implementing the interface `NERTrainer` expects, reading rows from `ner_feedback` (weighted by `sample_weight`). Replaces the missing in-memory buffer.
- **Augmentation hook:** in the Phase-1 extractor, when `MERLT_NER_LEARNED_ENABLED` is ON and `LegalNERModel` is loaded and the model's confidence is high, merge its spans with `parse_query`/regex output (learned augments, never replaces the fallback). Flag OFF → unchanged Phase-1 behavior.

**Training (admin-only, manual):**
- Reuse the existing admin training pattern (`rlcf_router.py` `/rlcf/training/start` + `requireAdmin` in the BFF). Add a NER training entry point (e.g. `POST /api/v1/ner/training/start`) that runs `NERTrainer.train()` over the buffer, checkpoints to the `merlt_checkpoints` volume, and updates the `legal_ner_latest` symlink.
- **A/B report:** evaluate learned-vs-baseline (precision/recall on a held-out slice of `ner_feedback`); surface the result so the flag flip is evidence-based.
- Durability: Python changes are baked at build → rebuild `merlt-api` + `merlt-worker`.

**Admin card (FE):** in `MerltHubPage` (ops-only via `requireAdmin`/`opsVisible`): `ner_feedback` stats + "Avvia training" + last A/B report. No gamification.

---

## Tracked risks

1. **`/extract_citations` not on :5000.** Root `app.py` exposes `/parse_query` but not `/extract_citations`. Reconcile in planning (add route to root app, or repoint client). `parse_query` alone already unblocks the core cure.
2. **Cold-start (Phase 4).** Learned model has little data initially → flag OFF by default, A/B-gated activation.
3. **`base.py` is CRITICAL.** All Phase-1 changes additive, no signature change; the display-vs-URN switch reads a new entities key with a guarded fallback.
4. **`parse_query` response shape.** Confirm exact field names (act_type/article/urn) from a live dump before coding the mapping (task-0 discipline). Fallback keeps current behavior on miss.
5. **Privacy.** Q&A branch persists only the ±500-char window, never the raw query; consent `full` enforced server-side via `contributionGuard`.
6. **Authority cold values.** `UserDomainAuthority` may be sparse early → define a sane default `user_authority`/`sample_weight` so early corrections still train (without over-weighting unknown users).

## Build order

P1 (inference-path fix, live-verify, commit) → P2 (store + MERL-T API + BFF, tests) → P3 (FE capture surfaces, tests) → P4 (buffer + training + flag + A/B + admin card). Code-review after each phase; fix everything (incl. pre-existing) before proceeding. Commit per phase (propose message, wait for ok). No push.

## Acceptance (whole feature)

A full-consent user asks a question or reads an article; legal references are extracted via the shared VisuaLex infra (correct act type, real `cite_law` grounding); the user can confirm/reject/correct an extremo or flag a missed citation; each action lands in `ner_feedback` with authority weight; an admin can view stats, run training, and read an A/B report; the learned model can be switched on once it beats baseline. BFF + FE tests green; tsc + lint clean; live smoke updated and passing.
