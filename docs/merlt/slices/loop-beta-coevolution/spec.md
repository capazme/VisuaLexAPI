# Spec — MERL-T Loop β: Live-Perpetual, Graph-Aware Reasoning & Co-Evolutionary Enrichment

**Status:** design/spec (no code yet) · **Branch:** `visualex-merlt-main` · **Author intent:** capazme
**Audience:** an implementation agent. This document is the GOAL. Read it fully before coding.
**Prereqs already done (do not redo):** Loop β Bug 1 — experts are wired with retrieval tools at
boot (`merlt/merlt/app.py`); Q&A entry-point fixed (`merlt/merlt/api/rate_limit.py`); Qdrant
collection name fixed; embeddings backfill for the seed in progress
(`merlt/merlt/scripts/backfill_embeddings.py`).

---

> ⚠️ **CODE-VERIFIED CORRECTIONS — read `sprint-plan.md` first.** A 5-lens code-grounded review
> (2026-05-29) found several claims below contradicted by the real tree. Where this spec and
> `sprint-plan.md` differ, **the sprint-plan wins.** Headline fixes: (B1) `get_policy_manager()` does
> NOT hardcode Redis — it's a filesystem `PolicyManager`; the only `localhost:6380` is FalkorDB;
> traversal weights are inert because the boot retriever is wired `policy_manager=None` + no `.pt`.
> (B2) Bug 4 = the `ExecutionTrace` is never serialized (orchestrator persists only
> `pipeline_trace.to_dict()`), not a key rename. (B4) no per-expert tool assignment exists. (B5)
> registering tools is inert unless `use_react=True` (default False). (B6) MCP tools return markdown,
> not structured data. (B7/B8) provisional FalkorDB nodes need a NEW low-trust writer; the lazy-ingest
> worker is Normattiva-norm-article-only. (M1) scoring is additive `α·sim+(1-α)·graph`. (M3) REUSE the
> existing `ExternalSourceTool`/`LiveEnrichmentService`/`ArticleFetchTool`. Full delta + tasks:
> **`sprint-plan.md`**.

## 0. The principle (one sentence)

**Every reasoning act is also an enrichment act.** The experts reason over the curated graph AND
live legal sources (mcp-legal-it) *simultaneously*; live retrievals judged correct sediment into
the graph via the *same pipeline that built the seed*; RLCF tunes both the graph-traversal weights
and the per-tool weights from community/user feedback. The graph is the growing, high-trust cache;
the live tools are the comprehensive, authoritative input. The two reinforce each other and the
system **learns to reason juridically**.

This SUPERSEDES the earlier "two separate loops (α enrichment / β reasoning)" framing: α and β are
the same continuous loop, joined by the bridge in §4.3.

---

## 1. Non-negotiables (acceptance gates for the whole slice)

1. **Zero unfounded claims.** Every cited source in an answer resolves to a `fonte`/URN — either a
   graph node or a live-retrieval URL. No source the model invented.
2. **Provenance always visible.** The user sees, per source, whether it is `seed`, `live_unconfirmed`,
   or `community_validated`.
3. **No blind auto-promotion.** A live retrieval never becomes a *permanent* graph node without a
   human/community signal (anti-pollution). Provisional nodes are allowed and clearly flagged.
4. **Graceful degradation.** A live node is created with whatever sources are available (norm-only,
   norm+Brocardi, +multivigenza, +case-law); a missing source never blocks.
5. **Latency is bounded and learned.** Live calls (30–45s scraping) are gated; the tool weights learn
   *when* a live call is worth it. Repeat queries are fast because validated retrievals migrate to the
   graph.
6. **Reuse, don't rebuild.** Use the existing seed-building pipeline, Loop α consensus machinery, and
   the gating pattern. New code is adapters + provenance + tool-gating, not new pipelines.
7. **Respect CRITICAL files.** `merlt/merlt/experts/base.py` and `merlt/merlt/rlcf/authority.py` are
   CRITICAL (see `merlt/CLAUDE.md`): no signature changes; use helpers; `authority.py` math is OFF-LIMITS.

---

## 2. Components

### 2.1 Existing — REUSE (verified present in the vendored tree)

| Component | File | Role in this slice |
|---|---|---|
| MultiExpertOrchestrator + 4 experts + ToolRegistry | `merlt/merlt/experts/orchestrator.py`, `experts/{literal,systemic,principles,precedent}.py`, `tools/registry.py` | host for the new tools; per-expert tool assignment |
| GraphSearchTool / SemanticSearchTool | `merlt/merlt/tools/search.py` | graph + vector retrieval (already wired) |
| GraphAwareRetriever + `policy_manager` (learnable traversal weights) | `merlt/merlt/storage/retriever/retriever.py`, `merlt/merlt/rlcf/policy_manager.py` | provenance-aware scoring; REINFORCE on traversal |
| IngestionPipelineV2 | `merlt/merlt/pipeline/ingestion.py` (+ built in `core/legal_knowledge_graph.py:connect`) | live norm → structured nodes |
| BrocardiScraper / NormattivaScraper | built in `core/legal_knowledge_graph.py:connect` | ratio/spiegazione/massime + norm text |
| MultivigenzaPipeline | built in `core/legal_knowledge_graph.py:connect` | temporal versions of a norm |
| EntityDeduplicator | Slice 2c (`pipeline/enrichment/...`) | merge live nodes with existing, no dups |
| Lazy-ingest worker (`URN → scrape → graph`) | `merlt/merlt/worker/tasks.py:ingest_article`, `_urn_to_ingest_params` | the existing "create graph nodes on demand" — extend/trigger from reasoning |
| Consensus triggers + `pending_entities`/`pending_relations` + validation | `merlt/merlt/storage/enrichment/consensus_triggers.py`, `api/enrichment_router.py` | promotion to permanent (Loop α machinery) |
| RLCF: REINFORCE, training, multilevel feedback, traces | `merlt/merlt/rlcf/{policy_gradient,training_scheduler,multilevel_feedback}.py`; tables `qa_traces`/`qa_feedback` | weight learning |
| Embeddings backfill | `merlt/merlt/scripts/backfill_embeddings.py` | also embeds live-created nodes so semantic search finds them |
| **mcp-legal-it** legal tools | `/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it` (clean `src/lib/*/client.py` libs + `src/tools/*` thin `@mcp.tool` wrappers; built on the same `visualex`) | the live authoritative arm |

### 2.2 New — BUILD

1. **MCP legal-tool adapters** — expose mcp-legal-it tools as MERL-T `Tool` objects in the
   ToolRegistry, assigned per expert (mapping in §3).
2. **Provenance model** on graph nodes (§4.1).
3. **Reasoning→Enrichment bridge** (§4.3): cited live retrieval → seed pipeline → provisional node.
4. **Promotion flow** (§4.4): provisional → community_validated (hybrid).
5. **Provenance-aware traversal** (§4.2): trust factors into retrieval scoring.
6. **Learnable tool weights** (§5): per-expert/per-domain tool-gating, REINFORCE-tuned, latency-aware.
7. **User-collaborative refinement** surface (§6): provenance + confirm/correct/remember affordance.

---

## 3. Per-expert tool mapping (canon → tools)

Each expert keeps GraphSearchTool + SemanticSearchTool AND gets live tools:

| Expert (canon, art. 12/14 Preleggi) | Live tools (mcp-legal-it) | Source |
|---|---|---|
| **Literal** (significato proprio) | `cite_law`, `fetch_law_article` | Normattiva / EUR-Lex |
| **Systemic** (connessione) | `fetch_act_index`, `giurisprudenza_su_norma` | Normattiva structure + Italgiure |
| **Principles** (ratio/intenzione) | `cerca_brocardi`, `fetch_law_annotations` | Brocardi.it (ratio/spiegazione/massime) |
| **Precedent** (prassi) | `cerca_giurisprudenza`, `leggi_sentenza`, `cerca_giurisprudenza_cgue` | Cassazione/Italgiure, CGUE; (extensible: tributaria, amministrativa) |

These map 1:1 onto each expert's existing `source_types` (`merlt/merlt/storage/retriever/models.py`:
Literal/Systemic→`norma`, Principles→`ratio`/`spiegazione`, Precedent→`massima`).

---

## 4. Architecture & flows

### 4.1 Provenance / trust model (graph nodes)

Add to every node (and respect on write in `storage/graph/entity_writer.py` + ingestion):

```
provenance        : enum { seed, live_unconfirmed, community_validated }
trust_weight      : float [0,1]      # seed=1.0, community_validated≈0.8–1.0, live_unconfirmed≈0.2–0.4
source_tool       : str | null       # e.g. "cite_law", "leggi_sentenza", or "seed"
source_url        : str | null       # the fonte URL/URN the node was built from
first_seen_at     : timestamp
confirmed_by      : list[user_id]    # users who confirmed in-dialogue
consensus_net_score : float          # from Loop α trigger (when in pending_*)
validation_status : enum { provisional, pending, approved }
```

Seed nodes are backfilled `provenance=seed, trust_weight=1.0` (one-time migration; default on
missing = treat as seed for backward-compat).

### 4.2 Provenance-aware traversal

`GraphAwareRetriever` scoring becomes `final_score = relevance × f(trust_weight) × policy_weight`,
where `f` down-weights `live_unconfirmed`. The `policy_manager` traversal weights (§5) are learned;
trust is a multiplicative prior. Surfacing must still RETURN low-trust nodes (flagged), never hide
them — the user decides.

### 4.3 The loop (per query)

```
query
 └─ gating: which experts (existing GatingNetwork)
     └─ per expert, IN PARALLEL:
         ├─ graph retrieval (GraphAwareRetriever, provenance-aware)        [fast, curated]
         └─ live retrieval (MCP tools, gated by tool-weights + latency)    [authoritative]
     └─ reason → cite sources (graph nodes + live retrievals)
     └─ synthesis (convergent/divergent)  →  answer + provenance-tagged sources
 └─ BRIDGE (async, non-blocking the answer):
     for each LIVE retrieval cited in the answer:
         seed pipeline (Ingestion + Brocardi + Multivigenza, by availability)
           → structured node(s)  → EntityDeduplicator (merge or create)
           → provenance=live_unconfirmed, trust low, source_tool/url set
           → embed into Qdrant (backfill mechanism) so semantic search finds it next time
 └─ FEEDBACK:
     user in-dialogue (confirm/correct) + community (authority-weighted)
       → RLCF multilevel feedback → REINFORCE on traversal + tool weights (§5)
       → PROMOTION of provisional nodes (§4.4)
next query: validated nodes are now in the graph → instant, high-trust. Loop tightens.
```

### 4.4 Promotion flow (DECISION: hybrid)

- **Live retrieval cited** → provisional node (`live_unconfirmed`, low trust). Usable immediately,
  flagged.
- **User confirms in-dialogue** ("pertinente / ricorda") → the provisional node is turned into a
  `pending_entity`/`pending_relation` **attributed to the user** (enters Loop α) and its trust is
  bumped for that user's context. *(This is "the user proposes.")*
- **Community authority-weighted consensus** (existing trigger, `net_score ±2.0`) →
  `provenance=community_validated`, high trust, permanent. *(This is "the community ratifies.")*

Rationale: prevents pollution (no blind auto-promote), keeps human/community in the loop, reuses the
Loop α machinery verbatim, gives the user immediate benefit while the community decides global truth.
*(Override knob: a future "trusted-source auto-promote" for `cite_law` Normattiva text — defer.)*

---

## 5. Learnable weights (RLCF)

Two weight families, both authority-weighted, both REINFORCE-tuned from `qa_feedback`:

1. **Traversal weights** (EXISTS — re-enable + fix): `policy_manager` + `policy_gradient`. Today it is
   DISABLED at boot because `get_policy_manager()` hardcodes Redis `localhost:6380` (unreachable in
   container — see `app.py` Bug-1 comment). **Fix:** make `get_policy_manager()` read `REDIS_URL`/
   `RQ_REDIS_URL` from env; re-enable in the retriever wiring. Reward = retrieval-level multilevel
   feedback.
2. **Tool weights** (NEW — mirror the expert `GatingNetwork`): a learned gating over the per-expert
   tool set → `P(call tool | query, expert, domain)`. Reward = "did this tool's retrieval contribute
   to an answer the user/community approved (high grounding)?"; penalty = latency cost. Per-expert AND
   per-domain (the Precedent expert weights Cassazione high; Literal weights Normattiva high). Start
   with sensible priors (the §3 mapping) and let feedback move them.

Training stays manual/admin via `POST /api/merlt/ops/rlcf/training/start` (existing). NB: Bug 4 —
the training trace shape mismatch (`PipelineTrace` vs `ExecutionTrace.from_dict` requires `query_id`)
must be fixed for REINFORCE to consume traces (`rlcf/training_scheduler.py`, `rlcf/execution_trace.py`).

---

## 6. User-collaborative refinement (UX, via BFF + FE — the Q&A surface)

- BFF: `POST /api/merlt/experts/query` (proxy to `:8000/api/v1/experts/query`, authenticate +
  consentGuard, inject `user_id`, map consent `none/basic/full → anonymous/basic/full`), mounted in
  `backend/src/routes/merlt/index.ts` BEFORE the catch-all auth routers (gotcha #1).
- BFF: `POST /api/merlt/experts/feedback/*` (inline/source/refine) → MERL-T feedback endpoints (exist).
- BFF: `POST /api/merlt/experts/confirm-source` → triggers §4.4 user-confirm promotion.
- FE: lazy `QAPage` (route `/merlt/chiedi`, consent=full gate) replacing the "Q&A esperti — In arrivo"
  placeholder (`frontend/src/pages/MerltHubPage.tsx`). Renders: synthesis + per-source provenance
  chip (`seed`/`live`/`validated`) + 👍/👎 + a "ricorda nel grafo" affordance. The `merltService.ts`
  already has dead `askMerlt`/feedback stubs to rewire.

This is "fix-first": expose the Q&A only once §1 grounding gates pass.

---

## 7. mcp-legal-it consumption (DECISION: MCP-client, with direct-import fallback)

**Primary (recommended):** run mcp-legal-it as an **HTTP MCP service** in `docker-compose.merlt.yml`
(`MCP_TRANSPORT=http`, port e.g. 8011). MERL-T gets ONE generic `McpLegalToolAdapter` that lists the
remote tools and wraps each as a MERL-T `Tool` (name, schema, async `execute` → MCP `tools/call`).
Rationale: decoupled, no vendoring drift, the legal toolbox is reusable by *other* agents, and
MCP-over-local-HTTP latency is negligible vs the 30–45s scraping it fronts.

**Fallback (perf-critical):** direct import — mcp-legal-it’s `src/lib/*/client.py` are pure async
functions (no MCP), e.g. `_cite_law_impl`, `_leggi_sentenza_impl`, `_cerca_brocardi_impl`. Either
vendor the needed `src/lib/*` into `merlt/` (like the existing selective vendoring) or `pip install`
it. Use only if MCP-client latency proves material.

Either way: **caching is the graph** — what's retrieved and validated migrates into FalkorDB+Qdrant,
so the live call happens once.

---

## 8. Phases (execute in order; each has an acceptance check verifiable WITHOUT the FE)

> Verify by calling `POST :8000/api/v1/experts/query` with `include_trace=true` and inspecting
> `sources` + `pipeline_trace.stages.expert_executions` + container logs, and FalkorDB/Qdrant queries.

**Phase A — Live tools in the experts (the arm).**
- Add mcp-legal-it as an HTTP MCP service in compose; build `McpLegalToolAdapter`; register the §3
  tools in the ToolRegistry; assign per-expert; wire at boot in `app.py`.
- ✅ Accept: a query (e.g. "art. 1218 c.c. inadempimento") returns sources from BOTH graph and a live
  tool (e.g. a real Brocardi ratio and/or a Cassazione massima), each with a resolvable URL.

**Phase B — Provenance model.**
- Add provenance/trust to node schema + `entity_writer`/ingestion write-path; migrate seed nodes to
  `provenance=seed, trust=1.0`; make `GraphAwareRetriever` scoring provenance-aware.
- ✅ Accept: graph query shows `provenance` on nodes; a live-created node is `live_unconfirmed`;
  traversal score reflects trust; low-trust nodes still returned (flagged).

**Phase C — Reasoning→Enrichment bridge.**
- On answer, route each cited live retrieval through the seed pipeline (Ingestion+Brocardi+Multivigenza
  by availability) → dedup → provisional node + Qdrant embed. Async, never blocks/fails the answer.
- ✅ Accept: ask about an article NOT in the seed (e.g. a c.p. article once that source is enabled, or
  a 2024 Cassazione) → provisional nodes appear in FalkorDB with provenance=live_unconfirmed; re-asking
  hits the graph (faster, no live call needed).

**Phase D — Promotion (hybrid).**
- `confirm-source` endpoint → provisional → `pending_*` (Loop α) attributed to user; community
  consensus trigger → `community_validated`.
- ✅ Accept: confirm in dialogue → node enters pending + trust bumps; simulate authority-weighted
  votes to ±2.0 → node flips to community_validated/permanent (reuse the Loop α E2E from
  `slices/rlcf-loop/sprint-plan.md`).

**Phase E — Learnable weights.**
- Fix `get_policy_manager()` Redis (env), re-enable traversal weights; fix Bug 4 trace shape; build
  tool-gating + REINFORCE update; per-expert/per-domain tool weights with latency penalty.
- ✅ Accept: `POST /api/v1/rlcf/training/start` processes traces (`samples_processed>0`, no "Error
  processing experience"); `GET /api/v1/rlcf/policies/weights` shows movement after feedback; tool
  weights shift toward the tools that produced approved sources.

**Phase F — UX (BFF + FE Q&A).**
- BFF experts routes + confirm/feedback; FE `QAPage` with provenance chips + collaboration affordance;
  flip the hub placeholder. Add to `docs/merlt/smoke-checklist.md`.
- ✅ Accept: logged-in `full`-consent user asks a question, sees a grounded answer with provenance-
  tagged sources, gives 👍/👎, confirms a source → it enters the graph.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Graph pollution from live nodes | provenance + no-auto-promote + dedup + provenance-aware traversal |
| Latency (30–45s live scraping) | parallel async; tool-gating learns when to call; graph cache migration |
| External-site fragility (scrapers break) | mcp-legal-it returns structured errors; expert degrades to graph + flags reduced grounding |
| Live nodes not semantically findable | embed live nodes into Qdrant on creation (backfill mechanism) |
| Trace-shape mismatch blocks training (Bug 4) | fix in Phase E before relying on REINFORCE |
| CRITICAL files | helpers only; never change `experts/base.py` signatures; `authority.py` untouched |

## 10. Open decisions (flagged for the human; defaults chosen so the agent can proceed)

1. **Promotion** — DEFAULT: hybrid (§4.4). [confirmed]
2. **mcp-legal-it consumption** — DEFAULT: MCP-client over HTTP (§7). [confirmed; direct-import fallback]
3. **Tool weights granularity** — DEFAULT: per-expert AND per-domain (§5).
4. **Authority weights** `α/β/γ` reconciliation (`0.4/0.4/0.2` vs `0.3/0.5/0.2`) — separate decision,
   does NOT block this slice (do not touch `authority.py`).
5. **Trusted-source auto-promote** (e.g. Normattiva `cite_law` text) — deferred; keep human-in-loop.

---

## 11. What "done" looks like

A lawyer asks a legal question. Four hermeneutic experts answer by reasoning over the curated graph
AND live authoritative sources; the answer is traceable to fonti/URN with visible provenance;
disagreement is preserved; the live sources just used (when correct and confirmed) have enriched the
graph for next time; and the system's traversal + tool weights have nudged toward how the community
reasons. The graph, the tools, and the community co-evolve — perpetually.
