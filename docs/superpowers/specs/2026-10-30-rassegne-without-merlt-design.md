# The Massimario's reviews without MERL-T — Design

**Date:** 2026-10-30
**Status:** proposal. Options for the owners; nothing here is decided until they answer
section 9. Specification only: no code changes with it.
**Changes:** decision 4 of `2026-10-01-rassegne-massimario-design.md` §2 («VisuaLex's own
database keeps no legal content. The panel exists only when MERL-T is on»), and its §7 data path.
The rest of that design (the source, the citation grammar, the graph model, rights) stands.
**Principle, the owner's words (30 October):**

> va bene che la rassegna comunichi con merlt ma non deve esserne dipendente

The reader shows the reviews with MERL-T off or down. MERL-T may consume the same data for the
graph, the vectors and the experts. Nothing on the article page waits for MERL-T. This applies
to the reviews the owners' architecture principle that the first version does not depend on
MERL-T (A2).

## 1. What exists

Every claim below was checked against `develop` on 30 October.

### 1.1 The reader

- The panel «Nelle rassegne della Cassazione» lives in `apps/web/src/features/merlt/rassegne/`:
  `RassegnePanel.tsx` (the panel, closed by default, and one section per year),
  `useRassegne.ts` (a session cache with in-flight dedupe), `rassegneApi.ts`,
  `RassegnaPassage.tsx`, `DecisionChip.tsx`, `rassegnaFilters.ts`, `types.ts`.
- It is a plugin of `visualex-merlt` in the `article_case_law` slot, with
  `requiredFlag: 'VITE_FEATURE_MERLT'` (`apps/web/src/plugins/registry.tsx`).
  `CaseLawSection.tsx` renders the slot inside «Giurisprudenza», and only while that section is
  open (`hasMassimario = getSlotComponents('article_case_law').length > 0`).
- `rassegneApi.ts` calls `getMerlt('/merlt/rassegne', …)`, which is `GET /api/merlt/rassegne`.
  The server mounts the whole `/api/merlt` namespace behind `merltKillSwitch`
  (`apps/server/src/app.ts`, `middleware/merlt/featureGate.ts`). It answers
  `404 {detail: 'merlt_disabled'}` when `MERLT_ENABLED` is off. Otherwise
  `routes/merlt/rassegne.ts` proxies MERL-T's `GET /api/v1/rassegne/by-norma` through
  `graphClient.rassegneByNorma`. It turns any MERL-T failure into
  `503 {detail: 'merlt_unavailable'}`.
- MERL-T's `rassegne_router.py` reads through `pipeline/massimario/reader.py`. It takes the
  `bridge_table` rows of relation `CITA_NORMA` for the URN (MERL-T's Postgres), then the Qdrant
  points by id. For reading, **the paragraph's text, its structure, its norm spans and its
  decisions come from the Qdrant payload**. A copy of every payload also stays in the staging
  batch (`MerltIngestionBatch.extras.chunks`, MERL-T's Postgres), but the reader does not use
  it.
- When the summary request fails, the panel renders «Rassegne non disponibili ora.» in its
  place (`RassegnePanel.tsx`, `summary.status === 'error'`). This happens on every article, as
  soon as «Giurisprudenza» is opened.
- **Which failure happens where.**
  - On the deployment host, `./start.sh --prod` runs MERL-T by default.
    `scripts/prod/init-env.sh` writes `MERLT_ENABLED=true`, `scripts/prod/deploy.sh` adds the
    `merlt` profile unless it is `false`, and `infra/compose.app.yml` defaults the server's
    `MERLT_ENABLED` to `true`.
  - The web's `VITE_FEATURE_MERLT` follows `MERLT_ENABLED` at build time
    (`infra/compose.app.yml`), so with MERL-T switched off the panel is not registered at all.
  - The 404 `merlt_disabled` reaches the panel only when the two flags disagree, which happens
    in development. The real case is the 503: MERL-T is on but its bridge or Qdrant cannot
    answer.

**What the reader depends on today.** The reader depends on:
- MERL-T's API;
- the bridge in MERL-T's Postgres;
- Qdrant;
- the **embedding chain**: a paragraph has no point until `massimario_tasks.index_slice` has
  embedded it;
- the **graph promotion**: the vectors are enqueued only after the batch is promoted into
  FalkorDB (`worker/mechanical_ingest_tasks.py`), and `index_slice` skips a batch that is not
  `promoted`.

So a volume reaches the reader only after it is promoted into the graph, which waits for the
graph round's phase 2 (§1.3), and after its vectors finish. On the pilot the vectors took 32
minutes for one volume on CPU; the 63 volumes would take about 40 hours.

### 1.2 The ingestion

- `services/visualex/visualex_api/services/massimario_portal.py` fetches one portal element at a
  time for MERL-T (`GET /fetch_massimario`: internal, not routed by the ingress, paced at ≥ 1.5 s,
  stops at the first firewall rejection). `/resolve_act_dates` completes acts cited by year only.
  **The core already does the fetching.**
- `services/merlt/merlt/pipeline/massimario/` does the rest:

  | Module | Role | What it imports from MERL-T |
  |---|---|---|
  | `paragraphs.py` | section HTML → plain paragraphs and norm-link spans; `split_for_vectors` | nothing (stdlib) |
  | `citations.py`, `rv_bands.py` (+ `rv_bands.json`, numbers only) | the CED citation grammar | nothing beyond the package |
  | `identity.py` | decision identity (`DecisionIdentity`, `CitedDecision`) | `merlt.utils.sources.decision_short`; `merlt.utils.tar_seats` (deferred import) |
  | `urns.py` | portal links → canonical URNs | `merlt.utils.map.NORMATTIVA_URN_CODICI`, a copy of `visualex_api/tools/map.py` |
  | `volume.py`, reading part (`walk_index`, `iter_paragraphs`, `year_only_acts`) | the volume in reading order | nothing |
  | `volume.py`, `_Volume` (`norms`, `decisions_of`, `_decision_entry`, `add_*`, `output`) and `build_volume` | resolving a paragraph's norms, de-duplicating its decisions; then nodes, stubs, edges, chunks, bridge rows and the parse report | `merlt.storage.graph.schema` (labels, `point_id`, `stub_properties`), `merlt.utils.sources.decision_node_estremi` |
  | `promote.py`, `report.py` | graph writes and counts | FalkorDB |
  | `vectors.py`, `worker/massimario_tasks.py` | embeddings, Qdrant points, bridge rows | Qdrant, bridge, RQ |
  | `reader.py`, `api/rassegne_router.py` | the reader's query | bridge, Qdrant |
  | `adapter.py` | fetch through VisuaLex, resolve, build | VisuaLex client |

  Also in MERL-T:
  - `merlt/scripts/build_rv_bands.py`, which builds the Rv table from the local archive;
  - `merlt/scripts/remove_massimario_prose.py`, which deletes the Qdrant points and the bridge
    rows and leaves the staging batches' copies;
  - the tests in `services/merlt/tests/pipeline/test_massimario_*.py`, with the synthetic
    `massimario_fixture.py`.

  Other MERL-T code imports these modules too:
  - `tests/unit/test_sources_golden.py` imports `DecisionIdentity`;
  - `tests/storage/test_lazy_ingest_identity_live.py` imports `parse_portal_urn` and
    `to_canonical`.

  The admin's run, staging and report screens are in
  `apps/web/src/features/merlt/ops/ingestion/`.
- **What is pure and what is not.** Paragraphs, citations, URNs and the reading order are pure:
  they read text and return text, numbers and identities. But the per-paragraph logic a reader
  needs sits inside `_Volume`, mixed with the graph assembly:
  - dropping the `Sez. L` links that are decisions;
  - resolving and counting the norms;
  - de-duplicating decisions by key and merging their `Rv.`.

  So does the parse report's counting (the `Rv.` totals, the forms, the references without
  identity, the unresolved links, the samples), which the admin's report panel shows. Moving
  the parsing therefore means extracting a paragraph-record builder from `_Volume`, not just
  moving files.

### 1.3 History

- The design `docs/superpowers/specs/2026-10-01-rassegne-massimario-design.md`, PRs #47, #50,
  #55, #56 and #59. The whole corpus has 63 volumes (2010–2024), 98,840 paragraphs, 62.9 million
  characters, 79,316 norm links and 68,083 `Rv.` mentions. The raw archive (the JSON as served,
  dated) is kept outside the repository (that design, §4).
- The pilot, vol. 96 (Massimario 2024 civile, vol. 1), was promoted in development: 1,366 points
  and 2,354 bridge rows. Vol. 99 (penale 2024) was not promoted. The parser has changed since
  the pilot, in commits of 4 and 12 October. No volume beyond the pilot goes into the **graph**
  until the graph round's phase 2 merges the seed's duplicate decision nodes. That constraint
  is about the graph. Today it also holds back the reader, because of the dependency in §1.1.

### 1.4 A precedent in review

PR #206 (open) serves the Corte costituzionale's massime under each article without MERL-T:
- The Python API downloads the open-data bundles and builds a SQLite index beside them, in its
  cache, with stdlib `sqlite3` and no migration.
- The index is built in a temporary file and put in place whole, and it is served while a
  refresh runs.
- The web calls the route through `legalFetch`; the path is added to the Vite proxy and to the
  ingress's `@legal` list.

Option (a) below follows the same pattern.

## 2. The principle, made testable

1. With `MERLT_ENABLED=false` and no MERL-T container running, an article cited by a stored
   paragraph shows the panel and its paragraphs. A test runs this without MERL-T, and the
   browser pass checks it with the stack's MERL-T profile off.
2. The reader's request path has no MERL-T hop: no `/api/merlt/*`, no `merlt` import in the
   route that serves it, no Qdrant or bridge read.
3. A paragraph is readable as soon as it is stored, before any graph promotion and before any
   vector.
4. **Dependency direction:** MERL-T may read the core's paragraphs. The core never calls MERL-T
   to read or show them, and never imports MERL-T code. MERL-T already depends on the Python API
   for fetching, so this adds no new direction.
5. With no review data at all (store not built), the route answers 200 with `total: 0`, and
   the panel draws nothing, as today when no paragraph cites the article. A 503 is kept for a
   store that exists but cannot be read, or whose schema version the API does not know.

## 3. Options

All three keep the response shape the web reads today (`RassegneResponse`: `urn`, `total`,
`anni`, `archivi`, `anno`, `items`, `next_cursor`). The same goes for each item:
- `id`, `anno`, `archivio`;
- `volume {id, numero, titolo}`, `parte {nome, titolo}`, `capitolo {nome, titolo}`,
  `sezione {id, numero, titolo}`;
- `autori`, `url`, `testo`, `evidenziazioni`, `pronunce`, `fonte`.

So the panel's components stay as they are, and only the fetcher and the mount change. None of
the three asks the reader to wait for a graph promotion or for vectors. All three move the
parsing out of `services/merlt` into the Python API (§1.2). §3.1 says how.

### 3.1 The paragraph record, and how MERL-T gets what it needs

The record is what the reader needs and what MERL-T needs to build its chunks, nodes and rows.
For each paragraph:
- `paragraph_key` (`massimario|<volume>|<section>|<index>`, unchanged), `ordine`, `anno`,
  `archivio`, `text`;
- `volume {id, numero, titolo}`, `parte {nome, titolo}`,
  `capitolo {id, nome, titolo, autori, materie}`, `sezione {id, numero, titolo}`, `url`,
  `fonte`;
- `norme`: per link, the URN, `start`, `end`, `citazione`, `comma`, and whether it names an
  article;
- `decisioni`: per cited decision, `key` (or `null` with `motivo_senza_identita`), `corte`,
  `archivio`, `numero`, `anno`, `sezione`, `rv`, `relatore`, `data_udienza`, `anno_implicito`
  and `forma`, already de-duplicated by key;
- `pieces`: the `[start, end]` cuts of `split_for_vectors` (≤ 2,000 characters).

A volume's records come with its **parse report**: today's `massimario` block minus the graph
counts, which MERL-T adds at staging (`report.py`).

**How MERL-T stops needing the parsing code.** The records carry everything the parsing used to
produce, so MERL-T's code does not need to import the parsing modules:
- the pieces fix the vector texts and hence the `point_id` inputs;
- the decision fields fill the `AttoGiudiziario` properties, and MERL-T computes `estremi`
  itself with `decision_node_estremi`;
- the norm URNs give the stubs (`stub_properties`) and the co-citation edges.

Some MERL-T code still uses the moved modules. For each:
- `identity.py` **stays in MERL-T as well**. It is MERL-T's graph key, and MERL-T's
  `test_sources_golden.py` reads it. The API gets its own copy. Both copies are pinned to the
  decision keys of `conventions/sources/golden.json`, which the API suite already asserts
  (`services/visualex/tests/test_sources_golden.py`), so they cannot drift apart unnoticed. The
  API's copy imports the API's own `services/decisions/tar_seats.py`.
- `test_lazy_ingest_identity_live.py` moves to the API's tests, or drops its `urns.py` part, in
  PR 3.
- The HTML fixture moves with the parsing tests. MERL-T keeps a synthetic **record** fixture for
  its adapter and assembly tests.
- `build_rv_bands.py` moves with `citations.py`.

Two other ways were considered and not recommended:
- MERL-T keeps full copies with a parity test, as `map.py` is today. That duplicates about 850 lines
  of grammar, and every measured fix would land twice.
- MERL-T installs the API's package. That ties the two images and their dependencies together.

**Point ids.** MERL-T's existing points stay valid only if a paragraph's text and its pieces are
byte-identical to what wrote them. The parser changed after the pilot (§1.3). So the baseline
is a fresh run of today's MERL-T code on vol. 96, made just before PR 3, and not the pilot's
historical report. After PR 3, the same volume through the new adapter must give the same point
ids, the same bridge rows and the same edge counts.

### (a) The Python API owns parsing and a store keyed by norm URN — recommended

**What moves.** These go to `services/visualex/visualex_api/services/massimario/`, next to
`massimario_portal.py`:
- `paragraphs.py`, `citations.py`, `urns.py`, `rv_bands.py` and its JSON;
- a copy of `identity.py` (§3.1);
- the reading half of `volume.py`;
- the record builder extracted from `_Volume`, with the parse report;
- `build_rv_bands.py`;
- their tests and the HTML fixture.

`urns.py` goes back to the original table in `tools/map.py` instead of MERL-T's copy.

**The store.** A SQLite file in the API's data directory, with these tables:
- `volumes`: id, title, year, archive, number, the parser version, when and from what it was
  built;
- `sections`;
- `paragraphs`, by key;
- `norm_links`: the URN, the paragraph key, year, archive and `ordine`, indexed on
  `(urn, anno, archivio, ordine)`;
- `decision_links`: the decision key and the paragraph key, for a later "in the reviews" on the
  decision page; written now, read by nothing yet;
- `resolved_acts`: year-only URN → full URN, reused across rebuilds;
- `meta`: the schema version.

The file name carries the schema version (`rassegne-v1.sqlite3`). `.gitignore` already ignores the API's data directory,
`services/visualex/data/`.

Every build writes a temporary file and swaps it in whole, as in #206:
- a build for one volume copies the other volumes' rows from the current store into the
  temporary file, so adding next year's volume never re-fetches the others;
- `--remove <volume>` works the same way;
- a build removes the files of older schema versions.

**How it is filled.** A build command in the API package reads one of two sources:
- (i) **the portal**, through the existing paced client. The whole corpus is about 1,500
  requests at ≥ 1.5 s, so about 40 minutes, plus the year-only acts not yet in
  `resolved_acts`;
- (ii) **the raw archive**: a local folder in the portal's own JSON, so no requests at all.

It builds one volume or the whole corpus.

**URN identity in the store.** Each URN that `urns.to_canonical` produces is passed through
`normalize_norm_urn` (`tools/sources.py`) before it is stored. The two disagree today, for
instance on ministerial decrees: `normalize_norm_urn` rewrites `…ministero.<x>:decreto:…` to
`stato:decreto.ministeriale:…`, and `urns.py` does not. §5 has the test.

**How it is read.** `GET /fetch_rassegne?urn=&anno=&archivio=&cursor=`:
- the same query validation and the same response as today;
- the URN goes through `normalize_norm_urn`;
- a missing store gives 200 with `total: 0`; an unreadable store, or one of unknown schema, gives
  503 (§2.5);
- the path is added to the Vite proxy, to the ingress's `@legal` list (behind the login,
  ADR-001) and to `infra/ingress/paths.test.mjs`.

On the server, `routes/merlt/rassegne.ts`, `graphClient.rassegneByNorma`, `rassegneTypes.ts`
and their registration in `routes/merlt/index.ts` are removed.

**What stays in MERL-T:**
- the graph writes: `AttoGiudiziario` nodes, `Norma` stubs, the `INTERPRETA` co-citation edges,
  `promote.py`, `report.py`;
- the vectors and bridge rows: `vectors.py` and the worker;
- the assembly half of `volume.py`, now fed by records;
- the staging and report in the admin's Ingestione tab;
- `remove_massimario_prose.py`, for MERL-T's own copy;
- `identity.py` (§3.1).

`reader.py`, `rassegne_router.py`, its registration (`api/__init__.py`, `app.py`) and the
bridge methods only the reader uses (`year_counts_for_node`, `archives_for_node`,
`page_for_node`) are deleted.

**How MERL-T keeps consuming.** `MassimarioAdapter` stops fetching and parsing. It asks the API
for a volume's records and parse report through a new internal route,
`GET /massimario/volume/<id>/records`. Like `/fetch_massimario`, that route is not in the
ingress, the Vite proxy or `legalFetch`.
- The API does not know MERL-T exists.
- A MERL-T outage changes nothing for the reader.
- An API outage stops MERL-T's ingestion, as it does today.
- The norm URNs MERL-T receives are the normalised ones. For the few that `normalize_norm_urn`
  rewrites, a re-run would key new stubs and bridge rows differently from today's. PR 1 counts
  them on vol. 96. Aligning MERL-T's existing keys is part of MERL-T adopting the convention for
  norms, not of this round.

**Migration of what is in development.** Vol. 96 is built into the store, from the raw archive
or from the portal (a few dozen requests). MERL-T's vol. 96 data stays as it is. The check of
§3.1 runs against a fresh baseline.

**Migration on the deployment host.** The store is built fresh (Q4). Any review data MERL-T may
hold there is left alone: the reader no longer reads it.

**Load on the deployment host.**
- Reading is one indexed SQLite query per summary or page, with no network hop and no model.
- Building is light on CPU: regexes over 63 million characters take minutes.
- With source (i) the host makes the portal requests. With source (ii) it makes none: the file
  is built elsewhere and copied (§8).

**Size.** About 65 MB of text, plus structure, spans and decisions. The estimate is 120–200 MB
for the whole corpus on disk; #206's index is about 110 MB for 46,607 massime. PR 1 measures
vol. 96 and states the figure. The pilot alone is a few MB.

**Effort.** Three PRs, 6–8 working days:
1. **API, 3–4 days.** Move the parsing with its tests, extract the record builder and the parse
   report from `_Volume`, add the store, the build command, both routes and the URN tests (§5).
2. **Web and ingress, 1–2 days.**
   - The fetcher goes through `legalFetch`.
   - The panel leaves the plugin registry and becomes a core block in «Giurisprudenza», beside
     #206's block.
   - Update the path lists and remove the server route.
   - This PR touches `infra/`: reserve it in the owners' register; it gets a CODEOWNERS review.
3. **MERL-T, 2 days.**
   - The adapter reads records, and assembly is fed by records.
   - Delete the reader, its route and the bridge methods.
   - Add the record fixture, and run the point-id check of §3.1.

**Backups.** The API's data volume (`scrapers_data`) is not in `scripts/datakit`:
`DEFAULT_VOLUMES` lists MERL-T's volumes only. The store is a derived file, and deleting it
costs one rebuild. Option (a) accepts this, as #206 does for its index, and says so in
`services/visualex/CLAUDE.md`. Adding the volume to datakit is a later choice (Q4).

### (b) The server owns a Prisma table filled by an import job

**What moves.** The parsing moves to the Python API as in (a), with the same records (§3.1).
Porting a grammar measured at 98.8 % on the whole corpus to TypeScript would mean measuring it
again from scratch. The server gains:
- Prisma models: `RassegnaVolume`, `RassegnaParagraph`, `RassegnaNormLink` and a decision-link
  table;
- an import job that loads a volume's records from the API;
- `GET /api/rassegne`.

**What stays in MERL-T, and how it consumes.** The same as (a): MERL-T reads the records from
the API. Reading them from the server instead would be worse, since MERL-T has no server
credentials today.

**Migration.** A Prisma migration, written by hand and applied with `migrate deploy`. It is
reserved in the register, reviewed by CODEOWNERS, and needs a dry run on a copy of the
production database at the next release. Vol. 96 is imported in development.

**Load on the host.** Reading is one indexed Postgres query. The import writes about 100,000
rows into the user database.

**Size.** The same data takes about 150–250 MB in `visualex_platform`, with Postgres's overhead
and indexes. Every `scripts/backup.sh` carries it, and every restore replays it.

**Effort.** Four PRs, 8–10 days: the API records, the migration with its models, the import job
with the route, then web and MERL-T.

**For it:**
- the existing datakit backs it up;
- the route stays under `/api/`, with no ingress change;
- it could later join user data (anchors, dossier items) in one database.

**Against it:**
- it puts a public, rebuildable corpus into the database of user data: bigger backups, slower
  restores, and a migration in every release that touches it;
- it goes against the rest of the architecture, where the server proxies legal sources and holds
  what users own (`apps/server/CLAUDE.md`: «the persistence for every user-owned slice»);
- each new volume needs both the API and the server.

### (c) A static, versioned data file built offline and served by the Python API

**What moves.** The parsing, as in (a). A build command turns the raw archive into a read-only
file (SQLite or JSONL.gz) with a manifest: the volumes, the counts and a SHA-256. The API opens
the file read-only and serves the same route as (a).

**What stays in MERL-T, and how it consumes.** The same as (a): MERL-T reads records from the
API.

**Migration.** Build the file from the archive and copy it into place in development. Nothing
changes in MERL-T beyond (a)'s PR 3.

**Load on the host.** The lowest: no build, no requests, only reads.

**Size.** The same as (a) on disk; about 30–50 MB gzipped for transfer (estimate).

**Effort.** Three PRs, 5–7 days: (a) without the portal build path.

**For it:** the host only reads, and a file is easy to reason about and to version.

**Against it:**
- the file cannot go in the repository (rights, §7; size), nor in a public release asset, which
  would publish the prose;
- it reaches the host outside git, by hand or through a new datakit store, so every deploy and
  every new volume has a manual step;
- development and host can drift apart unless the API checks the manifest's hash at startup.

### Recommendation

**(a)**, with its store kept as one versioned file that is always swapped in whole.
- It keeps (c)'s strength: the file can be built locally from the raw archive and copied when
  the host should not make portal requests.
- It keeps the server's database for what users own.
- It follows #206's pattern and needs no migration.
- It lets the reader show volumes without waiting for the graph's phase 2. Which volumes is a
  separate decision (Q2).

## 4. Rule 23: are review paragraphs anchored?

**Today, no.** Notes and highlights attach to `article_text` and to decision texts. The October
design keeps «adding a paragraph to a dossier, annotating it» out of scope (§3). The only
offsets into a paragraph are the panel's own `evidenziazioni` (the citation of this article).
The same parser run computes them and writes the text, and they are stored together. A parser
change rewrites both at once, so they cannot drift apart.

**This round: still no anchors.** The parser changed several times while the corpus was being
measured: the portal's `<<…>>` is now read as text, and the `Sez. L` links as decisions.
Freezing it before anchors exist would block those fixes and protect nothing.

**If anchoring is decided** (Q3), two things bind from that PR on, as they do for decisions:

1. **The text is frozen.** The paragraph text joins the frozen-text contract. Its projection is
   the text with every `\n` removed; the parser already collapses whitespace and emits no `\n`
   (`paragraphs.py`, `_collapse`). A `test_rassegne_text_frozen.py` runs on synthetic sections,
   and a `_local` twin runs on real volumes kept outside the repository. Each compares a
   paragraph's projection with a stored SHA-256 and length, never with the text. The golden is
   never re-recorded to make a test pass.
2. **The target is stable.** `paragraph_key` is a position (`<section>|<index>`), so a parser
   change that splits a section differently renumbers the paragraphs after the split.
   - The anchor therefore pins `(paragraph_key, parser_version)`, and the store keeps the parser
     version per volume (§3(a)).
   - The anchors live in the server's database and the API cannot see them. So a parser-version
     change becomes a release step: the server lists the anchors on the old version and either
     carries them over or shows them as no longer landing, as `UnmatchedAnchors` does for
     decisions.
   - That PR settles the mechanism.

The store records `parser_version` from PR 1, so this costs no new migration later.

## 5. Identity and citations

- **Norms.** The store keys `norm_links` by the convention's article identity: the full
  Normattiva URN at article level, as `normalize_norm_urn` writes it (`conventions/sources/`,
  `golden.json`). The reader's query normalises with the same function.
  - The portal's code forms (`codice.civile:…`) map to the enacting decree and its annex
    (`urns.py`, `CODE_ACTS`).
  - PR 1 tests on the fixture that every stored URN is a fixed point of `normalize_norm_urn`,
    and that the golden's code cases land where `urns.py` puts them. When the API adopts
    `golden.json` for norms, these tests join that adoption.
- **Decisions.** A cited decision keeps the shared identity of the source convention
  (`docs/superpowers/specs/2026-10-04-source-convention-design.md`; `identity.py`):
  `cassazione:<archivio>:<numero>:<anno>`, with the deposit year for criminal decisions, and
  `corte_costituzionale:<numero>:<anno>`. The fields of §3.1 are stored with it. A reference
  without identity keeps `key: null`.
- **On the web.** `DecisionChip` links through `linkableDecisionPath` and writes its label with
  `formatDecisionShort` from the fields (`apps/web/src/utils/decisionLinks.ts`). It does not
  read the stored `label`.
  - The response keeps `label` for compatibility. PR 1 decides between porting `decision_short`
    to the API, checked against MERL-T's label tests and the golden's `short_with_rv` case, or
    dropping the field from the response along with its type.
- **For MERL-T.** The records carry the same decision keys, so its `AttoGiudiziario` nodes and
  bridge rows match the core's `decision_links` one to one. The same holds for norm URNs, except
  for the few that normalisation rewrites (§3(a)).

## 6. The reader in the meantime (separate from this spec)

A small web fix is already assigned as its own PR. It does not wait for this design, and this
spec does not propose it again.

**Facts for that fix (§1.1):**
- The panel already appears only inside an opened «Giurisprudenza».
- On the deployment host the case seen today is the 503. The 404 `merlt_disabled` happens only
  when the web and server flags disagree.

So the fix's substance is:
- no panel on 404;
- on 503, nothing that shouts under every article: at most the notice inside the panel's own
  row, once the reader opens it.

**When option (a) lands,** the panel no longer calls `/api/merlt`, and the same rule applies to
the new route: 200 with `total: 0` draws nothing, and a 503 is a quiet notice.

## 7. Rights

- **Source.** The Ufficio del Massimario della Corte di cassazione, Portale del Massimario,
  annual reviews. The portal's legal notes reserve the Office's copyright and allow use only
  for scientific and teaching purposes, not for profit. The owners weighed this on 30 September
  (October design §2, decision 2). Dated copies of the notes are kept with the raw archive.
- **What changes.** In the October design the prose reached a reader only where MERL-T held it:
  vol. 96 was promoted in development only. With this design the core serves the prose, so it
  reaches every signed-in user of the deployment for certain, and later the public alpha. The
  owners' 30 September decision did not consider that audience: see Q1.
- **Copies to remove.** The prose sits in more than one place:
  - the core store: removable in one operation, by deleting the file or running
    `--remove <volume>`;
  - MERL-T's Qdrant points and bridge rows: `remove_massimario_prose.py`;
  - **MERL-T's staging batches**: `MerltIngestionBatch.extras.chunks` holds the full payloads
    today, and `scripts/backup.sh` carries them with MERL-T's database. The removal script does
    not touch them. This gap already exists, and PR 3 fixes it: the script also clears the
    Massimario batches' `extras`.
- **What stays.**
  - Every paragraph credits the source and links to its section on the portal
    (`RassegnaPassage.tsx`, unchanged).
  - The route is behind the login (ADR-001).
- **Never in the repository:** review text.
  - Tests use synthetic fixtures written in the portal's format.
  - Real volumes are kept local, for the `_local` tests.
  - The store file is ignored by git.
  - `rv_bands.json` (numbers only) holds no prose, and neither would a committed table of
    resolved acts (Normattiva facts).

## 8. Operations (option a)

- **Development.** `./start.sh --dev` does not build the store; an empty store means no panel.
  The build is one command, documented in `services/visualex/CLAUDE.md`.
- **Deployment host.** The store lives in the API's data volume. It is built once (from the
  portal, or by copying a file built from the raw archive: Q4), and again for each new annual
  volume. It is not part of `./start.sh --prod`, so a deploy never waits on the portal.
- **Schema changes.** The API refuses to open a store whose schema version it does not know,
  and answers 503; it never guesses at an older layout. A release that changes the store's
  schema adds a step to the release checklist (`docs/git-workflow.md`): rebuild or copy the new
  store before the deploy. Until then the panel shows the quiet notice of §6.

## 9. Questions for the owners

1. **Q1: the prose in production.** Serving the reviews from the core puts their prose in front
   of every signed-in user of the deployment (the closed beta of about 20 testers), and later of
   the public alpha. Is that within the 30 September decision?
   *Recommendation:* yes for the closed beta, with the credit and the removal as they are. Look
   at it again before the public alpha.
2. **Q2: which volumes the reader shows.** The graph waits for phase 2; the reader no longer has
   to.
   *Recommendation:* all 63 volumes in the reader, as soon as the store is built. MERL-T's graph
   keeps promoting volume by volume under its own gate.
3. **Q3: anchors on paragraphs.** Should a review paragraph take notes, highlights or «add to
   dossier»?
   *Recommendation:* not in this round. If yes later, §4 applies from that PR on (frozen
   projection, anchors pinned to the parser version).
4. **Q4: how the host gets the store.** Built on the host from the portal (about 40 minutes of
   paced requests from the host's address), or built locally from the raw archive and copied?
   And should the API's data volume join `scripts/datakit`?
   *Recommendation:* build locally from the archive and copy the file for the whole corpus; use
   the portal build only for next year's volume. Leave datakit as it is: the store is derived and
   can be rebuilt.
5. **Q5: the option.** (a), (b) or (c)?
   *Recommendation:* (a), §3.

## 10. Verification, for the PRs that follow

- **API:**
  - the moved tests are green in their new home;
  - the store builds from the synthetic fixture, whole and per volume, the latter keeping the
    other volumes;
  - the route's validation and paging work; a missing store gives 200 with `total: 0`, an
    unknown version gives 503;
  - the URN tests of §5 pass;
  - the parse report of vol. 96 equals a fresh run of today's MERL-T code (local).
- **Web:**
  - the panel sits outside the plugin registry and mounts with `VITE_FEATURE_MERLT=false`;
  - the error states of §6 hold;
  - the existing panel tests are moved.
- **MERL-T:**
  - the adapter test runs on records;
  - a re-run of vol. 96 changes no point id, no bridge row and no edge count, against the fresh
    baseline (§3.1);
  - the removal script also clears the staging copies.
- **Browser pass** on `http://localhost:5173` with the MERL-T profile off:
  - art. 2043 c.c. shows its paragraphs;
  - an article no paragraph cites shows nothing;
  - the decision chips open the decision page.
- The suites of every area touched are green.
