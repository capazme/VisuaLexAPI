# One convention for legal sources — Adoption Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every area identifies norms and decisions the same way and writes them in the owner's style, from one formatter per language, and no area can drift without a red test on `conventions/sources/golden.json`.

**Architecture:** one identity function and one label module per language — TypeScript in the web app (`apps/web/src/utils/sources/`), a pinned TypeScript copy in the server, Python in the API (`visualex_api/tools/sources.py`) and a pinned Python copy in MERL-T (`merlt/utils/sources.py`) — each tested against the same JSON golden file. Keys at rest never change; labels are derived on read.

**Spec:** `docs/superpowers/specs/2026-10-04-source-convention-design.md`. **Evidence:** `docs/superpowers/specs/2026-10-04-source-convention-inventory.md` (every site to replace is listed there with `file:line`).

**Approved** (4 October 2026): the owner approved the spec and took every recommendation of its §9, «per il 31 procedi con le raccomandazione». **Each PR starts on the orchestrator's go**: several running sessions share these files (Sentenze PR B: `decisionLinks.ts`; the dossier UI round: dossier rows and PDF; the MCP second round: `citeAct`/`citeArticle` and the MCP labels), so the orchestrator sequences every adoption PR with them. Each adoption PR removes its cases from the web test's `PENDING_ADOPTION` list.

## Global Constraints

- **Git flow:** a branch from `develop` per PR below, a pull request into `develop`, merged with a merge commit `merge: <branch> — <what changes>` once CI is green. `main`, tags and releases are the owner's.
- **Rule 23:** no PR changes `article_text`, the scraper's output, the renderer's text nodes or any offset.
- **No key at rest changes:** `buildItemKey`, `uniqueArticleIdFromNorma`, the graph's well-formed URN keys, the decision key, the `/sentenze/…` paths, `DossierItem.content`. A PR that would change one stops and asks.
- **Golden first:** each PR adds its suite's golden test before the code, red where the code is wrong, and ends with it green. Flipping a case from `open` to `decided` quotes the owner's answer in its `note`.
- **Tests:** the suites of every touched area (root `CLAUDE.md`, Commands). The server suite resets the shared test database: ask the orchestrator before running it. MERL-T's DB-backed and `integration` tests never run against the development stack.
- **Graph writes** (§5.3 migrations, the label backfill) run only in a window the orchestrator coordinates, after `scripts/backup.sh`.
- **Coordination:** do not edit files another running session owns (Sentenze PR B/C, the #63 follow-up, the dossier UI rethink); hand them the module and the golden cases instead.
- **Errors you surface in files you touch are fixed,** pre-existing ones too.

## Review Focus

1. **A key at rest that moved.** A refactor of `normaKeys.ts`, of a URN builder or of the decision key that changes one character orphans annotations, discussions, cards or graph nodes. Every PR diffs the keys of the golden inputs before and after.
2. **A label stored as truth.** A new column or JSON field holding a citation (the decision dossier item's `etichetta`) freezes today's style into user data.
3. **A guess in a label.** A synthetic `-01-01`, `None`, an ISO date in a sentence, the codice civile named for the preleggi, an article number lost (MERL-T's citation export drops it today).
4. **Two copies drifting.** The server's citation, MERL-T's tables and identity: each copy has its own golden test, not a test against the other copy.
5. **An identity built for something that has none.** A year-only act, a decision without archive or year, getting a key or a graph node.
6. **Text in force cited as past, or the reverse.** The version clause stays `citation.ts`'s; the convention only changes the head.

---

## PR 0 — Inventory, spec, golden file, plan (this PR)

- [x] Inventory with measured outputs.
- [x] Spec.
- [x] `conventions/sources/golden.json` and its README.
- [x] Web self-check `apps/web/src/utils/__tests__/sourcesGolden.test.ts`: shape, decided citations against `citation.ts`, current decision paths against `decisionLinks.ts`.
- [x] API self-check `services/visualex/tests/test_sources_golden.py`: current norm identities against `generate_urn`, current decision keys against `decisions.model`.
- [x] Root `CLAUDE.md` layout row for `conventions/`.

## PR 1 — Web: one label module (`refactor/web-source-labels`)

**Files:** create `apps/web/src/utils/sources/{actTypes,normLabels,normIdentity,index}.ts` and `apps/web/src/utils/sources/__tests__/golden.test.ts`; modify `utils/citation.ts` (head from `normLabels`), `utils/normaMeta.ts`, `utils/dateUtils.ts` (`abbreviateActType` goes), `utils/citationParser.ts`, `utils/citationMatcher.ts`, `utils/normattivaParser.ts`, `features/merlt/qa/format.ts`, and every inline site of inventory §3.1 (`SearchPanel`, `ArticleTabContent`, `SortableDossierItem`, `dossierUtils`, `DossierDetailView`, `StudyMode`, `StudyModeContent`, `HistoryView`, `CompareView`, `AdvancedExportModal`, `AskMerltEntry`, `NormaCard`, `NormaBlockComponent`); `apps/web/CLAUDE.md` (Shared utilities).

- [ ] **Golden test** over every norm case: `citation`, `short`, `act_*` labels from `normLabels`; act and article identity from `normIdentity` (from `norma_data.url`/`urn` for Normattiva acts, CELEX for EU acts); decision `key`, `path`, `citation`, `short` from `decisionLinks` (`decisionKey`, `linkableDecisionPath`, `formatDecisionCitation`, the new `formatDecisionShort`), which Sentenze PR B extends first. Run: red on the cases the code does not meet yet.
- [ ] **`actTypes.ts`**: the type table and the codes-by-name table (spec §3.3), case-insensitive lookup (web gotcha 28).
- [ ] **`normLabels.ts`**: `citeNorm`, `shortNorm`, `citeAct`, `shortAct`, `actHeading`; never `None`, never an ISO date, year-only per Q7.
- [ ] **`citation.ts`** calls `citeNorm` for its head; `citationGolden.ts` stays green unchanged.
- [ ] **Replace the inline sites**, one commit per surface; each commit names the inventory rows it removes. Copy trailers follow Q8.
- [ ] **Q&A chip**: from the server's `title`, else `shortNorm` of what the URN identifies; never `art. 12 c.c.` for the preleggi; a decision key becomes its short label.
- [ ] **Massimario and Brocardi chips** (`DecisionChip`, `MassimeSection`) use `formatDecisionShort` once Q2 is answered; the Massimario's server-side `label` is then dropped from the wire or ignored.
- [ ] **Suites:** `npm --prefix apps/web run test -- --run`, `run build`, `run lint`. **Browser pass** on `http://localhost:5173`: a tab of the l. 241/1990, the c.c., the preleggi, the GDPR; a dossier with two laws; the comparison; copy of a text in force and of a past text; the Massimario panel of art. 2043 c.c.

## PR 2 — Server and MCP (`refactor/server-source-labels`)

**Files:** `apps/server/src/norms/citation.ts` (+ `shortNorm`), a new `apps/server/src/norms/decisionCitation.ts` once PR C of Sentenze needs it, `apps/server/src/utils/normaWatcher.ts:105`, `apps/server/tests/norms/sourcesGolden.test.ts`, `apps/mcp/tests/sourcesGolden.test.ts`; `apps/server/CLAUDE.md`, `apps/mcp/CLAUDE.md`.

- [ ] **Golden test** for `citeArticle` on every norm case; the existing test against `citationGolden.ts` moves to the JSON file (the TS golden keeps only the version clause).
- [ ] Fix what it shows red: `art. 101, tfue` → per Q6; `art. 6, l. 1983, n. 184` → per Q7; EU forms per Q6.
- [ ] **Notification message**: the citation of the snapshot, not the raw `normaKey`.
- [ ] **MCP**: a stub server answering the golden citations; the tools pass `citation` and `display` through byte for byte.
- [ ] **Suites:** `npm --prefix apps/server run build`, `npm --prefix apps/server test` (after the orchestrator's go), `npm --prefix apps/mcp run build && npm --prefix apps/mcp test`.

## PR 3 — Python API: identity edges (3a: `fix/api-source-identity`; 3b: year-only)

**Files:** create `services/visualex/visualex_api/tools/sources.py` (normaliser, EU identity, labels for `/parse_query`); extend `services/visualex/tests/test_sources_golden.py` (PR 0 ships it for the `current` cases); modify `tools/urngenerator.py` (year-only, no number), `tools/map.py` (the two ministerial rows of `NORMATTIVA_URN_CODICI`), `services/visualex/app.py:801-803` (`display`; not `visualex_api/app.py`, the unused alternative server); `services/visualex/CLAUDE.md`.

- [x] **Golden test** (3a): `generate_urn` equals every `current` Normattiva identity; the normaliser maps every `aliases` entry to `identity.article`; `eu_identity` gives the CELEX identities; `cite_article` writes every decided citation; no golden URN carries `;None` (an act with no date still gets `…:None;241`: a pre-existing gap, left to 3b, which rewrites the date path); `/parse_query`'s `display` is the citation.
- [ ] **Year-only**: `generate_urn` never writes `1983-01-01`. No text is fetched from a year-only URN: the resolver matches year and number only and can answer with another act (`act_dates.py:11-13`), so the date is resolved first and checked against the page's title, as `act_dates` does. **3b**, after the small-fixes job carries out the owner's choice (4 October 2026: «se davvero non serve più complete_date sostituiamola»: `act_dates` in place of `complete_date` where no caller still needs it).
- [x] **Ministerial rows of the codes table** (3a): now `decreto.ministeriale:<date>;<n>` in both copies of the table (the API's and MERL-T's); Normattiva resolves that form to the c.p.i. regulation (checked 4 October); the c.p.p. regulation's row (`decreto.ministeriale:1989-09-30;334`) was not checked live — one request, spaced, before anything relies on it.
- [x] **No number** (3a): no `;None`. Normattiva answers the d.p.c.m. of 8 March 2020 with its error page under the State form (checked 4 October): it probably does not hold the decree, so that case stays `proposed`.
- [x] **Normaliser** (3a) `normalize_norm_urn`: wrapper, version markers, code aliases (`CODE_ACTS`), `decreto legislativo`/`decreto-legge` tokens, ministry-form decrees.
- [x] **EU identity** (3a): `celex:<CELEX>~art<N>` from type, year and number (the same reading as `euCitation.ts` / `resolve_eu_year_and_number`).
- [x] **`/parse_query` `display`** (3a) = the citation (`cite_article`, which writes every decided form, D4, D6 and D7 included; a list or range of articles reads «artt.»).
- [ ] **Suites:** `(cd services/visualex && .venv/bin/python -m pytest tests/ -q)`; archive suite too if `tools/` changed.

## PR 4 — MERL-T: labels and tables (`refactor/merlt-source-labels`)

**Files:** create `services/merlt/merlt/utils/sources.py`, `services/merlt/tests/unit/test_sources_golden.py`; modify `storage/graph/schema.py` (`format_estremi`, `act_abbreviation`, `estremi_from_urn`), `pipeline/visualex.py` (`to_estremi`), `pipeline/ingestion.py` (code node `titolo`/authority, article `titolo`), `pipeline/multivigenza.py` (authority table, `titolo`), `citation/urn_parser.py` and `citation/formats/*` (delegate to `sources.py`; the article is never dropped), `utils/urn_labels.py` (suffix table from one source), `pipeline/massimario/identity.py` (`estremi`, `label` from `sources.py`); a backfill script `merlt/scripts/backfill_source_labels.py`; `services/merlt/CLAUDE.md`.

- [ ] **Golden test**: the normaliser on `aliases`; `estremi` = `short`; act node title = `act_heading`; authority = `authority`; `DecisionIdentity.key`; decision `estremi` = `short`. A test pins MERL-T's `NORMATTIVA_URN_CODICI` copy to the API's by reading both files' tables (MERL-T must not import the API).
- [ ] **Writers**: stubs keep `stub_properties`; a code node takes `act_heading` and the authority table; an article node's `titolo` is its rubric or absent.
- [ ] **Citation export**: delegates to `sources.py`; red tests first for `R.D. 16 marzo 1942, n. 262` (article dropped), `Costituzione~Art81`, the EU URLs.
- [ ] **Readers of `estremi`**: `tools/external_source.py:312` searches `a.estremi CONTAINS $query` and `tools/constitutional_basis.py:300` `estremi CONTAINS 'Cost.'`, both case-sensitive. Make them case-insensitive (or search the key) before the backfill changes `Art. 2043 c.c.` into `art. 2043 c.c.`, with a test each; grep for every other `estremi` reader first.
- [ ] **Backfill** (idempotent, dry run by default, counts what it would change): recompute `estremi`, `titolo`, `autorita_emanante` from key and properties. Run on the development graph only in the orchestrator's window, after a backup.
- [ ] **Suites:** MERL-T `pytest tests/ -q` against a disposable database; `-m integration` against a disposable FalkorDB.

## PR 5 — MERL-T: identity of data already in the graph (graph phase 2)

Owned by the graph phase-2 work; this plan gives the rules (spec §5.3) and the golden cases (`legacy_keys`, malformed `aliases`).

- [ ] Re-key `massima_cassazione_civile_<n>_<anno>` → `cassazione:civile:<n>:<anno>` (and `…_penale_…`, Corte cost.), merging with the Massimario node where it exists: relations and properties kept, lists unioned. Bare `massima_cassazione_…` keep their key.
- [ ] Re-key the 34 nodes under `decreto legislativo:` / `decreto-legge:` and merge with the well-formed node.
- [ ] Qdrant points and bridge rows keyed by the old ids follow (`point_id` is derived from the canonical URN: recompute for the merged norm nodes).
- [ ] Report: counts before and after, every merge listed; reversible from the backup.
- [ ] Unblocks the Massimario volumes beyond the pilot.

## PR 6 — Decisions in the web and the dossier (with Sentenze PR B/C)

Not a PR of this plan: Sentenze PR B builds `decisionLinks.ts`'s wording (its plan, Task 8), which is the web implementation of spec §4; its tests take the golden decision cases. PR C stores `etichetta` and `title` as its spec says until the owner answers Q9 (spec §8.3).

## Year-only keys at rest (inside PR 1)

- [ ] When an act's date becomes known (the resolver or a later search), the reader loads annotations, highlights, bookmarks, saved-norm watches (`NormaWatch`), discussions and study-card anchors (`LingoCardAncora`) under **both** `buildItemKey` of the year-only norm and of the dated one, and writes new ones under the dated key. No row is rewritten. Test with two stored highlights, one under each key.
