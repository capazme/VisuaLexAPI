# Loop β Phase F — Q&A UX (BFF + FE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the lawyer a usable Q&A page over the MERL-T multi-expert engine — ask → grounded synthesis with per-source readable-URN + provenance chips + confidence, 👍/👎, refine, and "remember in the graph".

**Architecture:** Server-side polish in MERL-T Python (additive: readable URN + provenance/trust + confirmable node_id on sources; grounding-aware confidence) → thin BFF proxy (`/api/merlt/experts/*`, mirrors `graphClient.ts`/`validate.ts`) → FE conversational-thread page (`/merlt/chiedi`, full-consent + flag gated).

**Tech Stack:** MERL-T (FastAPI/Python, FalkorDB), BFF (Express/TS, vitest+supertest+nock), FE (React/TS, Zustand, vitest+jsdom, cytoscape link-out to `/grafo`).

**Spec:** `docs/superpowers/specs/2026-05-31-merlt-loopbeta-phase-f-qa-ux-design.md`

**Hard rules:** `experts/base.py` is CRITICAL → additive only, no signature changes. One Python rebuild for all of F.0. Commit per milestone (propose, wait for ok). No push. Code-review after each milestone, fix everything before proceeding.

**Env (live):** merlt-api `:8000`, BFF `:3001`, Vite `:5173`, Postgres `:5436` (`docker exec visualex-merlt-postgres psql -U merlt -d merlt`), FalkorDB `:6382`. MERL-T admin test key `loopbeta-d-test-key` (header `X-API-Key`).
Rebuild: `docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker && docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker`

---

## File Structure

**MERL-T (Python) — F.0:**
- Modify `merlt/merlt/api/experts_router.py` — `SourceReference` (+`node_id`, +`citation`), `_to_source_reference` (URN/provenance/trust/node_id surfacing), new helper `_build_source_enrichment(result)`.
- Modify `merlt/merlt/experts/synthesizer.py` — grounding factor in `_calibrate_confidence`.
- Read-only: `merlt/merlt/pipeline/provisional_writer.py` (reuse `_derive_node_id`, `_extract_source_url`), `merlt/merlt/storage/graph/*` (provenance lookup client).

**BFF (TS) — F.1:**
- Create `backend/src/services/merlt/expertsClient.ts`
- Create `backend/src/schemas/merlt/experts.ts`
- Create `backend/src/routes/merlt/experts.ts`
- Modify `backend/src/routes/merlt/index.ts` (register)
- Create `backend/tests/unit/merlt/expertsClient.test.ts`
- Create `backend/tests/integration/merlt/experts-routes.test.ts`
- Modify `backend/tests/setup.ts` if new truncation needed (none — no new tables)

**FE (TS) — F.2:**
- Modify `frontend/src/services/merltService.ts` (+`askMerltQuestion`, +`confirmMerltSource`, typed)
- Create `frontend/src/features/merlt/qa/types.ts`
- Create `frontend/src/features/merlt/qa/useQaThread.ts`
- Create `frontend/src/features/merlt/qa/QaSourceChip.tsx`
- Create `frontend/src/features/merlt/qa/QaComposer.tsx`
- Create `frontend/src/features/merlt/qa/QaTurn.tsx`
- Create `frontend/src/features/merlt/qa/QAPage.tsx`
- Modify `frontend/src/App.tsx` (lazy route `/merlt/chiedi`)
- Modify the Sidebar (entry, gated)
- Modify `frontend/src/pages/MerltHubPage.tsx` (flip `hub-card-qa`)
- Create `frontend/src/features/merlt/qa/__tests__/useQaThread.test.ts`
- Create `frontend/src/features/merlt/qa/__tests__/QaSourceChip.test.tsx`
- Modify `docs/merlt/smoke-checklist.md`

---

# MILESTONE F.0 — MERL-T Python polish (ONE rebuild)

### Task 1: Verify the real trace + provenance-lookup internals (investigation, read-only)

**Files:** read-only — `merlt/merlt/experts/orchestrator.py` (`_build_retrieval_trace` ~:998-1035, synthesis metadata ~:771-794), `merlt/merlt/experts/base.py` (LegalSource :78-110, combined_legal_basis assembly), `merlt/merlt/pipeline/provisional_writer.py` (`_derive_node_id` :131-154, `_extract_source_url` :113-128), `merlt/merlt/storage/graph/` (FalkorDB client used to read a node's `provenance`/`trust` by URN).

- [ ] **Step 1: Dump a real warm response and lock key paths**

Run (from repo root):
```bash
curl -s -X POST http://localhost:8000/api/v1/experts/query \
  -H "Content-Type: application/json" -H "X-API-Key: loopbeta-d-test-key" \
  -d '{"query":"art. 1453 c.c. risoluzione per inadempimento","user_id":"plan-verify","include_trace":true,"consent_level":"full"}' \
  > /tmp/merlt_f_dump.json
python3 -c "import json;d=json.load(open('/tmp/merlt_f_dump.json'));print('sources:',json.dumps(d['sources'],ensure_ascii=False,indent=2)[:1500]);rt=(d.get('pipeline_trace') or {}); print('TRACE KEYS:',list(rt.keys()))"
```
Record: (a) the actual `sources[].article_urn` values (UUID vs URN), the `citation`/`excerpt` presence; (b) where in `pipeline_trace` the retrieval `top_sources` live (expert_executions[*].retrieval_trace.top_sources per orchestrator `_build_retrieval_trace`), and whether `top_sources` are bare URNs or dicts.

- [ ] **Step 2: Confirm the FalkorDB provenance-lookup primitive**

Run:
```bash
grep -rn "def .*provenance\|MATCH (n).*provenance\|\.provenance\|n.trust\|def get_node\|def query" merlt/merlt/storage/graph/*.py | head -30
```
Record the exact callable to read `{provenance, trust}` for a node by `URN`/`node_id` (e.g. a `GraphClient.query(cypher, params)` returning rows). If none exists, note that M6b uses a one-line Cypher `MATCH (n {URN:$urn}) RETURN n.provenance AS provenance, n.trust AS trust LIMIT 1` via the existing FalkorDB client.

- [ ] **Step 3: Confirm `alternatives` (divergent) shape**

Run:
```bash
curl -s -X POST http://localhost:8000/api/v1/experts/query \
  -H "Content-Type: application/json" -H "X-API-Key: loopbeta-d-test-key" \
  -d '{"query":"natura giuridica della caparra confirmatoria, tesi a confronto","user_id":"plan-verify","include_trace":false,"consent_level":"full","max_experts":4}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('mode:',d['mode']);print('alternatives:',json.dumps(d.get('alternatives'),ensure_ascii=False,indent=2)[:1200])"
```
Record the `alternatives[]` item shape (keys: likely `expert`/`interpretation`/`confidence`). The FE `QaTurn` divergent renderer (Task 11) consumes exactly these keys.

No commit (read-only spike). The recorded facts parameterize Tasks 2–3 and 11.

---

### Task 2: M6 (Option A) — `retrieved_sources` panel with real URN/provenance/trust/node_id + readable `citation` on cited sources

**Verified key paths (Task 1):** graph = `merl_t_legal`; URNs at `pipeline_trace.stages.expert_executions[*].retrieval_trace.top_sources` (list of strings); cited `combined_legal_basis` lose provenance (LLM ids); FalkorDB lookup by URN works; `live_unconfirmed` nodes carry `node_id=live:<hash>`; `FalkorDBClient.query(cypher,params)->List[Dict]`, `_get_graph_client(None)` builds+connects using `FALKORDB_GRAPH_NAME` env (= `merl_t_legal` in the container).

**Files:**
- Modify: `merlt/merlt/api/experts_router.py` (`SourceReference` :73-85 → add `citation`; new `RetrievedSource` model; `ExpertQueryResponse` → add `retrieved_sources`; new async `_build_retrieved_sources(result)`; call it in `query_experts` + refine)
- Test: `merlt/tests/unit/test_experts_retrieved_sources.py` (create)

- [ ] **Step 1: Write the failing unit test**

Create `merlt/tests/unit/test_experts_retrieved_sources.py`:
```python
import pytest
from types import SimpleNamespace
from merlt.api.experts_router import _build_retrieved_sources, _to_source_reference


def test_cited_source_surfaces_readable_citation():
    ls = SimpleNamespace(source_type="norm", source_id="norm_1",
                         citation="Art. 1453 c.c.", excerpt="La risoluzione...",
                         relevance="", relevance_score=0.0)
    ref = _to_source_reference(ls)
    assert ref.citation == "Art. 1453 c.c."


@pytest.mark.asyncio
async def test_retrieved_sources_enriched_from_trace(monkeypatch):
    # Fake FalkorDB lookup: one seed URN, one live_unconfirmed node.
    async def fake_lookup(urns):
        return {
            "https://www.normattiva.it/...~art1453": {"provenance": "seed", "trust": 1.0, "node_id": "https://www.normattiva.it/...~art1453"},
            "live:abc123": {"provenance": "live_unconfirmed", "trust": 0.6, "node_id": "live:abc123"},
        }
    monkeypatch.setattr("merlt.api.experts_router._lookup_provenance_batch", fake_lookup)
    result = SimpleNamespace(metadata={"pipeline_trace": {"stages": {"expert_executions": [
        {"retrieval_trace": {"top_sources": ["https://www.normattiva.it/...~art1453", "live:abc123", "https://www.normattiva.it/...~art1453"]}},
    ]}}})
    out = await _build_retrieved_sources(result)
    urns = {s.urn for s in out}
    assert urns == {"https://www.normattiva.it/...~art1453", "live:abc123"}  # de-duped
    live = next(s for s in out if s.urn == "live:abc123")
    assert live.provenance == "live_unconfirmed" and live.node_id == "live:abc123" and live.trust == 0.6
```

- [ ] **Step 2: Run it, verify it fails**

Run: `docker exec visualex-merlt-api python -m pytest tests/unit/test_experts_retrieved_sources.py -v`
Expected: FAIL (`_build_retrieved_sources` / `RetrievedSource` missing).
*(If the live container lacks the new test file: `docker cp merlt/tests/unit/test_experts_retrieved_sources.py visualex-merlt-api:/app/tests/unit/` first, or run in a local venv with `PYTHONPATH=merlt` + `pytest-asyncio`.)*

- [ ] **Step 3: Implement**

In `merlt/merlt/api/experts_router.py`:

(a) add `citation` to `SourceReference`:
```python
    citation: Optional[str] = None
```
and surface it in `_to_source_reference` (the existing helper, single-arg — leave the M6 fallback logic intact, just add `citation`):
```python
    citation = getattr(legal_source, "citation", None) or None
    # ... existing body unchanged ...
    return SourceReference(
        article_urn=article_urn, expert=expert, relevance=relevance,
        excerpt=excerpt, provenance=provenance, trust=trust, citation=citation,
    )
```

(b) new retrieved-sources model + `ExpertQueryResponse` field:
```python
class RetrievedSource(BaseModel):
    """A source the engine actually consulted (from retrieval), with real
    FalkorDB provenance. Distinct from the LLM-cited `sources` (M6 Option A)."""
    urn: str
    provenance: Optional[str] = None
    trust: Optional[float] = Field(None, ge=0.0, le=1.0)
    node_id: Optional[str] = None  # confirmable when provenance == 'live_unconfirmed'
```
Add to `ExpertQueryResponse`:
```python
    retrieved_sources: List[RetrievedSource] = Field(default_factory=list)
```

(c) FalkorDB batch lookup + builder (best-effort, never raises):
```python
async def _lookup_provenance_batch(urns: list) -> Dict[str, dict]:
    """Read {provenance, trust, node_id} for each URN from FalkorDB (merl_t_legal).
    Reuses the configured client → graph name matches the env. Returns {} on error."""
    out: Dict[str, dict] = {}
    if not urns:
        return out
    try:
        from merlt.pipeline.provisional_writer import _get_graph_client
        client = await _get_graph_client(None)
        rows = await client.query(
            "UNWIND $urns AS u MATCH (n) WHERE n.URN = u OR n.node_id = u "
            "RETURN u AS urn, n.provenance AS provenance, n.trust AS trust, n.node_id AS node_id",
            {"urns": urns},
        )
        for r in rows:
            urn = r.get("urn")
            if urn and urn not in out:
                out[urn] = {"provenance": r.get("provenance"), "trust": r.get("trust"), "node_id": r.get("node_id")}
    except Exception as e:  # noqa: BLE001
        log.warning("provenance batch lookup failed (non-blocking)", error=str(e))
    return out


async def _build_retrieved_sources(result: Any) -> List[RetrievedSource]:
    """Build the consulted-sources panel from the retrieval trace + FalkorDB."""
    try:
        pt = (getattr(result, "metadata", None) or {}).get("pipeline_trace") or {}
        execs = (pt.get("stages") or {}).get("expert_executions") or []
        urns: list = []
        for ex in execs:
            for u in ((ex.get("retrieval_trace") or {}).get("top_sources") or []):
                urn = u if isinstance(u, str) else (u.get("urn") if isinstance(u, dict) else None)
                if urn and urn not in urns:
                    urns.append(urn)
        enr = await _lookup_provenance_batch(urns)
        return [
            RetrievedSource(urn=urn, provenance=(enr.get(urn) or {}).get("provenance"),
                            trust=(enr.get(urn) or {}).get("trust"),
                            node_id=(enr.get(urn) or {}).get("node_id"))
            for urn in urns
        ]
    except Exception as e:  # noqa: BLE001
        log.warning("retrieved_sources build failed (non-blocking)", error=str(e))
        return []
```

(d) call it in `query_experts` (after `sources = [...]`, ~:552) and pass to the response:
```python
        retrieved_sources = await _build_retrieved_sources(result)
        # ... in ExpertQueryResponse(...):
        retrieved_sources=retrieved_sources,
```
Do the same in the refine handler (~:1161/1204) so refined answers also carry the panel.

> NOTE: `_to_source_reference` keeps its existing single-arg signature (the M6b provenance fallback on `getattr(legal_source,'provenance')` stays as dead-but-harmless code; cited sources just gain `citation`). All provenance value now flows through `retrieved_sources`. The `node_id` recompute helper and the enrichment-by-source_id idea from the pre-T1 plan are DROPPED.

- [ ] **Step 4: Run the unit test, verify pass**

Run: `docker exec visualex-merlt-api python -m pytest tests/unit/test_experts_retrieved_sources.py -v`
Expected: PASS (2 tests). *(needs `pytest-asyncio`; if absent, mark the async test `@pytest.mark.anyio` per the repo's convention or run the sync test only + verify the async path live in Task 4.)*

No commit yet (batched with Task 3 + rebuild in Task 4).

---

### Task 3: Confidence — factor grounding-rate into calibration

**Files:**
- Modify: `merlt/merlt/experts/synthesizer.py` (`_calibrate_confidence` :370-417, its caller :316-318)
- Test: `merlt/tests/unit/test_synthesizer_confidence.py` (create)

- [ ] **Step 1: Write the failing test**

Create `merlt/tests/unit/test_synthesizer_confidence.py`:
```python
from merlt.experts.synthesizer import ResponseSynthesizer  # adjust to real class name


def test_zero_sources_caps_confidence():
    s = ResponseSynthesizer()
    capped = s._apply_grounding_factor(0.9, n_sources=0)
    assert capped <= 0.4

def test_well_grounded_keeps_confidence():
    s = ResponseSynthesizer()
    kept = s._apply_grounding_factor(0.85, n_sources=6)
    assert kept >= 0.8
```
> Adjust `ResponseSynthesizer` to the real class name found in `synthesizer.py`.

- [ ] **Step 2: Run, verify fail**

Run: `docker exec visualex-merlt-api python -m pytest tests/unit/test_synthesizer_confidence.py -v`
Expected: FAIL (`_apply_grounding_factor` missing).

- [ ] **Step 3: Implement (additive, conservative)**

Add to the synthesizer class:
```python
    def _apply_grounding_factor(self, confidence: float, n_sources: int) -> float:
        """Damp confidence when the answer is poorly grounded. Additive, monotone:
        0 sources → hard cap 0.4; 1-2 → mild damp; >=3 → unchanged."""
        if n_sources <= 0:
            return min(confidence, 0.4)
        if n_sources < 3:
            return confidence * (0.6 + 0.1 * n_sources)  # 1→0.7x, 2→0.8x
        return confidence
```
Wire it where `result.confidence` is finalized (after `_calibrate_confidence`, ~:318), using the count of `combined_legal_basis`/sources available to the synthesizer:
```python
        result.confidence = self._apply_grounding_factor(result.confidence, n_sources=len(result.combined_legal_basis))
```
> Use whatever source-count attribute the synthesizer holds at that point (recorded while editing). If sources aren't in scope there, apply the factor in `experts_router.query_experts` after building `sources` instead — same formula, `n_sources=len(sources)`.

- [ ] **Step 4: Run, verify pass**

Run: `docker exec visualex-merlt-api python -m pytest tests/unit/test_synthesizer_confidence.py -v`
Expected: PASS.

No commit yet.

---

### Task 4: Rebuild + live verification of F.0

- [ ] **Step 1: Rebuild & recreate (durability rule)**

```bash
docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

- [ ] **Step 2: Verify M6 live**

```bash
curl -s -X POST http://localhost:8000/api/v1/experts/query \
  -H "Content-Type: application/json" -H "X-API-Key: loopbeta-d-test-key" \
  -d '{"query":"art. 1453 c.c. risoluzione per inadempimento","user_id":"f0-verify","include_trace":true,"consent_level":"full"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(s.get('article_urn'),'|prov=',s.get('provenance'),'|trust=',s.get('trust'),'|node=',s.get('node_id')) for s in d['sources']];print('confidence',d['confidence'])"
```
Expected: at least one source with a **readable URN** (not a bare UUID) and a non-null `provenance`; `confidence` reflects grounding (not a flat 0.9 when sources are thin).

- [ ] **Step 3: Commit F.0**

Propose to the user, then on ok:
```bash
git add merlt/merlt/api/experts_router.py merlt/merlt/experts/synthesizer.py merlt/tests/unit/test_experts_source_reference.py merlt/tests/unit/test_synthesizer_confidence.py
git commit -m "feat(merlt): Loop β F.0 — readable URN + provenance/trust + confirmable node_id on Q&A sources; grounding-aware confidence"
```

- [ ] **Step 4: Code-review F.0** (`/code-review` or feature-dev:code-reviewer on the diff). Fix all findings before F.1.

---

# MILESTONE F.1 — BFF `/api/merlt/experts/*` (no rebuild)

> **SCOPE UPDATE (post-T1, full feedback surface approved):** besides query/inline/source/refine/confirm-source, the client+route also proxy **`/experts/feedback/detailed`** (`{trace_id,user_id,retrieval_score,reasoning_score,synthesis_score,comment?}`) and **`/experts/feedback/preference`** (`{trace_id,user_id,preferred_expert,comment?}`). Add `feedbackDetailed`/`feedbackPreference` to `ExpertsClient` (Task 5), `detailedFeedbackRequestSchema`/`preferenceFeedbackRequestSchema` to schemas (Task 6), and the two routes + tests (Task 7). Same `authenticate+contributionGuard` pattern. The query response now also carries `retrieved_sources[]` (pass through verbatim).

### Task 5: `expertsClient.ts` (typed proxy client)

**Files:**
- Create: `backend/src/services/merlt/expertsClient.ts`
- Test: `backend/tests/unit/merlt/expertsClient.test.ts`

- [ ] **Step 1: Write failing nock tests**

Create `backend/tests/unit/merlt/expertsClient.test.ts`:
```ts
import nock from 'nock';
import { describe, it, expect, afterEach } from 'vitest';
import { ExpertsClient } from '../../../src/services/merlt/expertsClient';
import { MerltTimeoutError, MerltServerError, MerltBadRequestError } from '../../../src/services/merlt/merltClient';

const BASE = 'http://merlt.test';
const client = new ExpertsClient({ baseUrl: BASE, timeoutMs: 200 });

afterEach(() => nock.cleanAll());

describe('ExpertsClient', () => {
  it('query() posts to /api/v1/experts/query and returns the body', async () => {
    nock(BASE).post('/api/v1/experts/query').reply(200, { trace_id: 't1', synthesis: 'x', mode: 'convergent', sources: [], experts_used: [], confidence: 0.8, execution_time_ms: 10 });
    const r = await client.query({ query: 'art 1453', user_id: 'u1', consent_level: 'full' });
    expect(r.trace_id).toBe('t1');
  });

  it('confirmSource() posts to /api/v1/enrichment/confirm-source', async () => {
    nock(BASE).post('/api/v1/enrichment/confirm-source').reply(200, { ok: true });
    const r = await client.confirmSource({ node_id: 'live:abc', user_id: 'u1' });
    expect(r).toEqual({ ok: true });
  });

  it('maps 5xx to MerltServerError', async () => {
    nock(BASE).post('/api/v1/experts/query').reply(502, 'bad gw');
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltServerError);
  });

  it('maps 4xx to MerltBadRequestError', async () => {
    nock(BASE).post('/api/v1/experts/query').reply(422, { detail: 'too short' });
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltBadRequestError);
  });

  it('maps timeout to MerltTimeoutError', async () => {
    nock(BASE).post('/api/v1/experts/query').delayConnection(500).reply(200, {});
    await expect(client.query({ query: 'q', user_id: 'u', consent_level: 'full' })).rejects.toBeInstanceOf(MerltTimeoutError);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run tests/unit/merlt/expertsClient.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `backend/src/services/merlt/expertsClient.ts`:
```ts
/**
 * HTTP client for MERL-T expert Q&A + confirm-source (FastAPI :8000).
 * Mirrors graphClient.ts: native fetch + AbortController, reuses merltClient's
 * typed error hierarchy. Uses a LONG timeout (experts query is multi-expert,
 * tens of seconds warm) — never the 5s default.
 */
import { MerltTimeoutError, MerltServerError, MerltBadRequestError } from './merltClient';

export interface ExpertsClientConfig { baseUrl: string; apiKey?: string; timeoutMs: number; }

export interface ExpertSourceReference {
  article_urn: string; expert: string; relevance: number;
  excerpt?: string | null; provenance?: string | null; trust?: number | null;
  citation?: string | null; node_id?: string | null;
}
export interface ExpertQueryResponse {
  trace_id: string; synthesis: string; mode: string;
  alternatives?: Record<string, unknown>[] | null;
  sources: ExpertSourceReference[]; experts_used: string[];
  confidence: number; execution_time_ms: number;
  pipeline_trace?: Record<string, unknown> | null;
}
export interface ExpertFeedbackResponse { success: boolean; feedback_id?: number | null; message: string; }

export interface QueryArgs { query: string; user_id: string; consent_level: 'anonymous'|'basic'|'full'; max_experts?: number; include_trace?: boolean; context?: Record<string, unknown>; }
export interface InlineFeedbackArgs { trace_id: string; user_id: string; rating: number; }
export interface SourceFeedbackArgs { trace_id: string; user_id: string; source_id: string; relevance: number; }
export interface RefineArgs { trace_id: string; user_id: string; follow_up_query: string; }
export interface ConfirmSourceArgs { node_id: string; user_id: string; entity_text?: string; entity_type?: string; ambito?: string; }

export class ExpertsClient {
  constructor(private readonly config: ExpertsClientConfig) {}

  query(a: QueryArgs): Promise<ExpertQueryResponse> { return this.request('POST', '/api/v1/experts/query', { include_trace: true, max_experts: 4, ...a }); }
  feedbackInline(a: InlineFeedbackArgs): Promise<ExpertFeedbackResponse> { return this.request('POST', '/api/v1/experts/feedback/inline', a); }
  feedbackSource(a: SourceFeedbackArgs): Promise<ExpertFeedbackResponse> { return this.request('POST', '/api/v1/experts/feedback/source', a); }
  refine(a: RefineArgs): Promise<ExpertQueryResponse> { return this.request('POST', '/api/v1/experts/feedback/refine', a); }
  confirmSource(a: ConfirmSourceArgs): Promise<Record<string, unknown>> { return this.request('POST', '/api/v1/enrichment/confirm-source', a); }

  private async request<T>(method: 'GET'|'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      throw new MerltTimeoutError(err instanceof Error && err.name === 'AbortError'
        ? `Timeout after ${this.config.timeoutMs}ms calling ${path}`
        : `Network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timer);
    if (response.status >= 500) { const t = await response.text().catch(() => ''); throw new MerltServerError(`MERL-T ${response.status} on ${path}: ${t.slice(0,200)}`, response.status); }
    if (response.status >= 400) { let b: unknown = null; try { b = await response.json(); } catch { b = await response.text().catch(() => ''); } throw new MerltBadRequestError(`MERL-T ${response.status} on ${path}`, response.status, b); }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

let cached: ExpertsClient | null = null;
export function createExpertsClient(env: NodeJS.ProcessEnv = process.env): ExpertsClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_EXPERTS_TIMEOUT_MS) || 120000;
  return new ExpertsClient({ baseUrl, apiKey, timeoutMs });
}
export function getExpertsClient(): ExpertsClient { if (!cached) cached = createExpertsClient(); return cached; }
export function _resetExpertsClientForTests(): void { cached = null; }
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run tests/unit/merlt/expertsClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** — defer to Task 7 (whole F.1 milestone commit).

---

### Task 6: Zod schemas `schemas/merlt/experts.ts`

**Files:** Create `backend/src/schemas/merlt/experts.ts`

- [ ] **Step 1: Implement (no separate test — exercised via route tests in Task 7)**

```ts
import { z } from 'zod';

export const expertQueryRequestSchema = z.object({
  query: z.string().min(5).max(2000),
  mode: z.enum(['convergent', 'divergent']).optional(),
  maxExperts: z.number().int().min(1).max(4).optional(),
});
export const inlineFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(5)]),
  sourceId: z.string().optional(),
});
export const sourceFeedbackRequestSchema = z.object({
  traceId: z.string().min(1),
  sourceId: z.string().min(1),
  relevance: z.number().int().min(1).max(5),
});
export const refineRequestSchema = z.object({
  traceId: z.string().min(1),
  followUpQuery: z.string().min(5).max(2000),
});
export const confirmSourceRequestSchema = z.object({
  nodeId: z.string().regex(/^live:/, 'must be a provisional node id'),
  entityText: z.string().optional(),
  entityType: z.string().optional(),
  ambito: z.string().optional(),
});

export type ExpertQueryRequest = z.infer<typeof expertQueryRequestSchema>;
```

- [ ] **Step 2: Commit** — defer to Task 7.

---

### Task 7: `routes/merlt/experts.ts` + register + integration tests

**Files:**
- Create: `backend/src/routes/merlt/experts.ts`
- Modify: `backend/src/routes/merlt/index.ts`
- Test: `backend/tests/integration/merlt/experts-routes.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `backend/tests/integration/merlt/experts-routes.test.ts` (mirror `validate-routes.test.ts`: real Postgres test DB for consent, nock for MERL-T, `_resetExpertsClientForTests` + `MERLT_API_URL` swap). Cases:
```ts
// 1. POST /api/merlt/experts/query without auth → 401
// 2. with auth but consent != full → 403 (contribution_consent_required)
// 3. with full consent + nock 200 → 200, MERL-T received user_id===<jwt user id> and consent_level==='full'
// 4. MERL-T 503/timeout → 503 { detail:'merlt_unavailable' }
// 5. MERL-T 422 → 422 passthrough
// 6. POST /api/merlt/experts/confirm-source full consent + nock 200 → 200, body had node_id + injected user_id
// 7. POST /api/merlt/experts/feedback/inline full consent + nock 200 → 200
```
Use the existing test harness helpers (auth token mint, `prisma.merltUserPreference.upsert({ consentLevel:'full', contributionEnabled:true ... })`).

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && npx vitest run tests/integration/merlt/experts-routes.test.ts`
Expected: FAIL (router not mounted / 404).

- [ ] **Step 3: Implement the router**

Create `backend/src/routes/merlt/experts.ts`:
```ts
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middleware/auth';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import {
  expertQueryRequestSchema, inlineFeedbackRequestSchema, sourceFeedbackRequestSchema,
  refineRequestSchema, confirmSourceRequestSchema,
} from '../../schemas/merlt/experts';
import { getExpertsClient } from '../../services/merlt/expertsClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';

const prisma = new PrismaClient();
const router = Router();

export function mapConsentLevel(level: string | null | undefined): 'anonymous'|'basic'|'full' {
  if (level === 'full') return 'full';
  if (level === 'basic') return 'basic';
  return 'anonymous';
}

function handleMerltError(err: unknown, res: Response): void {
  if (err instanceof MerltBadRequestError) {
    res.status(err.status ?? 400).json(typeof err.body === 'object' && err.body ? err.body : { detail: 'merlt_bad_request' });
    return;
  }
  if (err instanceof MerltClientError) { res.status(503).json({ detail: 'merlt_unavailable' }); return; }
  throw err;
}

router.post('/experts/query', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ detail: 'Authentication required' }); return; }
  const parsed = expertQueryRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() }); return; }
  const pref = await prisma.merltUserPreference.findUnique({ where: { userId: req.user.id }, select: { consentLevel: true } });
  try {
    const result = await getExpertsClient().query({
      query: parsed.data.query, user_id: req.user.id,
      consent_level: mapConsentLevel(pref?.consentLevel),
      max_experts: parsed.data.maxExperts,
      context: parsed.data.mode ? { mode: parsed.data.mode } : undefined,
      include_trace: true,
    });
    res.status(200).json(result);
  } catch (err) { handleMerltError(err, res); }
});

router.post('/experts/feedback/inline', authenticate, contributionGuard, async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ detail: 'Authentication required' }); return; }
  const parsed = inlineFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() }); return; }
  try {
    if (parsed.data.sourceId) {
      res.status(200).json(await getExpertsClient().feedbackSource({ trace_id: parsed.data.traceId, user_id: req.user.id, source_id: parsed.data.sourceId, relevance: parsed.data.rating === 5 ? 5 : 1 }));
    } else {
      res.status(200).json(await getExpertsClient().feedbackInline({ trace_id: parsed.data.traceId, user_id: req.user.id, rating: parsed.data.rating }));
    }
  } catch (err) { handleMerltError(err, res); }
});

router.post('/experts/feedback/source', authenticate, contributionGuard, async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ detail: 'Authentication required' }); return; }
  const parsed = sourceFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() }); return; }
  try { res.status(200).json(await getExpertsClient().feedbackSource({ trace_id: parsed.data.traceId, user_id: req.user.id, source_id: parsed.data.sourceId, relevance: parsed.data.relevance })); }
  catch (err) { handleMerltError(err, res); }
});

router.post('/experts/refine', authenticate, contributionGuard, async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ detail: 'Authentication required' }); return; }
  const parsed = refineRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() }); return; }
  try { res.status(200).json(await getExpertsClient().refine({ trace_id: parsed.data.traceId, user_id: req.user.id, follow_up_query: parsed.data.followUpQuery })); }
  catch (err) { handleMerltError(err, res); }
});

router.post('/experts/confirm-source', authenticate, contributionGuard, async (req, res): Promise<void> => {
  if (!req.user) { res.status(401).json({ detail: 'Authentication required' }); return; }
  const parsed = confirmSourceRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() }); return; }
  try {
    res.status(200).json(await getExpertsClient().confirmSource({
      node_id: parsed.data.nodeId, user_id: req.user.id,
      entity_text: parsed.data.entityText, entity_type: parsed.data.entityType, ambito: parsed.data.ambito,
    }));
  } catch (err) { handleMerltError(err, res); }
});

export default router;
```

In `backend/src/routes/merlt/index.ts` add the import + mount after `opsRouter`:
```ts
import expertsRouter from './experts';
// ...
router.use('/', opsRouter);
router.use('/', expertsRouter);   // per-route auth → order-safe; before catch-all auth (gotcha #1)
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && npx vitest run tests/integration/merlt/experts-routes.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Full BFF suite + lint**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all green (existing 209+ tests + new), no type errors.

- [ ] **Step 6: Commit F.1**

Propose, then on ok:
```bash
git add backend/src/services/merlt/expertsClient.ts backend/src/schemas/merlt/experts.ts backend/src/routes/merlt/experts.ts backend/src/routes/merlt/index.ts backend/tests/unit/merlt/expertsClient.test.ts backend/tests/integration/merlt/experts-routes.test.ts
git commit -m "feat(merlt): Loop β F.1 — BFF /api/merlt/experts/* proxy (query/feedback/refine/confirm-source) with full-consent gate"
```

- [ ] **Step 7: Code-review F.1.** Fix all findings before F.2.

---

# MILESTONE F.2 — FE QAPage

> **SCOPE UPDATE (post-T1, full feedback surface approved):**
> - The answer's provenance chips render from **`retrieved_sources`** (real URN + provenance + trust + node_id), NOT the LLM `sources` (which only feed readable in-prose `citation`/`excerpt`). `QaSourceChip` consumes a `RetrievedSource`.
> - **Collapsible "Come ci sono arrivato"** panel (`QaDeliberationPanel.tsx`, `<details>`): canons consulted (`experts_used`), retrieved_sources list, agreement/disagreement (read from the answer; if not surfaced top-level, omit gracefully). Legal lexicon, no scores/bars.
> - **Per-source feedback** *pertinente/non pertinente* on each chip → `rateMerltSource({traceId, sourceId:urn, relevance:5|1})` → BFF `/experts/feedback/source`.
> - **Canon preference** (divergent only) → `preferMerltExpert({traceId, preferredExpert})` → BFF `/experts/feedback/preference`.
> - **Detailed 3-layer** (inside the panel) → `rateMerltDetailed({traceId, retrieval, reasoning, synthesis, comment?})` → BFF `/experts/feedback/detailed`.
> - `useQaThread` gains `rateSource`/`preferExpert`/`rateDetailed` (all fire-and-forget, optimistic). `merltService` + `qa/types.ts` gain the matching typed fns. Add `QaDeliberationPanel.tsx` to the file list. These are additive to Tasks 8–11.

### Task 8: merltService additions + types

**Files:**
- Create: `frontend/src/features/merlt/qa/types.ts`
- Modify: `frontend/src/services/merltService.ts`

- [ ] **Step 1: Types**

Create `frontend/src/features/merlt/qa/types.ts`:
```ts
export type QaMode = 'convergent' | 'divergent';

export interface QaSource {
  article_urn: string;
  expert: string;
  relevance: number;
  excerpt?: string | null;
  provenance?: string | null;
  trust?: number | null;
  citation?: string | null;
  node_id?: string | null;
}
export interface QaAnswer {
  trace_id: string;
  synthesis: string;
  mode: string;
  alternatives?: Record<string, unknown>[] | null;
  sources: QaSource[];
  experts_used: string[];
  confidence: number;
  execution_time_ms: number;
}
export type QaAnswerState =
  | { status: 'loading' }
  | { status: 'success'; answer: QaAnswer }
  | { status: 'error'; error: string };

export interface QaTurnModel {
  id: string;
  question: string;
  state: QaAnswerState;
  rating?: 1 | 5;                 // optimistic 👍/👎
  confirmed: Record<string, 'pending' | 'done' | 'error'>; // by node_id
}
```

- [ ] **Step 2: Service functions**

In `frontend/src/services/merltService.ts`, add (reuse `postMerlt`, `MERLT_LONG_RUNNING_TIMEOUT_MS`):
```ts
import type { QaAnswer, QaMode } from '../features/merlt/qa/types';

export async function askMerltQuestion(input: { query: string; mode: QaMode; maxExperts?: number }): Promise<QaAnswer> {
  return postMerlt<QaAnswer>('/merlt/experts/query', {
    query: input.query, mode: input.mode, maxExperts: input.maxExperts,
  }, MERLT_LONG_RUNNING_TIMEOUT_MS);
}
export async function refineMerltQuestion(input: { traceId: string; followUpQuery: string }): Promise<QaAnswer> {
  return postMerlt<QaAnswer>('/merlt/experts/refine', input, MERLT_LONG_RUNNING_TIMEOUT_MS);
}
export async function rateMerltAnswer(input: { traceId: string; rating: 1 | 5; sourceId?: string }): Promise<MerltFeedbackResponse> {
  return postMerlt<MerltFeedbackResponse>('/merlt/experts/feedback/inline', input);
}
export async function confirmMerltSource(input: { nodeId: string; entityText?: string }): Promise<Record<string, unknown>> {
  return postMerlt<Record<string, unknown>>('/merlt/experts/confirm-source', input);
}
```
> The legacy article-shaped `askMerlt` (line ~135) stays for any future article-scoped caller; the QAPage uses `askMerltQuestion`.

- [ ] **Step 3: tsc check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit** — defer to Task 12 (FE milestone commit).

---

### Task 9: `useQaThread` hook

**Files:**
- Create: `frontend/src/features/merlt/qa/useQaThread.ts`
- Test: `frontend/src/features/merlt/qa/__tests__/useQaThread.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/useQaThread.test.ts` (mock `../../../../services/merltService`):
```ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useQaThread } from '../useQaThread';
import * as svc from '../../../../services/merltService';

vi.mock('../../../../services/merltService');

const answer = { trace_id:'t1', synthesis:'S', mode:'convergent', sources:[], experts_used:['literal'], confidence:0.8, execution_time_ms:10 };

beforeEach(() => vi.resetAllMocks());

describe('useQaThread', () => {
  it('ask() appends a turn that resolves to success', async () => {
    vi.mocked(svc.askMerltQuestion).mockResolvedValue(answer as never);
    const { result } = renderHook(() => useQaThread());
    await act(async () => { await result.current.ask('art 1453?', 'convergent'); });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('success'));
  });

  it('ask() error → error state', async () => {
    vi.mocked(svc.askMerltQuestion).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useQaThread());
    await act(async () => { await result.current.ask('q', 'convergent'); });
    await waitFor(() => expect(result.current.turns[0].state.status).toBe('error'));
  });

  it('refine() appends a second turn', async () => {
    vi.mocked(svc.askMerltQuestion).mockResolvedValue(answer as never);
    vi.mocked(svc.refineMerltQuestion).mockResolvedValue({ ...answer, trace_id:'t2' } as never);
    const { result } = renderHook(() => useQaThread());
    await act(async () => { await result.current.ask('q', 'convergent'); });
    await act(async () => { await result.current.refine('t1', 'e la diffida?'); });
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && npx vitest run src/features/merlt/qa/__tests__/useQaThread.test.ts`
Expected: FAIL (hook missing).

- [ ] **Step 3: Implement**

Create `frontend/src/features/merlt/qa/useQaThread.ts`:
```ts
import { useCallback, useRef, useState } from 'react';
import { askMerltQuestion, refineMerltQuestion, rateMerltAnswer, confirmMerltSource } from '../../../services/merltService';
import type { QaMode, QaTurnModel, QaSource } from './types';

let seq = 0;
const nextId = () => `turn-${++seq}`;

export function useQaThread() {
  const [turns, setTurns] = useState<QaTurnModel[]>([]);
  const tokenRef = useRef(0);

  const patch = useCallback((id: string, fn: (t: QaTurnModel) => QaTurnModel) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const run = useCallback(async (question: string, id: string, work: () => Promise<unknown>) => {
    const token = ++tokenRef.current;
    try {
      const answer = (await work()) as QaTurnModel['state'] extends never ? never : import('./types').QaAnswer;
      if (token === tokenRef.current) patch(id, (t) => ({ ...t, state: { status: 'success', answer } }));
    } catch (err) {
      if (token === tokenRef.current) patch(id, (t) => ({ ...t, state: { status: 'error', error: err instanceof Error ? err.message : 'Errore' } }));
    }
  }, [patch]);

  const ask = useCallback(async (question: string, mode: QaMode) => {
    const id = nextId();
    setTurns((prev) => [...prev, { id, question, state: { status: 'loading' }, confirmed: {} }]);
    await run(question, id, () => askMerltQuestion({ query: question, mode }));
  }, [run]);

  const refine = useCallback(async (traceId: string, followUp: string) => {
    const id = nextId();
    setTurns((prev) => [...prev, { id, question: followUp, state: { status: 'loading' }, confirmed: {} }]);
    await run(followUp, id, () => refineMerltQuestion({ traceId, followUpQuery: followUp }));
  }, [run]);

  const rate = useCallback((turnId: string, traceId: string, rating: 1 | 5) => {
    patch(turnId, (t) => ({ ...t, rating }));
    void rateMerltAnswer({ traceId, rating }).catch((e) => console.error('rate failed:', e));
  }, [patch]);

  const confirm = useCallback(async (turnId: string, source: QaSource) => {
    if (!source.node_id) return;
    const nodeId = source.node_id;
    patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'pending' } }));
    try {
      await confirmMerltSource({ nodeId, entityText: source.citation ?? undefined });
      patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'done' } }));
    } catch (e) {
      console.error('confirm-source failed:', e);
      patch(turnId, (t) => ({ ...t, confirmed: { ...t.confirmed, [nodeId]: 'error' } }));
    }
  }, [patch]);

  return { turns, ask, refine, rate, confirm };
}
```
> The `run` generic cast is ugly — simplify by typing `work: () => Promise<QaAnswer>` and importing `QaAnswer` at top. Clean it during implementation; the test only checks `state.status`.

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && npx vitest run src/features/merlt/qa/__tests__/useQaThread.test.ts`
Expected: PASS (3 tests).

---

### Task 10: `QaSourceChip`

**Files:**
- Create: `frontend/src/features/merlt/qa/QaSourceChip.tsx`
- Test: `frontend/src/features/merlt/qa/__tests__/QaSourceChip.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { QaSourceChip } from '../QaSourceChip';

const base = { article_urn: 'urn:nir:...~art1453', expert: 'literal', relevance: 0.8, provenance: 'seed', trust: 1.0, citation: 'Art. 1453 c.c.' };

describe('QaSourceChip', () => {
  it('shows the readable citation/URN and provenance, no remember button for seed', () => {
    render(<MemoryRouter><QaSourceChip source={base} confirmState={undefined} onConfirm={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(/Art\. 1453 c\.c\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ricorda/i })).toBeNull();
  });

  it('shows remember button only for live_unconfirmed with node_id', () => {
    const onConfirm = vi.fn();
    render(<MemoryRouter><QaSourceChip source={{ ...base, provenance: 'live_unconfirmed', trust: 0.6, node_id: 'live:abc' }} confirmState={undefined} onConfirm={onConfirm} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /ricorda/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail.** Run: `cd frontend && npx vitest run src/features/merlt/qa/__tests__/QaSourceChip.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

Create `frontend/src/features/merlt/qa/QaSourceChip.tsx`. Logic-bearing rules (markup uses Tailwind per project conventions, `cn()` for conditionals):
- Display label = `source.citation || source.article_urn`.
- The label links to `/grafo?urn=${encodeURIComponent(source.article_urn)}` (reuse Slice 2a) **only** when `article_urn` looks like a real URN (starts with `urn:` or `http`); otherwise render plain text.
- Provenance badge: map `seed`→slate "fondativa", `community_validated`→green "validata", `live_unconfirmed`→amber "provvisoria"; show `trust` as `· trust 0.60` when present.
- "Ricorda nel grafo" `<button>` rendered ONLY when `source.provenance === 'live_unconfirmed' && source.node_id`. States from `confirmState`: undefined→idle "Ricorda nel grafo"; `pending`→spinner "Salvataggio…" disabled; `done`→check "Ricordata" disabled; `error`→"Riprova" (re-enabled). On click → `onConfirm(source)`.
- 4px leading-edge stripe coloured by provenance (reuse the dossier/forum stripe idiom).
- Props interface exported: `{ source: QaSource; confirmState?: 'pending'|'done'|'error'; onConfirm: (s: QaSource) => void }`.

- [ ] **Step 4: Run, verify pass.** Expected: PASS (2 tests).

---

### Task 11: `QaComposer` + `QaTurn` + `QAPage`

**Files:** Create `QaComposer.tsx`, `QaTurn.tsx`, `QAPage.tsx` (no new unit tests beyond a QAPage gate-render smoke folded into Task 12; logic already covered by hook+chip tests).

- [ ] **Step 1: `QaComposer.tsx`**

Props `{ onSubmit: (q: string, mode: QaMode) => void; disabled: boolean }`. Controlled textarea + segmented convergent/divergent toggle (default convergent) + Invia button. Cmd/Ctrl+Enter submits; empty/whitespace ignored; clears on submit. Keyboard-accessible.

- [ ] **Step 2: `QaTurn.tsx`**

Props `{ turn: QaTurnModel; onRate: (rating:1|5)=>void; onRefine:(q:string)=>void; onConfirm:(s:QaSource)=>void }`.
- Question bubble (right-aligned "TU").
- `loading` → skeleton "MERL-T sta ragionando…".
- `error` → amber box + Riprova affordance (re-emit via composer).
- `success` →
  - **Convergent**: `synthesis` text; confidence bar (`▓` proportion of `confidence`) + indicator label; expert chips from `experts_used`; "Fonti" list of `QaSourceChip` (pass `turn.confirmed[source.node_id]`); 👍/👎 buttons (disabled+highlighted once `turn.rating` set, `aria-pressed`); "Approfondisci" toggles an inline mini-composer that calls `onRefine`.
  - **Divergent** (`turn.state.answer.mode === 'divergent' && alternatives`): render each `alternatives[]` item as a labelled card per canon. **Use the exact keys recorded in Task 1 Step 3** (e.g. `expert` + `interpretation` + `confidence`); still render the shared sources list + feedback below.

- [ ] **Step 3: `QAPage.tsx`**

```tsx
// orchestrator: const { turns, ask, refine, rate, confirm } = useQaThread();
// const features = useMerltFeatures(); const { level } = useConsent();
// gate: if (!features.merltEnabled) → "MERL-T non disponibile";
//       else if (level !== 'full') → card with CTA opening <ConsentDialog/>;
//       else → header + empty-state example questions + QaComposer (disabled while last turn loading) + turns.map(QaTurn)
```
Loading guard: `const busy = turns.some(t => t.state.status === 'loading')`.

- [ ] **Step 4: tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: clean (watch `react-hooks/set-state-in-effect` — none of these use in-effect setState; all setState is in callbacks).

---

### Task 12: Wiring (route + sidebar + hub flip + smoke) + FE verification

**Files:** Modify `frontend/src/App.tsx`, the Sidebar component, `frontend/src/pages/MerltHubPage.tsx`, `docs/merlt/smoke-checklist.md`. Test: `frontend/src/features/merlt/qa/__tests__/QAPage.test.tsx` (gate render).

- [ ] **Step 1: Lazy route in `App.tsx`**

Mirror `/merlt/valida`:
```tsx
const QAPage = lazy(() => import('./features/merlt/qa/QAPage').then(m => ({ default: m.QAPage })));
// inside the authenticated routes:
<Route path="/merlt/chiedi" element={<Suspense fallback={<PageLoader/>}><QAPage/></Suspense>} />
```

- [ ] **Step 2: Sidebar entry** — add a "Chiedi a MERL-T" item (icon `MessageSquare`) gated by `isMerltEnabled()`, mirroring the `/merlt/valida` entry's gating.

- [ ] **Step 3: Flip `hub-card-qa`** in `MerltHubPage.tsx`:
```tsx
<HubCard testId="hub-card-qa" icon={MessageSquare} title="Q&A esperti">
  <p className="text-sm text-slate-600 dark:text-slate-300">Domande giuridiche al sistema multi-expert.</p>
  <div className="mt-3">
    {features.canContribute ? (
      <Link to="/merlt/chiedi"><Button variant="primary" size="sm">Apri</Button></Link>
    ) : (
      <p className="text-xs text-slate-500 dark:text-slate-400">Richiede consenso <strong>Completo</strong>.</p>
    )}
  </div>
</HubCard>
```

- [ ] **Step 4: QAPage gate-render smoke test**

`__tests__/QAPage.test.tsx`: mock `useMerltFeatures`/`useConsent`; assert (a) merltEnabled=false → "non disponibile"; (b) level='basic' → consent CTA; (c) level='full' → composer present (`getByPlaceholderText`/role textbox).

- [ ] **Step 5: Full FE suite + lint + build**

Run: `cd frontend && npm run test && npm run lint && npx tsc --noEmit`
Expected: all green (existing 194+ + new), lint clean.

- [ ] **Step 6: Update `docs/merlt/smoke-checklist.md`** — add a "Phase F — Q&A" section: open `/merlt/chiedi` at full consent → ask "art. 1453 c.c. risoluzione" → grounded synthesis + ≥1 source chip with readable URN + provenance + confidence; 👍 persists; refine appends; "ricorda nel grafo" on a provvisoria → then visible in `/grafo`.

- [ ] **Step 7: Live browser smoke** (chrome-devtools MCP or manual): BFF `:3001` + Vite `:5173` + merlt-api `:8000` up. Walk the checklist. Record results.

- [ ] **Step 8: Commit F.2**

Propose, then on ok:
```bash
git add frontend/src/features/merlt/qa frontend/src/services/merltService.ts frontend/src/App.tsx frontend/src/pages/MerltHubPage.tsx <sidebar file> docs/merlt/smoke-checklist.md
git commit -m "feat(merlt): Loop β F.2 — QAPage /merlt/chiedi (multi-expert Q&A, provenance chips, feedback, remember-in-graph) + hub flip"
```

- [ ] **Step 9: Code-review F.2.** Fix all findings.

---

## Self-Review (against the spec)

- **Spec coverage:** M6a/b/c → Task 2; confidence → Task 3; BFF client/schemas/routes/register → Tasks 5–7; consent map + full gate → Task 7; FE thread/composer/turn/chip/page → Tasks 8–11; route/sidebar/hub flip/smoke → Task 12. Divergent toggle → Task 1 Step 3 (shape) + Task 11 Step 2. Per-source remember (live only) → Task 10 + Task 9 `confirm`. ✅ All spec sections mapped.
- **Risks honored:** M6a key-path verified before coding (Task 1 + caveats in Task 2); async-sediment 404 → `confirm` error state + chip "Riprova" (Tasks 9–10); alternatives shape gated (Task 1 Step 3); base.py additive (Task 2 Step 5 avoids signature change); long timeout (Task 5 `MERLT_EXPERTS_TIMEOUT_MS`). ✅
- **Type consistency:** `QaAnswer`/`QaSource`/`QaTurnModel` defined in Task 8, consumed in 9/10/11; `ExpertQueryResponse`/`mapConsentLevel` defined Tasks 5/7. node_id flows SourceReference(2)→ExpertSourceReference(5)→QaSource(8)→confirm(9). ✅
- **Open adjustment points (by design, resolved at execution):** the M6a join key (source_id vs citation) and the synthesizer source-count attribute — both flagged with concrete fallbacks, decided by Task-1 facts. No silent placeholders.
```
