# Sprint-plan — Loop β Co-Evolution (code-verified)

**Companion to** `spec.md` (read the spec for the vision; this file is the EXECUTABLE plan).
**Branch:** `visualex-merlt-main`. **Audience:** implementation agent.
**Provenance:** produced by a 5-lens code-grounded review of `spec.md` against the real tree
(`merlt/merlt/`, `backend/src/`, `server-infra2.0/mcp-legal-it/`). Where this file and the spec
disagree, **this file wins** (the spec carried assumptions the code contradicts — see "Corrections").

**Durability rule (gotcha):** Python changes are baked at build → after editing `merlt/`, run
`docker compose -f docker-compose.merlt.yml --profile api-in-docker build` + recreate **both**
`merlt-api` and `merlt-worker`. Tables/triggers auto-create at boot via lifespan.

---

## Corrections to the spec (code-verified — these override the spec body)

**BLOCKERS** (the spec is factually wrong here; building on it as written would fail):

- **B1 — `get_policy_manager()` does NOT hardcode Redis `localhost:6380`.** `rlcf/policy_manager.py`
  has zero Redis refs; `get_policy_manager()` (policy_manager.py:743) returns a `PolicyManager` that
  loads a **filesystem** checkpoint `checkpoints/traversal_policy_latest.pt` (policy_manager.py:234,250)
  and falls back to `DEFAULT_TRAVERSAL_WEIGHTS` (policy_manager.py:56) when absent. The only `6380`
  in the tree is **FalkorDB**'s port (MerltConfig, legal_knowledge_graph.py:117). Traversal weights
  are inert because (a) the boot retriever is wired `policy_manager=None` (`app.py`) and (b) no `.pt`
  checkpoint exists. **The wrong claim was inherited from a bad inline comment in `app.py` (the Bug-1
  comment) — fix that comment too (task E.1).**
- **B2 — Bug 4 is deeper than a key rename: the `ExecutionTrace` is never serialized.** The
  orchestrator builds an `ExecutionTrace` with `query_id` + `expert_selection` actions carrying
  `query_embedding` (orchestrator.py:329-330,430-450) but persists ONLY `pipeline_trace.to_dict()`
  (orchestrator.py:644). So `QATrace.full_trace` has `trace_id` (not `query_id`) and **zero actions**;
  `ExecutionTrace.from_dict` (execution_trace.py:304) KeyErrors, and even aliased it has no actions →
  REINFORCE trains on nothing (policy_gradient.py:550-558, returns `num_actions:0` **without raising**).
- **B3 — `samples_processed>0` is NOT a valid training gate** — it passes with the exact Bug-4 no-op.
  Require `num_actions>0` AND `grad_norm>0` AND weights actually changed.
- **B4 — there is no per-expert tool assignment**: `_init_experts` clones ONE shared list to every
  expert (orchestrator.py:209). Per-expert mapping (spec §3) needs new orchestrator code; it is
  **deferrable** (acceptance passes with all-experts-all-tools).
- **B5 — registering MCP tools does nothing by itself**: the standard expert path calls only
  `semantic_search` + `graph_search` by name (base.py:726-727; literal.py:262,286); arbitrary tools
  are reachable only via ReAct, and `use_react` defaults to **False** (literal.py:119). Phase A must
  enable `use_react=True` OR extend the standard retrieval path.
- **B6 — MCP tools return formatted markdown `str`, not structured data** (`_result.py:3-4`,
  `.to_str()`). The enrichment bridge cannot consume markdown; it must re-derive structure from the
  citation URL/URN (re-fetch via the structured `src/lib/visualex/scraper.py` / `brocardi/client.py`
  or the lazy-ingest worker).
- **B7 — the lazy-ingest worker is Normattiva-norm-article-ONLY** (`_urn_to_ingest_params` raises on
  non-article URNs, tasks.py:92) — it cannot create a Cassazione node. And `EntityDeduplicator` is a
  **Postgres `pending_entities` text dedup** at `storage/enrichment/deduplication.py` (NOT
  `pipeline/enrichment/...`), not a FalkorDB merge. Phase-C headline case = a Normattiva article not
  in seed; case-law is a separate writer.
- **B8 — provisional `live_unconfirmed` FalkorDB nodes are net-new**: `EntityGraphWriter.write_entity`
  hard-requires `consensus_reached AND consensus_type=='approved'` and hardcodes
  `community_validated:true` (entity_writer.py:124-126,334). Provisional nodes need a NEW low-trust
  writer; at promotion, dedup must recognize the existing provisional node (node-id
  `{type}:{normalized_nome}`).

**MAJORS** (build, but adjust the spec):

- **M1 — scoring is additive, not multiplicative:** `final_score = α·sim + (1-α)·graph_score`
  (retriever.py:11,194; α=0.7). Insert the trust factor into the graph-score path
  (`_compute_graph_score`/`_score_path`) and handle the isolated-node `default_graph_score=0.5`
  case (retriever.py:331).
- **M2 — per-expert/per-domain weights are doubly-blocked:** `TraversalPolicy.forward` has no expert
  input; there is no `domain` signal anywhere (only `query_type`); tool selection has no sampled
  policy/log-prob. → Downgrade default to **per-expert only**; tool-gating needs a new per-expert tool
  head (mirror `ExpertGatingMLP` in `experts/neural_gating/neural.py`), emit `Action(action_type=
  'tool_use', log_prob)` (execution_trace.py:199 `add_tool_use` exists but is never called), and a new
  REINFORCE consumer filtering `tool_use` (current trainers filter only `expert_selection`).
- **M3 — REUSE existing live-arm scaffolding** (the spec's own rule): `ExternalSourceTool`
  (tools/external_source.py:29, returns STRUCTURED `{text,urn,source,...}`), `LiveEnrichmentService`
  (pipeline/live_enrichment.py, scrape→extract→**pending**), `ArticleFetchTool` (tools/search.py:626,
  Normattiva as a native MERL-T tool), and `VISUALEX_API_URL` already wired in compose. mcp-legal-it's
  unique value is **case-law (Italgiure/CGUE) + Brocardi massime**; route norm-text through the
  existing structured tools, jurisprudence through MCP.
- **M4 — direct-import fallback files are wrong:** the structured, MCP-free layer is
  `src/lib/visualex/scraper.py` (`fetch_article/fetch_annotations/fetch_act_index→dict`) and
  `src/lib/brocardi/client.py` (`fetch_brocardi→BrocardiResult`); the `_*_impl` functions live in
  `src/tools/*` and return markdown + import the FastMCP server.
- **M5 — containerization:** mcp-legal-it is a submodule OUTSIDE the repo, default `MCP_PORT=8000`
  collides with merlt-api, and MERL-T has no `fastmcp` dep. Use a prebuilt image or vendor-as-submodule;
  set `MCP_PORT=8011`, `LEGAL_PROFILE=full`; add `MCP_LEGAL_IT_URL`; add `fastmcp>=2.0.0`.
- **M6 — per-source provenance is lost at the API:** `SourceReference` has no provenance field and
  `expert='combined'`/`relevance=0.9` are hardcoded (experts_router.py:474-480). Extend it.
- **M7 — the BFF experts router is NET-NEW** (no `experts.ts` exists), but the FE `merltService.ts`
  already targets `/merlt/experts/query` + feedback paths — build the BFF to match those paths.

(Minors m1–m8 are folded into the task accept-checks below.)

---

## Phase 0 — Prerequisites (do first)

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **0.1** | Confirm seed embeddings backfilled into `merl_t_legal_chunks` | run `merlt/merlt/scripts/backfill_embeddings.py`; inspect Qdrant | — | S | Qdrant `merl_t_legal_chunks.points_count` ≈ 17.2k; a `POST /api/v1/experts/query` returns ≥1 source with non-empty `article_urn`. |
| **0.2** | Dump a real `include_trace=true` response; lock the actual `pipeline_trace.*` key paths | (read-only) | 0.1 | S | Saved JSON; Phase-A/E accept scripts reference confirmed keys, not assumed ones. |
| **0.3** | **Bug-4 fix: persist `ExecutionTrace` into the result + QATrace** | `experts/orchestrator.py` (add `metadata["execution_trace"]=trace.to_dict()` ~:644), `api/experts_router.py` (store + feed to `add_experience`), `rlcf/training_scheduler.py` (read the exec-trace shape) | 0.2 | M | After 1 query + 1 feedback, `qa_traces.full_trace` (or new col) has `query_id` + non-empty `actions[]` with `query_embedding`; `POST /rlcf/training/start` logs `num_actions>0` (not "No expert_selection actions found"). **Gate for all REINFORCE.** |

## Phase A — Live tools in the experts (the arm)

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **A.1** | mcp-legal-it as an HTTP MCP compose service | `docker-compose.merlt.yml` (new service, prebuilt `image:` or in-tree submodule; `MCP_TRANSPORT=http`, `MCP_PORT=8011`, `LEGAL_PROFILE=full`, `profiles:[api-in-docker]`); merlt-api env `MCP_LEGAL_IT_URL=http://mcp-legal-it:8011/mcp` | 0.* | M | `curl http://localhost:8011/mcp` responds; from merlt-api container `tools/list` returns the §3 tools; no 8000 collision. |
| **A.2** | `fastmcp` dep + `McpLegalToolAdapter` | `merlt/pyproject.toml` (`fastmcp>=2.0.0`), `merlt/merlt/tools/mcp_legal_adapter.py` (new: remote `tools/list`→`BaseTool` wrappers; `execute`→`tools/call`→`ToolResult.ok(data=<markdown>)`) | A.1 | M | Rebuild image; adapter lists tools; `execute("cite_law", reference="art. 1218 c.c.")` returns markdown with a Normattiva URL. |
| **A.3** | **[RISKIEST]** enable live-tool invocation in experts (B5) + per-expert map (B4, deferrable) | `merlt/merlt/app.py` (orchestrator wiring: `use_react=True` OR extend standard path; per-expert tool map), `experts/orchestrator.py` (`_init_experts` accept `{expert_type:[Tool]}` vs clone-one-list :209) | A.2, 0.* | L | `POST /experts/query {…, include_trace:true}` → `sources` has BOTH a graph node AND a live-tool result, each with a resolvable URL; logs show a live call. **Riskiest: changes the experts' control flow (ReAct vs fixed sequence) on the hot path that grounds every answer; `experts/base.py` signatures are CRITICAL — change additively via the per-expert map + config only.** Split if needed: A.3a enable ReAct+shared tools (L), A.3b per-expert map (M). |

## Phase B — Provenance model (parallel-safe with Phase A)

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **B.1** | provenance/trust on all write surfaces | `storage/graph/entity_writer.py`, `pipeline/ingestion.py` (36 MERGE/SET blocks), schema doc | — | M | A lazy-ingested Normattiva node carries `provenance`; seed node shows `provenance` absent-or-`seed`. |
| **B.2** | one-time seed backfill `provenance=seed, trust=1.0` | `merlt/merlt/scripts/backfill_provenance_seed.py` (new) | B.1 | S | `MATCH (n) WHERE n.provenance='seed' RETURN count(n)` ≈ 27.7k; no null-provenance nodes. |
| **B.3** | provenance-aware traversal (M1) + API surface (M6) | `storage/retriever/retriever.py` (trust factor in `_compute_graph_score`/`_score_path`; isolated-node default at :331), `api/experts_router.py` (`SourceReference`+provenance/trust; stop hardcoding expert/relevance :474-480) | B.1,B.2 | M | `sources[].provenance` populated; a `live_unconfirmed` node still returned (flagged) and ranks below an equivalent `seed` node (verify in `include_trace`). |

## Phase C — Reasoning→Enrichment bridge

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **C.1** | provisional-node writer (norm-article path reuses `ingest_norm`; B7,B8,M3) | extend `pipeline/live_enrichment.py` to emit `live_unconfirmed` nodes OR new `pipeline/provisional_writer.py`; dedup vs `EntityGraphWriter._check_duplicate_mechanical` | A.3,B.1 | L | call for a Normattiva article NOT in seed → FalkorDB node `provenance=live_unconfirmed`, `source_tool/url` set; re-run MERGEs (no dup). |
| **C.2** | async non-blocking bridge + Qdrant embed (m3) | `experts/orchestrator.py` (post-synthesis async hook, failure-isolated like the Slice-2a lazy trigger); embed node text as a chunk into `merl_t_legal_chunks` with `article_urn` payload | C.1,B.3 | M | non-seed query → answer immediate; within seconds provisional node + Qdrant chunk exist; **re-asking hits the graph** (no 2nd live scrape in logs); killing mcp-legal-it → query still 200s. |

*(Case-law Cassazione/CGUE provisional nodes = separate writer, defer as C.3.)*

## Phase D — Promotion (hybrid)

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **D.1** | `confirm-source`: provisional → `pending_*` attributed to user | `api/enrichment_router.py` (or new endpoint), `api/experts_router.py` | C.1 | M | confirm → `pending_entities` row attributed to `user_id`; node trust bumps. |
| **D.2** | community consensus → `community_validated` (reuse Loop α; m2 net_score copy; B8 collision) | reuse `consensus_triggers.py`, `entity_writer.py` | D.1 | S | votes to `net_score ≥ +2.0` → trigger flips consensus; node → `community_validated`, permanent, no dup. |

## Phase E — Learnable weights

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **E.1** | re-enable traversal weights — REAL fix (B1) + fix the wrong app.py comment | `merlt/merlt/app.py` (construct `PolicyManager` via `get_policy_manager()` and pass into `GraphAwareRetriever` instead of `policy_manager=None`; correct the Bug-1 comment) | 0.3 | S | boot logs show retriever with non-None `PolicyManager`; `GET /rlcf/policies/weights` returns traversal weights (static until a `.pt` exists). |
| **E.2** | strengthen training accept + verify REINFORCE updates (B3) | verify in `rlcf/training_scheduler.py`, `policy_gradient.py` | 0.3,E.1 | S | after feedback, `POST /rlcf/training/start` shows `num_actions>0` AND `grad_norm>0`; `GET /rlcf/policies/weights` **changed** vs baseline. |
| **E.3** | tool-gating policy + REINFORCE (NEW; M2, per-expert only) | `experts/neural_gating/` (per-expert tool head, mirror `ExpertGatingMLP`), `experts/react_mixin.py` (sample tool; emit `add_tool_use(...,log_prob)`), `rlcf/policy_gradient.py` (consumer filtering `tool_use`) | A.3,E.2 | L | trace has `tool_use` actions with non-zero `log_prob`; after feedback+training, tool weights move toward the tool that produced an approved source. (per-domain deferred behind a domain-classifier prereq.) |

## Phase F — UX (BFF + FE Q&A)

| id | title | files | deps | eff | accept |
|---|---|---|---|---|---|
| **F.1** | NET-NEW BFF `/api/merlt/experts/*` router (M7) | `backend/src/routes/merlt/experts.ts` (new: `POST /experts/query` proxy authenticate+consentGuard, inject `user_id`, map consent none/basic/full→anonymous/basic/full; `feedback/{inline,detailed,source,refine}`; `confirm-source`), `routes/merlt/index.ts` (register BEFORE catch-all auth — gotcha #1), `services/merlt/expertsClient.ts` (new) | D.1 | M | authed full-consent `POST /api/merlt/experts/query` → 200 with provenance-tagged sources; `confirm-source` → provisional → `pending_*`. vitest+supertest (nock) green. |
| **F.2** | FE `QAPage` + hub flip | new `frontend/src/.../QAPage.tsx` (route `/merlt/chiedi`, consent=full, lazy), `frontend/src/pages/MerltHubPage.tsx` (flip `hub-card-qa` "In arrivo"), verify `services/merltService.ts` paths, `docs/merlt/smoke-checklist.md` | F.1,B.3 | M | full-consent user asks → grounded answer + per-source provenance chips + 👍/👎 + "ricorda nel grafo"; confirming a source → enters the graph. |

---

## Critical path & parallelism
- **Critical path:** `0.3` (Bug-4) → `A.1` → `A.2` → **`A.3` (riskiest)** → `C.1` → `C.2` → `D.1` → `F.1`.
- **Parallel:** Phase B ∥ Phase A (no shared files); `E.1`/`E.2` ∥ everything after `0.3`; `F.1` scaffold can start once `D.1` lands.
- **Runnable invariant:** every phase leaves the stack bootable. `0.3` gates all REINFORCE work; `A.3` gates live-tool acceptance.

## Single riskiest task
**A.3** — it rewires the experts' control flow (ReAct vs fixed-sequence) on the path that grounds every
answer, and must stay additive because `experts/base.py` is CRITICAL (no signature changes).
