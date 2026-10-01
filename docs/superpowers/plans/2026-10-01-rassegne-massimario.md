# The Massimario's annual reviews — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the 63 volumes of the Ufficio del Massimario's annual reviews (2010–2024) into MERL-T's stores — paragraphs in Qdrant, decisions and norms in the graph, the links in the bridge — and show the reader, on each article page, the review paragraphs that cite that article, year by year.

**Architecture:** VisuaLex gets two internal routes: one fetches portal elements politely, one completes acts cited by year only. A new MERL-T mechanical-ingestion adapter turns one volume into a staged batch (nodes, edges, chunks, bridge rows, a report). On the administrator's approval the graph is written, then a chained worker job writes vectors and bridge rows slice by slice. A MERL-T read endpoint answers "paragraphs citing this URN", grouped by year; the BFF proxies it and a self-contained web component renders it in the `article_content_after` slot.

**Tech Stack:** Python 3 (Quart, FastAPI, RQ, SQLAlchemy async, FalkorDB, qdrant-client, sentence-transformers e5-large), TypeScript (Express + Zod + vitest/supertest; React 19 + vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-10-01-rassegne-massimario-design.md` (approved 1 October, corrected the same day). Read it before any task.

## Preconditions

- The graph round's first pull request (the schema module `services/merlt/merlt/storage/graph/schema.py` with `Label`, `Rel`, `SourceType`, `Fonte`, `Provenance`, `canonical_urn()`, `point_id()`, `stub_properties()` and the contract test `services/merlt/tests/unit/test_graph_vocabulary_contract.py`) is merged into `develop`. Nothing in Tasks 3–13 starts before that.
- This branch is in sync with `develop` (Task 0).

## Global Constraints

- **No text from the reviews enters the repository.** Test fixtures are synthetic, written in the portal's format, with invented names and invented `Rv.` numbers. The `Rv.` range table (Task 7) is numbers only.
- **Nothing private enters the repository**: no personal paths, no names of people, no secrets (root `CLAUDE.md`). Commands below find the main checkout with `git worktree list`.
- **Every request to an external host goes through `services/visualex`**: its `ThrottledHttpClient`, its egress allowlist, an honest User-Agent (`VisuaLex (+https://github.com/capazme/VisuaLexAPI)`), and for the portal at least 1.5 s between requests.
- **No change under `infra/`** and no new ingress route: the two VisuaLex routes stay internal (the ingress routes an allowlist of prefixes; neither `/fetch_massimario` nor `/resolve_act_dates` matches one).
- **The article text is untouched** (root `CLAUDE.md`, rule 23): the panel lives in a plugin slot outside the article body.
- **Names come from the schema module.** New names: `SourceType.RASSEGNA = "rassegna"`, `Fonte.MASSIMARIO = "Ufficio del Massimario"`. Bridge relation types are module constants (`CITA_NORMA`, `CITA_PRONUNCIA`), not graph edges. The batch and bridge `source` is `massimario`.
- **Decision identity** (spec §5.2, shared with the sentenze round): `cassazione:civile:13319:2024`, `cassazione:penale:1399:2000`, `corte_costituzionale:1:2014`; `numero` without leading zeros; criminal `anno` = deposit year; the section is an attribute. A citation without a year takes the review's year only when its `Rv.` falls inside that year's range; otherwise it is a reference without identity.
- **Strong and weak links**: bridge rows (paragraph → norm, paragraph → decision) have confidence `1.0`; the graph edge decision → norm is `INTERPRETA` with `tipo: "co-citazione"`, `confidenza: 0.5`.
- **Norm citations** (owner, 1 October): the style is «art. 2, l. 7 agosto 1990, n. 241», codes as «art. 1284 c.c.». In this round a norm citation shown to the reader is the review author's own text, highlighted as written and never rewritten (it is the source's text); the `estremi` of norm stubs come from the schema module's formatter, owned by the graph round, which carries this style. No code in this plan formats a norm citation of its own.
- **Italian copy, verbatim**: `Nelle rassegne della Cassazione`; `1 passo` / `N passi`; `Rassegna dell'anno AAAA`; `mostra tutto` / `mostra meno`; `Altri passi`; `Fonte: Ufficio del Massimario della Corte di cassazione`; `Apri sul portale del Massimario`; `Rassegne non disponibili ora.`; filter `Tutte` / `Civile` / `Penale`. No caution sentence under the row.
- **Commits**: Conventional Commits, one per task, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The shared hook refuses commits on `develop` and `main`: work on the task branches of the section "Branches and pull requests".
- **Suites** (root `CLAUDE.md`): `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`, `npm --prefix apps/server run build`, `npm --prefix apps/server test`, the VisuaLex pytest suite, the MERL-T unit tests named in each task (the full MERL-T suite runs in CI or against a disposable database, never against the development stack's).

## Review Focus

1. **Markup inside the portal's text** (`<script>`, `<img onerror>`, attributes, entities). Expected: the stored paragraph is plain text and the panel renders text nodes only, never HTML. Pinned by Task 5 (`test_markup_never_survives`) and Task 16 (`renders hostile text as text`).
2. **An article page whose URN carries a version marker** (`…~art2043!vig=`, `!vig=2020-01-01`, `@originale`). Expected: the same passages as the bare URN. Pinned by Task 14 (`normalises version markers before calling MERL-T`) and Task 13 (`test_reader_strips_markers_and_adds_prefix`).
3. **A paragraph whose only link is to an act or a partition** (`d.lgs. n. 109 del 2006`, `…~sez2`). Expected: never listed on an article page; counted in the report. Pinned by Task 4 (`test_partition_links_are_not_norms`) and Task 13 (`test_reader_lists_only_rows_of_the_requested_urn`).
4. **A law's number next to an `Rv.`** (`ai sensi della legge n. 89 del 2001 (Rv. 655555-01)`). Expected: no decision `89/2001`; the `Rv.` is a reference without identity. Pinned by Task 3 (`test_act_number_is_not_a_decision`).
5. **Running a volume twice, or re-promoting after a failure half-way through the vectors.** Expected: no duplicate points, bridge rows, nodes or edges; list properties of a decision are unions. Pinned by Task 10 (`test_second_promotion_unions_lists`) and Task 11 (`test_reindexing_is_an_upsert`).

## Deviations from the spec, found while planning

Record them in the spec in Task 0 (one commit, `docs:`):

- §4 names `services/visualex/SECURITY.md`: the file is the repository root's `SECURITY.md`.
- §4's single route `GET /fetch_massimario_volume?id=` becomes `GET /fetch_massimario?kind=index|capitolo|sezione&id=<n>`: one element per request keeps every call far below MERL-T's client timeout and the route's JSON logging cost; the adapter walks the volume.
- §5.3 "resolved once per act through the VisuaLex API": VisuaLex's existing date completion drives a browser (Playwright) and would cost hours for ~27,700 year-only links. Measured on 1 October: Normattiva's resolver answers a year-only URN with the act's page, whose title carries the date ("LEGGE 4 maggio 1983, n. 184"). A new internal route `POST /resolve_act_dates` does one plain request per act, cached for a year.
- §6 step 5 "vectors computed in the job": the seed loader measured e5-large at ~2 s per text on the Docker CPU (the graph spec measured 4 a second); a volume could exceed the 1,800 s job timeout. Promotion writes the graph and enqueues a chained job that embeds 100 paragraphs at a time and writes their points and bridge rows together, so the reader never sees a bridge row without its point.

- §5.3 "A URN that cannot be resolved keeps the portal's form as an alias": a stub keyed by a year-only URN would never meet the act's real node, so an unresolved link is counted and sampled in the report and not linked. Measured: 25 such links on the whole archive.
- §6 "Sizes", measured on 1 October with this plan's code on the whole archive: 98,840 paragraphs → 100,920 points; ~160,000 bridge rows; ~47,000 co-citation edges; ~55,000 decisions counted volume by volume (fewer once merged across volumes); 7,354 distinct acts cited by year only (one request each to Normattiva's resolver, once).

## File map

| Area | File | Responsibility |
|---|---|---|
| VisuaLex | `services/visualex/visualex_api/services/massimario_portal.py` (new) | validated URL, pacing, invalid-JSON retries, firewall stop |
| | `services/visualex/visualex_api/services/act_dates.py` (new) | year-only URN → full URN through Normattiva's resolver, cached |
| | `services/visualex/app.py` | two internal routes |
| | `services/visualex/visualex_api/tools/egress.py`, `SECURITY.md`, `services/visualex/visualex_api/tools/cache_manager.py`, `services/visualex/CLAUDE.md` | allowlist, documentation, `act_dates` cache namespace |
| MERL-T schema | `services/merlt/merlt/storage/graph/schema.py` | `SourceType.RASSEGNA`, `Fonte.MASSIMARIO` |
| MERL-T parsing | `services/merlt/merlt/pipeline/massimario/identity.py` (new) | `DecisionIdentity`, `CitedDecision`, labels |
| | `…/massimario/rv_bands.py` + `rv_bands.json` (new) | `Rv.` ranges per archive and year |
| | `…/massimario/citations.py` (new) | the citation grammar |
| | `…/massimario/urns.py` (new) | portal URN → canonical URN |
| | `…/massimario/paragraphs.py` (new) | section HTML → plain paragraphs with link spans; pieces for vectors |
| | `…/massimario/volume.py` (new) | index walk, volume title, nodes/edges/chunks/report |
| | `…/massimario/adapter.py` (new) | `MassimarioAdapter.parse(source_ref)` |
| | `…/massimario/report.py` (new) | graph counts for the report |
| | `…/massimario/promote.py` (new) | graph writes (decisions, stubs, co-citation edges) |
| | `…/massimario/vectors.py` (new) | embed, upsert points, upsert bridge rows |
| | `…/massimario/reader.py` (new) | paragraphs citing a URN, by year |
| MERL-T plumbing | `services/merlt/merlt/clients/visualex_client.py` | `fetch_massimario`, `resolve_act_dates` |
| | `…/pipeline/mechanical_ingestion/parser.py` | `get_adapter("massimario")` |
| | `…/storage/enrichment/models.py`, `schema_additions.py`, `storage/migrations/006_massimario_ingestion.sql`, `alembic/versions/010_massimario_ingestion.py` | `extras` column, source check, bridge fixes |
| | `…/api/ingestion_mechanical_router.py` | accept `massimario` |
| | `…/worker/mechanical_ingest_tasks.py`, `…/worker/massimario_tasks.py` (new) | staging extras, massimario promotion, chained vector job |
| | `…/storage/bridge/bridge_table.py` | upsert, delete/count by source, reads by metadata, config from env |
| | `…/api/rassegne_router.py` (new), `merlt/app.py`, `merlt/api/__init__.py` | `GET /api/v1/rassegne/by-norma` |
| | `…/scripts/build_rv_bands.py`, `…/scripts/remove_massimario_prose.py` (new) | range table builder, prose removal |
| BFF | `apps/server/src/routes/merlt/rassegne.ts` (new), `routes/merlt/index.ts`, `services/merlt/graphClient.ts`, `services/merlt/rassegneTypes.ts` (new), `schemas/merlt/opsIngestion.ts`, `services/merlt/opsIngestionClient.ts` | proxy route, ops source name |
| Web ops | `apps/web/src/features/merlt/ops/ingestion/{types.ts,IngestionRunForm.tsx,BatchListTable.tsx,BatchDetailPanel.tsx,MassimarioReportPanel.tsx}` | run a volume, read its report |
| Web reader | `apps/web/src/features/merlt/rassegne/*` (new), `apps/web/src/utils/decisionLinks.ts` (new or shared), `apps/web/src/plugins/registry.tsx` | the panel |

## Branches and pull requests

Four pull requests into `develop`, each merged with a merge commit `merge: <branch> — <what changes>` once CI is green (`docs/git-workflow.md`):

1. `docs/rassegne-massimario` — the spec and this plan (this branch, renamed in Task 0).
2. `feat/massimario-sources` — Tasks 1–2 (`services/visualex`).
3. `feat/massimario-ingestion` — Tasks 3–13 (`services/merlt`), after the graph round's first pull request.
4. `feat/massimario-reader` — Tasks 14–16 (`apps/server`, `apps/web`).

Task 17 (pilot) runs on the development stack after 2–4 are merged. The changes to MERL-T's Postgres (`extras` column, source check, bridge indexes) are not Prisma and not `infra/`, but tell the other developer in pull request 3's description.

---

### Task 0: Sync, environments, deviations in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-rassegne-massimario-design.md`

- [ ] **Step 1: Bring the branch up to date with `develop`**

In the Claude desktop app call the `sync_with_base_branch` tool (it merges on the host, where the protected `.claude/hooks/*` files can be written). Elsewhere: `git fetch origin && git merge origin/develop`. Then confirm the schema module is present:

Run: `test -f services/merlt/merlt/storage/graph/schema.py && grep -n "class SourceType\|class Fonte\|def point_id\|def stub_properties\|def canonical_urn" services/merlt/merlt/storage/graph/schema.py`
Expected: five matches. If the file is missing, stop: the precondition is not met.

- [ ] **Step 2: Rename this branch for its pull request**

```bash
git branch -m docs/rassegne-massimario
```

- [ ] **Step 3: Python environments**

VisuaLex's virtualenv lives in the main checkout (worktrees have none):

```bash
MAIN=$(git worktree list --porcelain | awk 'NR==1{print $2}')
(cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -m pytest tests/ -q)
```
Expected: the suite passes (baseline).

MERL-T has no virtualenv anywhere; create one in this worktree (check `requires-python` in `services/merlt/pyproject.toml` first and use a matching interpreter):

```bash
python3.11 -m venv services/merlt/.venv
services/merlt/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
services/merlt/.venv/bin/pip install -e 'services/merlt[dev]'
(cd services/merlt && .venv/bin/python -m pytest tests/pipeline tests/unit -q)
```
Expected: the unit and pipeline tests pass (baseline). Note any pre-existing failure and fix it before Task 3 (project rule: errors you surface are fixed).

- [ ] **Step 4: Record the deviations in the spec**

In the spec, §4: replace `services/visualex/SECURITY.md` with `SECURITY.md` (repository root), and replace the route sentence with:

```markdown
- **Who fetches.** A VisuaLex route fetches one portal element at a time for MERL-T, as
  `VisualexTreeAdapter` already asks VisuaLex for Normattiva: `GET /fetch_massimario?kind=index|capitolo|sezione&id=<n>`
  returns the element's `objectData`, raw. It goes through `ThrottledHttpClient` with its own
  pacing (one request at a time, at least 1.5 s apart); the portal's host is added to
  `egress.ALLOWED_HOSTS` and to the root `SECURITY.md`. The route is internal: it is not in the
  web's `legalFetch` list, the Vite proxy or the ingress's `@legal` list, and the ingress does not
  route it. The adapter walks the volume element by element.
```

In §5.3 replace "Acts cited without a date (`legge:1983;184`) are resolved once per act through the VisuaLex API and cached." with:

```markdown
  Acts cited with the year only (`legge:1983;184`, ~27,700 links) are completed by an internal
  VisuaLex route, `POST /resolve_act_dates`: one plain request per act to Normattiva's resolver,
  whose page title carries the date ("LEGGE 4 maggio 1983, n. 184"), cached for a year.
```

In §5.3 replace "A URN that cannot be resolved keeps the portal's form as an alias and is reported." with "A URN that cannot be resolved is counted and sampled in the report, and not linked: a stub keyed by a year-only URN would never meet the act's real node." In §6 "Sizes" replace the estimates with the measured figures of this plan's "Deviations" section.

In §6 step 5 replace "Qdrant with the vectors computed in the job (…)" with:

```markdown
5. **Promote**, on the administrator's approval: the graph, then a chained job that embeds 100
   paragraphs at a time and writes their Qdrant points and bridge rows together, so the reader
   never meets a bridge row without its point. Progress is on the batch (`stats.vectors`).
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-01-rassegne-massimario-design.md docs/superpowers/plans/2026-10-01-rassegne-massimario.md
git commit -m "docs: plan for the Massimario's annual reviews, and the spec's corrections from planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Open pull request 1 (`docs/rassegne-massimario` → `develop`).

---

### Task 1: VisuaLex — fetch one portal element

Branch: `feat/massimario-sources` from `develop`.

**Files:**
- Create: `services/visualex/visualex_api/services/massimario_portal.py`
- Modify: `services/visualex/app.py` (import near line 32; `setup_routes` near line 353; handler after `fetch_recitals`)
- Modify: `services/visualex/visualex_api/tools/egress.py:23-36`
- Modify: `SECURITY.md:9-14` (repository root)
- Modify: `services/visualex/CLAUDE.md` ("Key API Endpoints")
- Test: `services/visualex/tests/test_massimario_portal.py`

**Interfaces:**
- Produces: `GET /fetch_massimario?kind=<index|capitolo|sezione>&id=<digits>` → `200 {"kind": str, "id": str, "data": <objectData>}`; `400` invalid input; `404` unknown element; `429` firewall rejection; `500` invalid payload after retries.
- Produces: `massimario_portal.USER_AGENT: str` (reused by Task 2).

- [ ] **Step 1: Write the failing tests**

```python
# services/visualex/tests/test_massimario_portal.py
"""The Massimario portal fetch: validated URLs, pacing, retries, the internal route."""
import json
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import massimario_portal as mp
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import (
    DocumentNotFoundError,
    RateLimitExceededError,
    ResourceNotFoundError,
    ValidationError,
)


def ok(data):
    return HttpResult(text=json.dumps({"valid": True, "objectData": data}), status=200, headers={})


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(mp, "MIN_INTERVAL", 0.0)
    monkeypatch.setattr(mp, "INVALID_PAUSE", 0.0)


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestBuildUrl:
    def test_index_has_no_links_flag(self):
        assert mp.build_url("index", "96") == (
            "https://www.portaledelmassimario.ipzs.it/publicServices/96/getIndex.do"
        )

    def test_chapter_and_section_ask_for_linked_norms(self):
        assert mp.build_url("capitolo", "20828").endswith("/20828/getCapitolo.do?activateLinks=true")
        assert mp.build_url("sezione", "20830").endswith("/20830/getSezione.do?activateLinks=true")

    @pytest.mark.parametrize("kind,element_id", [
        ("parte", "1"), ("", "1"), ("index", ""), ("index", "1/../2"),
        ("index", "١٢"), ("index", "1" * 10), ("capitolo", "-1"),
    ])
    def test_rejects_bad_input(self, kind, element_id):
        with pytest.raises(ValidationError):
            mp.build_url(kind, element_id)


class TestFetchElement:
    async def test_returns_object_data_and_sends_an_honest_user_agent(self):
        request = AsyncMock(return_value=ok({"id": 20828}))
        with patch.object(mp.http_client, "request", new=request):
            data = await mp.fetch_element("capitolo", "20828")
        assert data == {"id": 20828}
        assert request.await_args.kwargs["headers"]["User-Agent"] == mp.USER_AGENT
        assert "VisuaLex" in mp.USER_AGENT

    async def test_retries_an_invalid_page_then_succeeds(self):
        bad = HttpResult(text="<html>errore</html>", status=200, headers={})
        request = AsyncMock(side_effect=[bad, ok({"id": 1})])
        with patch.object(mp.http_client, "request", new=request):
            assert await mp.fetch_element("index", "1") == {"id": 1}
        assert request.await_count == 2

    async def test_gives_up_after_the_retries(self):
        bad = HttpResult(text=json.dumps({"valid": False}), status=200, headers={})
        request = AsyncMock(return_value=bad)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(Exception, match="risposta non valida"):
                await mp.fetch_element("index", "1")
        assert request.await_count == mp.INVALID_RETRIES + 1

    async def test_firewall_rejection_stops_at_once(self):
        rejected = HttpResult(text="<html><head><title>Request Rejected</title>", status=200, headers={})
        request = AsyncMock(return_value=rejected)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(RateLimitExceededError):
                await mp.fetch_element("index", "1")
        assert request.await_count == 1

    async def test_unknown_element_is_not_found(self):
        request = AsyncMock(side_effect=DocumentNotFoundError("404"))
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(ResourceNotFoundError):
                await mp.fetch_element("index", "999999")

    async def test_requests_are_paced(self, monkeypatch):
        monkeypatch.setattr(mp, "MIN_INTERVAL", 5.0)
        monkeypatch.setattr(mp, "_last_request_at", 0.0)
        clock = iter([100.0, 100.0, 101.0, 101.0])
        monkeypatch.setattr(mp.time, "monotonic", lambda: next(clock))
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(mp.asyncio, "sleep", fake_sleep)
        with patch.object(mp.http_client, "request", new=AsyncMock(return_value=ok({}))):
            await mp.fetch_element("index", "1")
            await mp.fetch_element("index", "2")
        assert slept == [pytest.approx(4.0)]


class TestRoute:
    async def test_returns_the_element(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(return_value={"id": 20828})):
            response = await client.get("/fetch_massimario", query_string={"kind": "capitolo", "id": "20828"})
        assert response.status_code == 200
        assert await response.get_json() == {"kind": "capitolo", "id": "20828", "data": {"id": 20828}}

    async def test_bad_kind_is_400(self, client):
        response = await client.get("/fetch_massimario", query_string={"kind": "parte", "id": "1"})
        assert response.status_code == 400

    async def test_not_found_is_404(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(side_effect=ResourceNotFoundError("x"))):
            response = await client.get("/fetch_massimario", query_string={"kind": "index", "id": "1"})
        assert response.status_code == 404

    async def test_firewall_is_429(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(side_effect=RateLimitExceededError("x"))):
            response = await client.get("/fetch_massimario", query_string={"kind": "index", "id": "1"})
        assert response.status_code == 429
```

- [ ] **Step 2: Run them to see them fail**

Run: `MAIN=$(git worktree list --porcelain | awk 'NR==1{print $2}'); (cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -m pytest tests/test_massimario_portal.py -q)`
Expected: FAIL — `ModuleNotFoundError: visualex_api.services.massimario_portal`.

- [ ] **Step 3: Write the module**

```python
# services/visualex/visualex_api/services/massimario_portal.py
"""One element of the Portale del Massimario (the Corte di cassazione's annual reviews).

Internal source for MERL-T's MassimarioAdapter: the route that serves it is not
routed by the ingress. The portal sits behind a web application firewall, so
this module is deliberately slow: one request at a time, at least MIN_INTERVAL
seconds apart (the shared client's pacing is global and much shorter), an honest
User-Agent, a pause before retrying a page that is not valid JSON, and a stop at
the first firewall rejection.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any

import structlog

from ..tools.exceptions import (
    DocumentNotFoundError,
    NetworkError,
    RateLimitExceededError,
    ResourceNotFoundError,
    ValidationError,
)
from .http_client import http_client

log = structlog.get_logger()

PORTAL_BASE = "https://www.portaledelmassimario.ipzs.it"
USER_AGENT = "VisuaLex (+https://github.com/capazme/VisuaLexAPI)"
MIN_INTERVAL = float(os.getenv("MASSIMARIO_MIN_INTERVAL", "1.5"))
INVALID_RETRIES = 3
INVALID_PAUSE = float(os.getenv("MASSIMARIO_INVALID_PAUSE", "10"))

_PATHS = {
    "index": "/publicServices/{id}/getIndex.do",
    "capitolo": "/publicServices/{id}/getCapitolo.do?activateLinks=true",
    "sezione": "/publicServices/{id}/getSezione.do?activateLinks=true",
}
# ASCII digits only: `\d` alone accepts other scripts' digits, which do not belong in a URL.
_ID = re.compile(r"[0-9]{1,9}", re.ASCII)

_lock = asyncio.Lock()
_last_request_at = 0.0


def build_url(kind: str, element_id: str) -> str:
    """The portal URL for one element; raises ValidationError on anything else."""
    if kind not in _PATHS:
        raise ValidationError(f"kind non valido: atteso uno tra {', '.join(sorted(_PATHS))}")
    if not _ID.fullmatch(element_id or ""):
        raise ValidationError("id non valido: atteso un numero")
    return PORTAL_BASE + _PATHS[kind].format(id=element_id)


async def _paced_get(url: str) -> str:
    global _last_request_at
    async with _lock:
        wait = _last_request_at + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            result = await http_client.request(
                "GET", url, source="massimario", headers={"User-Agent": USER_AGENT}
            )
        finally:
            _last_request_at = time.monotonic()
    return result.text


async def fetch_element(kind: str, element_id: str) -> dict[str, Any]:
    """Return the portal's `objectData` for one element, as served."""
    url = build_url(kind, element_id)
    for attempt in range(INVALID_RETRIES + 1):
        try:
            text = await _paced_get(url)
        except DocumentNotFoundError as exc:
            raise ResourceNotFoundError(f"elemento {kind} {element_id} non trovato sul portale") from exc
        if "Request Rejected" in text[:500]:
            raise RateLimitExceededError("il firewall del portale ha rifiutato la richiesta")
        try:
            payload = json.loads(text)
        except ValueError:
            payload = None
        if isinstance(payload, dict) and payload.get("valid") is True:
            return payload.get("objectData") or {}
        log.warning("massimario.invalid_payload", url=url, attempt=attempt + 1, head=text[:120])
        if attempt < INVALID_RETRIES:
            await asyncio.sleep(INVALID_PAUSE * (attempt + 1))
    raise NetworkError(
        f"risposta non valida dal portale dopo {INVALID_RETRIES + 1} tentativi: {kind} {element_id}"
    )
```

Check `NetworkError`'s and `RateLimitExceededError`'s constructors in `visualex_api/tools/exceptions.py` (lines 59 and 77) and pass the message the way they expect.

- [ ] **Step 4: Register the route**

In `services/visualex/app.py`, next to the other service imports (line ~32):

```python
from visualex_api.services import massimario_portal
```

In `setup_routes` (after `/fetch_alias_catalog`, line ~353):

```python
        # Internal: MERL-T's MassimarioAdapter only. Not routed by the ingress
        # (infra/ingress/Caddyfile routes an allowlist of prefixes) nor proxied by Vite.
        self.app.add_url_rule('/fetch_massimario', view_func=self.fetch_massimario, methods=['GET'])
```

Handler, after `fetch_recitals`:

```python
    async def fetch_massimario(self):
        """One element of the Massimario portal, raw. Internal route (MERL-T only)."""
        try:
            kind = request.args.get('kind', '')
            element_id = request.args.get('id', '')
            data = await massimario_portal.fetch_element(kind, element_id)
            return jsonify({'kind': kind, 'id': element_id, 'data': data})
        except Exception as exc:
            return self._error_response(exc, 'fetch_massimario')
```

- [ ] **Step 5: Allowlist and documentation**

`services/visualex/visualex_api/tools/egress.py`, after the legislation group:

```python
    # --- Italian State: case law ---
    # The annual reviews of the Corte di cassazione's Ufficio del Massimario,
    # fetched for MERL-T's ingestion through the internal /fetch_massimario route.
    "www.portaledelmassimario.ipzs.it": "Portale del Massimario — Corte di cassazione (realizzazione IPZS)",
```

Root `SECURITY.md`, a row in the host table:

```markdown
| `www.portaledelmassimario.ipzs.it` | Portale del Massimario — Corte di cassazione (realizzazione Istituto Poligrafico e Zecca dello Stato) |
```

`services/visualex/CLAUDE.md`, in "Key API Endpoints", a line:

```markdown
- `GET /fetch_massimario?kind=index|capitolo|sezione&id=<n>` — internal (MERL-T): one element of the Massimario portal, raw; paced at ≥1.5 s; 429 when the portal's firewall refuses.
```

- [ ] **Step 6: Run the tests**

Run: `(cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -m pytest tests/test_massimario_portal.py tests/test_egress_allowlist.py -q)`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/visualex/visualex_api/services/massimario_portal.py services/visualex/app.py services/visualex/visualex_api/tools/egress.py SECURITY.md services/visualex/CLAUDE.md services/visualex/tests/test_massimario_portal.py
git commit -m "feat(visualex): internal route that fetches one element of the Massimario portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: VisuaLex — complete acts cited by year only

**Files:**
- Create: `services/visualex/visualex_api/services/act_dates.py`
- Modify: `services/visualex/visualex_api/tools/cache_manager.py:72-77` (namespace)
- Modify: `services/visualex/app.py` (route + handler)
- Modify: `services/visualex/CLAUDE.md` ("Key API Endpoints")
- Test: `services/visualex/tests/test_act_dates.py`

**Interfaces:**
- Consumes: `massimario_portal.USER_AGENT`.
- Produces: `POST /resolve_act_dates {"urns": [<≤20 year-only URNs>]}` → `200 {"resolved": {urn: full_urn | null}}`; `400` invalid input. Example: `urn:nir:stato:legge:1983;184` → `urn:nir:stato:legge:1983-05-04;184`.

- [ ] **Step 1: Write the failing tests**

```python
# services/visualex/tests/test_act_dates.py
"""Year-only URNs completed through Normattiva's resolver."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import act_dates
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import ValidationError

PAGE = """<html><head><title>Normattiva</title></head><body>
<p>Gazzetta Ufficiale 17 maggio 1983</p>
<h2>LEGGE 4 maggio 1983, n. 184</h2>
<p>Disciplina dell'adozione</p></body></html>"""


class FakeCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


@pytest.fixture
def cache(monkeypatch):
    fake = FakeCache()
    manager = type("M", (), {"get_persistent": lambda self, ns: fake})()
    monkeypatch.setattr(act_dates, "get_cache_manager", lambda: manager)
    return fake


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestDateFromPage:
    def test_reads_the_title_not_the_gazette_date(self):
        assert act_dates.date_from_page(PAGE, "1983", "184") == "1983-05-04"

    def test_number_must_match(self):
        assert act_dates.date_from_page(PAGE, "1983", "185") is None

    def test_ordinal_day_and_capitals(self):
        page = "DECRETO LEGISLATIVO 1º Febbraio 2006, n. 109"
        assert act_dates.date_from_page(page, "2006", "109") == "2006-02-01"


class TestResolve:
    async def test_resolves_and_caches(self, cache):
        request = AsyncMock(return_value=HttpResult(text=PAGE, status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            first = await act_dates.resolve_many(["urn:nir:stato:legge:1983;184"])
            second = await act_dates.resolve_many(["urn:nir:stato:legge:1983;184"])
        assert first == {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
        assert second == first
        assert request.await_count == 1
        assert request.await_args.args[1] == (
            "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1983;184"
        )

    async def test_unknown_act_is_none_and_not_cached(self, cache):
        request = AsyncMock(return_value=HttpResult(text="<html></html>", status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many(["urn:nir:regione.sicilia:legge:2001;17"]) == {
                "urn:nir:regione.sicilia:legge:2001;17": None
            }
        assert cache.data == {}

    @pytest.mark.parametrize("urns", [
        None, [], "urn:nir:stato:legge:1983;184", [1],
        ["urn:nir:stato:legge:1983-05-04;184"],
        ["urn:nir:stato:legge:1983;184~art1"],
        ["https://evil.example/x"],
        ["urn:nir:stato:legge:1983;184"] * 21,
    ])
    async def test_rejects_bad_input_before_any_request(self, cache, urns):
        request = AsyncMock()
        with patch.object(act_dates.http_client, "request", new=request):
            with pytest.raises(ValidationError):
                await act_dates.resolve_many(urns)
        request.assert_not_awaited()


class TestRoute:
    async def test_returns_the_map(self, client):
        with patch.object(act_dates, "resolve_many", new=AsyncMock(return_value={"u": "v"})):
            response = await client.post("/resolve_act_dates", json={"urns": ["u"]})
        assert response.status_code == 200
        assert await response.get_json() == {"resolved": {"u": "v"}}

    async def test_bad_input_is_400(self, client):
        response = await client.post("/resolve_act_dates", json={"urns": "x"})
        assert response.status_code == 400
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -m pytest tests/test_act_dates.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```python
# services/visualex/visualex_api/services/act_dates.py
"""Completes the date of acts cited by year only (`urn:nir:stato:legge:1983;184`).

The Massimario portal links acts the way Normattiva resolves them, often with
the year alone; the graph and VisuaLex key acts by their full date. Normattiva's
resolver answers a year-only URN with the act's page, whose title carries the
date ("LEGGE 4 maggio 1983, n. 184"). One plain request per act: no browser,
unlike `complete_date` in urngenerator, which drives Playwright. A found date is
cached for a year (dates do not change); a miss is not cached, since it may be a
transient error page.
"""
from __future__ import annotations

import re
from typing import Optional

import structlog

from ..tools.cache_manager import get_cache_manager
from ..tools.exceptions import DocumentNotFoundError, ValidationError
from .http_client import http_client
from .massimario_portal import USER_AGENT

log = structlog.get_logger()

RESOLVER = "https://www.normattiva.it/uri-res/N2Ls?"
MAX_URNS = 20
_YEAR_ONLY = re.compile(r"urn:nir:([a-z.]{1,60}):([a-z.]{1,60}):([0-9]{4});([0-9]{1,6})", re.ASCII)
_MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_TITLE_DATE = re.compile(
    r"\b([0-9]{1,2})[º°]?\s+(" + "|".join(_MESI) + r")\s+([0-9]{4}),\s*n\.\s*([0-9]{1,6})\b",
    re.IGNORECASE,
)


def date_from_page(page: str, year: str, number: str) -> Optional[str]:
    """The ISO date in the act's title, when its year and number match the URN's."""
    for day, month, found_year, found_number in _TITLE_DATE.findall(page):
        if found_year == year and found_number.lstrip("0") == number.lstrip("0"):
            return f"{found_year}-{_MESI[month.lower()]:02d}-{int(day):02d}"
    return None


async def _resolve_one(urn: str) -> Optional[str]:
    cache = get_cache_manager().get_persistent("act_dates")
    cached = await cache.get(urn)
    if cached:
        return cached
    authority, kind, year, number = _YEAR_ONLY.fullmatch(urn).groups()
    try:
        result = await http_client.request(
            "GET", RESOLVER + urn, source="normattiva", headers={"User-Agent": USER_AGENT}
        )
    except DocumentNotFoundError:
        return None
    date = date_from_page(result.text, year, number)
    if date is None:
        log.info("act_dates.not_found", urn=urn)
        return None
    full = f"urn:nir:{authority}:{kind}:{date};{number}"
    await cache.set(urn, full)
    return full


async def resolve_many(urns) -> dict[str, Optional[str]]:
    """Validate every URN first, then resolve them one by one (the client paces requests)."""
    if not isinstance(urns, list) or not urns:
        raise ValidationError("urns: attesa una lista non vuota")
    if len(urns) > MAX_URNS:
        raise ValidationError(f"urns: al massimo {MAX_URNS} per richiesta")
    for urn in urns:
        if not isinstance(urn, str) or not _YEAR_ONLY.fullmatch(urn):
            raise ValidationError(
                "urns: atteso urn:nir:<autorità>:<tipo>:<anno>;<numero>, senza data completa né articolo"
            )
    return {urn: await _resolve_one(urn) for urn in dict.fromkeys(urns)}
```

- [ ] **Step 4: Cache namespace, route, docs**

`services/visualex/visualex_api/tools/cache_manager.py`, in `_init_caches`'s `self.persistent` dict:

```python
            # A found act date never changes: keep it a year (act_dates.py).
            "act_dates": _create_cache("act_dates", ttl=365 * 24 * 3600),
```

`services/visualex/app.py`: import `from visualex_api.services import act_dates` next to `massimario_portal`; in `setup_routes`:

```python
        # Internal: MERL-T's MassimarioAdapter only (not routed by the ingress).
        self.app.add_url_rule('/resolve_act_dates', view_func=self.resolve_act_dates, methods=['POST'])
```

Handler:

```python
    async def resolve_act_dates(self):
        """Full dates for acts cited by year only. Internal route (MERL-T only)."""
        try:
            data = await request.get_json() or {}
            return jsonify({'resolved': await act_dates.resolve_many(data.get('urns'))})
        except Exception as exc:
            return self._error_response(exc, 'resolve_act_dates')
```

`services/visualex/CLAUDE.md`, "Key API Endpoints":

```markdown
- `POST /resolve_act_dates {"urns": [...]}` — internal (MERL-T): up to 20 year-only URNs (`urn:nir:stato:legge:1983;184`) → full URNs, through Normattiva's resolver; found dates cached a year.
```

- [ ] **Step 5: Run the tests and the suite**

Run: `(cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -m pytest tests/ -q)`
Expected: PASS (the whole suite, including the egress test: `www.normattiva.it` is already allowed).

- [ ] **Step 6: Commit and open pull request 2**

```bash
git add services/visualex/visualex_api/services/act_dates.py services/visualex/visualex_api/tools/cache_manager.py services/visualex/app.py services/visualex/CLAUDE.md services/visualex/tests/test_act_dates.py
git commit -m "feat(visualex): internal route that completes acts cited by year only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Open pull request 2 (`feat/massimario-sources` → `develop`).

---
### Task 3: MERL-T — schema names, decision identity, citation grammar

Branch: `feat/massimario-ingestion` from `develop` (after the graph round's first pull request is merged). Tasks 3–13 commit here.

**Files:**
- Modify: `services/merlt/merlt/storage/graph/schema.py` (`SourceType`, `Fonte`, `_FONTE_ALIASES`)
- Create: `services/merlt/merlt/pipeline/massimario/__init__.py`
- Create: `services/merlt/merlt/pipeline/massimario/identity.py`
- Create: `services/merlt/merlt/pipeline/massimario/rv_bands.py`
- Create: `services/merlt/merlt/pipeline/massimario/citations.py`
- Test: `services/merlt/tests/pipeline/test_massimario_citations.py`

**Interfaces:**
- Produces: `SourceType.RASSEGNA` (`"rassegna"`), `Fonte.MASSIMARIO` (`"Ufficio del Massimario"`).
- Produces: `DecisionIdentity(corte: str, numero: int, anno: int, archivio: str | None)` with `.key -> str`; `CitedDecision` (fields `corte, numero, anno, archivio, sezione, relatore, data_udienza, rv: list[str], forma, anno_implicito, identity, motivo_senza_identita`; properties `.label`, `.estremi`); constants `CASSAZIONE`, `CORTE_COSTITUZIONALE`.
- Produces: `RvBands(bands: dict[tuple[str, int], tuple[int, int]])` with `.contains(archivio, anno, rv_base) -> bool`, `RvBands.from_samples(samples, *, min_samples=20)`.
- Produces: `parse_citations(text: str, *, review_year: int, archivio: str | None, bands: RvBands | None) -> CitationScan` (`decisions, rv_total, rv_recognized, forms: Counter, unrecognized: list[str], reasons: Counter`).

- [ ] **Step 1: Add the two names to the schema module**

In `services/merlt/merlt/storage/graph/schema.py`, add the members (keep each enum's existing order and comments):

```python
class SourceType(_Vocab):
    ...
    RASSEGNA = "rassegna"  # a paragraph of the Massimario's annual reviews


class Fonte(_Vocab):
    ...
    MASSIMARIO = "Ufficio del Massimario"  # the Corte di cassazione's annual reviews
```

Read `_FONTE_ALIASES` and add the variants the way its existing entries are written (lower-case spelling → member), at least `"massimario"` and `"ufficio del massimario"` → `Fonte.MASSIMARIO`. Do **not** add `rassegna` to `EXPERT_SOURCE_TYPES`: teaching the experts to read the reviews is a later round (spec §2, decision 3).

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/unit/test_graph_vocabulary_contract.py -q)`
Expected: PASS.

- [ ] **Step 2: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_citations.py
"""The citation grammar, one test per form (spec §5.5). Synthetic citations only."""
import pytest

from merlt.pipeline.massimario.citations import parse_citations
from merlt.pipeline.massimario.identity import DecisionIdentity
from merlt.pipeline.massimario.rv_bands import RvBands

BANDS = RvBands({("civile", 2012): (620000, 630000), ("civile", 2024): (669000, 673000)})


def scan(text, *, year=2024, archivio="civile", bands=BANDS):
    return parse_citations(text, review_year=year, archivio=archivio, bands=bands)


def only(text, **kw):
    result = scan(text, **kw)
    assert len(result.decisions) == 1, result.decisions
    return result.decisions[0]


class TestCivil:
    def test_slash_with_rapporteur(self):
        d = only("In tema di danno, Sez. U, n. 13319/2024, Rossi, Rv. 671516-02, ha affermato")
        assert d.identity.key == "cassazione:civile:13319:2024"
        assert (d.sezione, d.relatore, d.rv, d.forma) == ("U", "Rossi", ["671516-02"], "slash")
        assert d.label == "Sez. U, n. 13319/2024 · Rv. 671516-02"

    def test_leading_zeros_and_no_rapporteur(self):
        d = only("un passato indirizzo (Sez. 1, n. 04912/2017, Rv. 644441-01), a dire")
        assert d.identity.key == "cassazione:civile:4912:2017"
        assert d.relatore is None

    def test_number_del_year(self):
        d = only("(pronuncia conforme a Sez. L., n. 28928 del 2019, Rv. 655701-01)")
        assert (d.identity.key, d.sezione, d.forma) == ("cassazione:civile:28928:2019", "L", "del_anno")

    def test_number_without_n(self):
        d = only("si segnala Sez. L, 09136/2024, Bianchi, Rv. 670602-01, secondo cui")
        assert d.identity.key == "cassazione:civile:9136:2024"

    def test_rv_without_dash(self):
        assert only("Sez. U., n. 04353/2023, Verdi, Rv. 66701301, la S.C.").rv == ["667013-01"]

    def test_two_digit_year(self):
        assert only("in Sez. 1, n. 18161/19, Neri, Rv. 654543 – 01 secondo").identity.anno == 2019

    def test_section_written_in_two_ways_is_one_identity(self):
        a = only("Sez. T, n. 24471/2022, Gialli, Rv. 665000-01")
        b = only("Sez. 5, n. 24471/2022, Gialli, Rv. 665000-01")
        assert a.identity == b.identity
        assert (a.sezione, b.sezione) == ("T", "5")


class TestCriminal:
    def test_deposit_year_wins_over_hearing_year(self):
        d = only("Sez. 1, n. 1399 del 15/12/1999, dep. 2000, Neri, Rv. 215228-01", archivio="penale", year=2010)
        assert d.identity.key == "cassazione:penale:1399:2000"
        assert (d.data_udienza, d.relatore) == ("1999-12-15", "Neri")

    def test_hearing_year_without_deposit(self):
        d = only("Sez. 6, n. 23742 del 08/07/2020 Gialli, Rv. 279458-01", archivio="penale", year=2020)
        assert d.identity.key == "cassazione:penale:23742:2020"

    def test_date_before_number(self):
        d = only("(Sez. VI, 12 novembre 2008, n. 44877, Blu, Rv. 241853); il", archivio="penale", year=2010)
        assert (d.identity.key, d.sezione, d.data_udienza) == ("cassazione:penale:44877:2008", "VI", "2008-11-12")

    def test_date_before_number_with_deposit(self):
        d = only("Sez. I, 1 dicembre 2006 - dep. 8 gennaio 2007, n. 103, Rosa, Rv. 235341;", archivio="penale", year=2010)
        assert d.identity.key == "cassazione:penale:103:2007"
        assert d.data_udienza == "2006-12-01"  # the hearing, not the deposit

    def test_an_earlier_deposit_does_not_move_the_year(self):
        result = scan("Sez. 1, n. 5 del 01/01/2010, dep. 2011, e Sez. 2, n. 7 del 03/03/2012, Bianchi, Rv. 252000-01",
                      archivio="penale", year=2012)
        assert [d.identity.key for d in result.decisions if d.rv] == ["cassazione:penale:7:2012"]

    def test_month_in_words_after_del(self):
        d = only("Sez. U, n. 49935 del 28 settembre 2023, Viola, Rv. 285517-01", archivio="penale", year=2023)
        assert (d.identity.key, d.forma) == ("cassazione:penale:49935:2023", "del_data")


class TestStructure:
    def test_several_rv_for_one_decision(self):
        result = scan("Sez. U, n. 19883/2019, Conti, Rv. 644838-01, Rv. 644838-02, secondo")
        assert len(result.decisions) == 1
        assert result.decisions[0].rv == ["644838-01", "644838-02"]
        assert (result.rv_total, result.rv_recognized) == (2, 2)

    def test_list_separated_by_semicolons(self):
        result = scan("(Sez. 1, n. 100/2020, Rossi, Rv. 657000-01; Sez. 2, n. 200/2021, Bianchi, Rv. 661000-01)")
        assert [d.identity.key for d in result.decisions] == [
            "cassazione:civile:100:2020", "cassazione:civile:200:2021",
        ]

    def test_archive_written_in_the_citation(self):
        d = only("(Sez. 1 civ., n, 15724 del 11/06/2019, Rv. 654456)", archivio=None, year=2019)
        assert d.identity.key == "cassazione:civile:15724:2019"

    def test_unknown_archive_has_no_identity(self):
        d = only("Sez. 1, n. 100/2020, Rossi, Rv. 657000-01", archivio=None)
        assert d.identity is None and d.motivo_senza_identita == "archivio_ignoto"

    def test_number_zero_has_no_identity(self):
        d = only("Sez. 5, n. 0/2015, Rossi, Rv. 634000-01")
        assert d.identity is None and d.motivo_senza_identita == "numero_non_valido"

    def test_year_out_of_range_has_no_identity(self):
        d = only("Sez. 3, n. 30521/2919, Iannello, Rv. 655971-03, ha")
        assert d.identity is None and d.motivo_senza_identita == "anno_fuori_intervallo"


class TestImplicitYear:
    def test_inside_the_range_takes_the_review_year(self):
        d = only("con le pronunzie Sez. 3, n. 2103 (Rv. 621670) e", year=2012)
        assert d.identity.key == "cassazione:civile:2103:2012"
        assert d.anno_implicito and d.forma == "implicito"

    def test_outside_the_range_is_a_reference_without_identity(self):
        d = only("con le pronunzie Sez. 3, n. 2103 (Rv. 599999) e", year=2012)
        assert d.identity is None and d.motivo_senza_identita == "anno_non_verificato"
        assert d.anno is None and d.label == "Sez. 3, n. 2103 · Rv. 599999"

    def test_without_bands_nothing_is_assumed(self):
        d = only("Sez. 3, n. 2103 (Rv. 621670)", year=2012, bands=None)
        assert d.identity is None


class TestNotDecisions:
    def test_act_number_is_not_a_decision(self):
        result = scan("ai sensi della legge n. 89 del 2001 (Rv. 655555-01). Inoltre")
        assert result.decisions == []
        assert (result.rv_total, result.rv_recognized) == (1, 0)

    def test_article_number_is_not_a_decision(self):
        assert scan("dell'art. 360, n. 5, c.p.c. (Rv. 655555-01)").decisions == []

    def test_prose_sezione_is_not_a_citation(self):
        assert scan("nella sezione 3 della legge n. 89/2001 si prevede").decisions == []

    def test_rv_alone_is_counted_and_sampled(self):
        result = scan("«massima riportata» (Rv. 251820). Al riguardo")
        assert result.decisions == [] and result.rv_total == 1
        assert "Rv. 251820" in result.unrecognized[0]


class TestOtherForms:
    def test_cassazione_without_rv(self):
        d = only("come affermato da Sez. U, n. 123/2020, le spese")
        assert (d.identity.key, d.forma, d.rv, d.relatore) == ("cassazione:civile:123:2020", "senza_rv", [], None)

    def test_a_citation_with_rv_is_not_read_twice(self):
        assert len(scan("Sez. U, n. 13319/2024, Rossi, Rv. 671516-02").decisions) == 1

    def test_corte_costituzionale(self):
        result = scan("Corte cost., sent. n. 1 del 2014, e Corte costituzionale n. 238/2014 hanno")
        assert [d.identity.key for d in result.decisions] == [
            "corte_costituzionale:1:2014", "corte_costituzionale:238:2014",
        ]
        assert result.decisions[0].label == "Corte cost., n. 1/2014"


def test_identity_is_validated():
    with pytest.raises(ValueError):
        DecisionIdentity("cassazione", 1, 2020, None)
    with pytest.raises(ValueError):
        DecisionIdentity("corte_costituzionale", 1, 2020, "civile")
    with pytest.raises(ValueError):
        DecisionIdentity("tar", 1, 2020, None)
```

- [ ] **Step 3: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_citations.py -q)`
Expected: FAIL — `ModuleNotFoundError: merlt.pipeline.massimario`.

- [ ] **Step 4: Write `identity.py` and `rv_bands.py`**

```python
# services/merlt/merlt/pipeline/massimario/__init__.py
"""Ingestion of the Ufficio del Massimario's annual reviews (spec 2026-10-01)."""
```

```python
# services/merlt/merlt/pipeline/massimario/identity.py
"""Who a cited decision is: the identity shared with the sentenze round (spec §5.2).

`numero` without leading zeros; for criminal decisions `anno` is the deposit
year (the year of the number, as Italgiure indexes it); the section is an
attribute, never part of the identity.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

CASSAZIONE = "cassazione"
CORTE_COSTITUZIONALE = "corte_costituzionale"
ARCHIVI = ("civile", "penale")


@dataclass(frozen=True)
class DecisionIdentity:
    corte: str
    numero: int
    anno: int
    archivio: Optional[str] = None  # Cassazione only

    def __post_init__(self) -> None:
        if self.corte == CASSAZIONE:
            if self.archivio not in ARCHIVI:
                raise ValueError(f"archivio non valido per la Cassazione: {self.archivio!r}")
        elif self.corte == CORTE_COSTITUZIONALE:
            if self.archivio is not None:
                raise ValueError("la Corte costituzionale non ha archivio")
        else:
            raise ValueError(f"corte non valida: {self.corte!r}")
        if self.numero <= 0 or not 1900 <= self.anno <= 2100:
            raise ValueError(f"numero o anno fuori intervallo: {self.numero}/{self.anno}")

    @property
    def key(self) -> str:
        if self.corte == CASSAZIONE:
            return f"{CASSAZIONE}:{self.archivio}:{self.numero}:{self.anno}"
        return f"{CORTE_COSTITUZIONALE}:{self.numero}:{self.anno}"


@dataclass
class CitedDecision:
    """A decision as one paragraph cites it; `identity` is None when it cannot be established."""

    corte: str
    numero: int
    anno: Optional[int]
    archivio: Optional[str]
    sezione: Optional[str] = None
    relatore: Optional[str] = None
    data_udienza: Optional[str] = None  # ISO date
    rv: list[str] = field(default_factory=list)
    forma: str = ""
    anno_implicito: bool = False
    identity: Optional[DecisionIdentity] = None
    motivo_senza_identita: Optional[str] = None

    @property
    def estremi(self) -> str:
        if self.corte == CORTE_COSTITUZIONALE:
            return f"Corte cost., n. {self.numero}/{self.anno}"
        court = {"civile": "Cass. civ.", "penale": "Cass. pen."}.get(self.archivio or "", "Cass.")
        return f"{court}, n. {self.numero}/{self.anno}" if self.anno else f"{court}, n. {self.numero}"

    @property
    def label(self) -> str:
        """As the chip shows it: the section as written, number/year, the massime."""
        if self.corte == CORTE_COSTITUZIONALE or not self.sezione:
            head = self.estremi
        else:
            head = f"Sez. {self.sezione}, n. {self.numero}" + (f"/{self.anno}" if self.anno else "")
        return f"{head} · Rv. {', '.join(self.rv)}" if self.rv else head
```

```python
# services/merlt/merlt/pipeline/massimario/rv_bands.py
"""Ranges of `Rv.` numbers per archive and year (spec §5.2).

The CED numbers massime in increasing order, so the explicit citations of the
reviews show which numbers each year used. A citation that leaves out its year
takes the review's year only when its number falls inside that year's range.
The table is numbers only, built from a local archive by
`merlt/scripts/build_rv_bands.py` (Task 7).
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

DEFAULT_PATH = Path(__file__).with_name("rv_bands.json")


@dataclass(frozen=True)
class RvBands:
    bands: dict = field(default_factory=dict)  # (archivio, anno) -> (lo, hi)

    def contains(self, archivio: str, anno: int, rv_base: int) -> bool:
        band = self.bands.get((archivio, anno))
        return band is not None and band[0] <= rv_base <= band[1]

    @classmethod
    def from_samples(cls, samples: Iterable[tuple[str, int, int]], *, min_samples: int = 20) -> "RvBands":
        """2nd–98th percentile of the samples of each (archivio, anno) with enough of them."""
        grouped: dict[tuple[str, int], list[int]] = defaultdict(list)
        for archivio, anno, rv in samples:
            grouped[(archivio, anno)].append(rv)
        bands = {}
        for key, values in grouped.items():
            if len(values) < min_samples:
                continue
            values.sort()
            cut = len(values) // 50
            bands[key] = (values[cut], values[-cut - 1])
        return cls(bands)

    def to_json(self) -> dict:
        out: dict[str, dict[str, list[int]]] = {}
        for (archivio, anno), (lo, hi) in sorted(self.bands.items()):
            out.setdefault(archivio, {})[str(anno)] = [lo, hi]
        return {"version": 1, "bands": out}

    @classmethod
    def from_json(cls, data: dict) -> "RvBands":
        return cls({
            (archivio, int(anno)): (lo, hi)
            for archivio, years in data.get("bands", {}).items()
            for anno, (lo, hi) in years.items()
        })

    @classmethod
    def load(cls, path: Path = DEFAULT_PATH) -> "RvBands":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))
```

- [ ] **Step 5: Write `citations.py`**

```python
# services/merlt/merlt/pipeline/massimario/citations.py
"""The citation grammar for the Massimario's reviews (spec §5.5).

Anchored on each `Rv.`: the decision a massima number belongs to is the one
cited just before it. Then Cassazione citations without `Rv.` and the Corte
costituzionale. Nothing is guessed: a citation the grammar cannot read, or
whose year it cannot establish, is counted, and kept as a reference without
identity.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from .identity import CASSAZIONE, CORTE_COSTITUZIONALE, CitedDecision, DecisionIdentity
from .rv_bands import RvBands

_MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_DATE = re.compile(
    r"(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})"
    r"|(\d{1,2})[º°]?\s+(" + "|".join(_MESI) + r")\s+(\d{4})",
    re.IGNORECASE,
)
_YEAR = re.compile(r"(\d{4})(?!\d)")
_RV = re.compile(r"Rv\.?\s*(?:n\.\s*)?(\d{6})(?:\s*[-–]\s*(\d{2})|(\d{2})(?!\d))?")
# Case-sensitive on purpose: citations write "Sez." with a capital, prose writes "sezione 3".
_SEZ = re.compile(
    r"Sez(?:ione|\.)?\s*"
    r"(U(?:[Nn](?:ite)?)?\.?|un\.|VI\s*-\s*(?:[1-5]|III|II|IV|V|I)|[1-7](?:\s*-\s*[1-6])?|L\.?|T\.?|F\.?|VII|VI|IV|V|III|II|I)"
    r"(?![A-Za-z0-9])(?:\s*(civ|pen)\.?)?"
)
_NUM = re.compile(
    r"(?:\bn\.?\s*,?\s*|(?:sentenza|ordinanza|sent\.|ord\.)\s+(?:n\.\s*)?)"
    r"0*(\d{1,6})(?:\s*/\s*(\d{4}|\d{2})(?!\d))?",
    re.IGNORECASE,
)
_BARE = re.compile(r"\s*,\s*0*(\d{1,6})\s*/\s*(\d{4}|\d{2})(?!\d)")
_DEL = re.compile(r"\s*,?\s*del\s*", re.IGNORECASE)
_DEP = re.compile(r"dep(?:\.|osit\w*)\s*(?:il\s*)?", re.IGNORECASE)
_DEP_BEFORE = re.compile(r"dep(?:\.|osit\w*)\s*(?:il\s*)?$", re.IGNORECASE)
_ACT_BEFORE = re.compile(
    r"(?:\blegge|(?-i:\bl\.)|d\.\s*lgs\.?|d\.\s*l\.|\bdecreto|d\.\s*P\.\s*R\.|\bartt?\.|\bregolamento|\bdirettiva)"
    r"\s*(?:[\w.(),]+\s*){0,3}$",
    re.IGNORECASE,
)
_CONSULTA = re.compile(
    r"(?:Corte\s+cost(?:ituzionale)?\.?|C\.\s*cost\.)\s*,?\s*(?:(?:sent(?:enza)?|ord(?:inanza)?)\.?\s*)?"
    r"n\.\s*0*(\d{1,4})\s*(?:/\s*(\d{4})|del\s+(\d{4}))",
    re.IGNORECASE,
)
_SAME_DECISION = re.compile(r"[\s,e–-]*")
_RELATORE = re.compile(r"[A-Za-zÀ-ÿ'’.\s-]{2,40}")
_WINDOW = 190


@dataclass
class CitationScan:
    decisions: list[CitedDecision] = field(default_factory=list)
    rv_total: int = 0
    rv_recognized: int = 0
    forms: Counter = field(default_factory=Counter)
    unrecognized: list[str] = field(default_factory=list)
    reasons: Counter = field(default_factory=Counter)


def _two_digit_year(raw: str) -> int:
    value = int(raw)
    if value > 100:
        return value
    return 2000 + value if value <= 30 else 1900 + value


def _date_parts(match: re.Match) -> tuple[int, Optional[str]]:
    """(year, ISO date or None if the day/month are impossible)."""
    d1, m1, y1, d2, mese, y2 = match.groups()
    if y1:
        year, month, day = int(y1), int(m1), int(d1)
    else:
        year, month, day = int(y2), _MESI[mese.lower()], int(d2)
    iso = f"{year:04d}-{month:02d}-{day:02d}" if 1 <= month <= 12 and 1 <= day <= 31 else None
    return year, iso


def _norm_section(raw: str) -> str:
    section = re.sub(r"\s+", "", raw).rstrip(".").upper()
    return "U" if section.startswith("UN") else section


def _read_citation(window: str) -> Optional[dict]:
    """The last decision cited in `window`, or None; {'act_number': True} for a law's number."""
    candidates = [(m.start(), m.end(), int(m.group(1)), m.group(2)) for m in _NUM.finditer(window)]
    for sez in _SEZ.finditer(window):
        bare = _BARE.match(window, sez.end())
        if bare:
            candidates.append((bare.start(1), bare.end(), int(bare.group(1)), bare.group(2)))
    if not candidates:
        return None
    start, end, numero, slash = max(candidates, key=lambda c: c[0])
    before = window[:start]
    tail40 = before[-40:]
    act = _ACT_BEFORE.search(tail40)
    if act and not any(s.start() > act.start() for s in _SEZ.finditer(tail40)):
        return {"act_number": True}  # "legge n. 89 del 2001", "art. 360, n. 5": not a decision

    anno: Optional[int] = None
    data: Optional[str] = None
    forma: Optional[str] = None
    year_end = end
    if slash:
        anno, forma = _two_digit_year(slash), "slash"
    else:
        after_del = _DEL.match(window, end)
        if after_del:
            date = _DATE.match(window, after_del.end())
            if date:
                (anno, data), forma, year_end = _date_parts(date), "del_data", date.end()
            else:
                year = _YEAR.match(window, after_del.end())
                if year:
                    anno, forma, year_end = int(year.group(1)), "del_anno", year.end()
    # Dates and deposits are read only from this citation: from its section label on.
    sections = list(_SEZ.finditer(before))
    cit_start = sections[-1].start() if sections else start
    if anno is None:
        hearing = [d for d in _DATE.finditer(before, cit_start) if not _DEP_BEFORE.search(before[: d.start()])]
        if hearing:
            (anno, data), forma = _date_parts(hearing[-1]), "data_prima"
    deposit = None
    for dep in _DEP.finditer(window, cit_start):
        after = _DATE.match(window, dep.end()) or _YEAR.match(window, dep.end())
        if after:
            deposit = (_date_parts(after)[0] if after.re is _DATE else int(after.group(1)), dep, after)
    if deposit is not None:
        year_value, dep, after = deposit
        anno, forma = year_value, f"{forma}+dep" if forma else "dep"
        if dep.start() >= year_end:
            year_end = max(year_end, after.end())
    tail = _DEP.sub("", window[year_end:])
    tail = re.sub(r"\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{4}|\b\d{4}\b", "", tail).strip(" ,;:()–-\n")
    relatore = (
        tail if tail and tail[0].isupper() and _RELATORE.fullmatch(tail)
        and not tail.lower().startswith(("est", "rel")) else None
    )
    return {
        "start": cit_start,
        "numero": numero,
        "anno": anno,
        "forma": forma,
        "data": data,
        "sezione": _norm_section(sections[-1].group(1)) if sections else None,
        "arch": sections[-1].group(2) if sections else None,
        "relatore": relatore,
    }


def _decision(read: dict, rv: list[str], *, review_year: int, archivio: Optional[str],
              bands: Optional[RvBands], forma: Optional[str] = None) -> CitedDecision:
    arch = {"civ": "civile", "pen": "penale"}.get((read["arch"] or "").lower()[:3]) or archivio
    d = CitedDecision(
        corte=CASSAZIONE, numero=read["numero"], anno=read["anno"], archivio=arch,
        sezione=read["sezione"], relatore=read["relatore"], data_udienza=read["data"],
        rv=list(rv), forma=forma or read["forma"] or "",
    )
    if d.numero <= 0:
        d.motivo_senza_identita = "numero_non_valido"  # measured on the corpus: "n. 0/2015"
        return d
    if arch is None:
        d.motivo_senza_identita = "archivio_ignoto"
        return d
    if d.anno is None:
        d.anno_implicito, d.forma = True, "implicito"
        if not rv or bands is None or not bands.contains(arch, review_year, int(rv[0][:6])):
            d.motivo_senza_identita = "anno_non_verificato"  # no year: no guessed link either
            return d
        d.anno = review_year
    if not 1930 <= d.anno <= review_year + 1:
        d.motivo_senza_identita = "anno_fuori_intervallo"
        return d
    d.identity = DecisionIdentity(CASSAZIONE, d.numero, d.anno, arch)
    return d


def _rv_label(match: re.Match) -> str:
    suffix = match.group(2) or match.group(3)
    return f"{match.group(1)}-{suffix}" if suffix else match.group(1)


def _sample(text: str, at: int) -> str:
    return text[max(0, at - 110): at + 20].replace("\n", " ")


def parse_citations(text: str, *, review_year: int, archivio: Optional[str],
                    bands: Optional[RvBands]) -> CitationScan:
    scan = CitationScan()
    consumed: list[tuple[int, int]] = []
    previous: Optional[CitedDecision] = None
    previous_end = 0

    for rv in _RV.finditer(text):
        scan.rv_total += 1
        label = _rv_label(rv)
        lo = max(previous_end, rv.start() - _WINDOW)
        window = text[lo:rv.start()]
        cut = window.rfind(";")
        if cut >= 0:
            window, lo = window[cut + 1:], lo + cut + 1
        if previous is not None and _SAME_DECISION.fullmatch(window):
            previous.rv.append(label)
            scan.rv_recognized += 1
            scan.forms["stesso_precedente"] += 1
            consumed.append((lo, rv.end()))
            previous_end = rv.end()
            continue
        read = _read_citation(window)
        previous_end = rv.end()
        if read is None or read.get("act_number"):
            scan.unrecognized.append(_sample(text, rv.start()))
            scan.reasons["nessuna_pronuncia"] += 1
            previous = None
            continue
        decision = _decision(read, [label], review_year=review_year, archivio=archivio, bands=bands)
        scan.decisions.append(decision)
        scan.rv_recognized += 1
        scan.forms[decision.forma] += 1
        if decision.identity is None:
            scan.reasons[decision.motivo_senza_identita] += 1
        consumed.append((lo + read["start"], rv.end()))
        previous = decision

    for sez in _SEZ.finditer(text):
        if any(a <= sez.start() < b for a, b in consumed):
            continue
        chunk = text[sez.start(): sez.start() + 120]
        stop = re.search(r"Rv\.|;|\)", chunk)
        if stop:
            chunk = chunk[:stop.start()]
        number = _NUM.search(chunk, len(sez.group(0))) or _BARE.match(chunk, len(sez.group(0)))
        if number is None or number.start() - len(sez.group(0)) > 25:
            continue
        read = _read_citation(chunk[: number.end() + 40])
        if not read or read.get("act_number") or read["anno"] is None:
            continue
        decision = _decision(read, [], review_year=review_year, archivio=archivio, bands=bands, forma="senza_rv")
        scan.decisions.append(decision)
        scan.forms["senza_rv"] += 1
        consumed.append((sez.start(), sez.start() + len(chunk)))

    for match in _CONSULTA.finditer(text):
        anno = int(match.group(2) or match.group(3))
        numero = int(match.group(1))
        decision = CitedDecision(corte=CORTE_COSTITUZIONALE, numero=numero, anno=anno, archivio=None, forma="consulta")
        if numero > 0 and 1956 <= anno <= review_year + 1:
            decision.identity = DecisionIdentity(CORTE_COSTITUZIONALE, numero, anno)
        else:
            decision.motivo_senza_identita = "anno_fuori_intervallo"
        scan.decisions.append(decision)
        scan.forms["consulta"] += 1
    return scan
```

- [ ] **Step 6: Run the tests until they pass**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_citations.py -q)`
Expected: PASS. If a form fails, fix the grammar, not the test: every test string is a real form measured on the corpus (spec §1), with invented names and numbers.

- [ ] **Step 7: Commit**

```bash
git add services/merlt/merlt/storage/graph/schema.py services/merlt/merlt/pipeline/massimario services/merlt/tests/pipeline/test_massimario_citations.py
git commit -m "feat(merlt): decision identity and citation grammar for the Massimario's reviews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: MERL-T — portal links to canonical URNs

**Files:**
- Create: `services/merlt/merlt/pipeline/massimario/urns.py`
- Test: `services/merlt/tests/pipeline/test_massimario_urns.py`

**Interfaces:**
- Produces: `PortalNorm(act: str, article: str | None, comma: str | None, year_only: bool)` with `.year_only_urn -> str | None`; `parse_portal_urn(href: str) -> PortalNorm | None`; `to_canonical(norm: PortalNorm, resolved: dict[str, str | None]) -> str | None`; `NORMATTIVA_PREFIX`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_urns.py
"""Portal links → the graph's canonical URNs (spec §5.3)."""
import pytest

from merlt.pipeline.massimario.urns import NORMATTIVA_PREFIX, parse_portal_urn, to_canonical

PORTAL = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:"


@pytest.mark.parametrize("portal,canonical", [
    ("stato:codice.civile:1942-03-16;262~art2043", "stato:regio.decreto:1942-03-16;262:2~art2043"),
    ("stato:codice.procedura.civile:1940-10-28;1443~art380bis", "stato:regio.decreto:1940-10-28;1443:1~art380bis"),
    ("stato:codice.penale:1930-10-19;1398~art575", "stato:regio.decreto:1930-10-19;1398:1~art575"),
    ("stato:codice.procedura.penale:1988-09-22;447~art649",
     "stato:decreto.del.presidente.della.repubblica:1988-09-22;447~art649"),
    ("stato:costituzione:1947-12-27~art27", "stato:costituzione~art27"),
    ("presidente.repubblica:decreto:1973-01-23;43~art291ter",
     "stato:decreto.del.presidente.della.repubblica:1973-01-23;43~art291ter"),
    ("stato:legge:2009-04-23;38~art5", "stato:legge:2009-04-23;38~art5"),
    ("stato:decreto.legislativo:2018-04-10;36", "stato:decreto.legislativo:2018-04-10;36"),
])
def test_dated_links(portal, canonical):
    norm = parse_portal_urn(PORTAL + portal)
    assert to_canonical(norm, {}) == NORMATTIVA_PREFIX + "urn:nir:" + canonical


def test_comma_is_kept_apart_from_the_article():
    norm = parse_portal_urn(PORTAL + "stato:codice.procedura.civile:1940-10-28;1443~art369-com2-num2")
    assert (norm.article, norm.comma) == ("369", "com2-num2")
    assert to_canonical(norm, {}).endswith(";1443:1~art369")


def test_year_only_act_needs_its_resolution():
    norm = parse_portal_urn(PORTAL + "stato:legge:1983;184~art6")
    assert norm.year_only and norm.year_only_urn == "urn:nir:stato:legge:1983;184"
    assert to_canonical(norm, {}) is None
    assert to_canonical(norm, {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}) == (
        NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184~art6"
    )


@pytest.mark.parametrize("href", [
    PORTAL + "stato:decreto.legislativo:2006-02-23;109~sez2",
    PORTAL + "stato:decreto.legislativo:2006-02-23;109~prt1",
])
def test_partition_links_are_not_norms(href):
    assert parse_portal_urn(href) is None


@pytest.mark.parametrize("href", [
    "https://example.org/uri-res/N2Ls?urn:nir:stato:legge:1983;184",
    PORTAL + "regione.puglia:statuto:~art44",
    PORTAL + "stato:legge:abc;184",
    "",
])
def test_unusable_links(href):
    assert parse_portal_urn(href) is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_urns.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `urns.py`**

```python
# services/merlt/merlt/pipeline/massimario/urns.py
"""The portal's Normattiva links → the canonical URNs of VisuaLex and the graph (spec §5.3).

The portal names the codes (`codice.civile:1942-03-16;262`); VisuaLex and the
graph name the enacting decree and its annex (`regio.decreto:1942-03-16;262:2`,
services/visualex/visualex_api/tools/map.py, NORMATTIVA_URN_CODICI). The article
is the join level; the comma part (`com2-num2`) is kept apart. Acts linked with
the year only are completed by VisuaLex's /resolve_act_dates (Task 2).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

NORMATTIVA_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"

CODE_ACTS = {
    "stato:codice.civile:1942-03-16;262": "stato:regio.decreto:1942-03-16;262:2",
    "stato:codice.procedura.civile:1940-10-28;1443": "stato:regio.decreto:1940-10-28;1443:1",
    "stato:codice.penale:1930-10-19;1398": "stato:regio.decreto:1930-10-19;1398:1",
    "stato:codice.procedura.penale:1988-09-22;447": "stato:decreto.del.presidente.della.repubblica:1988-09-22;447",
    "stato:costituzione:1947-12-27": "stato:costituzione",
}
_AUTHORITIES = {"presidente.repubblica:decreto:": "stato:decreto.del.presidente.della.repubblica:"}

_HREF = re.compile(r"^(?:https?://www\.normattiva\.it)?/uri-res/N2Ls\?urn:nir:([^\s\"'<>]+)$")
_ACT = re.compile(r"([a-z.]{1,60}):([a-z.]{1,60}):(\d{4}(?:-\d{2}-\d{2})?)(?:;(\d{1,6}[a-z]*))?(?::(\d))?")
_ARTICLE = re.compile(r"art(\d{1,5}[a-z]*(?:\.\d{1,2})?)(?:-(.+))?")


@dataclass(frozen=True)
class PortalNorm:
    act: str                # "stato:legge:1983;184" (no "urn:nir:"), authority already mapped
    article: Optional[str]  # "369", "380bis"
    comma: Optional[str]    # "com2-num2"
    year_only: bool

    @property
    def year_only_urn(self) -> Optional[str]:
        return f"urn:nir:{self.act}" if self.year_only else None


def parse_portal_urn(href: str) -> Optional[PortalNorm]:
    """The norm a portal link points to; None for partitions and unusable links."""
    match = _HREF.match((href or "").strip())
    if not match:
        return None
    act, _, tail = match.group(1).partition("~")
    for portal, visualex in _AUTHORITIES.items():
        if act.startswith(portal):
            act = visualex + act[len(portal):]
    parts = _ACT.fullmatch(act)
    if not parts:
        return None
    article = comma = None
    if tail:
        found = _ARTICLE.fullmatch(tail)
        if not found:
            return None  # a partition (`sez2`, `prt1`, `tit2`, `cap3`): not an article
        article, comma = found.group(1), found.group(2)
    year_only = len(parts.group(3)) == 4 and parts.group(4) is not None
    return PortalNorm(act=act, article=article, comma=comma, year_only=year_only)


def to_canonical(norm: PortalNorm, resolved: dict) -> Optional[str]:
    """The canonical URN (full Normattiva URL, article level); None if a year-only act is unresolved."""
    act = norm.act
    if norm.year_only:
        full = resolved.get(norm.year_only_urn)
        if not full:
            return None
        act = full[len("urn:nir:"):]
    act = CODE_ACTS.get(act, act)
    return NORMATTIVA_PREFIX + "urn:nir:" + act + (f"~art{norm.article}" if norm.article else "")
```

- [ ] **Step 4: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_urns.py -q)`
Expected: PASS.

- [ ] **Step 5: Check the canonical form against VisuaLex**

Run: `MAIN=$(git worktree list --porcelain | awk 'NR==1{print $2}'); (cd services/visualex && "$MAIN/services/visualex/.venv/bin/python" -c "from visualex_api.tools.map import codice_urn; print([codice_urn(n) for n in ('codice civile','codice di procedura civile','codice penale','codice di procedura penale','costituzione')])")`
Expected: `['regio.decreto:1942-03-16;262:2', 'regio.decreto:1940-10-28;1443:1', 'regio.decreto:1930-10-19;1398:1', 'decreto.del.presidente.della.repubblica:1988-09-22;447', 'costituzione']` — the right-hand sides of `CODE_ACTS`. If VisuaLex differs, `CODE_ACTS` follows VisuaLex.

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/pipeline/massimario/urns.py services/merlt/tests/pipeline/test_massimario_urns.py
git commit -m "feat(merlt): map the Massimario portal's Normattiva links to canonical URNs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: MERL-T — section HTML to plain paragraphs

**Files:**
- Create: `services/merlt/merlt/pipeline/massimario/paragraphs.py`
- Test: `services/merlt/tests/pipeline/test_massimario_paragraphs.py`

**Interfaces:**
- Produces: `LinkSpan(start: int, end: int, href: str, text: str)`, `Paragraph(text: str, links: list[LinkSpan])`, `extract_paragraphs(html: str) -> list[Paragraph]`, `split_for_vectors(text: str, max_len: int = 2000) -> list[tuple[int, int]]`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_paragraphs.py
"""Section HTML → plain paragraphs with link spans (spec §5.1)."""
from merlt.pipeline.massimario.paragraphs import extract_paragraphs, split_for_vectors

LINK = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043"


def test_paragraphs_and_link_spans():
    html = (
        f'<p> Secondo l\'<a href="{LINK}" target="_blank">art. 2043 c.c.</a> il danno&nbsp;deve\n'
        "essere ingiusto.</p><p></p><p>Secondo paragrafo &egrave; qui.</p>"
    )
    first, second = extract_paragraphs(html)
    assert first.text == "Secondo l'art. 2043 c.c. il danno deve essere ingiusto."
    (link,) = first.links
    assert first.text[link.start:link.end] == "art. 2043 c.c." == link.text
    assert link.href == LINK
    assert second.text == "Secondo paragrafo è qui." and second.links == []


def test_links_to_other_sites_are_not_spans():
    (p,) = extract_paragraphs('<p>Vedi <a href="https://example.org/x">qui</a>.</p>')
    assert p.text == "Vedi qui." and p.links == []


def test_markup_never_survives():
    html = (
        '<p>Testo<script>alert(1)</script> <img src=x onerror="alert(2)">sicuro '
        "<b>grassetto</b><style>p{}</style>.</p>"
    )
    (p,) = extract_paragraphs(html)
    assert p.text == "Testo sicuro grassetto."
    assert "<" not in p.text and "alert" not in p.text


def test_text_outside_paragraphs_and_line_breaks():
    (a, b) = extract_paragraphs("Prima riga<br>stessa<p>Dopo</p>")
    assert (a.text, b.text) == ("Prima riga stessa", "Dopo")


def test_split_for_vectors_covers_the_text_at_sentence_ends():
    text = ("Frase numero uno abbastanza lunga. " * 120).strip()
    pieces = split_for_vectors(text, max_len=500)
    assert pieces[0][0] == 0 and pieces[-1][1] == len(text)
    assert all(end - start <= 500 for start, end in pieces)
    assert all(text[end - 1] == "." for _, end in pieces[:-1])
    assert split_for_vectors("breve") == [(0, 5)]
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_paragraphs.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `paragraphs.py`**

```python
# services/merlt/merlt/pipeline/massimario/paragraphs.py
"""A section's HTML → plain paragraphs, with the spans of the norm links (spec §5.1).

Only text leaves this module: tags, attributes, scripts and styles are dropped,
so the reader renders text nodes and never HTML. Whitespace is collapsed;
offsets index the returned text.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from html.parser import HTMLParser

_BLOCKS = {"p", "li", "div", "blockquote", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}
_SKIP = {"script", "style"}


@dataclass(frozen=True)
class LinkSpan:
    start: int
    end: int
    href: str
    text: str


@dataclass
class Paragraph:
    text: str
    links: list[LinkSpan] = field(default_factory=list)


def _collapse(raw: str) -> tuple[str, list[int]]:
    """Collapse whitespace; return the text and, for each raw offset, its offset in the text."""
    out: list[str] = []
    index = [0] * (len(raw) + 1)
    previous_space = True
    for i, ch in enumerate(raw):
        index[i] = len(out)
        if ch.isspace():
            if not previous_space:
                out.append(" ")
            previous_space = True
        else:
            out.append(ch)
            previous_space = False
    index[len(raw)] = len(out)
    text = "".join(out)
    if text.endswith(" "):
        text = text[:-1]
    return text, index


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[Paragraph] = []
        self._raw: list[str] = []
        self._size = 0
        self._links: list[tuple[int, int, str]] = []
        self._href: str | None = None
        self._href_start = 0
        self._skip = 0

    def _add(self, data: str) -> None:
        self._raw.append(data)
        self._size += len(data)

    def flush(self) -> None:
        text, index = _collapse("".join(self._raw))
        if text:
            spans = []
            for raw_start, raw_end, href in self._links:
                start, end = index[raw_start], min(index[raw_end], len(text))
                while start < end and text[start] == " ":
                    start += 1
                while end > start and text[end - 1] == " ":
                    end -= 1
                if end > start:
                    spans.append(LinkSpan(start, end, href, text[start:end]))
            self.paragraphs.append(Paragraph(text, spans))
        self._raw, self._size, self._links, self._href = [], 0, [], None

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP:
            self._skip += 1
        elif tag in _BLOCKS:
            self.flush()
        elif tag == "br":
            self._add(" ")
        elif tag == "a":
            href = dict(attrs).get("href") or ""
            if "N2Ls?urn:nir:" in href:
                self._href, self._href_start = href, self._size

    def handle_endtag(self, tag):
        if tag in _SKIP:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCKS:
            self.flush()
        elif tag == "a" and self._href is not None:
            self._links.append((self._href_start, self._size, self._href))
            self._href = None

    def handle_data(self, data):
        if not self._skip:
            self._add(data)


def extract_paragraphs(html: str) -> list[Paragraph]:
    collector = _Collector()
    collector.feed(html or "")
    collector.close()
    collector.flush()
    return collector.paragraphs


def split_for_vectors(text: str, max_len: int = 2000) -> list[tuple[int, int]]:
    """Cut a long paragraph at sentence ends into pieces of at most `max_len` characters."""
    pieces: list[tuple[int, int]] = []
    start = 0
    while len(text) - start > max_len:
        window = text[start:start + max_len]
        cut = max(window.rfind(". "), window.rfind("; "))
        if cut > max_len // 2:
            end = start + cut + 1
        else:
            space = window.rfind(" ")
            end = start + (space if space > 0 else max_len)
        pieces.append((start, end))
        start = end
        while start < len(text) and text[start] == " ":
            start += 1
    pieces.append((start, len(text)))
    return pieces
```

- [ ] **Step 4: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_paragraphs.py -q)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/pipeline/massimario/paragraphs.py services/merlt/tests/pipeline/test_massimario_paragraphs.py
git commit -m "feat(merlt): turn a review section's HTML into plain paragraphs with link spans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: MERL-T — reading a volume (title, index, paragraphs in order)

**Files:**
- Create: `services/merlt/merlt/pipeline/massimario/volume.py` (reading part; Task 8 adds the assembly)
- Create: `services/merlt/tests/pipeline/massimario_fixture.py` (synthetic volume, shared by Tasks 6–13)
- Test: `services/merlt/tests/pipeline/test_massimario_volume_reading.py`

**Interfaces:**
- Consumes: `extract_paragraphs`, `Paragraph` (Task 5).
- Produces: a *raw volume* dict `{"volume_id": int, "index": <objectData>, "capitoli": {int: <objectData>}, "sezioni": {int: <objectData>}}` (the adapter fills it in Task 9).
- Produces: `VolumeMeta(volume_id, titolo, anno, archivio: "civile"|"penale"|"misto", numero)`; `volume_meta(raw) -> VolumeMeta`; `walk_index(index) -> IndexTree(capitoli: list[int], sezioni: dict[int, int | None], parte_of: dict[int, tuple[str, str] | None])`; `ParagraphContext(meta, archivio, parte, capitolo, sezione, index, ordine, paragraph)`; `iter_paragraphs(raw) -> Iterator[ParagraphContext]`.

- [ ] **Step 1: Write the synthetic fixture**

```python
# services/merlt/tests/pipeline/massimario_fixture.py
"""A synthetic volume in the portal's format. Invented text, names and numbers:
no text of the reviews may enter the repository (spec §9)."""

N = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:"


def link(urn, text):
    return f'<a href="{N}{urn}" target="_blank">{text}</a>'


CC_2043 = "stato:codice.civile:1942-03-16;262~art2043"
CPC_360 = "stato:codice.procedura.civile:1940-10-28;1443~art360-com1-num5"
L_184 = "stato:legge:1983;184"
COST_3 = "stato:costituzione:1947-12-27~art3"
CC_1453 = "stato:codice.civile:1942-03-16;262~art1453"


def volume_9001():
    index = {"items": [{
        "deep": 0, "text": "Massimario 2024 CIVILE Vol. 1", "title": "", "elementId": None, "nodes": [
            {"deep": 1, "text": "PARTE PRIMA", "title": "I DIRITTI", "elementId": 9001,
             "functionName": "refreshParte", "nodes": [
                 {"deep": 2, "text": "CAPITOLO I", "title": "LA RESPONSABILITÀ", "elementId": 9101,
                  "elementType": "capitolo", "functionName": "refreshCapitolo", "nodes": [
                      {"deep": 3, "text": "1", "title": "Il danno.", "elementId": 9111, "elementType": "sezione", "nodes": [
                          {"deep": 4, "text": "1.1", "title": "Il nesso.", "elementId": 9112, "elementType": "sezione", "nodes": []},
                      ]},
                  ]},
             ]},
            {"deep": 1, "text": "PARTE SECONDA", "title": "I CONTRATTI", "elementId": 9002,
             "functionName": "refreshParte", "nodes": [
                 {"deep": 2, "text": "CAPITOLO II", "title": "LA RISOLUZIONE", "elementId": 9102,
                  "elementType": "capitolo", "functionName": "refreshCapitolo", "nodes": [
                      {"deep": 3, "text": "1", "title": "L'inadempimento.", "elementId": 9121, "elementType": "sezione", "nodes": []},
                  ]},
             ]},
            {"deep": 1, "text": "1", "title": "Una sezione sciolta.", "elementId": 9201, "elementType": "sezione", "nodes": []},
        ]}]}
    capitolo_9101 = {
        "id": 9101, "nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ",
        "autori": [{"nome": "Anna", "cognome": "Rossi"}, {"nome": "Bruno", "cognome": "Verdi"}],
        "materie": [{"nome": "danno"}, {"nome": "responsabilità civile"}],
        "sezioni": [{
            "id": 9111, "numeroSezioneVis": "1", "titolo": "Il danno.", "note": None,
            "testo": (
                f"<p>In tema di danno, Sez. U, n. 1234/2024, Bianchi, Rv. 670001-01, ha affermato che "
                f"l'{link(CC_2043, 'art. 2043 c.c.')} richiede un danno ingiusto.</p>"
                f"<p>Lo stesso vale per l'{link(CPC_360, 'art. 360, comma 1, n. 5, c.p.c.')} "
                f"(Sez. 3, n. 567/2023, Neri, Rv. 668001-02; Sez. 1, n. 89/2022, Rv. 664001-01).</p>"
            ),
            "sottoSezioni": [{
                "id": 9112, "numeroSezioneVis": "1.1", "titolo": "Il nesso.", "note": None,
                "testo": f"<p>La {link(L_184, 'l. n. 184 del 1983')} resta ferma.<script>alert(1)</script></p>"
                         f"<p>Si veda la {link('stato:decreto.legislativo:2006-02-23;109~sez2', 'sezione II')}.</p>",
                "sottoSezioni": [],
            }],
        }],
    }
    capitolo_9102 = {
        "id": 9102, "nome": "CAPITOLO II", "titolo": "LA RISOLUZIONE",
        "autori": [{"nome": "Carla", "cognome": "Gialli"}], "materie": [{"nome": "contratti"}],
        "sezioni": [{
            "id": 9121, "numeroSezioneVis": "1", "titolo": "L'inadempimento.", "note": None,
            "testo": f"<p>Sez. 2, n. 4321 (Rv. 670500-01) richiama l'{link(CC_1453, 'art. 1453 c.c.')} "
                     f"e l'{link(CC_2043, 'art. 2043 c.c.')}; Sez. U, n. 1234/2024, Bianchi, Rv. 670001-02.</p>",
            "sottoSezioni": [],
        }],
    }
    sezione_9201 = {
        "id": 9201, "numeroSezioneVis": "1", "titolo": "Una sezione sciolta.", "note": None,
        "testo": f"<p>Corte cost., sent. n. 12 del 2024, ha dichiarato illegittimo l'{link(COST_3, 'art. 3 Cost.')}.</p>",
        "sottoSezioni": [],
    }
    return {
        "volume_id": 9001,
        "index": index,
        "capitoli": {9101: capitolo_9101, 9102: capitolo_9102},
        "sezioni": {9201: sezione_9201},
    }
```

- [ ] **Step 2: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_volume_reading.py
import pytest

from merlt.pipeline.massimario.volume import iter_paragraphs, parse_volume_title, volume_meta, walk_index
from tests.pipeline.massimario_fixture import volume_9001


@pytest.mark.parametrize("title,expected", [
    ("Massimario 2024 CIVILE Vol. 1", (2024, "civile", 1)),
    ("Massimario 2010 PENALE Vol. 2", (2010, "penale", 2)),
    ("Massimario 2019 CIVILE E PENALE", (2019, "misto", None)),
])
def test_volume_titles(title, expected):
    meta = parse_volume_title(43, title)
    assert (meta.anno, meta.archivio, meta.numero) == expected


def test_unknown_title_is_an_error():
    with pytest.raises(ValueError):
        parse_volume_title(1, "Studi e pubblicazioni")


def test_walk_index_finds_chapters_sections_and_parts():
    tree = walk_index(volume_9001()["index"])
    assert tree.capitoli == [9101, 9102]
    assert tree.sezioni == {9111: 9101, 9112: 9101, 9121: 9102, 9201: None}
    assert tree.parte_of[9101] == ("PARTE PRIMA", "I DIRITTI")
    assert tree.parte_of[9201] is None


def test_paragraphs_in_reading_order_with_their_context():
    contexts = list(iter_paragraphs(volume_9001()))
    assert [c.sezione.id for c in contexts] == [9111, 9111, 9112, 9112, 9121, 9201]
    assert [c.ordine for c in contexts] == [9001_000_000 + i for i in range(6)]
    first = contexts[0]
    assert first.meta == volume_meta(volume_9001())
    assert (first.archivio, first.parte, first.index) == ("civile", ("PARTE PRIMA", "I DIRITTI"), 0)
    assert first.capitolo["autori"] == ["Anna Rossi", "Bruno Verdi"]
    assert first.capitolo["materie"] == ["danno", "responsabilità civile"]
    assert contexts[-1].capitolo is None and contexts[-1].sezione.titolo == "Una sezione sciolta."


def test_mixed_volume_reads_the_archive_from_the_part_title():
    raw = volume_9001()
    raw["index"]["items"][0]["text"] = "Massimario 2019 CIVILE E PENALE"
    raw["index"]["items"][0]["nodes"][0]["title"] = "QUESTIONI PENALI"
    contexts = list(iter_paragraphs(raw))
    assert contexts[0].archivio == "penale"
    assert contexts[4].archivio is None  # "I CONTRATTI": no hint
```

- [ ] **Step 3: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_volume_reading.py -q)`
Expected: FAIL — module not found. (If `tests` is not importable as a package, add an empty `services/merlt/tests/pipeline/__init__.py` only if the other test folders have one; otherwise import the fixture with `from massimario_fixture import volume_9001` and keep the file next to the tests.)

- [ ] **Step 4: Write the reading part of `volume.py`**

```python
# services/merlt/merlt/pipeline/massimario/volume.py
"""One volume of the reviews: reading it in order (Task 6), assembling the batch (Task 8)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterator, Optional

from .paragraphs import Paragraph, extract_paragraphs

_TITLE = re.compile(r"Massimario\s+(\d{4})\s+(CIVILE E PENALE|CIVILE|PENALE)(?:\s+Vol\.\s*(\d+))?", re.IGNORECASE)


@dataclass(frozen=True)
class VolumeMeta:
    volume_id: int
    titolo: str
    anno: int
    archivio: str  # civile | penale | misto
    numero: Optional[int]


@dataclass(frozen=True)
class SectionRef:
    id: int
    numero: str
    titolo: str


@dataclass
class IndexTree:
    capitoli: list[int] = field(default_factory=list)
    sezioni: dict[int, Optional[int]] = field(default_factory=dict)
    parte_of: dict[int, Optional[tuple[str, str]]] = field(default_factory=dict)


@dataclass(frozen=True)
class ParagraphContext:
    meta: VolumeMeta
    archivio: Optional[str]  # civile | penale, None in the mixed volume when nothing says
    parte: Optional[tuple[str, str]]
    capitolo: Optional[dict]  # {id, nome, titolo, autori, materie}
    sezione: SectionRef
    index: int   # paragraph position in its section
    ordine: int  # reading position in the volume: volume_id * 1_000_000 + running index
    paragraph: Paragraph


def parse_volume_title(volume_id: int, text: str) -> VolumeMeta:
    match = _TITLE.search(text or "")
    if not match:
        raise ValueError(f"titolo di volume non riconosciuto: {text!r}")
    kind = match.group(2).upper()
    archivio = "misto" if " " in kind else kind.lower()
    return VolumeMeta(volume_id, text.strip(), int(match.group(1)), archivio,
                      int(match.group(3)) if match.group(3) else None)


def volume_meta(raw: dict) -> VolumeMeta:
    return parse_volume_title(raw["volume_id"], raw["index"]["items"][0].get("text", ""))


def walk_index(index: dict) -> IndexTree:
    tree = IndexTree()

    def walk(node: dict, parte: Optional[tuple[str, str]], capitolo: Optional[int]) -> None:
        kind, element = node.get("elementType"), node.get("elementId")
        if node.get("functionName") == "refreshParte":
            parte = (node.get("text", "").strip(), (node.get("title") or "").strip())
        elif kind == "capitolo":
            tree.capitoli.append(element)
            tree.parte_of[element] = parte
            capitolo = element
        elif kind == "sezione":
            tree.sezioni[element] = capitolo
            if capitolo is None:
                tree.parte_of[element] = parte
        for child in node.get("nodes") or []:
            walk(child, parte, capitolo)

    walk(index["items"][0], None, None)
    return tree


def _archivio(meta: VolumeMeta, parte, capitolo) -> Optional[str]:
    if meta.archivio != "misto":
        return meta.archivio
    hint = " ".join(filter(None, [parte[1] if parte else "", (capitolo or {}).get("titolo", "")]))
    if re.search(r"\bPENAL", hint, re.IGNORECASE):
        return "penale"
    if re.search(r"\bCIVIL", hint, re.IGNORECASE):
        return "civile"
    return None


def _sections(sections: list[dict]) -> Iterator[dict]:
    for section in sections or []:
        yield section
        yield from _sections(section.get("sottoSezioni") or [])


def iter_paragraphs(raw: dict) -> Iterator[ParagraphContext]:
    meta = volume_meta(raw)
    tree = walk_index(raw["index"])
    running = 0

    def emit(section: dict, capitolo: Optional[dict], parte) -> Iterator[ParagraphContext]:
        nonlocal running
        ref = SectionRef(int(section["id"]), str(section.get("numeroSezioneVis") or ""),
                         (section.get("titolo") or "").strip())
        archivio = _archivio(meta, parte, capitolo)
        for i, paragraph in enumerate(extract_paragraphs(section.get("testo") or "")):
            yield ParagraphContext(meta, archivio, parte, capitolo, ref, i,
                                   meta.volume_id * 1_000_000 + running, paragraph)
            running += 1

    for chapter_id in tree.capitoli:
        data = raw["capitoli"].get(chapter_id)
        if data is None:
            continue
        capitolo = {
            "id": chapter_id,
            "nome": (data.get("nome") or "").strip(),
            "titolo": (data.get("titolo") or "").strip(),
            "autori": [f"{a.get('nome', '')} {a.get('cognome', '')}".strip() for a in data.get("autori") or []],
            "materie": [m.get("nome", "") for m in data.get("materie") or []],
        }
        for section in _sections(data.get("sezioni") or []):
            yield from emit(section, capitolo, tree.parte_of.get(chapter_id))
    for section_id, chapter_id in tree.sezioni.items():
        if chapter_id is None and section_id in raw["sezioni"]:
            yield from emit(raw["sezioni"][section_id], None, tree.parte_of.get(section_id))
```

- [ ] **Step 5: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_volume_reading.py -q)`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/pipeline/massimario/volume.py services/merlt/tests/pipeline/massimario_fixture.py services/merlt/tests/pipeline/test_massimario_volume_reading.py
git commit -m "feat(merlt): read a Massimario volume's paragraphs in order with their context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: MERL-T — the `Rv.` range table

**Files:**
- Create: `services/merlt/merlt/scripts/build_rv_bands.py`
- Create: `services/merlt/merlt/pipeline/massimario/rv_bands.json` (generated)
- Test: `services/merlt/tests/scripts/test_build_rv_bands.py`

**Interfaces:**
- Consumes: `iter_paragraphs` (Task 6), `parse_citations`, `RvBands` (Task 3).
- Produces: `load_archive_volume(directory: Path) -> dict` (raw volume from the downloaded archive), `samples(raw) -> Iterator[tuple[str, int, int]]`, CLI `python -m merlt.scripts.build_rv_bands --archive DIR [--out PATH] [--min-samples N]`; `RvBands.load()` works on the committed file.

- [ ] **Step 1: Write the failing test**

```python
# services/merlt/tests/scripts/test_build_rv_bands.py
import json

from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.scripts.build_rv_bands import load_archive_volume, main, samples
from tests.pipeline.massimario_fixture import volume_9001


def write_archive(root):
    raw = volume_9001()
    vdir = root / "json" / "9001"
    vdir.mkdir(parents=True)
    wrap = lambda data: json.dumps({"valid": True, "objectData": data})
    (vdir / "index.json").write_text(wrap(raw["index"]), encoding="utf-8")
    for cid, data in raw["capitoli"].items():
        (vdir / f"capitolo_{cid}.json").write_text(wrap(data), encoding="utf-8")
    for sid, data in raw["sezioni"].items():
        (vdir / f"sezione_{sid}.json").write_text(wrap(data), encoding="utf-8")
    return vdir


def test_loads_a_volume_from_the_archive(tmp_path):
    raw = load_archive_volume(write_archive(tmp_path))
    assert raw["volume_id"] == 9001 and set(raw["capitoli"]) == {9101, 9102}


def test_samples_are_explicit_cassazione_citations_only(tmp_path):
    found = sorted(samples(load_archive_volume(write_archive(tmp_path))))
    # 1234/2024 (two Rv.), 567/2023, 89/2022; not the implicit 4321, not the Consulta
    assert found == [("civile", 2022, 664001), ("civile", 2023, 668001),
                     ("civile", 2024, 670001), ("civile", 2024, 670001)]


def test_cli_writes_a_loadable_table(tmp_path):
    write_archive(tmp_path)
    out = tmp_path / "bands.json"
    main(["--archive", str(tmp_path), "--out", str(out), "--min-samples", "1"])
    bands = RvBands.load(out)
    assert bands.contains("civile", 2024, 670001)
    assert not bands.contains("civile", 2024, 600000)


def test_from_samples_trims_the_tails():
    data = [("civile", 2020, n) for n in range(100)]
    lo, hi = RvBands.from_samples(data).bands[("civile", 2020)]
    assert (lo, hi) == (2, 97)
    assert RvBands.from_samples(data[:10]).bands == {}
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/scripts/test_build_rv_bands.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the builder**

```python
# services/merlt/merlt/scripts/build_rv_bands.py
"""Build the `Rv.` range table from a local archive of the reviews (spec §5.2).

    python -m merlt.scripts.build_rv_bands --archive <dir> [--out <file>] [--min-samples 20]

The archive is the raw download kept outside the repository:
<dir>/json/<volume>/index.json, capitolo_<id>.json, sezione_<id>.json, each the
portal's `{"valid": true, "objectData": …}`. Only numbers leave it: for every
explicit Cassazione citation, (archive, year, massima number).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterator

from merlt.pipeline.massimario.citations import parse_citations
from merlt.pipeline.massimario.identity import CASSAZIONE
from merlt.pipeline.massimario.rv_bands import DEFAULT_PATH, RvBands
from merlt.pipeline.massimario.volume import iter_paragraphs


def _object(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["objectData"]


def load_archive_volume(directory: Path) -> dict:
    def by_id(prefix: str) -> dict[int, dict]:
        return {int(p.stem.split("_", 1)[1]): _object(p) for p in directory.glob(f"{prefix}_*.json")}

    return {
        "volume_id": int(directory.name),
        "index": _object(directory / "index.json"),
        "capitoli": by_id("capitolo"),
        "sezioni": by_id("sezione"),
    }


def samples(raw: dict) -> Iterator[tuple[str, int, int]]:
    for ctx in iter_paragraphs(raw):
        if ctx.archivio is None:
            continue
        scan = parse_citations(ctx.paragraph.text, review_year=ctx.meta.anno, archivio=ctx.archivio, bands=None)
        for decision in scan.decisions:
            if decision.corte != CASSAZIONE or decision.identity is None or decision.anno_implicito:
                continue
            for rv in decision.rv:
                yield decision.archivio, decision.anno, int(rv[:6])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--min-samples", type=int, default=20)
    args = parser.parse_args(argv)
    found = [s for vdir in sorted((args.archive / "json").iterdir()) if vdir.is_dir()
             for s in samples(load_archive_volume(vdir))]
    bands = RvBands.from_samples(found, min_samples=args.min_samples)
    args.out.write_text(json.dumps(bands.to_json(), indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(found)} citazioni esplicite, {len(bands.bands)} fasce → {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/scripts/test_build_rv_bands.py -q)`
Expected: PASS.

- [ ] **Step 5: Build the real table from the local archive**

The owner keeps the downloaded archive outside the repository; ask for its path and export it as `ARCHIVE` in the shell (never write the path into a file).

Run: `(cd services/merlt && .venv/bin/python -m merlt.scripts.build_rv_bands --archive "$ARCHIVE")`
Expected: a line like `N citazioni esplicite, M fasce → …/rv_bands.json` with N about 60,000 and bands for both `civile` and `penale` covering at least 2010–2024. Open the file: numbers only, increasing with the year within each archive. Check a measured fact from planning: the implicit-year citations of the corpus fall inside their year's range about 96 % of the time:

```bash
(cd services/merlt && .venv/bin/python - <<'EOF'
import os
from pathlib import Path
from merlt.pipeline.massimario.citations import parse_citations
from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.pipeline.massimario.volume import iter_paragraphs
from merlt.scripts.build_rv_bands import load_archive_volume
bands = RvBands.load(); inside = outside = 0
for vdir in sorted((Path(os.environ["ARCHIVE"]) / "json").iterdir()):
    for ctx in iter_paragraphs(load_archive_volume(vdir)):
        for d in parse_citations(ctx.paragraph.text, review_year=ctx.meta.anno, archivio=ctx.archivio, bands=bands).decisions:
            if d.anno_implicito:
                inside += d.identity is not None; outside += d.identity is None
print(inside, outside, round(100 * inside / max(1, inside + outside), 1))
EOF
)
```
Expected: about 94 (the third number; measured on 1 October with this grammar and this table: 5,799 accepted, 361 refused). A very different value means the grammar or the table is wrong: stop and investigate. Measured at the same time: 60,791 explicit citations, 81 ranges (civile 1990–2024, penale 1979–2024), coverage 98.9 % overall and 96.5 % for the worst volume.

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/scripts/build_rv_bands.py services/merlt/merlt/pipeline/massimario/rv_bands.json services/merlt/tests/scripts/test_build_rv_bands.py
git commit -m "feat(merlt): table of Rv. ranges per archive and year, built from the reviews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: MERL-T — assembling a volume into a batch

**Files:**
- Modify: `services/merlt/merlt/pipeline/massimario/volume.py` (append the assembly)
- Test: `services/merlt/tests/pipeline/test_massimario_volume_assembly.py`

**Interfaces:**
- Consumes: Tasks 3–7; `point_id`, `stub_properties`, `Label`, `Rel`, `SourceType`, `Fonte`, `Provenance` from the schema module.
- Produces: constants `SOURCE = "massimario"`, `BRIDGE_REL_NORMA = "CITA_NORMA"`, `BRIDGE_REL_PRONUNCIA = "CITA_PRONUNCIA"`, `COCITATION_CONFIDENCE = 0.5`; `year_only_acts(raw) -> set[str]`; `build_volume(raw, *, resolved: dict[str, str | None], bands: RvBands) -> dict` returning the adapter output `{"nodes": [...], "edges": [...], "extras": {"chunks": [...]}, "report": {...}}`.
- Chunk shape (stored in the batch, consumed by Tasks 11 and 13):

```python
{
  "point_id": str,             # schema point_id(f"massimario:{volume}:{section}", "rassegna", f"{index}.{piece}")
  "paragraph_key": str,        # "massimario|<volume>|<section>|<index>"
  "piece": int,                # 0 = the whole paragraph in the payload
  "ordine": int,
  "vector_text": str,          # what is embedded (the piece)
  "payload": {...},            # see Step 3, _payload
  "bridge": [                  # rows without chunk_id/source: Task 11 adds them
    {"graph_node_urn": str, "node_type": "Norma" | "AttoGiudiziario",
     "relation_type": "CITA_NORMA" | "CITA_PRONUNCIA", "confidence": 1.0,
     "metadata": {"anno": int, "archivio": str, "ordine": int, "piece": int, ...}},
  ],
}
```

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_volume_assembly.py
from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.pipeline.massimario.urns import NORMATTIVA_PREFIX
from merlt.pipeline.massimario.volume import build_volume, year_only_acts
from tests.pipeline.massimario_fixture import volume_9001

BANDS = RvBands({("civile", 2024): (669000, 673000)})
RESOLVED = {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
CC_2043 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
CPC_360 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1940-10-28;1443:1~art360"


def build(resolved=RESOLVED):
    return build_volume(volume_9001(), resolved=resolved, bands=BANDS)


def nodes_by_id(out):
    return {n["id"]: n for n in out["nodes"]}


def test_year_only_acts_are_listed_for_resolution():
    assert year_only_acts(volume_9001()) == {"urn:nir:stato:legge:1983;184"}


def test_decisions_are_one_node_each_with_unions():
    nodes = nodes_by_id(build())
    d = nodes["cassazione:civile:1234:2024"]
    assert d["labels"] == ["AttoGiudiziario"]
    props = d["properties"]
    assert props["node_id"] == "cassazione:civile:1234:2024"
    assert props["rv"] == ["670001-01", "670001-02"]
    assert props["sezioni"] == ["U"] and props["anni_rassegna"] == [2024]
    assert props["estremi"] == "Cass. civ., n. 1234/2024"
    assert props["fonte"] == "Ufficio del Massimario" and props["provenance"] == "ingestion"
    assert nodes["cassazione:civile:4321:2024"]["properties"]["anno_implicito"] is True
    assert "corte_costituzionale:12:2024" in nodes


def test_norm_stubs_for_every_cited_norm():
    nodes = nodes_by_id(build())
    stub = nodes[CC_2043]
    assert stub["labels"] == ["Norma"] and stub["properties"]["is_stub"] is True
    assert NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184" in nodes
    assert not any("~sez2" in key for key in nodes)


def test_weak_edges_only_inside_a_paragraph():
    edges = {(e["start"], e["end"]): e for e in build()["edges"]}
    edge = edges[("cassazione:civile:1234:2024", CC_2043)]
    assert edge["type"] == "INTERPRETA"
    props = edge["properties"]
    assert (props["tipo"], props["confidenza"], props["paragrafi"]) == ("co-citazione", 0.5, 2)
    assert props["anno_rassegna"] == 2024 and props["volume"] == 9001 and props["_mass_key"]
    assert ("cassazione:civile:567:2023", CC_2043) not in edges  # different paragraphs


def test_chunks_payload_and_bridge_rows():
    chunks = build()["extras"]["chunks"]
    first = chunks[0]
    assert first["piece"] == 0 and first["paragraph_key"] == "massimario|9001|9111|0"
    payload = first["payload"]
    assert payload["source_type"] == "rassegna" and payload["fonte"] == "Ufficio del Massimario"
    assert payload["anno"] == 2024 and payload["archivio"] == "civile"
    assert payload["capitolo"] == {"nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ"}
    assert payload["sezione"] == {"id": 9111, "numero": "1", "titolo": "Il danno."}
    assert payload["autori"] == ["Anna Rossi", "Bruno Verdi"]
    assert payload["url"].endswith("/rassegneAnnuali/9001/dettaglio.do#9111")
    (norm,) = payload["norme"]
    assert payload["text"][norm["start"]:norm["end"]] == "art. 2043 c.c."
    assert payload["decisioni"][0]["key"] == "cassazione:civile:1234:2024"
    rows = {(r["relation_type"], r["graph_node_urn"]) for r in first["bridge"]}
    assert rows == {("CITA_NORMA", CC_2043), ("CITA_PRONUNCIA", "cassazione:civile:1234:2024")}
    assert all(r["confidence"] == 1.0 and r["metadata"]["anno"] == 2024 for r in first["bridge"])
    assert all(r["metadata"]["fonte"] == "Ufficio del Massimario" for r in first["bridge"])


def test_comma_and_markup():
    chunks = build()["extras"]["chunks"]
    second = chunks[1]["payload"]
    assert second["norme"][0] == {**second["norme"][0], "urn": CPC_360, "comma": "com1-num5"}
    script = chunks[2]["payload"]["text"]
    assert script == "La l. n. 184 del 1983 resta ferma."


def test_report():
    report = build()["report"]
    assert report["urn_conflicts"] == [] and report["stats"]["nodes_total"] == len(build()["nodes"])
    m = report["massimario"]
    assert m["volume"]["anno"] == 2024 and m["paragrafi"] == 6
    assert m["citazioni"]["rv_totali"] == 5 and m["citazioni"]["rv_riconosciute"] == 5
    assert m["norme"]["partizioni"] == 1 and m["norme"]["date_completate"] == 1
    assert m["sezioni_fuori_capitolo"] == 1


def test_unresolved_year_only_act_is_reported_not_linked():
    out = build(resolved={})
    assert out["report"]["massimario"]["norme"]["non_risolte"] == 1
    assert not any("legge" in n["id"] for n in out["nodes"])


def test_build_is_deterministic():
    assert build() == build()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_volume_assembly.py -q)`
Expected: FAIL — `ImportError: cannot import name 'build_volume'`.

- [ ] **Step 3: Append the assembly to `volume.py`**

Add to the imports at the top of `volume.py`:

```python
import hashlib
from collections import Counter

from merlt.storage.graph.schema import Fonte, Label, Provenance, Rel, SourceType, point_id, stub_properties

from .citations import parse_citations
from .identity import CitedDecision
from .paragraphs import split_for_vectors
from .rv_bands import RvBands
from .urns import parse_portal_urn, to_canonical
```

Then append:

```python
SOURCE = "massimario"
BRIDGE_REL_NORMA = "CITA_NORMA"
BRIDGE_REL_PRONUNCIA = "CITA_PRONUNCIA"
COCITATION_CONFIDENCE = 0.5
MAX_PIECE = 2000
SECTION_URL = "https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali/{volume}/dettaglio.do#{section}"
_SAMPLES = 20


def year_only_acts(raw: dict) -> set[str]:
    acts = set()
    for ctx in iter_paragraphs(raw):
        for link in ctx.paragraph.links:
            norm = parse_portal_urn(link.href)
            if norm is not None and norm.year_only:
                acts.add(norm.year_only_urn)
    return acts


def _decision_entry(d: CitedDecision) -> dict:
    return {
        "key": d.identity.key if d.identity else None,
        "label": d.label, "corte": d.corte, "archivio": d.archivio,
        "numero": d.numero, "anno": d.anno, "sezione": d.sezione, "rv": list(d.rv),
    }


class _Volume:
    def __init__(self, meta: VolumeMeta, resolved: dict, bands: RvBands) -> None:
        self.meta, self.resolved, self.bands = meta, resolved, bands
        self.decisions: dict[str, dict] = {}
        self.stubs: dict[str, dict] = {}
        self.edges: dict[tuple[str, str], dict] = {}
        self.chunks: list[dict] = []
        self.count = Counter()
        self.forms = Counter()
        self.reasons = Counter()
        self.unrecognized: list[str] = []
        self.unresolved: list[str] = []
        self.multi_section: dict[str, set[str]] = {}
        self.article_urns: set[str] = set()
        self.act_urns: set[str] = set()
        self.loose_sections: set[int] = set()

    def norms(self, ctx: ParagraphContext) -> list[dict]:
        found = []
        for link in ctx.paragraph.links:
            self.count["riferimenti"] += 1
            norm = parse_portal_urn(link.href)
            if norm is None:
                self.count["partizioni" if "~" in link.href and "~art" not in link.href else "non_risolte"] += 1
                if len(self.unresolved) < _SAMPLES and "~art" in link.href:
                    self.unresolved.append(link.href)
                continue
            urn = to_canonical(norm, self.resolved)
            if urn is None:
                self.count["non_risolte"] += 1
                if len(self.unresolved) < _SAMPLES:
                    self.unresolved.append(link.href)
                continue
            if norm.year_only:
                self.count["date_completate"] += 1
            (self.article_urns if norm.article else self.act_urns).add(urn)
            self.stubs.setdefault(urn, {"id": urn, "labels": [Label.NORMA.value], "properties": stub_properties(urn)})
            found.append({"urn": urn, "start": link.start, "end": link.end,
                          "citazione": link.text, "comma": norm.comma, "articolo": bool(norm.article)})
        return found

    def decisions_of(self, ctx: ParagraphContext) -> list[CitedDecision]:
        scan = parse_citations(ctx.paragraph.text, review_year=self.meta.anno, archivio=ctx.archivio, bands=self.bands)
        self.count["rv_totali"] += scan.rv_total
        self.count["rv_riconosciute"] += scan.rv_recognized
        self.forms.update(scan.forms)
        self.reasons.update(scan.reasons)
        self.unrecognized.extend(scan.unrecognized[: max(0, _SAMPLES - len(self.unrecognized))])
        unique: dict[str, CitedDecision] = {}
        others: list[CitedDecision] = []
        for d in scan.decisions:
            if d.identity is None:
                others.append(d)
                continue
            if d.identity.key in unique:
                kept = unique[d.identity.key]
                kept.rv += [rv for rv in d.rv if rv not in kept.rv]
            else:
                unique[d.identity.key] = d
        for d in unique.values():
            self.add_decision(d)
        return list(unique.values()) + others

    def add_decision(self, d: CitedDecision) -> None:
        key = d.identity.key
        node = self.decisions.get(key)
        if node is None:
            props = {
                "node_id": key, "corte": d.corte, "archivio": d.archivio, "numero": d.numero, "anno": d.anno,
                "estremi": d.estremi, "sezioni": [], "rv": [], "anni_rassegna": [self.meta.anno],
                "anno_implicito": d.anno_implicito,
                "fonte": Fonte.MASSIMARIO.value, "provenance": Provenance.INGESTION.value,
            }
            node = self.decisions[key] = {"id": key, "labels": [Label.ATTO_GIUDIZIARIO.value], "properties": props}
        props = node["properties"]
        if d.sezione and d.sezione not in props["sezioni"]:
            props["sezioni"].append(d.sezione)
            if len(props["sezioni"]) > 1:
                self.multi_section[key] = set(props["sezioni"])
        props["rv"] += [rv for rv in d.rv if rv not in props["rv"]]
        for name, value in (("relatore", d.relatore), ("data_udienza", d.data_udienza)):
            if value and not props.get(name):
                props[name] = value
        props["anno_implicito"] = props["anno_implicito"] and d.anno_implicito

    def add_edges(self, decisions: list[CitedDecision], norms: list[dict]) -> None:
        articles = {n["urn"] for n in norms if n["articolo"]}
        for d in decisions:
            if d.identity is None:
                continue
            for urn in articles:
                pair = (d.identity.key, urn)
                edge = self.edges.get(pair)
                if edge is None:
                    mass_key = hashlib.sha1(f"{pair[0]}|{urn}|{self.meta.volume_id}".encode()).hexdigest()
                    edge = self.edges[pair] = {"start": pair[0], "end": urn, "type": Rel.INTERPRETA.value, "properties": {
                        "tipo": "co-citazione", "confidenza": COCITATION_CONFIDENCE,
                        "fonte": Fonte.MASSIMARIO.value, "provenance": Provenance.INGESTION.value,
                        "anno_rassegna": self.meta.anno, "volume": self.meta.volume_id,
                        "paragrafi": 0, "_mass_key": mass_key,
                    }}
                edge["properties"]["paragrafi"] += 1

    def add_chunks(self, ctx: ParagraphContext, norms: list[dict], decisions: list[CitedDecision]) -> None:
        text = ctx.paragraph.text
        archivio = ctx.archivio or self.meta.archivio
        paragraph_key = f"{SOURCE}|{self.meta.volume_id}|{ctx.sezione.id}|{ctx.index}"
        articles = sorted({n["urn"] for n in norms if n["articolo"]})
        entries = [_decision_entry(d) for d in decisions]
        common = {
            "source_type": SourceType.RASSEGNA.value, "fonte": Fonte.MASSIMARIO.value,
            "anno": self.meta.anno, "archivio": archivio,
            "volume": {"id": self.meta.volume_id, "numero": self.meta.numero, "titolo": self.meta.titolo},
            "parte": {"nome": ctx.parte[0], "titolo": ctx.parte[1]} if ctx.parte else None,
            "capitolo": {"nome": ctx.capitolo["nome"], "titolo": ctx.capitolo["titolo"]} if ctx.capitolo else None,
            "sezione": {"id": ctx.sezione.id, "numero": ctx.sezione.numero, "titolo": ctx.sezione.titolo},
            "autori": ctx.capitolo["autori"] if ctx.capitolo else [],
            "materie": ctx.capitolo["materie"] if ctx.capitolo else [],
            "url": SECTION_URL.format(volume=self.meta.volume_id, section=ctx.sezione.id),
            "paragraph_key": paragraph_key, "ordine": ctx.ordine,
            "article_urn": articles[0] if articles else None, "article_urns": articles,
            "decisioni": entries,
        }
        rows = [
            {"graph_node_urn": urn, "node_type": Label.NORMA.value, "relation_type": BRIDGE_REL_NORMA,
             "confidence": 1.0, "metadata": {"anno": self.meta.anno, "archivio": archivio, "ordine": ctx.ordine,
                                             "fonte": Fonte.MASSIMARIO.value}}
            for urn in sorted({n["urn"] for n in norms})
        ] + [
            {"graph_node_urn": e["key"], "node_type": Label.ATTO_GIUDIZIARIO.value, "relation_type": BRIDGE_REL_PRONUNCIA,
             "confidence": 1.0, "metadata": {"anno": self.meta.anno, "archivio": archivio, "ordine": ctx.ordine,
                                             "fonte": Fonte.MASSIMARIO.value, "rv": e["rv"]}}
            for e in entries if e["key"]
        ]
        for piece, (start, end) in enumerate(split_for_vectors(text, MAX_PIECE)):
            payload = {
                **common, "piece": piece,
                "text": text if piece == 0 else text[start:end],
                "norme": [{k: n[k] for k in ("urn", "start", "end", "citazione", "comma")} for n in norms] if piece == 0 else [],
            }
            self.chunks.append({
                "point_id": point_id(f"{SOURCE}:{self.meta.volume_id}:{ctx.sezione.id}", SourceType.RASSEGNA.value, f"{ctx.index}.{piece}"),
                "paragraph_key": paragraph_key, "piece": piece, "ordine": ctx.ordine,
                "vector_text": text[start:end], "payload": payload,
                "bridge": [{**row, "metadata": {**row["metadata"], "piece": piece}} for row in rows],
            })

    def output(self) -> dict:
        nodes = list(self.decisions.values()) + list(self.stubs.values())
        edges = list(self.edges.values())
        total, recognized = self.count["rv_totali"], self.count["rv_riconosciute"]
        coverage = round(100 * recognized / total, 1) if total else None
        report = {
            "urn_conflicts": [], "node_updates": [], "node_new": [], "orphan_edges": [], "duplicates": [],
            "coverage": None,
            "stats": {
                "nodes_total": len(nodes), "nodes_new": 0, "nodes_update": 0, "edges_total": len(edges),
                "edges_new": 0, "edges_orphan": 0, "duplicates": 0, "coverage_pct": coverage,
            },
            "massimario": {
                "volume": {"id": self.meta.volume_id, "titolo": self.meta.titolo, "anno": self.meta.anno,
                           "archivio": self.meta.archivio, "numero": self.meta.numero},
                "paragrafi": self.count["paragrafi"],
                "frammenti": len(self.chunks),
                "citazioni": {
                    "rv_totali": total, "rv_riconosciute": recognized, "copertura_pct": coverage,
                    "per_forma": dict(sorted(self.forms.items())),
                    "senza_identita": dict(sorted(self.reasons.items())),
                    "non_riconosciute": self.unrecognized,
                },
                "pronunce": {
                    "totali": len(self.decisions),
                    "anno_implicito": sum(1 for d in self.decisions.values() if d["properties"]["anno_implicito"]),
                    "chiavi_con_piu_sezioni": [
                        {"key": k, "sezioni": sorted(v)} for k, v in sorted(self.multi_section.items())
                    ][:_SAMPLES],
                    "gia_nel_grafo": None,
                },
                "norme": {
                    "riferimenti": self.count["riferimenti"], "articoli": len(self.article_urns),
                    "atti": len(self.act_urns), "stub": len(self.stubs),
                    "date_completate": self.count["date_completate"], "non_risolte": self.count["non_risolte"],
                    "partizioni": self.count["partizioni"], "campioni_non_risolti": self.unresolved,
                    "gia_nel_grafo": None,
                },
                "sezioni_fuori_capitolo": len(self.loose_sections),
            },
        }
        return {"nodes": nodes, "edges": edges, "extras": {"chunks": self.chunks}, "report": report}


def build_volume(raw: dict, *, resolved: dict, bands: RvBands) -> dict:
    """The adapter's output for one volume: nodes, edges, chunks with bridge rows, report."""
    volume = _Volume(volume_meta(raw), resolved, bands)
    for ctx in iter_paragraphs(raw):
        volume.count["paragrafi"] += 1
        if ctx.capitolo is None:
            volume.loose_sections.add(ctx.sezione.id)
        norms = volume.norms(ctx)
        decisions = volume.decisions_of(ctx)
        volume.add_edges(decisions, norms)
        volume.add_chunks(ctx, norms, decisions)
    return volume.output()
```

- [ ] **Step 4: Run the tests until they pass**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_volume_assembly.py tests/pipeline/test_massimario_volume_reading.py -q)`
Expected: PASS.

- [ ] **Step 5: Run the vocabulary contract test**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/unit/test_graph_vocabulary_contract.py -q)`
Expected: PASS (no Cypher here yet; this guards the imports and names).

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/pipeline/massimario/volume.py services/merlt/tests/pipeline/test_massimario_volume_assembly.py
git commit -m "feat(merlt): assemble a Massimario volume into nodes, edges, chunks and a report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: MERL-T — the adapter, the batch's extras, the source name

**Files:**
- Modify: `services/merlt/merlt/clients/visualex_client.py` (two methods after `fetch_tree`)
- Create: `services/merlt/merlt/pipeline/massimario/adapter.py`
- Create: `services/merlt/merlt/pipeline/massimario/report.py`
- Modify: `services/merlt/merlt/pipeline/mechanical_ingestion/parser.py:478-483` (`get_adapter`)
- Modify: `services/merlt/merlt/storage/enrichment/models.py:342-396` (`extras`, `check_batch_source`)
- Modify: `services/merlt/merlt/storage/enrichment/schema_additions.py` (`_STATEMENTS`)
- Create: `services/merlt/merlt/storage/migrations/006_massimario_ingestion.sql`
- Create: `services/merlt/alembic/versions/010_massimario_ingestion.py`
- Modify: `services/merlt/merlt/api/ingestion_mechanical_router.py:60-64` (`RunIngestionRequest.source`)
- Modify: `services/merlt/merlt/worker/mechanical_ingest_tasks.py:21-82` (`_run_parse_and_stage`)
- Test: `services/merlt/tests/pipeline/test_massimario_adapter.py`, `services/merlt/tests/worker/test_mechanical_ingest_massimario.py`

**Interfaces:**
- Consumes: VisuaLex `GET /fetch_massimario`, `POST /resolve_act_dates` (Tasks 1–2); `build_volume`, `year_only_acts`, `walk_index` (Tasks 6, 8); `RvBands.load()` (Task 7).
- Produces: `VisuaLexClient.fetch_massimario(kind: str, element_id: int) -> dict`, `VisuaLexClient.resolve_act_dates(urns: list[str]) -> dict[str, str | None]`; `MassimarioAdapter(client=None, bands=None).parse(source_ref: str) -> dict`; `parse_source_ref(source_ref) -> int`; `add_graph_counts(falkordb, nodes, report) -> None`; batch column `extras` (`{"chunks": [...]}`); source name `massimario` accepted by the router and the database.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_adapter.py
import pytest

from merlt.pipeline.massimario.adapter import MassimarioAdapter, parse_source_ref
from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.pipeline.mechanical_ingestion.parser import get_adapter
from tests.pipeline.massimario_fixture import volume_9001


class FakeVisuaLex:
    def __init__(self):
        self.raw = volume_9001()
        self.calls = []

    async def fetch_massimario(self, kind, element_id):
        self.calls.append((kind, element_id))
        if kind == "index":
            return self.raw["index"]
        return (self.raw["capitoli"] if kind == "capitolo" else self.raw["sezioni"])[element_id]

    async def resolve_act_dates(self, urns):
        self.calls.append(("resolve", tuple(urns)))
        return {u: u.replace("1983;", "1983-05-04;") for u in urns}


async def test_parse_walks_the_volume_and_resolves_dates():
    client = FakeVisuaLex()
    adapter = MassimarioAdapter(client=client, bands=RvBands({("civile", 2024): (669000, 673000)}))
    out = await adapter.parse('{"volume": 9001}')
    assert client.calls == [
        ("index", 9001), ("capitolo", 9101), ("capitolo", 9102), ("sezione", 9201),
        ("resolve", ("urn:nir:stato:legge:1983;184",)),
    ]
    assert set(out) == {"nodes", "edges", "extras", "report"}
    assert any(n["id"].endswith("legge:1983-05-04;184") for n in out["nodes"])


@pytest.mark.parametrize("ref", ['{"volume": "96"}', "[]", "nope", '{"volume": true}', '{"volume": 0}', "{}"])
def test_bad_source_ref(ref):
    with pytest.raises(ValueError):
        parse_source_ref(ref)


def test_registered_as_a_mechanical_source():
    assert isinstance(get_adapter("massimario"), MassimarioAdapter)
```

```python
# services/merlt/tests/worker/test_mechanical_ingest_massimario.py
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.worker import mechanical_ingest_tasks as tasks


class FakeSession:
    def __init__(self, batch):
        self.batch = batch

    async def execute(self, _statement):
        return SimpleNamespace(scalar_one_or_none=lambda: self.batch)

    async def commit(self):
        pass


def fake_batch():
    return SimpleNamespace(
        id="b1", source="massimario", source_ref='{"volume": 9001}', status="parsing",
        nodes=None, edges=None, extras=None, conflict_report=None, stats=None, error=None,
    )


async def test_massimario_batch_keeps_its_report_and_extras():
    batch = fake_batch()

    @asynccontextmanager
    async def session():
        yield FakeSession(batch)

    report = {"urn_conflicts": [], "stats": {"nodes_total": 1}, "massimario": {}}
    parsed = {"nodes": [{"id": "x", "labels": ["Norma"], "properties": {}}], "edges": [],
              "extras": {"chunks": [{"point_id": "p"}]}, "report": report}
    adapter = SimpleNamespace(parse=AsyncMock(return_value=parsed))
    graph = MagicMock(connect=AsyncMock(), close=AsyncMock())
    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), \
         patch("merlt.storage.enrichment.database.get_db_session", new=session), \
         patch("merlt.pipeline.mechanical_ingestion.parser.get_adapter", return_value=adapter), \
         patch("merlt.storage.graph.client.FalkorDBClient", return_value=graph), \
         patch("merlt.pipeline.massimario.report.add_graph_counts", new=AsyncMock()) as counts, \
         patch("merlt.pipeline.mechanical_ingestion.conflict_report.build_conflict_report", new=AsyncMock()) as generic:
        result = await tasks._run_parse_and_stage("b1")
    assert result["status"] == "pending_review"
    assert batch.extras == {"chunks": [{"point_id": "p"}]}
    assert batch.conflict_report is report and batch.stats == report["stats"]
    counts.assert_awaited_once()
    generic.assert_not_awaited()
```

Add to the same worker test file a report test:

```python
from merlt.pipeline.massimario.report import add_graph_counts


async def test_add_graph_counts():
    graph = MagicMock(query=AsyncMock(side_effect=[[{"c": 1}], [{"c": 2}]]))
    nodes = [{"id": "u1", "labels": ["Norma"]}, {"id": "u2", "labels": ["Norma"]},
             {"id": "k1", "labels": ["AttoGiudiziario"]}, {"id": "k2", "labels": ["AttoGiudiziario"]}]
    report = {"stats": {"nodes_total": 4}, "massimario": {"norme": {}, "pronunce": {}}}
    await add_graph_counts(graph, nodes, report)
    assert report["massimario"]["norme"]["gia_nel_grafo"] == 1
    assert report["massimario"]["pronunce"]["gia_nel_grafo"] == 2
    assert (report["stats"]["nodes_update"], report["stats"]["nodes_new"]) == (3, 1)
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_adapter.py tests/worker/test_mechanical_ingest_massimario.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: VisuaLex client methods**

In `services/merlt/merlt/clients/visualex_client.py`, after `fetch_tree` (check that `Dict`, `List`, `Optional`, `Any` and `httpx` are already imported at the top; add what is missing):

```python
    async def fetch_massimario(self, kind: str, element_id: int) -> Dict[str, Any]:
        """One element of the Massimario portal, through VisuaLex's internal route (raw objectData)."""
        client = await self._get_client()
        response = await client.get(
            "/fetch_massimario",
            params={"kind": kind, "id": str(element_id)},
            timeout=httpx.Timeout(120.0),
        )
        if response.status_code == 429:
            raise RuntimeError("Portale del Massimario: il firewall ha rifiutato la richiesta; riprovare più tardi")
        response.raise_for_status()
        return response.json()["data"]

    async def resolve_act_dates(self, urns: List[str]) -> Dict[str, Optional[str]]:
        """Full URNs for acts cited by year only (at most 20 per call), through VisuaLex."""
        client = await self._get_client()
        response = await client.post(
            "/resolve_act_dates", json={"urns": urns}, timeout=httpx.Timeout(180.0)
        )
        response.raise_for_status()
        return response.json().get("resolved", {})
```

- [ ] **Step 4: The adapter and the report counts**

```python
# services/merlt/merlt/pipeline/massimario/adapter.py
"""MechanicalSourceAdapter for the Massimario's annual reviews (spec §6).

`source_ref` is `{"volume": <portal id>}`. The volume is fetched element by
element through VisuaLex (index, chapters, sections outside any chapter), acts
cited by year only are completed through VisuaLex, and the batch is assembled
by `build_volume`.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import structlog

from .rv_bands import RvBands
from .volume import build_volume, walk_index, year_only_acts

log = structlog.get_logger()

RESOLVE_BATCH = 20  # VisuaLex's /resolve_act_dates limit


def parse_source_ref(source_ref: str) -> int:
    try:
        data = json.loads(source_ref)
    except ValueError as exc:
        raise ValueError('source_ref: atteso {"volume": <id>}') from exc
    volume = data.get("volume") if isinstance(data, dict) else None
    if not isinstance(volume, int) or isinstance(volume, bool) or volume <= 0:
        raise ValueError('source_ref: atteso {"volume": <id>}')
    return volume


class MassimarioAdapter:
    def __init__(self, client: Optional[Any] = None, bands: Optional[RvBands] = None) -> None:
        self._client = client
        self._bands = bands

    def _get_client(self):
        if self._client is None:
            from merlt.clients.visualex_client import get_visualex_client

            self._client = get_visualex_client()
        return self._client

    async def fetch_volume(self, volume_id: int) -> dict:
        client = self._get_client()
        index = await client.fetch_massimario("index", volume_id)
        tree = walk_index(index)
        capitoli = {}
        for chapter_id in tree.capitoli:
            capitoli[chapter_id] = await client.fetch_massimario("capitolo", chapter_id)
        sezioni = {}
        for section_id, chapter_id in tree.sezioni.items():
            if chapter_id is None:
                sezioni[section_id] = await client.fetch_massimario("sezione", section_id)
        return {"volume_id": volume_id, "index": index, "capitoli": capitoli, "sezioni": sezioni}

    async def parse(self, source_ref: str) -> dict[str, Any]:
        volume_id = parse_source_ref(source_ref)
        raw = await self.fetch_volume(volume_id)
        acts = sorted(year_only_acts(raw))
        resolved: dict[str, Optional[str]] = {}
        client = self._get_client()
        for i in range(0, len(acts), RESOLVE_BATCH):
            resolved.update(await client.resolve_act_dates(acts[i:i + RESOLVE_BATCH]))
        log.info("massimario.fetched", volume=volume_id, chapters=len(raw["capitoli"]),
                 loose_sections=len(raw["sezioni"]), year_only_acts=len(acts))
        return build_volume(raw, resolved=resolved, bands=self._bands or RvBands.load())
```

```python
# services/merlt/merlt/pipeline/massimario/report.py
"""What the graph already holds, added to a Massimario batch's report at staging time."""
from __future__ import annotations

from merlt.storage.graph.schema import Label

_NORMS = "MATCH (n:Norma) WHERE n.URN IN $ids RETURN count(n) AS c"
_DECISIONS = "MATCH (d:AttoGiudiziario) WHERE d.node_id IN $ids RETURN count(d) AS c"
_CHUNK = 1000


async def _count(falkordb, cypher: str, ids: list[str]) -> int:
    total = 0
    for i in range(0, len(ids), _CHUNK):
        rows = await falkordb.query(cypher, {"ids": ids[i:i + _CHUNK]})
        total += int(rows[0]["c"]) if rows else 0
    return total


async def add_graph_counts(falkordb, nodes: list[dict], report: dict) -> None:
    urns = [n["id"] for n in nodes if n["labels"][0] == Label.NORMA.value]
    keys = [n["id"] for n in nodes if n["labels"][0] == Label.ATTO_GIUDIZIARIO.value]
    norms = await _count(falkordb, _NORMS, urns)
    decisions = await _count(falkordb, _DECISIONS, keys)
    report["massimario"]["norme"]["gia_nel_grafo"] = norms
    report["massimario"]["pronunce"]["gia_nel_grafo"] = decisions
    stats = report["stats"]
    stats["nodes_update"] = norms + decisions
    stats["nodes_new"] = stats["nodes_total"] - stats["nodes_update"]
```

Check the shape of `FalkorDBClient.query`'s rows (`merlt/storage/graph/client.py:101`): if it does not key rows by the `RETURN` alias, read the count the way `conflict_report.fetch_existing_norma_props` reads its rows.

- [ ] **Step 5: Register the source**

`services/merlt/merlt/pipeline/mechanical_ingestion/parser.py`, in `get_adapter` before the `ValueError`:

```python
    if source == "massimario":
        from merlt.pipeline.massimario.adapter import MassimarioAdapter

        return MassimarioAdapter()
```

`services/merlt/merlt/api/ingestion_mechanical_router.py`:

```python
    source: str = Field(..., pattern="^(visualex_tree|italia_corpus|massimario)$")
```

`services/merlt/merlt/storage/enrichment/models.py`, in `MerltIngestionBatch`: after `stats = Column(JSON)`:

```python
    # Massimario batches: {"chunks": [...]} — paragraphs with their payload and
    # bridge rows, written by the chained vector job after promotion.
    extras = Column(JSON)
```

and the check:

```python
        CheckConstraint(
            "source IN ('visualex_tree','italia_corpus','massimario')",
            name="check_batch_source",
        ),
```

Update the class docstring's source list and the comment on `source` (`# visualex_tree | italia_corpus | massimario`).

- [ ] **Step 6: The database change, three places (MERL-T rule: an ORM column needs all three)**

`services/merlt/merlt/storage/enrichment/schema_additions.py`, append to `_STATEMENTS`:

```python
    # 006_massimario_ingestion.sql: Massimario batches stage chunks next to
    # nodes/edges, and `massimario` is a batch source.
    "ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON",
    "DO $$ BEGIN "
    "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_batch_source' "
    "AND pg_get_constraintdef(oid) LIKE '%massimario%') THEN "
    "ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source; "
    "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
    "CHECK (source IN ('visualex_tree','italia_corpus','massimario')); "
    "END IF; END $$",
```

`services/merlt/merlt/storage/migrations/006_massimario_ingestion.sql`:

```sql
-- ====================================================
-- Migration 006: the Massimario's annual reviews (ingestion)
-- ====================================================
--
-- Same statements as alembic/versions/010_massimario_ingestion.py and
-- merlt/storage/enrichment/schema_additions.py (applied at every boot), for
-- databases bootstrapped by create_tables(). Idempotent: safe to re-run.
ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_batch_source'
               AND pg_get_constraintdef(oid) LIKE '%massimario%') THEN
    ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source;
    ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source
        CHECK (source IN ('visualex_tree','italia_corpus','massimario'));
END IF;
END $$;
```

`services/merlt/alembic/versions/010_massimario_ingestion.py` (run `(cd services/merlt && .venv/bin/alembic heads)` first; if the head is not `009_user_documents_owner_dedup`, use the head it prints as `down_revision`):

```python
"""massimario_ingestion

Massimario batches stage chunks next to nodes/edges (`extras`), and
`massimario` is a batch source. The same statements live in
``merlt/storage/migrations/006_massimario_ingestion.sql`` and in
``merlt/storage/enrichment/schema_additions.py`` (applied at boot).

Revision ID: 010_massimario_ingestion
Revises: 009_user_documents_owner_dedup
Create Date: 2026-10-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = '010_massimario_ingestion'
down_revision: Union[str, None] = '009_user_documents_owner_dedup'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON")
    op.execute("ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source")
    op.execute(
        "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
        "CHECK (source IN ('visualex_tree','italia_corpus','massimario'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source")
    op.execute(
        "ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source "
        "CHECK (source IN ('visualex_tree','italia_corpus'))"
    )
    op.execute("ALTER TABLE merlt_ingestion_batches DROP COLUMN IF EXISTS extras")
```

- [ ] **Step 7: The worker stages the adapter's report and extras**

In `_run_parse_and_stage` (`services/merlt/merlt/worker/mechanical_ingest_tasks.py`), replace the report block and the assignments with:

```python
            falkordb = FalkorDBClient()
            await falkordb.connect()
            try:
                if batch.source == "massimario":
                    # Stubs are created only if missing and decision lists are
                    # unions (pipeline/massimario/promote.py): there is nothing
                    # to conflict with. The adapter brings its own report; add
                    # what the graph already holds.
                    from merlt.pipeline.massimario.report import add_graph_counts

                    report = parsed["report"]
                    await add_graph_counts(falkordb, nodes, report)
                else:
                    report = await build_conflict_report(falkordb, nodes, edges)
            finally:
                await falkordb.close()

            batch.nodes = nodes
            batch.edges = edges
            batch.extras = parsed.get("extras")
            batch.conflict_report = report
            batch.stats = report["stats"]
```

Update the module docstring: batches are enqueued on `merlt_bulk` (the router's `_QUEUE_NAME` on `develop`), not `merlt_ingest`.

- [ ] **Step 8: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_adapter.py tests/worker/test_mechanical_ingest_massimario.py tests/pipeline/test_mechanical_ingestion_parser.py tests/pipeline/test_mechanical_ingestion_conflict_report.py tests/unit/test_graph_vocabulary_contract.py -q)`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/merlt/merlt/clients/visualex_client.py services/merlt/merlt/pipeline/massimario/adapter.py services/merlt/merlt/pipeline/massimario/report.py services/merlt/merlt/pipeline/mechanical_ingestion/parser.py services/merlt/merlt/storage/enrichment/models.py services/merlt/merlt/storage/enrichment/schema_additions.py services/merlt/merlt/storage/migrations/006_massimario_ingestion.sql services/merlt/alembic/versions/010_massimario_ingestion.py services/merlt/merlt/api/ingestion_mechanical_router.py services/merlt/merlt/worker/mechanical_ingest_tasks.py services/merlt/tests/pipeline/test_massimario_adapter.py services/merlt/tests/worker/test_mechanical_ingest_massimario.py
git commit -m "feat(merlt): Massimario adapter for the mechanical ingestion, staged with its report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: MERL-T — promoting a Massimario batch into the graph

**Files:**
- Create: `services/merlt/merlt/pipeline/massimario/promote.py`
- Modify: `services/merlt/merlt/worker/mechanical_ingest_tasks.py` (`_run_promote`)
- Test: `services/merlt/tests/pipeline/test_massimario_promote.py`

**Interfaces:**
- Consumes: batch `nodes` and `edges` from Task 8.
- Produces: `merge_decision_props(existing: dict | None, new: dict) -> dict`; `promote_massimario_graph(falkordb, nodes, edges) -> {"nodes_merged": int, "edges_merged": int, "edges_skipped": int}`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_promote.py
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario import promote
from merlt.pipeline.massimario.promote import merge_decision_props, promote_massimario_graph

KEY = "cassazione:civile:1234:2024"
URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
NODES = [
    {"id": KEY, "labels": ["AttoGiudiziario"], "properties": {
        "node_id": KEY, "corte": "cassazione", "archivio": "civile", "numero": 1234, "anno": 2024,
        "sezioni": ["T"], "rv": ["670001-02"], "anni_rassegna": [2024], "relatore": "Bianchi",
        "fonte": "Ufficio del Massimario", "provenance": "ingestion", "data_udienza": None,
    }},
    {"id": URN, "labels": ["Norma"], "properties": {"URN": URN, "node_id": URN, "is_stub": True, "provenance": "ingestion"}},
]
EDGES = [{"start": KEY, "end": URN, "type": "INTERPRETA",
          "properties": {"tipo": "co-citazione", "confidenza": 0.5, "_mass_key": "k1", "paragrafi": 2}}]


def graph(existing_rows):
    return MagicMock(query=AsyncMock(side_effect=[existing_rows, [], [], []]))


async def test_first_promotion_writes_decisions_stubs_and_edges():
    g = graph([])
    stats = await promote_massimario_graph(g, NODES, EDGES)
    assert stats == {"nodes_merged": 2, "edges_merged": 1, "edges_skipped": 0}
    queries = [call.args[0] for call in g.query.await_args_list]
    assert queries == [promote._EXISTING, promote._MERGE_DECISIONS, promote._MERGE_STUBS, promote._MERGE_EDGES]
    decision_props = g.query.await_args_list[1].args[1]["rows"][0]["props"]
    assert "data_udienza" not in decision_props  # None never reaches FalkorDB (it would delete the property)


async def test_second_promotion_unions_lists():
    existing = [{"k": KEY, "sezioni": ["5"], "rv": ["670001-01"], "anni_rassegna": [2023],
                 "relatore": "Rossi", "data_udienza": None, "fonte": "Brocardi.it", "provenance": "seed"}]
    g = graph(existing)
    await promote_massimario_graph(g, NODES, EDGES)
    props = g.query.await_args_list[1].args[1]["rows"][0]["props"]
    assert props["sezioni"] == ["5", "T"]
    assert props["rv"] == ["670001-01", "670001-02"]
    assert props["anni_rassegna"] == [2023, 2024]
    assert (props["relatore"], props["fonte"], props["provenance"]) == ("Rossi", "Brocardi.it", "seed")


def test_stubs_are_created_only_if_missing():
    assert "ON CREATE SET" in promote._MERGE_STUBS
    assert promote._MERGE_STUBS.count("SET") == 1


def test_merge_without_existing_is_the_new_props_without_nulls():
    assert merge_decision_props(None, {"a": 1, "b": None}) == {"a": 1}
```

And in `services/merlt/tests/worker/test_mechanical_ingest_massimario.py`:

```python
async def test_massimario_promotion_uses_its_own_writer():
    batch = fake_batch()
    batch.status, batch.nodes, batch.edges = "promoting", [{"id": "x", "labels": ["Norma"], "properties": {}}], []
    batch.extras = {"chunks": []}

    @asynccontextmanager
    async def session():
        yield FakeSession(batch)

    graph = MagicMock(connect=AsyncMock(), close=AsyncMock())
    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), \
         patch("merlt.storage.enrichment.database.get_db_session", new=session), \
         patch("merlt.storage.graph.client.FalkorDBClient", return_value=graph), \
         patch("merlt.pipeline.massimario.promote.promote_massimario_graph",
               new=AsyncMock(return_value={"nodes_merged": 1, "edges_merged": 0, "edges_skipped": 0})) as own, \
         patch("merlt.pipeline.mechanical_ingestion.promote.promote_batch", new=AsyncMock()) as generic:
        result = await tasks._run_promote("b1", False)
    assert result["status"] == "promoted"
    own.assert_awaited_once()
    generic.assert_not_awaited()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_promote.py tests/worker/test_mechanical_ingest_massimario.py -q)`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `promote.py`**

```python
# services/merlt/merlt/pipeline/massimario/promote.py
"""Graph writes for a Massimario batch (spec §5.2–5.4).

Decisions: MERGE by `node_id`; their lists (`sezioni`, `rv`, `anni_rassegna`)
become unions with what the graph holds, and facts already present (rapporteur,
hearing date, source, provenance) are kept. Norm stubs: created only if missing
(`ON CREATE`), never written over a complete article. Co-citation edges: one per
(decision, norm, volume), keyed by `_mass_key`, so a re-run rewrites the same
edge. None values never reach FalkorDB: `SET x += {k: null}` deletes `k`.
"""
from __future__ import annotations

from typing import Optional

from merlt.storage.graph.schema import Label

_ROWS = 500
_EXISTING = (
    "MATCH (d:AttoGiudiziario) WHERE d.node_id IN $keys "
    "RETURN d.node_id AS k, d.sezioni AS sezioni, d.rv AS rv, d.anni_rassegna AS anni_rassegna, "
    "d.relatore AS relatore, d.data_udienza AS data_udienza, d.fonte AS fonte, d.provenance AS provenance"
)
_MERGE_DECISIONS = "UNWIND $rows AS row MERGE (d:AttoGiudiziario {node_id: row.k}) SET d += row.props"
_MERGE_STUBS = "UNWIND $rows AS row MERGE (n:Norma {URN: row.k}) ON CREATE SET n += row.props"
_MERGE_EDGES = (
    "UNWIND $rows AS row "
    "MATCH (d:AttoGiudiziario {node_id: row.s}) MATCH (n:Norma {URN: row.t}) "
    "MERGE (d)-[r:INTERPRETA {_mass_key: row.k}]->(n) SET r += row.props"
)
_LISTS = ("sezioni", "rv", "anni_rassegna")
_KEEP = ("relatore", "data_udienza", "fonte", "provenance")


def _clean(props: dict) -> dict:
    return {k: v for k, v in props.items() if v is not None}


def merge_decision_props(existing: Optional[dict], new: dict) -> dict:
    props = dict(new)
    if existing:
        for name in _LISTS:
            merged = list(existing.get(name) or [])
            merged += [v for v in new.get(name) or [] if v not in merged]
            props[name] = sorted(merged) if name == "anni_rassegna" else merged
        for name in _KEEP:
            if existing.get(name):
                props[name] = existing[name]
    return _clean(props)


def _chunks(rows: list) -> list[list]:
    return [rows[i:i + _ROWS] for i in range(0, len(rows), _ROWS)]


async def promote_massimario_graph(falkordb, nodes: list[dict], edges: list[dict]) -> dict:
    decisions = [n for n in nodes if n["labels"][0] == Label.ATTO_GIUDIZIARIO.value]
    stubs = [n for n in nodes if n["labels"][0] == Label.NORMA.value]
    existing: dict[str, dict] = {}
    for keys in _chunks([d["id"] for d in decisions]):
        for row in await falkordb.query(_EXISTING, {"keys": keys}):
            existing[row["k"]] = row
    decision_rows = [{"k": d["id"], "props": merge_decision_props(existing.get(d["id"]), d["properties"])}
                     for d in decisions]
    stub_rows = [{"k": s["id"], "props": _clean(s["properties"])} for s in stubs]
    edge_rows = [{"s": e["start"], "t": e["end"], "k": e["properties"]["_mass_key"], "props": _clean(e["properties"])}
                 for e in edges]
    for query, rows in ((_MERGE_DECISIONS, decision_rows), (_MERGE_STUBS, stub_rows), (_MERGE_EDGES, edge_rows)):
        for chunk in _chunks(rows):
            await falkordb.query(query, {"rows": chunk})
    return {"nodes_merged": len(decision_rows) + len(stub_rows), "edges_merged": len(edge_rows), "edges_skipped": 0}
```

Check on the development graph that FalkorDB accepts `UNWIND` of a list of maps with nested maps and `ON CREATE SET n += map` (run each query once against `merl_t_legal` through `redis-cli GRAPH.QUERY` with one invented row, then delete it). If it does not, write one query per row with the same Cypher minus the `UNWIND`.

- [ ] **Step 4: The worker promotes with it**

In `_run_promote`, replace the `promote_batch` call with:

```python
            try:
                if batch.source == "massimario":
                    from merlt.pipeline.massimario.promote import promote_massimario_graph

                    result = await promote_massimario_graph(falkordb, batch.nodes or [], batch.edges or [])
                else:
                    result = await promote_batch(
                        falkordb, batch.nodes or [], batch.edges or [], force=force
                    )
```

- [ ] **Step 5: Run the tests and the contract test**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_promote.py tests/worker/test_mechanical_ingest_massimario.py tests/pipeline/test_mechanical_ingestion_promote.py tests/unit/test_graph_vocabulary_contract.py -q)`
Expected: PASS (the contract test now sees `AttoGiudiziario`, `Norma`, `INTERPRETA` in Cypher strings: all defined).

- [ ] **Step 6: Commit**

```bash
git add services/merlt/merlt/pipeline/massimario/promote.py services/merlt/merlt/worker/mechanical_ingest_tasks.py services/merlt/tests/pipeline/test_massimario_promote.py services/merlt/tests/worker/test_mechanical_ingest_massimario.py
git commit -m "feat(merlt): promote a Massimario batch: decisions as unions, stubs only if missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: MERL-T — vectors and bridge rows, slice by slice

**Files:**
- Modify: `services/merlt/merlt/storage/bridge/bridge_table.py` (`BridgeTableConfig.from_enrichment_env`, `upsert_mappings_batch`, `count_by_source`, `delete_by_source`)
- Modify: `services/merlt/merlt/api/engine_bootstrap.py:54-63` (use `from_enrichment_env`)
- Create: `services/merlt/merlt/pipeline/massimario/vectors.py`
- Create: `services/merlt/merlt/worker/massimario_tasks.py`
- Modify: `services/merlt/merlt/worker/mechanical_ingest_tasks.py` (`_run_promote`: progress and enqueue)
- Modify: `schema_additions.py`, `006_massimario_ingestion.sql`, `010_massimario_ingestion.py` (bridge statements)
- Test: `services/merlt/tests/pipeline/test_massimario_vectors.py`, `services/merlt/tests/worker/test_massimario_tasks.py`, `services/merlt/tests/storage/test_bridge_upsert.py`

**Interfaces:**
- Consumes: chunk shape (Task 8); `EmbeddingService.encode_batch_async(texts, is_query=False)`; `default_chunks_collection()`.
- Produces: `BridgeTableConfig.from_enrichment_env() -> BridgeTableConfig`; `BridgeTable.upsert_mappings_batch(mappings) -> int`; `BridgeTable.count_by_source(source) -> int`; `BridgeTable.delete_by_source(source) -> int`; `build_qdrant_client()`; `index_chunks(chunks, *, embeddings, qdrant, bridge, collection) -> int`; RQ task `merlt.worker.massimario_tasks.index_slice(batch_id: str, start: int = 0)`; `enqueue_index_slice(batch_id, start)`; batch `stats["vectors"] = {"done": int, "total": int, "error"?: str}`.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/storage/test_bridge_upsert.py
from merlt.storage.bridge.bridge_table import BridgeTable, BridgeTableConfig


class RecordingSession:
    def __init__(self, log):
        self.log = log

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement, params=None):
        self.log.append((str(statement), params))
        return type("R", (), {"rowcount": 3, "scalar": lambda self: 7})()

    async def commit(self):
        self.log.append(("commit", None))


def bridge(log):
    b = BridgeTable(BridgeTableConfig())
    b._connected = True
    b._session_maker = lambda: RecordingSession(log)
    return b


async def test_upsert_is_on_conflict_update():
    log = []
    n = await bridge(log).upsert_mappings_batch([
        {"chunk_id": "6f1c2b9e-0000-5000-8000-000000000001", "graph_node_urn": "u", "node_type": "Norma",
         "relation_type": "CITA_NORMA", "confidence": 1.0, "source": "massimario", "metadata": {"anno": 2024}},
    ])
    sql, params = log[0]
    assert n == 1
    assert "ON CONFLICT (chunk_id, graph_node_urn) DO UPDATE" in sql
    assert params["metadata"] == '{"anno": 2024}' and params["source"] == "massimario"


async def test_count_and_delete_by_source():
    log = []
    b = bridge(log)
    assert await b.count_by_source("massimario") == 7
    assert await b.delete_by_source("massimario") == 3
    assert all(p == {"source": "massimario"} for _, p in log if p)


def test_config_from_enrichment_env(monkeypatch):
    monkeypatch.setenv("ENRICHMENT_DB_HOST", "postgres")
    monkeypatch.setenv("ENRICHMENT_DB_NAME", "merlt")
    config = BridgeTableConfig.from_enrichment_env()
    assert (config.host, config.database) == ("postgres", "merlt")
```

```python
# services/merlt/tests/pipeline/test_massimario_vectors.py
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario.vectors import index_chunks

CHUNKS = [
    {"point_id": "6f1c2b9e-0000-5000-8000-000000000001", "vector_text": "uno", "payload": {"text": "uno"},
     "bridge": [{"graph_node_urn": "u", "node_type": "Norma", "relation_type": "CITA_NORMA",
                 "confidence": 1.0, "metadata": {"anno": 2024, "piece": 0}}]},
    {"point_id": "6f1c2b9e-0000-5000-8000-000000000002", "vector_text": "due", "payload": {"text": "due"},
     "bridge": []},
]


def fakes():
    embeddings = MagicMock(encode_batch_async=AsyncMock(return_value=[[0.1, 0.2], [0.3, 0.4]]))
    qdrant = MagicMock(collection_exists=MagicMock(return_value=True))
    bridge = MagicMock(upsert_mappings_batch=AsyncMock(return_value=1), add_mappings_batch=AsyncMock())
    return embeddings, qdrant, bridge


async def test_points_then_bridge_rows():
    embeddings, qdrant, bridge = fakes()
    n = await index_chunks(CHUNKS, embeddings=embeddings, qdrant=qdrant, bridge=bridge, collection="c")
    assert n == 2
    embeddings.encode_batch_async.assert_awaited_once_with(["uno", "due"], is_query=False)
    points = qdrant.upsert.call_args.kwargs["points"]
    assert [p.id for p in points] == [c["point_id"] for c in CHUNKS]
    assert points[0].payload == {"text": "uno"}
    (rows,) = bridge.upsert_mappings_batch.await_args.args
    assert rows == [{**CHUNKS[0]["bridge"][0], "chunk_id": CHUNKS[0]["point_id"], "source": "massimario"}]


async def test_reindexing_is_an_upsert():
    embeddings, qdrant, bridge = fakes()
    for _ in range(2):
        await index_chunks(CHUNKS, embeddings=embeddings, qdrant=qdrant, bridge=bridge, collection="c")
    first, second = (c.kwargs["points"] for c in qdrant.upsert.call_args_list)
    assert [p.id for p in first] == [p.id for p in second]
    bridge.add_mappings_batch.assert_not_awaited()
```

```python
# services/merlt/tests/worker/test_massimario_tasks.py
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.worker import massimario_tasks


def batch(status="promoted", chunks=250):
    return SimpleNamespace(id="b1", status=status, stats={}, extras={"chunks": [{"point_id": str(i)} for i in range(chunks)]})


def session_for(b):
    @asynccontextmanager
    async def session():
        yield SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: b)),
            commit=AsyncMock(),
        )
    return session


async def run(b, start):
    index = AsyncMock(side_effect=lambda chunks, **kw: len(chunks))
    bridge = MagicMock(connect=AsyncMock(), close=AsyncMock())
    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), \
         patch("merlt.storage.enrichment.database.get_db_session", new=session_for(b)), \
         patch.object(massimario_tasks, "index_chunks", new=index), \
         patch.object(massimario_tasks, "_bridge", return_value=bridge), \
         patch.object(massimario_tasks, "build_qdrant_client", return_value=MagicMock()), \
         patch.object(massimario_tasks, "_embeddings", return_value=MagicMock()), \
         patch.object(massimario_tasks, "enqueue_index_slice") as enqueue:
        result = await massimario_tasks._run_index_slice("b1", start)
    return result, index, enqueue


async def test_a_slice_writes_and_chains_the_next():
    b = batch()
    result, index, enqueue = await run(b, 0)
    assert len(index.await_args.args[0]) == massimario_tasks.SLICE == 100
    assert b.stats["vectors"] == {"done": 100, "total": 250}
    enqueue.assert_called_once_with("b1", 100)


async def test_the_last_slice_stops_the_chain():
    b = batch()
    await run(b, 200)
    assert b.stats["vectors"] == {"done": 250, "total": 250}


async def test_a_batch_not_promoted_is_skipped():
    result, index, enqueue = await run(batch(status="rejected"), 0)
    assert result["status"] == "skipped"
    index.assert_not_awaited()
    enqueue.assert_not_called()
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/storage/test_bridge_upsert.py tests/pipeline/test_massimario_vectors.py tests/worker/test_massimario_tasks.py -q)`
Expected: FAIL.

- [ ] **Step 3: Bridge additions**

In `services/merlt/merlt/storage/bridge/bridge_table.py`, in `BridgeTableConfig` (next to `from_environment`):

```python
    @classmethod
    def from_enrichment_env(cls) -> "BridgeTableConfig":
        """The bridge lives in the enrichment database (postgres:5432/merlt in the stack)."""
        return cls(
            host=os.getenv("ENRICHMENT_DB_HOST", "localhost"),
            port=int(os.getenv("ENRICHMENT_DB_PORT", "5432")),
            database=os.getenv("ENRICHMENT_DB_NAME", "merlt"),
            user=os.getenv("ENRICHMENT_DB_USER", "merlt"),
            password=os.getenv("ENRICHMENT_DB_PASSWORD", "merlt"),
        )
```

(add `import os` at the top if missing), and in `BridgeTable`, after `add_mappings_batch`:

```python
    async def upsert_mappings_batch(self, mappings: List[Dict[str, Any]]) -> int:
        """Insert or update mappings on (chunk_id, graph_node_urn): re-running an ingestion never duplicates."""
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")
        if not mappings:
            return 0
        upsert_sql = text(f"""
            INSERT INTO {self.config.table_name}
            (chunk_id, graph_node_urn, node_type, relation_type, confidence, chunk_text, source, metadata)
            VALUES (:chunk_id, :graph_node_urn, :node_type, :relation_type, :confidence, :chunk_text, :source, CAST(:metadata AS jsonb))
            ON CONFLICT (chunk_id, graph_node_urn) DO UPDATE SET
                node_type = EXCLUDED.node_type, relation_type = EXCLUDED.relation_type,
                confidence = EXCLUDED.confidence, chunk_text = EXCLUDED.chunk_text,
                source = EXCLUDED.source, metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP
        """)
        async with self._session_maker() as session:
            for m in mappings:
                metadata = m.get("metadata") or m.get("extra_metadata")
                await session.execute(upsert_sql, {
                    "chunk_id": str(m["chunk_id"]),
                    "graph_node_urn": m["graph_node_urn"],
                    "node_type": m["node_type"],
                    "relation_type": m.get("relation_type"),
                    "confidence": m.get("confidence"),
                    "chunk_text": m.get("chunk_text"),
                    "source": m.get("source"),
                    "metadata": json.dumps(metadata) if metadata else None,
                })
            await session.commit()
        return len(mappings)

    async def count_by_source(self, source: str) -> int:
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")
        async with self._session_maker() as session:
            result = await session.execute(
                text(f"SELECT count(*) FROM {self.config.table_name} WHERE source = :source"), {"source": source}
            )
            return int(result.scalar())

    async def delete_by_source(self, source: str) -> int:
        if not self._connected:
            raise RuntimeError("Not connected to PostgreSQL. Call connect() first.")
        async with self._session_maker() as session:
            result = await session.execute(
                text(f"DELETE FROM {self.config.table_name} WHERE source = :source"), {"source": source}
            )
            await session.commit()
            return result.rowcount
```

In `services/merlt/merlt/api/engine_bootstrap.py`, replace the inline `BridgeTableConfig(host=…, …)` with `BridgeTableConfig.from_enrichment_env()`.

- [ ] **Step 4: The bridge's unique index, source index and the missing column (pre-existing bug)**

`expert_affinity` is in the ORM model but not in the live table (seed DDL), so ORM writes from `rlcf/affinity_service.py` fail today; `ON CONFLICT` needs a unique index on `(chunk_id, graph_node_urn)`. Append to `schema_additions._STATEMENTS`, to `006_massimario_ingestion.sql` and to the Alembic revision's `upgrade()` (as `op.execute`):

```python
    # The bridge lives in the same database; guarded because a fresh database
    # gets it from the seed DDL, not from create_tables().
    "DO $$ BEGIN "
    "IF to_regclass('bridge_table') IS NOT NULL THEN "
    "ALTER TABLE bridge_table ADD COLUMN IF NOT EXISTS expert_affinity JSONB; "
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_bridge_chunk_node ON bridge_table (chunk_id, graph_node_urn); "
    "CREATE INDEX IF NOT EXISTS idx_bridge_source ON bridge_table (source); "
    "END IF; END $$",
```

(in the `.sql` file the same block, one statement per line, ending with `END $$;`). `downgrade()` drops `uq_bridge_chunk_node` and `idx_bridge_source` but keeps `expert_affinity` (the ORM expects it).

- [ ] **Step 5: `vectors.py` and the chained job**

```python
# services/merlt/merlt/pipeline/massimario/vectors.py
"""Embed a slice of Massimario chunks, then write their points and bridge rows together.

Points first, bridge rows second: the reader joins the bridge to the points, so
it never meets a row whose point is missing. Both writes are upserts on stable
ids, so a slice can be re-run.
"""
from __future__ import annotations

import asyncio
import os

import structlog

from .volume import SOURCE

log = structlog.get_logger()


def build_qdrant_client():
    from qdrant_client import QdrantClient

    url = os.getenv("QDRANT_URL")
    if url:
        return QdrantClient(url=url)
    return QdrantClient(host=os.getenv("QDRANT_HOST", "localhost"), port=int(os.getenv("QDRANT_PORT", "6333")))


def _ensure_collection(qdrant, collection: str) -> None:
    from qdrant_client import models as qm

    if not qdrant.collection_exists(collection):
        qdrant.create_collection(
            collection_name=collection,
            vectors_config=qm.VectorParams(size=1024, distance=qm.Distance.COSINE),
        )


async def index_chunks(chunks: list[dict], *, embeddings, qdrant, bridge, collection: str) -> int:
    from qdrant_client import models as qm

    if not chunks:
        return 0
    vectors = await embeddings.encode_batch_async([c["vector_text"] for c in chunks], is_query=False)
    points = [qm.PointStruct(id=c["point_id"], vector=v, payload=c["payload"]) for c, v in zip(chunks, vectors)]
    await asyncio.to_thread(_ensure_collection, qdrant, collection)
    await asyncio.to_thread(qdrant.upsert, collection_name=collection, points=points)
    rows = [{**row, "chunk_id": c["point_id"], "source": SOURCE} for c in chunks for row in c["bridge"]]
    await bridge.upsert_mappings_batch(rows)
    log.info("massimario.indexed", points=len(points), bridge_rows=len(rows))
    return len(points)
```

```python
# services/merlt/merlt/worker/massimario_tasks.py
"""RQ task: vectors and bridge rows of a promoted Massimario batch, 100 paragraphs per job.

Chained: each job enqueues the next slice on `merlt_bulk` (listed last by the
worker, so readers' lazy ingestions go first). Progress lives on the batch
(`stats.vectors`). A failed slice stops the chain and records the error; a new
promotion of the batch starts again from 0, and every write is an upsert.

GOTCHA (CLAUDE.md #6): the worker has no FastAPI lifespan, so `init_db()` first.
"""
from __future__ import annotations

import asyncio
import os

import structlog

from merlt.pipeline.massimario.vectors import build_qdrant_client, index_chunks

log = structlog.get_logger()

SLICE = int(os.getenv("MASSIMARIO_EMBED_SLICE", "100"))
QUEUE = "merlt_bulk"


def _bridge():
    from merlt.storage.bridge import BridgeTable, BridgeTableConfig

    return BridgeTable(BridgeTableConfig.from_enrichment_env())


def _embeddings():
    from merlt.storage.vectors.embeddings import EmbeddingService

    return EmbeddingService.get_instance()


def enqueue_index_slice(batch_id: str, start: int) -> None:
    from redis import Redis
    from rq import Queue

    queue = Queue(QUEUE, connection=Redis.from_url(os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1")))
    queue.enqueue(
        "merlt.worker.massimario_tasks.index_slice", batch_id, start,
        job_id=f"mass-vec-{batch_id}-{start}", job_timeout=1800,
    )


async def _run_index_slice(batch_id: str, start: int) -> dict:
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import MerltIngestionBatch
    from merlt.storage.vectors.collection import default_chunks_collection

    await init_db(echo=False)
    async with get_db_session() as session:
        batch = (
            await session.execute(select(MerltIngestionBatch).where(MerltIngestionBatch.id == batch_id))
        ).scalar_one_or_none()
        if batch is None or batch.status != "promoted":
            return {"batch_id": batch_id, "status": "skipped"}
        chunks = (batch.extras or {}).get("chunks") or []
        part = chunks[start:start + SLICE]
        done = min(start + SLICE, len(chunks))
        bridge = _bridge()
        try:
            await bridge.connect()
            await index_chunks(part, embeddings=_embeddings(), qdrant=build_qdrant_client(),
                               bridge=bridge, collection=default_chunks_collection())
        except Exception as e:  # noqa: BLE001 — recorded on the batch, the chain stops
            log.error("massimario.index_slice.failed", batch_id=batch_id, start=start, error=str(e))
            batch.stats = {**(batch.stats or {}), "vectors": {"done": start, "total": len(chunks), "error": str(e)}}
            await session.commit()
            return {"batch_id": batch_id, "status": "failed", "error": str(e)}
        finally:
            await bridge.close()
        batch.stats = {**(batch.stats or {}), "vectors": {"done": done, "total": len(chunks)}}
        await session.commit()
    if done < len(chunks):
        enqueue_index_slice(batch_id, done)
    return {"batch_id": batch_id, "status": "ok", "done": done, "total": len(chunks)}


def index_slice(batch_id: str, start: int = 0) -> dict:
    """RQ task (sync entrypoint)."""
    return asyncio.run(_run_index_slice(batch_id, start))
```

In `_run_promote`, after setting `batch.stats` on success and before `await session.commit()`:

```python
        if batch.source == "massimario":
            total = len((batch.extras or {}).get("chunks") or [])
            batch.stats = {**batch.stats, "vectors": {"done": 0, "total": total}}
```

and after the `async with` block, before the final `log.info`:

```python
    if batch.source == "massimario":
        from merlt.worker.massimario_tasks import enqueue_index_slice

        enqueue_index_slice(batch_id, 0)
```

Extend `test_massimario_promotion_uses_its_own_writer` (Task 10) to patch `merlt.worker.massimario_tasks.enqueue_index_slice` and assert it was called with `("b1", 0)`.

- [ ] **Step 6: Run the tests**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/storage/test_bridge_upsert.py tests/pipeline/test_massimario_vectors.py tests/worker/test_massimario_tasks.py tests/worker/test_mechanical_ingest_massimario.py tests/unit/test_graph_vocabulary_contract.py -q)`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/merlt/merlt/storage/bridge/bridge_table.py services/merlt/merlt/api/engine_bootstrap.py services/merlt/merlt/pipeline/massimario/vectors.py services/merlt/merlt/worker/massimario_tasks.py services/merlt/merlt/worker/mechanical_ingest_tasks.py services/merlt/merlt/storage/enrichment/schema_additions.py services/merlt/merlt/storage/migrations/006_massimario_ingestion.sql services/merlt/alembic/versions/010_massimario_ingestion.py services/merlt/tests/storage/test_bridge_upsert.py services/merlt/tests/pipeline/test_massimario_vectors.py services/merlt/tests/worker/test_massimario_tasks.py services/merlt/tests/worker/test_mechanical_ingest_massimario.py
git commit -m "feat(merlt): chained job writing a Massimario batch's vectors and bridge rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: MERL-T — removing the prose in one operation

**Files:**
- Create: `services/merlt/merlt/scripts/remove_massimario_prose.py`
- Test: `services/merlt/tests/scripts/test_remove_massimario_prose.py`

**Interfaces:**
- Consumes: `count_by_source`, `delete_by_source` (Task 11); `build_qdrant_client`.
- Produces: `remove_prose(*, apply: bool, qdrant, bridge, collection: str) -> {"points": int, "bridge_rows": int, "applied": bool}`; CLI `python -m merlt.scripts.remove_massimario_prose [--apply]`.

- [ ] **Step 1: Write the failing test**

```python
# services/merlt/tests/scripts/test_remove_massimario_prose.py
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.scripts.remove_massimario_prose import remove_prose


def fakes():
    qdrant = MagicMock(count=MagicMock(return_value=SimpleNamespace(count=12)))
    bridge = MagicMock(count_by_source=AsyncMock(return_value=30), delete_by_source=AsyncMock(return_value=30))
    return qdrant, bridge


async def test_dry_run_counts_only():
    qdrant, bridge = fakes()
    assert await remove_prose(apply=False, qdrant=qdrant, bridge=bridge, collection="c") == {
        "points": 12, "bridge_rows": 30, "applied": False,
    }
    qdrant.delete.assert_not_called()
    bridge.delete_by_source.assert_not_awaited()


async def test_apply_deletes_exactly_the_prose():
    qdrant, bridge = fakes()
    await remove_prose(apply=True, qdrant=qdrant, bridge=bridge, collection="c")
    selector = qdrant.delete.call_args.kwargs["points_selector"]
    conditions = {(c.key, c.match.value) for c in selector.filter.must}
    assert conditions == {("source_type", "rassegna"), ("fonte", "Ufficio del Massimario")}
    bridge.delete_by_source.assert_awaited_once_with("massimario")
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/scripts/test_remove_massimario_prose.py -q)`
Expected: FAIL.

- [ ] **Step 3: Write the script**

```python
# services/merlt/merlt/scripts/remove_massimario_prose.py
"""Remove the Massimario's prose from MERL-T's stores in one operation (spec §9).

Deletes the Qdrant points of source_type `rassegna` and fonte `Ufficio del
Massimario`, and the bridge rows of source `massimario`. Decisions, norm stubs
and co-citation edges stay: they are facts. Dry run by default.

    python -m merlt.scripts.remove_massimario_prose            # counts only
    python -m merlt.scripts.remove_massimario_prose --apply    # deletes
"""
from __future__ import annotations

import argparse
import asyncio

from merlt.pipeline.massimario.vectors import build_qdrant_client
from merlt.pipeline.massimario.volume import SOURCE
from merlt.storage.graph.schema import Fonte, SourceType


def _filter():
    from qdrant_client import models as qm

    return qm.Filter(must=[
        qm.FieldCondition(key="source_type", match=qm.MatchValue(value=SourceType.RASSEGNA.value)),
        qm.FieldCondition(key="fonte", match=qm.MatchValue(value=Fonte.MASSIMARIO.value)),
    ])


async def remove_prose(*, apply: bool, qdrant, bridge, collection: str) -> dict:
    from qdrant_client import models as qm

    flt = _filter()
    points = (await asyncio.to_thread(qdrant.count, collection_name=collection, count_filter=flt, exact=True)).count
    rows = await bridge.count_by_source(SOURCE)
    if apply:
        await asyncio.to_thread(qdrant.delete, collection_name=collection, points_selector=qm.FilterSelector(filter=flt))
        await bridge.delete_by_source(SOURCE)
    return {"points": points, "bridge_rows": rows, "applied": apply}


async def _main(apply: bool) -> None:
    from merlt.storage.bridge import BridgeTable, BridgeTableConfig
    from merlt.storage.vectors.collection import default_chunks_collection

    bridge = BridgeTable(BridgeTableConfig.from_enrichment_env())
    await bridge.connect()
    try:
        result = await remove_prose(apply=apply, qdrant=build_qdrant_client(), bridge=bridge,
                                    collection=default_chunks_collection())
    finally:
        await bridge.close()
    verb = "cancellati" if apply else "da cancellare (prova a vuoto; --apply per cancellare)"
    print(f"{result['points']} frammenti e {result['bridge_rows']} collegamenti {verb}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(_main(parser.parse_args(argv).apply))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the test**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/scripts/test_remove_massimario_prose.py -q)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/merlt/merlt/scripts/remove_massimario_prose.py services/merlt/tests/scripts/test_remove_massimario_prose.py
git commit -m "feat(merlt): script that removes the Massimario's prose from the stores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: MERL-T — the reader's endpoint

**Files:**
- Modify: `services/merlt/merlt/storage/bridge/bridge_table.py` (three reads by metadata)
- Create: `services/merlt/merlt/pipeline/massimario/reader.py`
- Create: `services/merlt/merlt/api/rassegne_router.py`
- Modify: `services/merlt/merlt/api/__init__.py:71,102`, `services/merlt/merlt/app.py:68,286`
- Test: `services/merlt/tests/pipeline/test_massimario_reader.py`, `services/merlt/tests/api/test_rassegne_router.py`

**Interfaces:**
- Consumes: bridge rows and point payloads (Tasks 8, 11).
- Produces: `GET /api/v1/rassegne/by-norma?urn=<str>&anno=<int?>&archivio=<civile|penale?>&cursor=<digits?>&limit=<1..50, default 10>` (header `X-API-Key`) →

```json
{
  "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043",
  "total": 14,
  "anni": [{"anno": 2024, "passi": 3}, {"anno": 2016, "passi": 11}],
  "archivi": ["civile"],
  "anno": 2024,
  "items": [{
    "id": "massimario|96|20830|3", "anno": 2024, "archivio": "civile",
    "volume": {"id": 96, "numero": 1, "titolo": "Massimario 2024 CIVILE Vol. 1"},
    "parte": {"nome": "PARTE PRIMA", "titolo": "…"} , "capitolo": {"nome": "CAPITOLO I", "titolo": "…"},
    "sezione": {"id": 20830, "numero": "2", "titolo": "…"}, "autori": ["…"], "url": "https://…#20830",
    "testo": "…", "evidenziazioni": [{"start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": null}],
    "pronunce": [{"key": "cassazione:civile:13319:2024", "label": "Sez. U, n. 13319/2024 · Rv. 671516-02",
                  "corte": "cassazione", "archivio": "civile", "numero": 13319, "anno": 2024, "sezione": "U",
                  "rv": ["671516-02"]}],
    "fonte": "Ufficio del Massimario"
  }],
  "next_cursor": "10"
}
```

  `total: 0` with empty lists when no paragraph cites the URN; `503 {"detail": "rassegne_unavailable"}` when the bridge or Qdrant fails.

- [ ] **Step 1: Write the failing tests**

```python
# services/merlt/tests/pipeline/test_massimario_reader.py
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario.reader import RassegneReader, normalize_reader_urn

URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
OTHER = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


def payload(key, anno, norme):
    return {"paragraph_key": key, "anno": anno, "archivio": "civile", "volume": {"id": 1, "numero": 1, "titolo": "T"},
            "parte": None, "capitolo": None, "sezione": {"id": 2, "numero": "1", "titolo": "S"}, "autori": [],
            "url": "u", "text": "Testo con art. 2043 c.c. e art. 1453 c.c.", "decisioni": [], "fonte": "Ufficio del Massimario",
            "norme": norme}


def reader(pages):
    bridge = MagicMock(
        year_counts_for_node=AsyncMock(return_value={2024: 2, 2016: 1}),
        archives_for_node=AsyncMock(return_value=["civile"]),
        page_for_node=AsyncMock(side_effect=pages),
    )
    points = {
        "p1": payload("k1", 2024, [{"urn": URN, "start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None},
                                   {"urn": OTHER, "start": 27, "end": 41, "citazione": "art. 1453 c.c.", "comma": None}]),
        "p2": payload("k2", 2024, [{"urn": URN, "start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None}]),
    }
    qdrant = MagicMock(retrieve=MagicMock(side_effect=lambda **kw: [SimpleNamespace(id=i, payload=points[i]) for i in kw["ids"] if i in points]))
    return RassegneReader(bridge, qdrant, "c"), bridge


async def test_newest_year_first_with_paging():
    r, bridge = reader([[{"chunk_id": "p1"}, {"chunk_id": "p2"}]])
    out = await r.by_norma(URN, anno=None, archivio=None, offset=0, limit=1)
    assert out["total"] == 3 and out["anno"] == 2024
    assert out["anni"] == [{"anno": 2024, "passi": 2}, {"anno": 2016, "passi": 1}]
    assert [i["id"] for i in out["items"]] == ["k1"] and out["next_cursor"] == "1"
    assert bridge.page_for_node.await_args.kwargs["anno"] == 2024


async def test_reader_lists_only_rows_of_the_requested_urn():
    r, _ = reader([[{"chunk_id": "p1"}]])
    (item,) = (await r.by_norma(URN, anno=2024, archivio=None, offset=0, limit=10))["items"]
    assert item["evidenziazioni"] == [{"start": 10, "end": 24, "citazione": "art. 2043 c.c.", "comma": None}]


async def test_nothing_cited():
    r, bridge = reader([])
    bridge.year_counts_for_node.return_value = {}
    out = await r.by_norma(URN, anno=None, archivio=None, offset=0, limit=10)
    assert out == {"urn": URN, "total": 0, "anni": [], "archivi": [], "anno": None, "items": [], "next_cursor": None}


def test_reader_strips_markers_and_adds_prefix():
    bare = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
    assert normalize_reader_urn(bare + "!vig=2020-01-01") == URN
    assert normalize_reader_urn(URN + "@originale") == URN
    assert normalize_reader_urn(" " + URN + " ") == URN
```

```python
# services/merlt/tests/api/test_rassegne_router.py
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from merlt.api.auth import verify_api_key
from merlt.api.rassegne_router import get_rassegne_reader, router


def client(reader):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[verify_api_key] = lambda: None
    app.dependency_overrides[get_rassegne_reader] = lambda: reader
    return TestClient(app)


def test_passes_the_query_through():
    reader = AsyncMock()
    reader.by_norma.return_value = {"total": 0}
    response = client(reader).get("/api/v1/rassegne/by-norma",
                                  params={"urn": "urn:nir:x", "anno": 2024, "archivio": "penale", "cursor": "20"})
    assert response.status_code == 200
    reader.by_norma.assert_awaited_once_with("urn:nir:x", anno=2024, archivio="penale", offset=20, limit=10)


def test_validates_the_query():
    c = client(AsyncMock())
    assert c.get("/api/v1/rassegne/by-norma").status_code == 422
    assert c.get("/api/v1/rassegne/by-norma", params={"urn": "u", "archivio": "misto"}).status_code == 422
    assert c.get("/api/v1/rassegne/by-norma", params={"urn": "u", "cursor": "-1"}).status_code == 422


def test_store_failure_is_503():
    reader = AsyncMock()
    reader.by_norma.side_effect = RuntimeError("qdrant down")
    response = client(reader).get("/api/v1/rassegne/by-norma", params={"urn": "u"})
    assert response.status_code == 503 and response.json() == {"detail": "rassegne_unavailable"}
```

Check that `verify_api_key` is importable from `merlt.api.auth` (it is what `graph_router.py` depends on); if it lives elsewhere, import it from there in both the router and the test.

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline/test_massimario_reader.py tests/api/test_rassegne_router.py -q)`
Expected: FAIL.

- [ ] **Step 3: Bridge reads**

In `BridgeTable`, after `get_chunks_for_node`:

```python
    _PRIMARY = "coalesce((metadata->>'piece')::int, 0) = 0"

    async def year_counts_for_node(self, graph_node_urn: str, *, source: str, relation_type: str,
                                   archivio: Optional[str] = None) -> Dict[int, int]:
        """{year: rows} of the whole-paragraph rows linking `graph_node_urn` (pieces > 0 excluded)."""
        sql = (f"SELECT (metadata->>'anno')::int AS anno, count(*) FROM {self.config.table_name} "
               f"WHERE graph_node_urn = :urn AND source = :source AND relation_type = :rel AND {self._PRIMARY}"
               + (" AND metadata->>'archivio' = :archivio" if archivio else "") + " GROUP BY 1")
        params = {"urn": graph_node_urn, "source": source, "rel": relation_type, "archivio": archivio}
        async with self._session_maker() as session:
            rows = (await session.execute(text(sql), params)).fetchall()
        return {int(r[0]): int(r[1]) for r in rows if r[0] is not None}

    async def archives_for_node(self, graph_node_urn: str, *, source: str, relation_type: str) -> List[str]:
        sql = (f"SELECT DISTINCT metadata->>'archivio' FROM {self.config.table_name} "
               f"WHERE graph_node_urn = :urn AND source = :source AND relation_type = :rel AND {self._PRIMARY}")
        async with self._session_maker() as session:
            rows = (await session.execute(text(sql), {"urn": graph_node_urn, "source": source, "rel": relation_type})).fetchall()
        return sorted(r[0] for r in rows if r[0])

    async def page_for_node(self, graph_node_urn: str, *, source: str, relation_type: str, anno: int,
                            archivio: Optional[str] = None, limit: int = 10, offset: int = 0) -> List[Dict[str, Any]]:
        sql = (f"SELECT chunk_id, metadata FROM {self.config.table_name} "
               f"WHERE graph_node_urn = :urn AND source = :source AND relation_type = :rel AND {self._PRIMARY} "
               f"AND (metadata->>'anno')::int = :anno"
               + (" AND metadata->>'archivio' = :archivio" if archivio else "")
               + " ORDER BY (metadata->>'ordine')::bigint LIMIT :limit OFFSET :offset")
        params = {"urn": graph_node_urn, "source": source, "rel": relation_type, "anno": anno,
                  "archivio": archivio, "limit": limit, "offset": offset}
        async with self._session_maker() as session:
            rows = (await session.execute(text(sql), params)).fetchall()
        return [{"chunk_id": str(r[0]), "metadata": r[1]} for r in rows]
```

- [ ] **Step 4: The reader and the router**

```python
# services/merlt/merlt/pipeline/massimario/reader.py
"""Paragraphs of the reviews that cite a norm, grouped by year (spec §7).

An exact join, no semantic search: bridge rows of relation CITA_NORMA for the
URN (whole paragraphs only), newest year first, then the points' payloads by id.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from merlt.storage.graph.schema import canonical_urn

from .urns import NORMATTIVA_PREFIX
from .volume import BRIDGE_REL_NORMA, SOURCE


def normalize_reader_urn(urn: str) -> str:
    urn = canonical_urn((urn or "").strip())
    return NORMATTIVA_PREFIX + urn if urn.startswith("urn:nir:") else urn


def _item(payload: dict, urn: str) -> dict:
    return {
        "id": payload["paragraph_key"], "anno": payload["anno"], "archivio": payload["archivio"],
        "volume": payload["volume"], "parte": payload.get("parte"), "capitolo": payload.get("capitolo"),
        "sezione": payload["sezione"], "autori": payload.get("autori", []), "url": payload["url"],
        "testo": payload["text"],
        "evidenziazioni": [
            {"start": n["start"], "end": n["end"], "citazione": n["citazione"], "comma": n.get("comma")}
            for n in payload.get("norme", []) if n["urn"] == urn
        ],
        "pronunce": payload.get("decisioni", []),
        "fonte": payload["fonte"],
    }


class RassegneReader:
    def __init__(self, bridge, qdrant, collection: str) -> None:
        self.bridge, self.qdrant, self.collection = bridge, qdrant, collection

    async def by_norma(self, urn: str, *, anno: Optional[int], archivio: Optional[str],
                       offset: int, limit: int) -> dict:
        urn = normalize_reader_urn(urn)
        filters = {"source": SOURCE, "relation_type": BRIDGE_REL_NORMA}
        counts = await self.bridge.year_counts_for_node(urn, archivio=archivio, **filters)
        if not counts:
            return {"urn": urn, "total": 0, "anni": [], "archivi": [], "anno": None, "items": [], "next_cursor": None}
        archivi = await self.bridge.archives_for_node(urn, **filters)
        years = sorted(counts, reverse=True)
        target = anno if anno in counts else years[0]
        rows = await self.bridge.page_for_node(urn, anno=target, archivio=archivio, limit=limit + 1, offset=offset, **filters)
        page = rows[:limit]
        points = await asyncio.to_thread(
            self.qdrant.retrieve, collection_name=self.collection,
            ids=[r["chunk_id"] for r in page], with_payload=True, with_vectors=False,
        )
        payloads = {str(p.id): p.payload for p in points}
        return {
            "urn": urn,
            "total": sum(counts.values()),
            "anni": [{"anno": y, "passi": counts[y]} for y in years],
            "archivi": archivi,
            "anno": target,
            "items": [_item(payloads[r["chunk_id"]], urn) for r in page if r["chunk_id"] in payloads],
            "next_cursor": str(offset + limit) if len(rows) > limit else None,
        }
```

```python
# services/merlt/merlt/api/rassegne_router.py
"""GET /api/v1/rassegne/by-norma — the paragraphs of the Massimario's reviews citing a norm."""
from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey
from merlt.pipeline.massimario.reader import RassegneReader

log = structlog.get_logger()

router = APIRouter(prefix="/rassegne", tags=["rassegne"])
_reader: Optional[RassegneReader] = None


async def get_rassegne_reader() -> RassegneReader:
    global _reader
    if _reader is None:
        from merlt.pipeline.massimario.vectors import build_qdrant_client
        from merlt.storage.bridge import BridgeTable, BridgeTableConfig
        from merlt.storage.vectors.collection import default_chunks_collection

        bridge = BridgeTable(BridgeTableConfig.from_enrichment_env())
        try:
            await bridge.connect()
        except Exception as exc:  # noqa: BLE001
            log.error("rassegne.bridge_unavailable", error=str(exc))
            raise HTTPException(status_code=503, detail="rassegne_unavailable") from exc
        _reader = RassegneReader(bridge, build_qdrant_client(), default_chunks_collection())
    return _reader


@router.get("/by-norma")
async def by_norma(
    urn: str = Query(..., min_length=1, max_length=500),
    anno: Optional[int] = Query(None, ge=1900, le=2100),
    archivio: Optional[str] = Query(None, pattern="^(civile|penale)$"),
    cursor: Optional[str] = Query(None, pattern=r"^\d{1,6}$"),
    limit: int = Query(10, ge=1, le=50),
    reader: RassegneReader = Depends(get_rassegne_reader),
    api_key: ApiKey = Depends(verify_api_key),
) -> dict:
    try:
        return await reader.by_norma(urn, anno=anno, archivio=archivio, offset=int(cursor or 0), limit=limit)
    except Exception as exc:  # noqa: BLE001 — a store down is a 503, never a 500 with internals
        log.error("rassegne.by_norma_failed", error=str(exc))
        raise HTTPException(status_code=503, detail="rassegne_unavailable") from exc
```

Mount it: in `services/merlt/merlt/api/__init__.py` add `from merlt.api.rassegne_router import router as rassegne_router` and `"rassegne_router"` in `__all__`; in `services/merlt/merlt/app.py` import it with the others (line ~68) and add after the mechanical router (line ~286):

```python
app.include_router(rassegne_router, prefix="/api/v1", tags=["rassegne"])
```

- [ ] **Step 5: Run the tests and the MERL-T unit suites touched**

Run: `(cd services/merlt && .venv/bin/python -m pytest tests/pipeline tests/worker tests/scripts tests/storage/test_bridge_upsert.py tests/api/test_rassegne_router.py tests/unit -q)`
Expected: PASS.

- [ ] **Step 6: Commit and open pull request 3**

```bash
git add services/merlt/merlt/storage/bridge/bridge_table.py services/merlt/merlt/pipeline/massimario/reader.py services/merlt/merlt/api/rassegne_router.py services/merlt/merlt/api/__init__.py services/merlt/merlt/app.py services/merlt/tests/pipeline/test_massimario_reader.py services/merlt/tests/api/test_rassegne_router.py
git commit -m "feat(merlt): endpoint listing the review paragraphs that cite a norm, by year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Open pull request 3 (`feat/massimario-ingestion` → `develop`). In its description, tell the other developer: MERL-T's Postgres gains `merlt_ingestion_batches.extras`, a wider `check_batch_source`, `bridge_table.expert_affinity` (missing until now), and two bridge indexes — idempotent, applied at boot.

---
### Task 14: BFF — the reader's route, and the new source for the admin

Branch: `feat/massimario-reader` from `develop` (after pull request 3). Tasks 14–16 commit here.

**Files:**
- Create: `apps/server/src/services/merlt/rassegneTypes.ts`
- Modify: `apps/server/src/services/merlt/graphClient.ts` (method `rassegneByNorma`)
- Create: `apps/server/src/routes/merlt/rassegne.ts`
- Modify: `apps/server/src/routes/merlt/index.ts` (mount after `expertsRouter`, before the pathless-auth routers)
- Modify: `apps/server/src/schemas/merlt/opsIngestion.ts:15`, `apps/server/src/services/merlt/opsIngestionClient.ts:30`
- Modify: `docs/merlt/claude-notes.md` (route table)
- Test: `apps/server/tests/integration/merlt/rassegne-routes.test.ts`

**Interfaces:**
- Consumes: MERL-T `GET /api/v1/rassegne/by-norma` (Task 13).
- Produces: `GET /api/merlt/rassegne?urn=<string ≤500>&anno=<1900..2100?>&archivio=<civile|penale?>&cursor=<1–6 digits?>` (authenticated) → MERL-T's body verbatim; `400 {detail: 'invalid_query', issues}`; `401` without a token; `503 {detail: 'merlt_unavailable'}` on any MERL-T failure. Types `RassegneResponse`, `RassegnePasso`, `RassegnaPronuncia`, `RassegneQuery` (exported from `rassegneTypes.ts`). Ops source `'massimario'`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/tests/integration/merlt/rassegne-routes.test.ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { app, authHeader, createTestUser, request } from '../../helpers';
import { _resetRassegneClientForTests } from '../../../src/routes/merlt/rassegne';

const BASE = 'http://merlt-test.local:8000';
const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';
const EMPTY = { urn: URN, total: 0, anni: [], archivi: [], anno: null, items: [], next_cursor: null };

describe('GET /api/merlt/rassegne', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(() => {
    process.env.MERLT_API_URL = BASE;
    process.env.MERLT_TIMEOUT_MS = '500';
    process.env.MERLT_API_KEY = 'test-rassegne-key';
    _resetRassegneClientForTests();
    if (!nock.isActive()) nock.activate();
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
  });
  beforeEach(async () => {
    user = await createTestUser('rassegne-reader');
  });
  afterEach(() => nock.cleanAll());

  it('normalises version markers before calling MERL-T', async () => {
    let apiKey: string | undefined;
    nock(BASE)
      .get('/api/v1/rassegne/by-norma')
      .query((q) => q.urn === URN && q.anno === '2024' && q.archivio === 'civile' && q.cursor === '10')
      .reply(function () {
        apiKey = this.req.headers['x-api-key'] as string | undefined;
        return [200, EMPTY];
      });
    const res = await request(app)
      .get('/api/merlt/rassegne')
      .query({ urn: `${URN}!vig=2020-01-01`, anno: 2024, archivio: 'civile', cursor: '10' })
      .set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMPTY);
    expect(apiKey).toBe('test-rassegne-key');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN });
    expect(res.status).toBe(401);
  });

  it.each([
    [{}],
    [{ urn: URN, archivio: 'misto' }],
    [{ urn: URN, cursor: 'abc' }],
    [{ urn: URN, anno: '20x4' }],
    [{ urn: 'x'.repeat(501) }],
  ])('rejects a bad query %j', async (query) => {
    const res = await request(app).get('/api/merlt/rassegne').query(query).set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('invalid_query');
  });

  it('maps a network failure to 503', async () => {
    nock(BASE).get('/api/v1/rassegne/by-norma').query(true).replyWithError({ code: 'ECONNREFUSED', message: 'down' });
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN }).set(authHeader(user));
    expect(res.status).toBe(503);
    expect(res.body.detail).toBe('merlt_unavailable');
  });

  it('never lets an upstream 401 through', async () => {
    nock(BASE).get('/api/v1/rassegne/by-norma').query(true).reply(401, { detail: 'bad key' });
    const res = await request(app).get('/api/merlt/rassegne').query({ urn: URN }).set(authHeader(user));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/server test -- tests/integration/merlt/rassegne-routes.test.ts`
Expected: FAIL — cannot resolve `src/routes/merlt/rassegne`.

- [ ] **Step 3: Types and client method**

```ts
// apps/server/src/services/merlt/rassegneTypes.ts
/**
 * MERL-T GET /api/v1/rassegne/by-norma, proxied verbatim (snake_case as MERL-T emits it):
 * the paragraphs of the Massimario's annual reviews that cite a norm, grouped by year.
 */
export interface RassegnaPronuncia {
  key: string | null;
  label: string;
  corte: string;
  archivio: string | null;
  numero: number;
  anno: number | null;
  sezione: string | null;
  rv: string[];
}

export interface RassegnaEvidenziazione {
  start: number;
  end: number;
  citazione: string;
  comma: string | null;
}

export interface RassegnePasso {
  id: string;
  anno: number;
  archivio: string;
  volume: { id: number; numero: number | null; titolo: string };
  parte: { nome: string; titolo: string } | null;
  capitolo: { nome: string; titolo: string } | null;
  sezione: { id: number; numero: string; titolo: string };
  autori: string[];
  url: string;
  testo: string;
  evidenziazioni: RassegnaEvidenziazione[];
  pronunce: RassegnaPronuncia[];
  fonte: string;
}

export interface RassegneResponse {
  urn: string;
  total: number;
  anni: { anno: number; passi: number }[];
  archivi: string[];
  anno: number | null;
  items: RassegnePasso[];
  next_cursor: string | null;
}

export interface RassegneQuery {
  urn: string;
  anno?: number;
  archivio?: 'civile' | 'penale';
  cursor?: string;
}
```

In `apps/server/src/services/merlt/graphClient.ts`, import the types and add to the client class (read the class first: use its private `request<T>(method, path)` exactly as `searchEntities` does):

```ts
  /** GET /api/v1/rassegne/by-norma — review paragraphs citing a norm; version markers stripped. */
  async rassegneByNorma(query: RassegneQuery): Promise<RassegneResponse> {
    const params = new URLSearchParams({ urn: normalizeGraphUrn(query.urn) });
    if (query.anno !== undefined) params.set('anno', String(query.anno));
    if (query.archivio) params.set('archivio', query.archivio);
    if (query.cursor) params.set('cursor', query.cursor);
    return this.request<RassegneResponse>('GET', `/api/v1/rassegne/by-norma?${params.toString()}`);
  }
```

- [ ] **Step 4: The route and its mount**

```ts
// apps/server/src/routes/merlt/rassegne.ts
/**
 * GET /api/merlt/rassegne — the Massimario's review paragraphs citing an article (reader panel).
 *
 * Read-only, every authenticated user (the reader's panel, not a graph view), no consent needed
 * (nothing is recorded about the reader). Any MERL-T failure becomes 503 merlt_unavailable: an
 * upstream 401 must never reach the web client's refresh interceptor (same reasoning as
 * opsIngestion.ts).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { createGraphClient } from '../../services/merlt/graphClient';
import { MerltClientError } from '../../services/merlt/merltClient';

const querySchema = z.object({
  urn: z.string().trim().min(1).max(500),
  anno: z.coerce.number().int().min(1900).max(2100).optional(),
  archivio: z.enum(['civile', 'penale']).optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
});

let client: ReturnType<typeof createGraphClient> | null = null;
function rassegneClient(): ReturnType<typeof createGraphClient> {
  client ??= createGraphClient();
  return client;
}
export function _resetRassegneClientForTests(): void {
  client = null;
}

const router = Router();

router.get('/rassegne', authenticate, async (req: Request, res: Response): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_query', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await rassegneClient().rassegneByNorma(parsed.data));
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

export default router;
```

Copy the `authenticate` import path and the router export style from `apps/server/src/routes/merlt/graph.ts` if they differ.

In `apps/server/src/routes/merlt/index.ts`, import it and mount it right after `expertsRouter`:

```ts
// Massimario reviews for the reader's panel. Per-route auth → order-safe; before the
// catch-all auth routers (gotcha #1). Not behind a sub-flag: it is reading, not the graph view.
router.use('/', rassegneRouter);
```

and add `/rassegne` to the header comment's route list.

- [ ] **Step 5: The ops source name**

`apps/server/src/schemas/merlt/opsIngestion.ts`: `source: z.enum(['visualex_tree', 'italia_corpus', 'massimario']),`
`apps/server/src/services/merlt/opsIngestionClient.ts`: `source: 'visualex_tree' | 'italia_corpus' | 'massimario';`

Add to the existing ops ingestion route tests one case that a `massimario` run is forwarded (copy the `visualex_tree` run test and change the source).

- [ ] **Step 6: Docs**

In `docs/merlt/claude-notes.md`, route table: a row `GET /api/merlt/rassegne → GET /api/v1/rassegne/by-norma` (authenticated, ungated, 503 on any MERL-T failure).

- [ ] **Step 7: Run the server suite and build**

Run: `npm --prefix apps/server test && npm --prefix apps/server run build`
Expected: PASS, build clean.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/merlt/rassegneTypes.ts apps/server/src/services/merlt/graphClient.ts apps/server/src/routes/merlt/rassegne.ts apps/server/src/routes/merlt/index.ts apps/server/src/schemas/merlt/opsIngestion.ts apps/server/src/services/merlt/opsIngestionClient.ts apps/server/tests docs/merlt/claude-notes.md
git commit -m "feat(server): proxy route for the Massimario review paragraphs citing an article

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Web — running a volume and reading its report (admin)

**Files:**
- Modify: `apps/web/src/features/merlt/ops/ingestion/types.ts` (source, report, progress types)
- Modify: `apps/web/src/features/merlt/ops/ingestion/IngestionRunForm.tsx:13-16,74`
- Modify: `apps/web/src/features/merlt/ops/ingestion/BatchListTable.tsx:6-9`
- Create: `apps/web/src/features/merlt/ops/ingestion/MassimarioReportPanel.tsx`
- Modify: `apps/web/src/features/merlt/ops/ingestion/BatchDetailPanel.tsx:92`
- Test: `apps/web/src/features/merlt/ops/ingestion/__tests__/MassimarioReportPanel.test.tsx`

**Interfaces:**
- Consumes: batch `conflict_report.massimario` and `stats.vectors` (Tasks 8, 9, 11).
- Produces: `IngestionSource` includes `'massimario'`; `MassimarioReport`, `VectorProgress` types; `<MassimarioReportPanel report vectors />`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/features/merlt/ops/ingestion/__tests__/MassimarioReportPanel.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MassimarioReportPanel } from '../MassimarioReportPanel';
import type { MassimarioReport } from '../types';

const REPORT: MassimarioReport = {
  volume: { id: 96, titolo: 'Massimario 2024 CIVILE Vol. 1', anno: 2024, archivio: 'civile', numero: 1 },
  paragrafi: 1325,
  frammenti: 1360,
  citazioni: {
    rv_totali: 1208, rv_riconosciute: 1190, copertura_pct: 98.5,
    per_forma: { slash: 900 }, senza_identita: { archivio_ignoto: 2 },
    non_riconosciute: ['<b>testo</b> (Rv. 251820)'],
  },
  pronunce: { totali: 980, anno_implicito: 3, chiavi_con_piu_sezioni: [], gia_nel_grafo: 12 },
  norme: {
    riferimenti: 1138, articoli: 400, atti: 120, stub: 520, date_completate: 300, non_risolte: 2,
    partizioni: 5, campioni_non_risolti: [], gia_nel_grafo: 210,
  },
  sezioni_fuori_capitolo: 0,
};

describe('MassimarioReportPanel', () => {
  it('shows the coverage and the counts', () => {
    render(<MassimarioReportPanel report={REPORT} />);
    expect(screen.getByText(/98,5%/)).toBeInTheDocument();
    expect(screen.getByText(/1\.190 su 1\.208/)).toBeInTheDocument();
    expect(screen.getByText(/Massimario 2024 CIVILE Vol\. 1/)).toBeInTheDocument();
    expect(screen.queryByText(/sotto la soglia/)).not.toBeInTheDocument();
  });

  it('warns below 95%', () => {
    render(<MassimarioReportPanel report={{ ...REPORT, citazioni: { ...REPORT.citazioni, copertura_pct: 93.1 } }} />);
    expect(screen.getByText(/sotto la soglia del 95%/)).toBeInTheDocument();
  });

  it('renders samples as text', () => {
    const { container } = render(<MassimarioReportPanel report={REPORT} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>testo</b> (Rv. 251820)')).toBeInTheDocument();
  });

  it('shows the vector progress and its error', () => {
    render(<MassimarioReportPanel report={REPORT} vectors={{ done: 300, total: 1360, error: 'qdrant down' }} />);
    expect(screen.getByText(/300 su 1\.360/)).toBeInTheDocument();
    expect(screen.getByText(/qdrant down/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix apps/web run test -- --run src/features/merlt/ops/ingestion/__tests__/MassimarioReportPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Types**

In `types.ts`:

```ts
export type IngestionSource = 'visualex_tree' | 'italia_corpus' | 'massimario';

/** `conflict_report.massimario` of a Massimario batch (MERL-T pipeline/massimario/volume.py). */
export interface MassimarioReport {
  volume: { id: number; titolo: string; anno: number; archivio: string; numero: number | null };
  paragrafi: number;
  frammenti: number;
  citazioni: {
    rv_totali: number;
    rv_riconosciute: number;
    copertura_pct: number | null;
    per_forma: Record<string, number>;
    senza_identita: Record<string, number>;
    non_riconosciute: string[];
  };
  pronunce: {
    totali: number;
    anno_implicito: number;
    chiavi_con_piu_sezioni: { key: string; sezioni: string[] }[];
    gia_nel_grafo: number | null;
  };
  norme: {
    riferimenti: number;
    articoli: number;
    atti: number;
    stub: number;
    date_completate: number;
    non_risolte: number;
    partizioni: number;
    campioni_non_risolti: string[];
    gia_nel_grafo: number | null;
  };
  sezioni_fuori_capitolo: number;
}

/** `stats.vectors` of a promoted Massimario batch. */
export interface VectorProgress {
  done: number;
  total: number;
  error?: string;
}
```

and in `ConflictReport` add `massimario?: MassimarioReport;`.

- [ ] **Step 4: The panel**

```tsx
// apps/web/src/features/merlt/ops/ingestion/MassimarioReportPanel.tsx
import type { MassimarioReport, VectorProgress } from './types';

const n = (value: number | null | undefined): string => (value ?? 0).toLocaleString('it-IT');
const pct = (value: number | null): string =>
  value === null ? '—' : `${value.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;

export interface MassimarioReportPanelProps {
  report: MassimarioReport;
  vectors?: VectorProgress;
}

/** The report of a Massimario batch: what the administrator reads before promoting it. */
export function MassimarioReportPanel({ report, vectors }: MassimarioReportPanelProps) {
  const { citazioni, pronunce, norme } = report;
  const below = citazioni.copertura_pct !== null && citazioni.copertura_pct < 95;
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
      <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Rapporto del volume</h4>
      <p className="text-slate-700 dark:text-slate-300">{report.volume.titolo}</p>
      <p className={below ? 'text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
        Copertura delle citazioni: {pct(citazioni.copertura_pct)} ({n(citazioni.rv_riconosciute)} su{' '}
        {n(citazioni.rv_totali)} Rv.){below && ' — sotto la soglia del 95%'}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600 dark:text-slate-400">
        <dt>Paragrafi</dt><dd>{n(report.paragrafi)} ({n(report.frammenti)} frammenti)</dd>
        <dt>Pronunce</dt><dd>{n(pronunce.totali)} (già nel grafo: {n(pronunce.gia_nel_grafo)}; anno sottinteso: {n(pronunce.anno_implicito)})</dd>
        <dt>Norme citate</dt><dd>{n(norme.riferimenti)} rinvii · {n(norme.articoli)} articoli · {n(norme.atti)} atti</dd>
        <dt>Date completate</dt><dd>{n(norme.date_completate)}</dd>
        <dt>Non risolte</dt><dd>{n(norme.non_risolte)} (partizioni: {n(norme.partizioni)})</dd>
        <dt>Sezioni fuori capitolo</dt><dd>{n(report.sezioni_fuori_capitolo)}</dd>
      </dl>
      {citazioni.non_riconosciute.length > 0 && (
        <details>
          <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Citazioni non riconosciute (esempi)</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-500">
            {citazioni.non_riconosciute.map((sample, i) => <li key={i}>{sample}</li>)}
          </ul>
        </details>
      )}
      {vectors && (
        <p className="text-slate-600 dark:text-slate-400">
          Vettori: {n(vectors.done)} su {n(vectors.total)}
          {vectors.error && <span className="text-amber-700 dark:text-amber-400"> — errore: {vectors.error}</span>}
        </p>
      )}
    </section>
  );
}
```

In `BatchDetailPanel.tsx`, after the `ConflictReportPanel` line:

```tsx
            {batch.conflict_report?.massimario && (
              <MassimarioReportPanel
                report={batch.conflict_report.massimario}
                vectors={batch.stats?.vectors as VectorProgress | undefined}
              />
            )}
```

with `import { MassimarioReportPanel } from './MassimarioReportPanel';` and `VectorProgress` added to the type import from `./types` (the conflict panel shows only empty lists for a Massimario batch: keep it, it confirms there is nothing to force). In `IngestionRunForm.tsx`, add to `SOURCE_HINTS`:

```ts
  massimario: 'JSON con l\'id del volume sul Portale del Massimario, es. {"volume":96}. Un volume per lotto.',
```

and the option `<option value="massimario">Massimario (rassegne)</option>`; in `BatchListTable.tsx`, `massimario: 'Massimario',` in `SOURCE_LABELS`. `useBatchPoll` keeps polling only `parsing`/`promoting`: after promotion the vectors run in the background, so the detail panel shows their progress on each manual refresh.

- [ ] **Step 5: Run the tests, lint, build**

Run: `npm --prefix apps/web run test -- --run src/features/merlt/ops && npm --prefix apps/web run lint && npm --prefix apps/web run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/merlt/ops/ingestion
git commit -m "feat(web): run a Massimario volume from the admin and read its report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Web — the reader's panel

**Files:**
- Create: `apps/web/src/utils/decisionLinks.ts` (or extend it, see Step 3) + `apps/web/src/utils/__tests__/decisionLinks.test.ts`
- Create: `apps/web/src/features/merlt/rassegne/types.ts`
- Create: `apps/web/src/features/merlt/rassegne/rassegneApi.ts`
- Create: `apps/web/src/features/merlt/rassegne/useRassegne.ts`
- Create: `apps/web/src/features/merlt/rassegne/RassegnePanel.tsx`
- Create: `apps/web/src/features/merlt/rassegne/RassegnaPassage.tsx`
- Create: `apps/web/src/features/merlt/rassegne/DecisionChip.tsx`
- Modify: `apps/web/src/plugins/registry.tsx:17-39`, `apps/web/src/plugins/__tests__/registry.test.tsx:36,37,44,92`
- Test: `apps/web/src/features/merlt/rassegne/__tests__/RassegnePanel.test.tsx`, `apps/web/src/features/merlt/rassegne/__tests__/useRassegne.test.ts`

**Interfaces:**
- Consumes: `GET /api/merlt/rassegne` (Task 14); `getMerlt<T>(url, params)` from `apps/web/src/services/merltService.ts`.
- Produces: `RassegnePanel({ articleUrn })` registered in `article_content_after` (flag `VITE_FEATURE_MERLT`); `loadRassegne(query) -> Promise<RassegneResponse>` (session cache, in-flight dedupe); `useRassegneSummary(urn, archivio)`; from the shared `decisionLinks.ts`: `DECISION_PAGE_AVAILABLE`, `LooseDecisionRef`, `linkableDecisionPath(raw, now?)`.

- [ ] **Step 1: The shared `decisionLinks.ts` (agreed with the sentenze round on 1 October)**

The sentenze round's plan (`docs/superpowers/plans/2026-10-01-sentenze.md`, Task 7 creates the file, Task 8 flips the flag) and this task write the same block, verbatim, whichever ships first. If `apps/web/src/utils/decisionLinks.ts` already exists on `develop`, import from it and do not write the file or its tests. If it does not, write exactly the block of Step 3; the sentenze round then adds its strict part below it. Never export `decisionPath` or `DecisionRef` from this file: those names belong to the sentenze round's strict part (`decisionPath(ref: DecisionReference): string`, types in `apps/web/src/types/decisions.ts`). The panel's chips use `linkableDecisionPath`, which needs no canonical key: archive + number + year is the identity.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/web/src/utils/__tests__/decisionLinks.test.ts
import { describe, expect, it } from 'vitest';
import { DECISION_PAGE_AVAILABLE, linkableDecisionPath } from '../decisionLinks';

const NOW = new Date('2026-10-01T00:00:00Z');

describe('linkableDecisionPath', () => {
  it('archive known: the identity path, no section', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: 'civile', numero: 13319, anno: 2024, sezione: 'U' }, NOW))
      .toBe('/sentenze/cassazione-civile/13319/2024');
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: 'penale', numero: 1399, anno: 2000 }, NOW))
      .toBe('/sentenze/cassazione-penale/1399/2000');
    expect(linkableDecisionPath({ corte: 'corte_costituzionale', numero: 1, anno: 2014 }, NOW))
      .toBe('/sentenze/corte-costituzionale/1/2014');
  });

  it('archive unknown: the section as written, URL-encoded', () => {
    expect(linkableDecisionPath({ corte: 'cassazione', archivio: null, numero: 15, anno: 2019, sezione: ' 6-3 ' }, NOW))
      .toBe('/sentenze/cassazione/15/2019?sezione=6-3');
    expect(linkableDecisionPath({ corte: 'cassazione', numero: 15, anno: 2019, sezione: 'VI - 1' }, NOW))
      .toBe('/sentenze/cassazione/15/2019?sezione=VI%20-%201');
  });

  it.each([
    [{ corte: 'tar', numero: 15, anno: 2019 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 15, anno: null }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 0, anno: 2019 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 1_000_000, anno: 2019 }],
    [{ corte: 'corte_costituzionale', numero: 1, anno: 1950 }],
    [{ corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2027 }],
  ])('no link for %j', (raw) => {
    expect(linkableDecisionPath(raw, NOW)).toBeNull();
  });

  it('the decision page does not exist yet', () => {
    expect(DECISION_PAGE_AVAILABLE).toBe(false);
  });
});
```

```ts
// apps/web/src/features/merlt/rassegne/__tests__/useRassegne.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearRassegneCacheForTests, loadRassegne } from '../useRassegne';

const fetchRassegne = vi.fn();
vi.mock('../rassegneApi', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args) }));

describe('loadRassegne', () => {
  beforeEach(() => {
    _clearRassegneCacheForTests();
    fetchRassegne.mockReset();
  });

  it('dedupes concurrent loads of the same query', async () => {
    fetchRassegne.mockResolvedValue({ total: 0 });
    await Promise.all([loadRassegne({ urn: 'u' }), loadRassegne({ urn: 'u' })]);
    expect(fetchRassegne).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so it can be retried', async () => {
    fetchRassegne.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ total: 0 });
    await expect(loadRassegne({ urn: 'u' })).rejects.toThrow('down');
    await expect(loadRassegne({ urn: 'u' })).resolves.toEqual({ total: 0 });
  });
});
```

```tsx
// apps/web/src/features/merlt/rassegne/__tests__/RassegnePanel.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RassegnePanel } from '../RassegnePanel';
import { _clearRassegneCacheForTests } from '../useRassegne';
import type { RassegnePasso, RassegneResponse } from '../types';

const fetchRassegne = vi.fn();
vi.mock('../rassegneApi', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args) }));

const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043';

function passo(id: string, anno: number, testo = 'Secondo l\'art. 2043 c.c. il danno deve essere ingiusto.'): RassegnePasso {
  return {
    id, anno, archivio: 'civile',
    volume: { id: 96, numero: 1, titolo: `Massimario ${anno} CIVILE Vol. 1` },
    parte: { nome: 'PARTE PRIMA', titolo: 'I DIRITTI' },
    capitolo: { nome: 'CAPITOLO I', titolo: 'LA RESPONSABILITÀ' },
    sezione: { id: 9111, numero: '2', titolo: 'Il danno.' },
    autori: ['Anna Rossi'],
    url: 'https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali/96/dettaglio.do#9111',
    testo,
    evidenziazioni: testo.includes('art. 2043 c.c.')
      ? [{ start: testo.indexOf('art. 2043 c.c.'), end: testo.indexOf('art. 2043 c.c.') + 14, citazione: 'art. 2043 c.c.', comma: null }]
      : [],
    pronunce: [{ key: 'cassazione:civile:1234:2024', label: 'Sez. U, n. 1234/2024 · Rv. 670001-01', corte: 'cassazione',
                 archivio: 'civile', numero: 1234, anno: 2024, sezione: 'U', rv: ['670001-01'] }],
    fonte: 'Ufficio del Massimario',
  };
}

const SUMMARY: RassegneResponse = {
  urn: URN, total: 3, anni: [{ anno: 2024, passi: 2 }, { anno: 2016, passi: 1 }], archivi: ['civile'],
  anno: 2024, items: [passo('a', 2024)], next_cursor: '1',
};

function renderPanel() {
  return render(<MemoryRouter><RassegnePanel articleUrn={URN} /></MemoryRouter>);
}

async function openPanel() {
  const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
  fireEvent.click(row);
}

describe('RassegnePanel', () => {
  beforeEach(() => {
    _clearRassegneCacheForTests();
    fetchRassegne.mockReset();
  });

  it('renders nothing when no paragraph cites the article', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, total: 0, anni: [], items: [], anno: null, next_cursor: null });
    const { container } = renderPanel();
    await waitFor(() => expect(fetchRassegne).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is a closed row with the count and the years', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Nelle rassegne della Cassazione')).toBeInTheDocument();
    expect(screen.getByText('3 passi, 2016–2024')).toBeInTheDocument();
    expect(screen.queryByText("Rassegna dell'anno 2024")).not.toBeInTheDocument();
  });

  it('opens with the keyboard on the newest year', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    const row = await screen.findByRole('button', { name: /Espandi le rassegne della Cassazione/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByText("Rassegna dell'anno 2024")).toBeInTheDocument();
    expect(screen.getByText(/Rassegna civile 2024 · vol\. 1 › CAPITOLO I › § 2 Il danno\./)).toBeInTheDocument();
    expect(screen.getByText('di Anna Rossi')).toBeInTheDocument();
    const mark = screen.getByText('art. 2043 c.c.');
    expect(mark.tagName).toBe('MARK');
  });

  it('shows decisions as plain labels while the decision page does not exist', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    const chip = await screen.findByText('Sez. U, n. 1234/2024 · Rv. 670001-01');
    expect(chip.closest('a')).toBeNull();
  });

  it('credits the source and links the portal', async () => {
    fetchRassegne.mockResolvedValue(SUMMARY);
    renderPanel();
    await openPanel();
    expect(await screen.findByText(/Fonte: Ufficio del Massimario della Corte di cassazione/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Apri sul portale del Massimario' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('loads more paragraphs and other years on demand', async () => {
    fetchRassegne
      .mockResolvedValueOnce(SUMMARY)
      .mockResolvedValueOnce({ ...SUMMARY, items: [passo('b', 2024, 'Un secondo passo.')], next_cursor: null })
      .mockResolvedValueOnce({ ...SUMMARY, anno: 2016, items: [passo('c', 2016, 'Un passo del 2016.')], next_cursor: null });
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Altri passi' }));
    expect(await screen.findByText('Un secondo passo.')).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, anno: 2024, cursor: '1' });
    fireEvent.click(screen.getByRole('button', { name: /Rassegna dell'anno 2016/ }));
    expect(await screen.findByText('Un passo del 2016.')).toBeInTheDocument();
    expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, anno: 2016 });
  });

  it('renders hostile text as text', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, items: [passo('x', 2024, '<img src=x onerror="alert(1)"> testo')] });
    const { container } = renderPanel();
    await openPanel();
    expect(await screen.findByText(/<img src=x onerror="alert\(1\)"> testo/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('says so when MERL-T is unavailable, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchRassegne.mockRejectedValue(new Error('503'));
    renderPanel();
    expect(await screen.findByText('Rassegne non disponibili ora.')).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('offers the civile/penale filter only when both are present', async () => {
    fetchRassegne.mockResolvedValue({ ...SUMMARY, archivi: ['civile', 'penale'] });
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Penale' }));
    await waitFor(() => expect(fetchRassegne).toHaveBeenLastCalledWith({ urn: URN, archivio: 'penale' }));
  });
});
```

- [ ] **Step 3: Write `decisionLinks.ts`, the types and the loader**

```ts
// apps/web/src/utils/decisionLinks.ts
/** False until App.tsx routes /sentenze/:corte/:numero/:anno; the decision-page PR sets it true. */
export const DECISION_PAGE_AVAILABLE = false;

/** A decision as other data names it (graph nodes, imports): loose, possibly incomplete. */
export interface LooseDecisionRef {
  corte: string;
  archivio?: string | null;
  numero: number;
  anno?: number | null;
  sezione?: string | null;
}

const LINKABLE_FIRST_YEAR: Record<string, number> = { cassazione: 1900, corte_costituzionale: 1956 };

/**
 * The page of a decision named by other data, or null when that data cannot make a link (another
 * court, no year, a number out of range). With the archive the path is the identity's and carries
 * no section; without it, the section as written goes along for the page to resolve.
 */
export function linkableDecisionPath(raw: LooseDecisionRef, now: Date = new Date()): string | null {
  const first = LINKABLE_FIRST_YEAR[raw.corte];
  if (first === undefined) return null;
  if (!Number.isInteger(raw.numero) || raw.numero < 1 || raw.numero > 999_999) return null;
  if (raw.anno == null || !Number.isInteger(raw.anno) || raw.anno < first || raw.anno > now.getFullYear()) return null;
  if (raw.corte === 'corte_costituzionale') return `/sentenze/corte-costituzionale/${raw.numero}/${raw.anno}`;
  if (raw.archivio === 'civile' || raw.archivio === 'penale') {
    return `/sentenze/cassazione-${raw.archivio}/${raw.numero}/${raw.anno}`;
  }
  const sezione = raw.sezione?.trim();
  return `/sentenze/cassazione/${raw.numero}/${raw.anno}${sezione ? `?sezione=${encodeURIComponent(sezione)}` : ''}`;
}
```

This block is the sentenze round's text, verbatim: do not reformat it. A reference without identity reaches it with `anno: null` when its year was not verified (Task 3), so it gets no link.

`apps/web/src/features/merlt/rassegne/types.ts`: the same interfaces as `apps/server/src/services/merlt/rassegneTypes.ts` (Task 14), with the header comment "mirrors the BFF's proxy of MERL-T, snake_case verbatim — never invent camelCase fields".

```ts
// apps/web/src/features/merlt/rassegne/rassegneApi.ts
import { getMerlt } from '../../../services/merltService';
import type { RassegneQuery, RassegneResponse } from './types';

export function fetchRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const params: Record<string, string | number> = { urn: query.urn };
  if (query.anno !== undefined) params.anno = query.anno;
  if (query.archivio) params.archivio = query.archivio;
  if (query.cursor) params.cursor = query.cursor;
  return getMerlt<RassegneResponse>('/merlt/rassegne', params);
}
```

```ts
// apps/web/src/features/merlt/rassegne/useRassegne.ts
import { useEffect, useState } from 'react';
import { fetchRassegne } from './rassegneApi';
import type { RassegneQuery, RassegneResponse } from './types';

/**
 * Session cache by query, with in-flight dedupe: the article view is mounted twice (mobile
 * accordion and desktop column), and each copy mounts the panel — one request, not two.
 * A failed load is forgotten so the next mount retries.
 */
const cache = new Map<string, Promise<RassegneResponse>>();

export function _clearRassegneCacheForTests(): void {
  cache.clear();
}

export function loadRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const key = [query.urn, query.archivio ?? '', query.anno ?? '', query.cursor ?? ''].join('|');
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchRassegne(query).catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

export type RassegneState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: RassegneResponse }
  | { status: 'error' };

export function useRassegneSummary(urn: string | undefined, archivio?: 'civile' | 'penale'): RassegneState {
  const key = urn ? `${urn}|${archivio ?? ''}` : null;
  const initial: RassegneState = key ? { status: 'loading' } : { status: 'idle' };
  const [state, setState] = useState<{ key: string | null; value: RassegneState }>({ key, value: initial });
  if (state.key !== key) setState({ key, value: initial }); // reset during render (set-state-in-effect rule)

  useEffect(() => {
    if (!urn) return;
    let cancelled = false;
    loadRassegne(archivio ? { urn, archivio } : { urn }).then(
      (data) => {
        if (!cancelled) setState({ key, value: { status: 'ready', data } });
      },
      (err: unknown) => {
        console.error('[rassegne] load failed', { urn, archivio, err });
        if (!cancelled) setState({ key, value: { status: 'error' } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [urn, archivio, key]);

  return state.key === key ? state.value : initial;
}
```

- [ ] **Step 4: The components**

```tsx
// apps/web/src/features/merlt/rassegne/DecisionChip.tsx
import { Link } from 'react-router-dom';
import { DECISION_PAGE_AVAILABLE, linkableDecisionPath } from '../../../utils/decisionLinks';
import type { RassegnaPronuncia } from './types';

const CHIP = 'px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';

/** A decision cited in a paragraph: a link to its page once that page exists, a plain label until then. */
export function DecisionChip({ pronuncia }: { pronuncia: RassegnaPronuncia }) {
  const path = DECISION_PAGE_AVAILABLE ? linkableDecisionPath(pronuncia) : null;
  return path ? (
    <Link to={path} className={`${CHIP} hover:underline`} title={pronuncia.label}>{pronuncia.label}</Link>
  ) : (
    <span className={CHIP} title={pronuncia.label}>{pronuncia.label}</span>
  );
}
```

```tsx
// apps/web/src/features/merlt/rassegne/RassegnaPassage.tsx
import { useState, type ReactNode } from 'react';
import { DecisionChip } from './DecisionChip';
import type { RassegnaEvidenziazione, RassegnePasso } from './types';

const COMMA_PARTS: Record<string, string> = { com: 'comma', num: 'n.', let: 'lett.' };

function commaLabel(comma: string | null): string | undefined {
  if (!comma) return undefined;
  return comma
    .split('-')
    .map((part) => {
      const match = /^([a-z]+)(.*)$/.exec(part);
      return match ? `${COMMA_PARTS[match[1]] ?? match[1]} ${match[2]}` : part;
    })
    .join(', ');
}

/** The paragraph as text nodes, the citations of this article in <mark>: never HTML. */
function withHighlights(text: string, spans: RassegnaEvidenziazione[]): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  [...spans].sort((a, b) => a.start - b.start).forEach((span, i) => {
    if (span.start < at || span.end > text.length || span.end <= span.start) return;
    if (span.start > at) out.push(text.slice(at, span.start));
    out.push(
      <mark key={i} title={commaLabel(span.comma)} className="rounded bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/40">
        {text.slice(span.start, span.end)}
      </mark>,
    );
    at = span.end;
  });
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function provenance(p: RassegnePasso): string {
  const head = p.archivio === 'civile' || p.archivio === 'penale' ? `Rassegna ${p.archivio} ${p.anno}` : `Rassegna ${p.anno}`;
  return [
    head + (p.volume.numero ? ` · vol. ${p.volume.numero}` : ''),
    p.capitolo?.nome,
    `§ ${p.sezione.numero} ${p.sezione.titolo}`.trim(),
  ].filter(Boolean).join(' › ');
}

export function RassegnaPassage({ passo }: { passo: RassegnePasso }) {
  const [full, setFull] = useState(false);
  const long = passo.testo.length > 400;
  return (
    <li className="space-y-2 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{provenance(passo)}</p>
      {passo.autori.length > 0 && <p className="text-xs italic text-slate-500 dark:text-slate-400">di {passo.autori.join(', ')}</p>}
      <p className={`text-sm leading-relaxed text-slate-700 dark:text-slate-300 ${long && !full ? 'line-clamp-4' : ''}`}>
        {withHighlights(passo.testo, passo.evidenziazioni)}
      </p>
      {long && (
        <button type="button" onClick={() => setFull((v) => !v)}
          className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
          {full ? 'mostra meno' : 'mostra tutto'}
        </button>
      )}
      {passo.pronunce.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {passo.pronunce.map((p, i) => <DecisionChip key={`${p.key ?? p.label}-${i}`} pronuncia={p} />)}
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Fonte: Ufficio del Massimario della Corte di cassazione ·{' '}
        <a href={passo.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600 dark:hover:text-slate-200">
          Apri sul portale del Massimario
        </a>
      </p>
    </li>
  );
}
```

```tsx
// apps/web/src/features/merlt/rassegne/RassegnePanel.tsx
import { useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { RassegnaPassage } from './RassegnaPassage';
import { loadRassegne, useRassegneSummary } from './useRassegne';
import type { RassegnePasso } from './types';

type Archivio = 'civile' | 'penale';

const passi = (n: number): string => (n === 1 ? '1 passo' : `${n.toLocaleString('it-IT')} passi`);

function years(anni: { anno: number }[]): string {
  const values = anni.map((a) => a.anno);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(max) : `${min}–${max}`;
}

interface YearProps {
  urn: string;
  archivio?: Archivio;
  anno: number;
  count: number;
  initial?: { items: RassegnePasso[]; next: string | null };
}

function YearSection({ urn, archivio, anno, count, initial }: YearProps) {
  const [open, setOpen] = useState(Boolean(initial));
  const [items, setItems] = useState<RassegnePasso[]>(initial?.items ?? []);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = (cursor?: string) => {
    setLoading(true);
    setFailed(false);
    const query = { urn, anno, ...(archivio ? { archivio } : {}), ...(cursor ? { cursor } : {}) };
    loadRassegne(query).then(
      (data) => {
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNext(data.next_cursor);
        setLoading(false);
      },
      (err: unknown) => {
        console.error('[rassegne] year load failed', { urn, anno, cursor, err });
        setFailed(true);
        setLoading(false);
      },
    );
  };

  const toggle = () => {
    const opening = !open;
    setOpen(opening);
    if (opening && items.length === 0) load();
  };

  return (
    <section className="border-t border-slate-100 dark:border-slate-800">
      <button type="button" aria-expanded={open} onClick={toggle}
        className="flex min-h-[44px] w-full items-center justify-between py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rassegna dell'anno {anno}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{passi(count)}</span>
      </button>
      {open && (
        <div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((p) => <RassegnaPassage key={p.id} passo={p} />)}
          </ul>
          {failed && <p className="text-sm text-amber-600 dark:text-amber-400">Rassegne non disponibili ora.</p>}
          {next && !loading && (
            <button type="button" onClick={() => load(next)}
              className="min-h-[44px] text-xs font-medium text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400">
              Altri passi
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export interface RassegnePanelProps {
  articleUrn?: string;
}

/**
 * "Nelle rassegne della Cassazione": the paragraphs of the Massimario's annual reviews whose
 * author cited this article, by year. A closed row under the article text (spec §7; placement
 * per the text-as-at-a-date spec §9). Self-contained: it takes the article's URN and ignores
 * the slot's other props.
 */
export function RassegnePanel({ articleUrn }: RassegnePanelProps) {
  const [open, setOpen] = useState(false);
  const [archivio, setArchivio] = useState<Archivio | undefined>(undefined);
  const summary = useRassegneSummary(articleUrn, archivio);

  if (!articleUrn || summary.status === 'idle' || summary.status === 'loading') return null;
  if (summary.status === 'error') {
    return <p className="mt-6 text-sm text-amber-600 dark:text-amber-400">Rassegne non disponibili ora.</p>;
  }
  const { data } = summary;
  if (data.total === 0) return null;

  const toggle = () => setOpen((v) => !v);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };
  const both = data.archivi.includes('civile') && data.archivi.includes('penale');

  return (
    <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-800">
      <div role="button" tabIndex={0} aria-expanded={open}
        aria-label={open ? 'Comprimi le rassegne della Cassazione' : 'Espandi le rassegne della Cassazione'}
        onClick={toggle} onKeyDown={onKeyDown}
        className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0">
        <span className="text-xs font-bold uppercase text-slate-600 dark:text-slate-300">Nelle rassegne della Cassazione</span>
        <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{`${passi(data.total)}, ${years(data.anni)}`}</span>
          <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </span>
      </div>
      {open && (
        <div className="mt-3">
          {both && (
            <div className="mb-2 flex gap-2" role="group" aria-label="Filtra per archivio">
              {([undefined, 'civile', 'penale'] as const).map((value) => (
                <button key={value ?? 'tutte'} type="button" aria-pressed={archivio === value} onClick={() => setArchivio(value)}
                  className={cn('min-h-[44px] rounded px-2 text-xs md:min-h-0',
                    archivio === value ? 'bg-slate-200 font-semibold dark:bg-slate-700' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  {value === undefined ? 'Tutte' : value === 'civile' ? 'Civile' : 'Penale'}
                </button>
              ))}
            </div>
          )}
          {data.anni.map(({ anno, passi: count }) => (
            <YearSection key={`${archivio ?? ''}-${anno}`} urn={articleUrn} archivio={archivio} anno={anno} count={count}
              initial={anno === data.anno ? { items: data.items, next: data.next_cursor } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Copy `cn`'s import path from a neighbouring MERL-T component if `../../../lib/utils` is not it. The year heading carries no link yet: the text-as-at-a-date round adds *Vedi il testo in vigore al 31 dicembre AAAA* when it ships `version_date` (spec §7).

- [ ] **Step 5: Register the panel**

In `apps/web/src/plugins/registry.tsx`, import `RassegnePanel` and add after `merlt-article-tracker`:

```tsx
    {
        id: 'merlt-article-rassegne',
        pluginId: 'visualex-merlt',
        slot: 'article_content_after',
        component: RassegnePanel as unknown as React.ComponentType<Record<string, unknown>>,
        requiredFlag: 'VITE_FEATURE_MERLT',
    },
```

In `apps/web/src/plugins/__tests__/registry.test.tsx`, the `article_content_after` expectations become two entries in this order (`merlt-article-tracker`, `merlt-article-rassegne`) at lines 36–37, 44 and 92, and mock `../../features/merlt/rassegne/RassegnePanel` the way the test mocks the other registered components.

- [ ] **Step 6: Run the web suite, lint and build**

Run: `npm --prefix apps/web run test -- --run && npm --prefix apps/web run lint && npm --prefix apps/web run build`
Expected: PASS, lint clean, build clean.

- [ ] **Step 7: Commit and open pull request 4**

```bash
git add apps/web/src/utils/decisionLinks.ts apps/web/src/utils/__tests__/decisionLinks.test.ts apps/web/src/features/merlt/rassegne apps/web/src/plugins/registry.tsx apps/web/src/plugins/__tests__/registry.test.tsx
git commit -m "feat(web): panel with the Massimario's review paragraphs citing the article, by year

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Open pull request 4 (`feat/massimario-reader` → `develop`).

---

### Task 17: Pilot on the development stack

Runs after pull requests 2–4 are merged into `develop` and the development stack is updated. Every step that writes to the development stores waits for the owner's go-ahead at that step.

- [ ] **Step 1: Bring the stack up with the new code**

MERL-T's code is baked into its images: rebuild **and** recreate both containers, then restart VisuaLex so it serves the two internal routes.

```bash
docker compose -f infra/compose.yml --profile merlt build merlt-api merlt-worker
docker compose -f infra/compose.yml --profile merlt up -d --force-recreate merlt-api merlt-worker
```

Check: `curl -s "http://localhost:5000/fetch_massimario?kind=index&id=96" | head -c 200` returns JSON whose `data.items[0].text` is `Massimario 2024 CIVILE Vol. 1`; the MERL-T API log shows `Schema additions ensured`.

- [ ] **Step 2: Two pilot volumes**

From `/admin` → Ingestione: source *Massimario (rassegne)*, reference `{"volume":96}`, label `Massimario 2024 civile vol. 1`; then `{"volume":99}`, `Massimario 2024 penale vol. 1`. Wait for `pending_review`.

- [ ] **Step 3: Read the reports with the owner**

For each batch, the "Rapporto del volume": coverage ≥ 95 %; the unrecognised samples make sense; norms unresolved and partitions few; decisions already in the graph plausible. Pick ten paragraphs from the batch's sample and compare each with the portal (text identical but for whitespace; the cited article and the cited decisions match).

- [ ] **Step 4: Promote and measure the vectors**

Promote both batches (owner's go-ahead). Note the time each 100-paragraph slice takes in the worker log (`massimario.indexed`): this is the measurement that settles the graph round's open point on where vectors are computed. Check: `stats.vectors.done == total`; Qdrant `count` with filter `source_type = rassegna` equals the batches' `frammenti`; bridge `count_by_source('massimario')` equals the sum of the chunks' bridge rows.

- [ ] **Step 5: Idempotence**

Run volume 96 again and promote it. Expected: the same Qdrant count, the same bridge count, the same number of `AttoGiudiziario` nodes and `INTERPRETA` edges with `tipo = 'co-citazione'`.

- [ ] **Step 6: Reversibility, on a copy**

With the owner's go-ahead: `scripts/backup.sh`; `docker compose -f infra/compose.yml exec merlt-api python -m merlt.scripts.remove_massimario_prose` (dry run: the counts of Step 4), then `--apply`; check that the Qdrant and bridge counts are zero and that the decisions and stubs are still there; restore with `scripts/restore.sh <the backup folder>`, and check the counts of Step 4 again.

- [ ] **Step 7: Browser pass**

Log in on `http://localhost:5173` (MERL-T on) and check:
- an article cited in many paragraphs of the two volumes (for example art. 360 c.p.c. or art. 2043 c.c.): the closed row with the count; open it; newest year first; the highlight on the article's citation; chips as plain labels; credit and portal link; "Altri passi";
- an article never cited: nothing under the text;
- the same article in a historical version: the row is still there;
- MERL-T stopped (`docker compose … stop merlt-api`): the line *Rassegne non disponibili ora.*; start it again;
- the dossier view of an article: no panel (`show_brocardi_info: false` path is untouched; the slot is not mounted there).

Take a screenshot of the open panel for the owner.

- [ ] **Step 8: The other 61 volumes**

Only with the owner's go-ahead, after reading the pilot: one volume at a time, at night, each report read before its promotion. The portal's firewall decides the pace: a `failed` batch with "il firewall ha rifiutato" waits a day.
