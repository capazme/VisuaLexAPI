# Archivio normativo locale — Design

Round opened 2026-09-19. The owner (a practising lawyer and DPO) wants a local,
structured, **updatable** archive of the sources he uses in practice: the
consolidated text in force, one record per article (or recital, for EU acts),
plus an enrichment layer (annotations, brocardi, case law, authority practice)
attached to each article and clearly attributed to its source.

Not a one-off download. A reusable, idempotent, resumable script he can rerun
periodically, driven by an external manifest he can edit without touching code.

Confirmed by the owner on 2026-09-19:

1. VisuaLex may be extended with three small vanilla features (recitals,
   AKN fingerprints, EU consolidated texts) developed on `main`.
2. The script is an HTTP client of the local VisuaLex API (approach A below),
   packaged as `archivio_normativo/` in this repo, output in `archivio_out/`.
3. SQLite is the primary archive; JSONL is an optional export.
4. The enrichment kinds table and the refresh policy (text changed / 90 days /
   `--refresh-enrich`) stand as written.

## Context

VisuaLex fetches Italian and EU legal texts live and stores no legal content.
Its Python API already answers everything the archive needs for the **text and
structure** of an act: the ordered index with headings and annexes
(`/fetch_tree` with `details=true`), article titles and repealed articles
(`/fetch_rubriche`), the consolidated text one article at a time as NDJSON
(`/stream_article_text`), and Brocardi's annotations as structured fields
(`show_brocardi_info`).

The rest of the enrichment the owner asked for — Cassazione, TAR/Consiglio di
Stato, tax courts, CGUE, Corte costituzionale, Garante privacy, EU↔IT
transposition — lives in the sibling MCP server `mcp-legal-it` (FastMCP over
stdio, the same server Claude uses as the `legal-it` plugin). Its tools return
**markdown text**, not structured records; the archive stores that text as-is,
attributed and dated.

Three gaps were found during reconnaissance and are closed by this design:

- VisuaLex has no support for EU **recitals** (considerando).
- There is no cheap way to ask "which articles of this act changed since last
  time"; a full refetch of ~10,000 articles is the only option today.
- For regulations and directives VisuaLex reads the **Official Journal** text
  (`/eli/reg/2016/679/oj/ita`), not the consolidated version. Immaterial for
  most of the corpus; material for Dir. 2002/58/CE (the cookie rule in art.
  5(3) is in the 2009 version) and Reg. (UE) 910/2014 (rewritten by
  Reg. 2024/1183).

## Goals

- One record per article / recital, with: stable identifier (Normattiva URN,
  CELEX), number, rubrica, full text, libro/titolo/capo/sezione, date the text
  is in force as of, last-amendment date where the source gives one, source URL.
- Optional enrichment per corpus, switchable from the command line.
- Two outputs from the same data: SQLite (queryable) and one Markdown file per
  act (readable, with an index and internal links), in an area folder tree.
- Idempotent, resumable, rate-limited, logged, with a final report and an
  integrity check.

## Non-goals (v1)

- Parsing the enrichment markdown into per-decision records.
- A historical view of amendments before the archive was born.
- Any UI. The archive is files.
- Writing into the owner's Obsidian vault.

## Approach

Three ways to sit next to VisuaLex were weighed:

| | Approach | For | Against |
|---|---|---|---|
| **A** | HTTP client of the local API | clean boundary (the endpoints the frontend uses); inherits cache, circuit breakers, egress allowlist, 404/429 error mapping; works against any instance | the API must be running |
| B | import `visualex_api` in-process | no server | coupled to scraper internals and the Playwright pool; every refactor breaks it; bypasses error mapping |
| C | everything through `mcp-legal-it` | one provider | unstructured text, no tree/rubriche/annexes, Brocardi as markdown only |

**A is chosen.** `mcp-legal-it` is reached only for what VisuaLex does not have,
through the official `mcp` Python client over stdio.

## Architecture

```
manifest.yaml ──► manifest.py ──► pipeline.py (one act at a time)
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        ▼                            ▼                             ▼
 sources/visualex.py         sources/legalit.py               store.py (SQLite)
 /fetch_tree (details)       MCP stdio client                 upsert per unit,
 /fetch_rubriche             giurisprudenza_su_norma …        hash registry,
 /fetch_act_fingerprints*    pronunce_cost_su_norma …         runs, unit log
 /fetch_recitals*            cerca_provvedimenti_garante        │
 /stream_article_text        get_eu_basis / attuazione          ▼
   (+ structured brocardi)                               render_md.py → one .md per act
                                                          verify.py  → gaps/dups/empty
        * = new VisuaLex endpoints (see "VisuaLex extensions")   report.py  → summary table
```

### Package layout

A new top-level package beside `e2e/`:

```
archivio_normativo/
  __main__.py      python -m archivio_normativo → cli.main()
  cli.py           argparse: build | verify | render | report | export
  manifest.py      load + validate manifest.yaml → list[ActSpec]; slug checks
  pipeline.py      per-act orchestration: index → diff → fetch → enrich → store
  hierarchy.py     tree headings → (libro, titolo, capo, sezione) per article
  sources/
    visualex.py    VisuaLexClient (aiohttp): tree, rubriche, fingerprints,
                   recitals, stream_articles; NDJSON parsing; 4xx/5xx mapping
    legalit.py     LegalItClient: spawn the MCP server, call_tool(name, args) → str
  store.py         SQLite schema, upserts, registry queries, run bookkeeping
  render_md.py     Markdown per act + INDICE.md, deterministic
  verify.py        integrity checks over the store
  throttle.py      token bucket per provider + exponential backoff with jitter
  report.py        end-of-run summary
  manifest.yaml    the corpus (owner-editable)
tests/archivio/    pytest, offline fixtures, fake VisuaLex server
```

Dependencies: `aiohttp` and `pyyaml` (already in `requirements.txt`), `sqlite3`
(stdlib), and `mcp` (the official client SDK) — new, imported lazily and only
when an enrichment kind beyond `brocardi` is requested. Declared in
`requirements-archivio.txt`. Python ≥ 3.11.

### Per-act flow (Normattiva)

1. `POST /fetch_tree {urn, details: true, return_metadata: true}` → an ordered
   list mixing heading strings ("LIBRO QUARTO Delle obbligazioni", "TITOLO IX
   Dei fatti illeciti", "CAPO I …", "SEZIONE I …", annex labels) and article
   dicts (`numero`, `link`). `metadata.annexes` gives each annex's number and
   article list. `hierarchy.py` walks the list with a stack: a heading at level
   L resets every level below L (levels: PARTE > LIBRO > TITOLO > CAPO >
   SEZIONE; all five are stored); every article dict takes the current values. Position in the list
   is the unit's `position`.
2. `POST /fetch_rubriche {urn}` → `rubriche` (number → title), `abrogati`,
   `parts`.
3. `POST /fetch_act_fingerprints {urn}` → per article `{fingerprint,
   date}`. Compared with the stored fingerprint: only articles that
   are new or whose fingerprint changed go to step 4. On the first run, or with
   `--full`, every article does. If the endpoint answers with no index (AKN
   unavailable), the act falls back to a full fetch for this run and the report
   says so.
4. `POST /stream_article_text {act_type, date, act_number, annex, article:
   "2043,2044,…", show_brocardi_info}` in batches of `--batch-size` (default
   25) articles. One NDJSON object per article: `norma_data` (URN, allegato,
   numero_articolo), `article_text`, `url`, optional `brocardi_info` or a
   per-article error. Batching keeps the request count far below the API's
   per-IP limiter (1000 per 10 minutes); pacing is applied per article.
5. Enrichment (see below) for the kinds active on this act, for the units
   whose enrichment is due.
6. `store.upsert_unit(...)` — committed per unit, so the run can be killed at
   any moment. The act's Markdown is re-rendered at the end of the act only if
   a unit or an enrichment of that act changed in this run.

### Per-act flow (EUR-Lex)

Same steps without fingerprints: the act is one page, VisuaLex caches it for
24 h, so a full refetch costs one download plus in-memory extraction. Step 1
uses the EUR-Lex tree (TITOLO/CAPO/SEZIONE headings, articles); recitals come
from `POST /fetch_recitals` in one call per act. Units of kind `recital` carry
no libro/titolo/capo/sezione.

### Identifiers

- Normattiva article: the `urn` VisuaLex returns in `norma_data`, e.g.
  `urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043`. Act identifier: the
  same URN without the `~art…` suffix.
- EU article: `<CELEX>#art_<n>`, recital: `<CELEX>#rct_<n>`; act identifier:
  the CELEX of the base act (`32016R0679`). When a consolidated version is
  served, `acts.text_status = consolidated` and `acts.consolidated_celex`
  holds the sector-0 CELEX (`02002L0058-20091219`); otherwise `text_status =
  oj`.

Unit primary key: `<act_id>:<kind>:<number>` with the number normalised the
way `normalize_article_key` does on the server (`2-bis`, never `2 bis`).

## Manifest

`archivio_normativo/manifest.yaml`, validated on load. Unknown keys are an
error (a typo must not silently disable an option).

```yaml
version: 1

providers:
  visualex:
    base_url: "http://localhost:5000"
  legalit:
    # The MCP server command. Only ever read from this local file, never from
    # downloaded data. Overridable with LEGALIT_MCP_COMMAND (JSON list).
    command: ["bash", "~/.claude/plugins/cache/mcp-legal-it/legal-it/2.13.0/start_server.sh"]

defaults:
  version: vigente
  rate_per_second: 1.0          # towards VisuaLex, counted per article
  enrich_rate_per_second: 0.5   # towards legal-it (Italgiure, CdS, CeRDEF… behind it)
  enrich_ttl_days: 90
  enrich: []
  batch_size: 25

acts:
  - id: cc                      # slug [a-z0-9-]+: file name and record key
    area: civile                # one of the eight area slugs below
    label: Codice civile
    source: normattiva
    act_type: codice civile     # codici need no date/act_number: VisuaLex knows them
    cite: "c.c."                # how the owner writes it: composes "art. 2043 c.c." for legal-it
    enrich: [brocardi]
    enrich_articles: "1173-2059"   # optional: restrict enrichment to a range/list

  - id: gdpr
    area: privacy-digitale
    label: Regolamento (UE) 2016/679 (GDPR)
    source: eurlex
    act_type: regolamento ue
    date: "2016"
    act_number: "679"
    celex: 32016R0679
    units: [articles, recitals]
    cite: "GDPR"
    enrich: [brocardi, cassazione, cgue, garante, attuazione]
```

| key | required | meaning |
|---|---|---|
| `id` | yes | slug; path component and record key |
| `area` | yes | `costituzionale` \| `civile` \| `penale` \| `amministrativo` \| `tributario` \| `lavoro` \| `privacy-digitale` \| `ue` |
| `label` | yes | human title, used in Markdown and reports |
| `source` | yes | `normattiva` \| `eurlex` |
| `act_type` | yes | VisuaLex's `act_type` vocabulary (`codice civile`, `decreto legislativo`, `legge`, `regolamento ue`, `direttiva ue`, …) |
| `date`, `act_number` | for non-codici | full date `YYYY-MM-DD` for Normattiva; year for EUR-Lex |
| `annex` | no | explicit annex number when VisuaLex's default is not the wanted one (e.g. the norme di attuazione of the c.p.a.) |
| `celex` | eurlex | CELEX of the base act |
| `celex_consolidated` | no | sector-0 CELEX of the consolidated version to serve (extension 3) |
| `units` | no | `[articles]` (default) or `[articles, recitals]` |
| `cite` | yes | short citation used to build `riferimento` for legal-it tools |
| `enrich` | no | list of kinds, default from `defaults.enrich` |
| `enrich_articles` | no | ranges/lists like `"1173-2059, 2643"`; enrichment runs only on these |
| `version` | no | `vigente` (default); `originale` is accepted but not the point of this archive |

Every act is validated at the start of a run (and in `--dry-run`): the tree
must resolve, and when `annex` is given it must match one of the annexes
`/fetch_tree` reports. An act that does not resolve is reported and skipped;
it never aborts the run.

### Initial corpus

The manifest ships with the owner's list. Codici use VisuaLex's codice names;
everything else carries date and number.

| area | id | act |
|---|---|---|
| costituzionale | `costituzione` | Costituzione (`act_type: costituzione`) |
| civile | `preleggi` | Disposizioni sulla legge in generale (`preleggi`) |
| civile | `cc`, `cc-disp-att` | Codice civile; disp. att. (`disposizioni per l'attuazione del Codice civile e disposizioni transitorie`) |
| civile | `cpc`, `cpc-disp-att` | Codice di procedura civile; disp. att. (`disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie`) |
| penale | `cp` | Codice penale |
| penale | `cpp`, `cpp-disp-att` | Codice di procedura penale; norme di attuazione (`norme di attuazione, di coordinamento e transitorie del codice di procedura penale`) |
| amministrativo | `cpa`, `cpa-disp-att` | D.Lgs. 104/2010 (`codice del processo amministrativo`; the norme di attuazione as a second entry with explicit `annex`) |
| civile | `cod-consumo` | D.Lgs. 206/2005 (`codice del consumo`) |
| penale | `dlgs-231-2001` | D.Lgs. 8 giugno 2001, n. 231 |
| amministrativo | `l-241-1990` | L. 7 agosto 1990, n. 241 |
| amministrativo | `l-689-1981` | L. 24 novembre 1981, n. 689 |
| privacy-digitale | `cod-privacy` | D.Lgs. 196/2003 (`codice in materia di protezione dei dati personali`) |
| privacy-digitale | `cad` | D.Lgs. 82/2005 (`codice dell'amministrazione digitale`) |
| privacy-digitale | `dlgs-138-2024` | D.Lgs. 4 settembre 2024, n. 138 (NIS2) |
| privacy-digitale | `dlgs-23-2025` | D.Lgs. 10 marzo 2025, n. 23 (DORA) |
| lavoro | `dlgs-81-2008` | D.Lgs. 9 aprile 2008, n. 81 |
| lavoro | `l-300-1970` | L. 20 maggio 1970, n. 300 |
| civile | `l-633-1941` | L. 22 aprile 1941, n. 633 |
| amministrativo | `cod-appalti` | D.Lgs. 36/2023 (`codice dei contratti pubblici`) |
| amministrativo | `dlgs-33-2013` | D.Lgs. 14 marzo 2013, n. 33 |
| civile | `ccii` | D.Lgs. 14/2019 (`codice della crisi d'impresa e dell'insolvenza`) |
| tributario | `tuir`, `dpr-600-1973`, `dpr-633-1972`, `dlgs-546-1992` | d.P.R. 917/1986; d.P.R. 600/1973; d.P.R. 633/1972; D.Lgs. 546/1992 (`codice del processo tributario`) |
| ue | `gdpr` | Reg. (UE) 2016/679 — `32016R0679` |
| ue | `eprivacy` | Dir. 2002/58/CE — `32002L0058`, `celex_consolidated: 02002L0058-20091219` |
| ue | `ai-act` | Reg. (UE) 2024/1689 — `32024R1689` |
| ue | `nis2` | Dir. (UE) 2022/2555 — `32022L2555` |
| ue | `dora` | Reg. (UE) 2022/2554 — `32022R2554` |
| ue | `dsa`, `dma` | Reg. (UE) 2022/2065 — `32022R2065`; Reg. (UE) 2022/1925 — `32022R1925` |
| ue | `data-act`, `dga` | Reg. (UE) 2023/2854 — `32023R2854`; Reg. (UE) 2022/868 — `32022R0868` |
| ue | `eidas`, `eidas2` | Reg. (UE) 910/2014 — `32014R0910`, `celex_consolidated: 02014R0910-20241018`; Reg. (UE) 2024/1183 — `32024R1183` |
| ue | `cra` | Reg. (UE) 2024/2847 — `32024R2847` |

Dates and CELEX numbers in the shipped manifest are checked by the first
`--dry-run`; anything that fails to resolve is listed in the report for the
owner to correct in the file.

### Enrichment kinds

| kind | tool | source | level |
|---|---|---|---|
| `brocardi` (alias `annotazioni`) | VisuaLex `show_brocardi_info` | brocardi.it — ratio, spiegazione, massime, brocardi, glossario, **structured** | unit |
| `cassazione` | `giurisprudenza_su_norma` | Italgiure (archive 2020+) | unit |
| `cassazione_massime` | `giurisprudenza_articolo` | Brocardi → Italgiure (two hops, slower) | unit |
| `amministrativa` | `giurisprudenza_amm_su_norma` | giustizia-amministrativa.it | unit |
| `tributaria` | `cerca_giurisprudenza_tributaria` | CeRDEF | unit |
| `cgue` | `giurisprudenza_cgue_su_norma` | CELLAR (EUR-Lex) | unit |
| `costituzionale` | `pronunce_cost_su_norma` | cortecostituzionale.it | unit |
| `garante` | `cerca_provvedimenti_garante` with query `"art. <n> <cite>"` | gpdp.it — full-text search, may be noisy | unit |
| `attuazione` | `get_italian_implementation` + `elenco_misure_nazionali` | EUR-Lex | **act** (EU acts only) |
| `base_ue` | `get_eu_basis` | EUR-Lex | **act** (Italian acts of EU origin) |
| `giurisprudenza` | group = cassazione + amministrativa + tributaria + cgue + costituzionale | | |

Unit-level tools receive `riferimento = f"art. {number} {cite}"`. Recitals get
no unit-level enrichment. Tool results are stored verbatim in `content_md`;
`brocardi` is stored as JSON in `content_json` and rendered field by field.

**Refresh policy.** An enrichment is (re)fetched when: the unit has none yet;
the unit's text changed in this run; it is older than `enrich_ttl_days`; or
`--refresh-enrich` is passed. Otherwise it is kept.

**Volumes.** ~9,500–10,000 Italian articles, ~700 EU articles, ~1,400
recitals. First run ≈ 3–4 h at 1 article/s (overnight); later runs: minutes
plus the changed articles. Case law: 5 sources × N articles at 0.5 req/s —
D.Lgs. 231 (109 articles) ≈ 20 min; the whole codice civile ≈ 9 h, which is
what `enrich_articles` is for.

## Data schema

Primary store: `archivio_out/archivio.sqlite`. All writes parametrised; one
transaction per unit.

**`acts`**

| column | notes |
|---|---|
| `id` TEXT PK | manifest id |
| `area`, `label`, `source` | |
| `identifier` | act URN (Normattiva) or CELEX (EUR-Lex) |
| `act_type`, `date`, `act_number`, `annex` | as resolved |
| `source_url` | |
| `text_status` | `consolidated` \| `oj` |
| `consolidated_celex` | nullable |
| `unit_count`, `updated_at` | |

**`units`**

| column | notes |
|---|---|
| `id` TEXT PK | `cc:art:2043`, `gdpr:rec:47` |
| `act_id` FK, `kind` | `article` \| `recital` |
| `number` | normalised (`2-bis`) |
| `position` INTEGER | order in the act's index — the true order, not a numeric sort |
| `identifier` | full URN with `~art…`, or `CELEX#art_n` / `CELEX#rct_n` |
| `rubrica` | nullable |
| `parte`, `libro`, `titolo`, `capo`, `sezione` | heading strings as read from the index (`parte` for acts divided in parti, e.g. the Costituzione); null for recitals |
| `text` NOT NULL | VisuaLex's `article_text` contract, never the AKN text |
| `text_hash` | sha256 of `text` — the change registry |
| `fingerprint` | AKN hash used for the diff; null for EUR-Lex |
| `abrogato` INTEGER | |
| `version`, `vigenza_al` | `vigente`; date of the download ("in force as of") |
| `ultimo_aggiornamento` | AKN expression date of the article where the export has one (codici: yes; flat acts: null) |
| `source_url`, `fetched_at` | |
| `first_seen_run`, `last_changed_run`, `last_checked_run` | run ids |

**`enrichments`**

| column | notes |
|---|---|
| `id` INTEGER PK | |
| `act_id` FK, `unit_id` FK nullable | null for act-level kinds |
| `kind`, `tool`, `params_json` | |
| `content_md` | verbatim tool output |
| `content_json` | structured Brocardi payload |
| `content_hash`, `fetched_at`, `run_id` | |
| `status`, `error` | `ok` \| `empty` \| `error` |
| | `UNIQUE(act_id, unit_id, kind)` |

**`runs`** — `id`, `started_at`, `finished_at`, `args_json`, `status`
(`running` \| `done` \| `interrupted`), `stats_json`.

**`unit_log`** — `run_id`, `unit_id`, `outcome` (`new` \| `updated` \|
`unchanged` \| `failed` \| `skipped`), `reason`.

### On-disk tree

```
archivio_out/                 (--out; the default is gitignored)
  archivio.sqlite
  INDICE.md                   acts by area, unit counts, last run date
  costituzionale/costituzione.md
  civile/cc.md  civile/cc-disp-att.md  civile/cpc.md …
  penale/ … amministrativo/ … tributario/ … lavoro/ … privacy-digitale/ … ue/
  logs/build-2026-09-19T21-04-12.log
```

### Markdown per act

Deterministic render from the store (running `render` twice yields identical
files):

- YAML front matter: `id`, `label`, `identifier`, `source`, `text_status`,
  `vigenza_al`, `units`, `rendered_at`.
- **Indice**: grouped by libro / titolo / capo, one line per unit,
  `[Art. 2043 — Risarcimento per fatto illecito](#art-2043)`.
- One section per unit: `## Art. 2043 — Risarcimento per fatto illecito`, a
  metadata line (URN linked to the source page, "vigente al", "ultimo
  aggiornamento" when known, "abrogato" when so), the text, then one
  subsection per enrichment present — `### Annotazioni (Brocardi)`,
  `### Cassazione (Italgiure, interrogato il 2026-09-19)`, … — each headed by
  its source and fetch date. Recitals: `## Considerando 47`.
- Anchors are GitHub-style heading slugs (`#art-2043`, `#art-2-bis`,
  `#considerando-47`).

Third-party text is written as Markdown; raw HTML tags inside it are escaped so
that nothing a source emits can execute in a viewer.

## Command line

```
python -m archivio_normativo build  [--manifest PATH] [--out DIR]
                                    [--only cc,gdpr] [--area civile]
                                    [--enrich brocardi,giurisprudenza] [--refresh-enrich]
                                    [--full] [--resume [RUN_ID]] [--dry-run]
                                    [--rate 1.0] [--enrich-rate 0.5] [--batch-size 25]
python -m archivio_normativo verify [--out DIR] [--only …]
python -m archivio_normativo render [--out DIR] [--only …]      # Markdown from the store, no network
python -m archivio_normativo report [--out DIR]                 # last run summary
python -m archivio_normativo export --jsonl PATH [--only …]     # optional JSONL
```

`--enrich` replaces the manifest defaults for the run on the selected acts;
`--only`/`--area` select the corpus. `build` ends with `verify` and the report.

## Operational behaviour

- **Idempotence.** A unit is rewritten only when `text_hash` differs. An act's
  Markdown is regenerated only when one of its units or enrichments changed in
  the run. Enrichments follow the refresh policy above.
- **Resume.** Every unit is committed as soon as it is stored. A run that dies
  stays `running`; on the next start it is marked `interrupted` and reported.
  `--resume` (latest interrupted run, or a given id) continues under that run
  id, skipping units already present in its `unit_log`. Without `--resume` a
  fresh run is nearly free anyway thanks to the fingerprints.
- **`--full`.** Ignores fingerprints and refetches every unit. Recommended
  periodically (monthly) — see Limits.
- **`--dry-run`.** Runs the read-only steps (tree, rubriche, fingerprints,
  manifest validation) and prints, per act: units new / changed / unchanged,
  enrichment calls planned. Writes nothing (no SQLite, no files, no log file),
  never spawns the legal-it server.
- **Rate limiting.** One token bucket per provider (defaults 1.0/s VisuaLex per
  article, 0.5/s legal-it). Exponential backoff with jitter on 429, 5xx,
  timeouts and connection errors: base 2 s, factor 2, 5 attempts, then the
  unit is `failed` with the last error as reason. VisuaLex's own per-IP
  limiter is never approached: batches of 25 keep requests around 1/25 of the
  article rate.
- **Logging.** `logging` to `archivio_out/logs/build-<timestamp>.log` and to
  the console (INFO). One line per unit outcome:
  `UPDATED act=cc art=2043 hash=ab12…→cd34…`,
  `FAILED act=cpp art=415-bis reason=404 Articolo non presente…`,
  `UNCHANGED act=cc art=2044 (fingerprint)`. Enrichment lines carry kind and
  status.
- **Report.** Printed at the end: a table per act (units, new, updated,
  unchanged, failed, skipped), enrichment counts ok / empty / error, the list
  of failures with reasons, acts that did not resolve, duration. Then the
  integrity check output.
- **Integrity check (`verify`).** Per act: gaps in the numeric sequence (100
  → 102, reported as a list of missing numbers — legitimate gaps exist, so this
  is a signal, not an error), duplicate numbers, empty text, text shorter than
  40 characters and not marked `abrogato`, and **two units with identical
  text** — the fingerprint of "nonexistent article → Normattiva answers with
  art. 1" (CLAUDE.md gotcha 24). VisuaLex turns that into a 404 today; the
  check costs nothing and would catch a regression.

## VisuaLex extensions

Three vanilla features on `main`, each in its own commit with offline
fixtures and tests, developed test-first. Each one has to be documented in
CLAUDE.md's endpoint list and, where applicable, in `egress.py`'s
allowlist test (no new hosts are expected).

### 1. `POST /fetch_recitals`

Request `{act_type, date, act_number}` (EUR-Lex acts only; a Normattiva act
answers 400). Response `{recitals: [{number, text}], count, url}`. A new
`extract_recitals(soup)` in `eurlex_scraper.py` reads the recital blocks of
the cached page (the same page the tree and articles come from, so one call
per act costs nothing extra). Fixture: a trimmed EUR-Lex page with a handful
of recitals in both the current (`rct_N` ids) and the older markup, captured
during implementation.

### 2. `POST /fetch_act_fingerprints`

Request `{urn}`. Response:

```json
{
  "fingerprints": {"2043": {"fingerprint": "sha256…", "date": "2018-04-06"}},
  "parts": [{"name": "…", "fingerprints": {…}}],
  "count": 3249
}
```

`AktIndex` (`services/akn_fetch.py`) gains a `fingerprints` map built in
`_to_index` from the parsed article texts: `sha256` of the AKN article text
plus the article's `FRBRWork/FRBRdate` where the export has a
per-article `<doc>` (component acts, i.e. the codici; verified on the
committed fixture: art. 3-bis c.p. → 2018-04-06, the date the article was
introduced; the `FRBRExpression` date beside it is the act's, identical for
every article). Flat acts have act-level lifecycle only → `date` is
null. A hash is not the text, so the rule "AKN is structure and fallback,
never the display text" stands; the memory cost is ~200 KB for the codice
civile, inside `AKN_CACHE_MAX_ACTS`. The endpoint answers 200 with an empty
map when no AKN index is available (the archive then falls back to a full
fetch for that act).

### 3. EU consolidated texts

The manifest may declare `celex_consolidated`. VisuaLex learns to serve that
version: `EurlexScraper.get_uri` accepts an explicit consolidated CELEX and
builds `https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:<id>`;
`/fetch_tree`, `/fetch_rubriche`, `/fetch_recitals` and `/stream_article_text`
accept an optional `celex_consolidated` field for EU acts and thread it
through. `NormaVisitata` carries it so the URN/cache keys differ from the OJ
version.

**Gate.** Before writing this feature, a one-hour spike checks that the
consolidated HTML (`02002L0058-20091219`, `02014R0910-20241018`) is parsed by
the existing article/tree/recital extractors or by a small selector change.
If it is not tractable in that budget, the feature is dropped from this round:
the archive then records `text_status: oj` for those acts, prints it in the
report and in each file's front matter, and the manifest key is accepted but
ignored with a warning. A consolidated text is never claimed when the OJ text
is what was fetched.

## Limits, stated

- Enrichment from legal-it is **markdown, not data**. Stored as-is, attributed
  and dated. No per-decision records in v1.
- AKN fingerprints detect **content** changes. A change to Normattiva's HTML
  rendering alone goes unnoticed until the next `--full`; an AKN-only change
  triggers a harmless refetch.
- `ultimo_aggiornamento` exists where the AKN export has a per-article
  lifecycle (codici). For flat acts it is null and the archive's own registry
  (`last_changed_run`) is the record — which starts today.
- For EU acts the index exposes CAPO/TITOLO labels without their heading text
  (current limit of the EUR-Lex tree parser). Not widened in this round.
- Tables in technical annexes (e.g. AI Act Annexes I–III) arrive as linear
  text, as VisuaLex extracts them.
- The archive needs the VisuaLex API running locally. It does not start it.

## Testing

Offline, under `tests/archivio/`:

- `hierarchy.py`: a LIBRO resets TITOLO/CAPO/SEZIONE; annex labels switch the
  annex; EU headings; articles before any heading get nulls.
- `manifest.py`: valid file loads; unknown key, bad slug, bad area, missing
  `cite`, `enrich_articles` syntax → clear errors.
- `sources/visualex.py`: against an `aiohttp` test server serving fixture
  JSON/NDJSON; 404 per article inside a stream, 429 then success, 5xx
  exhaustion, malformed NDJSON line.
- `throttle.py`: token bucket and backoff with a fake clock.
- `store.py`: schema creation, upsert semantics (unchanged/updated), resume
  skip-set, refresh policy decisions.
- `pipeline.py`: end-to-end on a two-act fixture manifest with the fake
  server; first run all `new`, second run all `unchanged`, fingerprint change
  → exactly one `updated`; `--dry-run` writes nothing (asserted on the tmp
  dir); `--resume` skips logged units.
- `render_md.py`: golden files; render twice → identical bytes.
- `verify.py`: gaps, duplicates, empty, short, identical texts.
- `sources/legalit.py`: the MCP client is mocked; one `-m live` smoke test
  calls `giurisprudenza_su_norma` once.

VisuaLex extensions follow the repo's rite: `.venv/bin/python -m pytest
tests/ -q`, fixtures under `tests/fixtures/`, plus a `live`-marked test each.

## Security

- `id` and `area` are validated as slugs; output paths are built from them
  only, under `--out` — no path traversal from the manifest.
- The legal-it command comes from the local manifest or an environment
  variable, never from fetched content.
- Third-party text is escaped when written to Markdown.
- SQLite queries are parametrised; the store never interpolates values.
- The archive talks to `localhost` VisuaLex by default; pointing it at
  `visualex.org` is possible but the rate defaults are chosen for a local
  instance and the report says which base URL was used.

## Out of scope / follow-ups

- Turning in-text citations into internal links (`/extract_citations` exists;
  a later round).
- Full heading text for EU CAPO/TITOLO.
- Structured parsing of case-law results.
- A `--since` view ("what changed since date X") over `unit_log` — the data is
  there; the command is a later addition.
