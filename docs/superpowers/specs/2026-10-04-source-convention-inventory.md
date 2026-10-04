# Legal sources: inventory of how norms and decisions are identified and labelled

Measured on 2026-10-04 against `develop` at `b513e3c0`. Companion of the design
`2026-10-04-source-convention-design.md`, which this inventory justifies.

## How it was measured

- **Code.** Every function and inline expression that builds an identity, a key
  or a human label for a norm or a decision, in the web app, the server, the MCP
  server, MERL-T and the Python API. Found by reading the files the brief names
  and by grepping for `Art. ${`, `art. ${`, `tipo_atto}`, `estremi`, `label`,
  `urn:nir`, `node_id`.
- **Outputs.** The same 22 norms (codes, the Constitution, preleggi, disp. att.,
  ordinary acts of seven types, aliased codes, a year-only act, a decree with no
  number, two EU acts, a treaty) were passed to the real functions: TypeScript
  through `tsx`, Python through the API's virtual environment with MERL-T's leaf
  modules loaded directly. Inline expressions in components were copied verbatim
  and are named by `file:line`. Appendix A holds the full matrix.
- **The graph.** Read-only Cypher (`GRAPH.RO_QUERY`) on the development graph
  `merl_t_legal`: node counts, key shapes, labels as stored.
- **Live sources.** Four `POST /fetch_decision` on the development API (one
  Sezioni Unite, one lavoro, one penal, one Corte costituzionale), one
  `/fetch_brocardi_info` (art. 2043 c.c., cached), two Normattiva resolutions of
  a ministerial decree. Spaced by several seconds.
- **mcp-legal-it** read as a reference only (`vendor/mcp-legal-it` at 2.3.3 in
  the main checkout; the submodule is not initialised in worktrees).

## 1. Summary

**Norms: one URN, eleven label styles.** The identity is sound where VisuaLex
builds it (`generate_urn`), with four defects at the edges. The labels are not:
for art. 2 of the l. 241/1990 the app writes, today, depending on the surface:

| Surface | Label |
|---|---|
| copy of a past text, dossier citation, MCP | `art. 2, l. 7 agosto 1990, n. 241` |
| copy of the text in force («Tratto da») | `legge n. 241 del 1990-08-07, Art. 2` |
| workspace subtitle | `7 agosto 1990` |
| tab | `legge 241` |
| article tab | `Art. 2 - legge n. 241` |
| dossier row | `legge 241` |
| dossier PDF heading | `1. legge n. 241 · Art. 2` |
| quick norm (stored) | `Art. 2 L. n. 241` |
| palette preview | `Art. 2 L. 241/1990` |
| in-text link | `Art. 2 L. 241/1990-08-07` |
| `/parse_query` display | `Art. 2 — legge` |
| graph `estremi` (ingested article) | `Art. 2 legge` |
| graph `estremi` (stub) | `Art. 2` |
| MERL-T citation export | `L. 7 agosto 1990, n. 241, art. 2` |
| Q&A source chip | `art. 2` |

Only two producers follow the owner's style, and they are pinned to each other
(`apps/web/src/utils/citation.ts`, `apps/server/src/norms/citation.ts`, golden
file `citationGolden.ts`). The web one cites only past texts; the text in force
still goes out as `legge n. 241 del 1990-08-07, Art. 2`.

**Decisions: one identity in two copies, three keys in the graph, five label
styles.** The identity (`cassazione:<archivio>:<numero>:<anno>`,
`corte_costituzionale:<numero>:<anno>`) is shared by the Sentenze reader and the
Massimario, in two independent implementations. The graph still holds 9,917
decisions keyed `massima_cassazione_civile_<n>_<anno>` from Brocardi, 127 of
which duplicate a Massimario node. The only worded citation of decisions is the
Sentenze plan's `formatDecisionCitation` (`decisionLinks.ts`, being built in
Sentenze PR B); nothing else uses it yet.

## 2. Identities and stored keys

### 2.1 Norms

| Producer | Where | Output (art. 2043 c.c.) | Notes |
|---|---|---|---|
| `generate_urn` | `services/visualex/visualex_api/tools/urngenerator.py` | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043` | the identity in practice: `norma_data.urn` / `url`, graph keys, discussions' `articleUrn` |
| `NORMATTIVA_URN_CODICI` | `visualex_api/tools/map.py`, copied in `services/merlt/merlt/utils/map.py` | `codice civile` → `regio.decreto:1942-03-16;262:2` | 38 rows; the two copies are identical today and no test pins them together |
| `canonical_urn` | `services/merlt/merlt/storage/graph/schema.py` | cuts `!vig=`, `!orig=`, `@originale` | graph key; the BFF's `normalizeGraphUrn` (`apps/server/src/services/merlt/graphClient.ts:94`) is a second implementation |
| Massimario `CODE_ACTS` | `services/merlt/merlt/pipeline/massimario/urns.py` | `stato:codice.civile:1942-03-16;262` → `stato:regio.decreto:1942-03-16;262:2` | maps the portal's alias URNs into VisuaLex's form |
| `buildItemKey` | `apps/web/src/utils/normaKeys.ts` | `codice-civile--262--1942-03-16--all2--2043` | **stored**: `Annotation`, `Highlight`, `Bookmark`, `NormaWatch`, `ArticleThread`, `LingoCardAncora` (`normaKey`) |
| `buildNormaKey` | same | `codice-civile--262--1942-03-16` | grouping only |
| `uniqueArticleIdFromNorma` | same | `all2:2043` | **stored** as `articleId` (`ArticleThread`, `LingoCardAncora`) |
| EU acts | `eurlex_scraper.get_uri` via `generate_urn` | `https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita` | the act's page; **no article** in it |

**Defects found:**

1. **A year-only act gets a synthetic date in its identity.** `legge`, `1983`,
   `184` → `…urn:nir:stato:legge:1983-01-01;184~art6`. The act is the l. 4
   maggio 1983, n. 184. `buildItemKey` gives `legge--184--1983--6` for it and
   `legge--184--1983-05-04--6` once the date is known: one article, two keys,
   and annotations split between them. (The year-only lookup bug is being fixed
   in `fix/year-only-date-lookup`; `act_dates.py` resolves such URNs for MERL-T.)
2. **An act with no number gets `;None`.** `decreto del presidente del consiglio
   dei ministri`, `2020-03-08` →
   `…stato:decreto.del.presidente.del.consiglio.dei.ministri:2020-03-08;None~art1`.
3. **Ministerial decrees are keyed under `stato`.** `decreto ministeriale` 55 of
   2014-03-10 → `…stato:decreto.ministeriale:2014-03-10;55`; Normattiva's own
   form is `…ministero.giustizia:decreto:2014-03-10;55`. Normattiva resolves both
   to the same act (checked live), so the reader works, but an identity read
   from another source (a Massimario link) would not join.
4. **The graph holds acts under malformed keys, next to the right ones.** Seven
   act nodes are keyed `…stato:decreto legislativo:…` (a space) and four
   `…stato:decreto-legge:…`, 34 nodes with their articles; Normattiva's form is `decreto.legislativo`,
   `decreto.legge`. The d.lgs. 206/2005 exists under both keys
   (`decreto.legislativo:2005-09-06;206` 3 nodes, `decreto legislativo:…` 3
   nodes). They come from old multivigenza writes (the VisuaLex route they called,
   `/fetch_amendment_history`, does not exist any more).
5. **Two rows of the codes table are not URN fragments.** «regolamento di attuazione
   del Codice della proprietà industriale» and «regolamento per l'esecuzione del
   codice di procedura penale» are stored as `/uri-res/N2Ls?urn:nir:ministero…`, so
   `generate_urn` writes `…urn:nir:stato:/uri-res/N2Ls?urn:nir:ministero.sviluppo.economico:decreto:2010-01-13;33~art1`.
6. **An EU article has no identity string.** The ELI page URL names the act; the
   article travels only as `numero_articolo`.

### 2.2 Decisions

| Producer | Where | Key | Notes |
|---|---|---|---|
| `Identity.key()` | `services/visualex/visualex_api/services/decisions/model.py` | `cassazione:civile:31310:2024` | Sentenze reader, cache keys |
| `DecisionIdentity.key` | `services/merlt/merlt/pipeline/massimario/identity.py` | same | second implementation; same fields and the same key (section never in it); its range checks differ (years 1900–2100 for both courts, no number ceiling) |
| `linkableDecisionPath` | `apps/web/src/utils/decisionLinks.ts` | `/sentenze/cassazione-civile/31310/2024` | the page's address, a contract (Sentenze spec §2) |
| graph, Brocardi ingestion | `services/merlt/merlt/pipeline/ingestion.py:1217` | `massima_cassazione_civile_31191_2025` | **9,917 `massima_*` nodes** (9,892 civil, 4 penal, 16 with no archive, 4 Corte cost., 1 Consiglio di Stato); the court word is Brocardi's `autorita` normalised («Cassazione civile», «Cassazione», «Corte Costituzionale», «Consiglio di Stato») |
| graph, Massimario | `pipeline/massimario/volume.py` | `cassazione:civile:10865:2023` | **1,030 + 27** nodes |
| graph, mechanistic extractor | `pipeline/enrichment/extractors/mechanistic.py:182` | `sentenza:cass_civ:<n>:<anno>` | no node in the graph today |
| citation chain tool | `services/merlt/merlt/tools/citation_chain.py` | `urn:giurisprudenza:cass:2024:12345` (docstring) | no node in the graph today |

**Measured:** 127 Brocardi nodes whose number and year equal a Massimario
node's (same decision, two nodes; the Massimario round counted 127 for vol. 96
and 2,489 over the whole archive). Brocardi gives `Cass. civ.` or `Cass. pen.`
and never a section (500 of 500 massime of art. 2043 c.c.), so its decisions
can be re-keyed to the identity; the 16 nodes with a bare «Cassazione» cannot
(no archive).

**ECLI.** The Corte costituzionale's open data carries it
(`ECLI:IT:COST:2020:71`); Italgiure does not for the Cassazione.

**Dates (measured on the four live decisions).** Italgiure gives the Cassazione's
date of deposit and **no date of decision or hearing**, civil and penal alike
(`cassazione:penale:10787:2024`: `data_deposito 2024-03-14`, `tipo ordinanza`,
`sezione 7`). The Corte costituzionale gives both (`data_decisione 2020-02-12`,
`data_deposito 2020-04-24`). The Massimario's paragraphs carry a hearing date
for some citations (`CitedDecision.data_udienza`).

### 2.3 Stored labels (data at rest, not derived)

| Column | Written by | Value for a norm |
|---|---|---|
| `DossierItem.title` | `apps/web/src/store/useAppStore.ts:1473, 1582, 1753` | the act type alone: `legge`, `codice civile` |
| `QuickNorm.label` | `StudyMode.tsx:62`, `HistoryView.tsx:73` (editable by the user) | `Art. 2 L. n. 241`, `Art. 2043 CC n. 262` |
| `NormaChangeNotification.message` | `apps/server/src/utils/normaWatcher.ts:105` | `La norma salvata «legge--241--1990-08-07--2» è cambiata` (the raw key) |
| `Bookmark.title` | user | free text |
| graph `estremi`, `titolo`, `autorita_emanante` | MERL-T writers (§3.4) | see §3.4 |
| dossier decision item `etichetta`, `title` | Sentenze PR C (planned, §6 of its spec) | the citation of the decision page |

## 3. Labels of norms

### 3.1 Web app

| Producer | Where | Used by | l. 241/1990 art. 2 |
|---|---|---|---|
| `formatNormCitation` | `utils/citation.ts` | copy and export of a **past** text, version banner, dossier copy | `art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore al …` |
| `formatCitation` | `utils/normaMeta.ts:62` | copy trailer of the text in force, notifications (`normaChanges.ts:36`) | `legge n. 241 del 1990-08-07, Art. 2` |
| `formatNormaMeta` | `utils/normaMeta.ts:31` | card and block subtitle | `7 agosto 1990` (c.c.: `R.D. 16 marzo 1942, n. 262`) |
| `abbreviateActType` | `utils/dateUtils.ts:158` | `formatNormaMeta`, `citation.ts` | `L.`, `D.Lgs.`, `D.L.`, `D.P.R.`, `R.D.` (capitals; `citation.ts` lower-cases them) |
| tab label | `SearchPanel.tsx:234, 440, 477` | workspace tab | `legge 241` |
| article tab label | `ArticleTabContent.tsx:392, 735` | tab of a loose article | `Art. 2 - legge n. 241` |
| dossier row | `SortableDossierItem.tsx:65, 140` | dossier list | `legge 241` |
| dossier PDF | `dossierUtils.ts:119`, `DossierDetailView.tsx:379` | export | `1. legge n. 241 · Art. 2`, `Fonte: legge n. 241 del 1990-08-07` |
| quick-norm label | `StudyMode.tsx:62`, `HistoryView.tsx:73` | stored | `Art. 2 L. n. 241` |
| compare | `CompareView.tsx:91, 101, 111, 197` | comparison headers | `Art. 2 - legge n. 241` |
| Study Mode trailer | `StudyModeContent.tsx:199` | copy | `legge n. 241 del 1990-08-07, Art. 2` |
| advanced export | `AdvancedExportModal.tsx:133, 199, 206, 279, 292, 420, 428, 554` | txt, rtf, md, pdf | `legge n. 241 del 1990-08-07, Art. 2` and variants |
| Ask MERL-T | `AskMerltEntry.tsx:36` | heading | `Art. 2 legge n. 241` |
| palette preview | `citationParser.ts:595` | command palette | `Art. 2 L. 241/1990` |
| in-text link | `citationMatcher.ts:587` | tooltip of a detected citation | `Art. 2 L. 241/1990-08-07` |
| URL import | `normattivaParser.ts:166` | label from a Normattiva URL | `Art. 2 L. n. 241 /1990` |
| Q&A source chip | `features/merlt/qa/format.ts:51` | MERL-T answers | `art. 2` |
| other aria/titles | `NormaCard.tsx`, `NormaBlockComponent.tsx`, `FootnoteTooltip.tsx`, `BrocardiDisplay.tsx:418`, `SuggestionItemCard.tsx:127`, `EnvironmentContentViewer.tsx:247` | accessibility, tooltips | `legge n. 241`, `legge art. 2` |

Seven abbreviation tables live in the web app alone (`citation.ts`,
`dateUtils.ts`, `citationParser.ts`, `citationMatcher.ts`, `normattivaParser.ts`,
`StudyMode.tsx`, `HistoryView.tsx`), each with its own spelling of the codice
civile: `c.c.`, `C.C.`, `CC`.

**Defects found:** the preleggi are labelled `art. 12 c.c.` by the Q&A chip (it
recognises the codice civile by `1942-03-16;262`, which the preleggi share);
`art. 2645bis c.c.` for `~art2645bis`; an EU act's chip is its EUR-Lex URL; the
in-text link prints a full ISO date (`241/1990-08-07`); a past-text banner and a
copy of the same article cite it in two styles.

### 3.2 Server and MCP

| Producer | Where | Used by | Output |
|---|---|---|---|
| `citeArticle` | `apps/server/src/norms/citation.ts` | `display` of `POST /dossiers/:id/norms`, `citation` of dossier items | owner's style, pinned to the web's golden file (`tests/norms/citation.test.ts`) |
| MCP tools | `apps/mcp/src/tools/dossier.ts:97` | `riferimento` | the server's `citation`, never rebuilt |
| saved-norm watcher | `utils/normaWatcher.ts:105` | notification message (stored) | the raw `normaKey` |

`citeArticle` already handles EU acts the web does not cite
(`art. 5, regolamento (UE) 2016/679`), but writes `art. 101, tfue` for a treaty
and `art. 6, l. 1983, n. 184` for a year-only act.

### 3.3 Python API

| Producer | Where | Output |
|---|---|---|
| `Norma.__str__` / `NormaVisitata.__str__` | `tools/norma.py` | `legge 1990-08-07, n. 241 art. 2` (error messages: "Articolo N non presente in …") |
| `/parse_query` `display` | `app.py:802` | `Art. 2 — legge` (the reason the server stopped using it) |
| `citation_linker` | `tools/citation_linker.py` | `display_text` is the matched text itself: no label generated |
| Brocardi labels | `tools/map.py` `BROCARDI_CODICI` | Brocardi's own source labels, used only to find a page |
| `/export_pdf` | `app.py:1660` | Normattiva's own print page: no VisuaLex label |

### 3.4 MERL-T

| Producer | Where | Output |
|---|---|---|
| `format_estremi` (`NormaMetadata.to_estremi`) | `storage/graph/schema.py:459`, `pipeline/visualex.py:84` | `Art. 2043 c.c.`; for any act outside its 29-row table, the type in full and no number: `Art. 2 legge`, `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| `estremi_from_urn` / `stub_properties` | `schema.py:476, 489` | `Art. 2043 c.c.`; `Art. 2` for an act outside the URN table |
| `build_node_label` | `utils/urn_labels.py:146` | `nome` › `Art. N — rubrica` › `estremi` › … › `Art. N` |
| `CODE_ABBREVIATIONS` | `schema.py:412` | 29 abbreviations of its own: `cod. cons.`, `cod. privacy`, `CTS`, `C.d.S.`, `CAD`, `CCII`… |
| `CitationFormatter` (`/citations` export) | `citation/formatter.py`, `urn_parser.py`, `formats/italian_legal.py` | `L. 7 agosto 1990, n. 241, art. 2`; **drops the article of every code keyed with its annex** (`;262:2~art2043` → `R.D. 16 marzo 1942, n. 262`), `Costituzione~Art81`, and garbles EU URLs (`//Eur-Lex Europa Eu/Eli/Reg/2016/679/Oj/Ita`); a third abbreviation table (`D.lgs.`, `Prel.`, `Cod. privacy`) |
| act node `titolo`, `autorita_emanante` (codes) | `pipeline/ingestion.py:476-496` | `Codice Civile` with authority `Regio Decreto`; `Costituzione` with authority `Parlamento` |
| article node `titolo` | `ingestion.py:716` | the estremi, not the act's title (`Art. 1 Cost.` written today; older nodes in the graph still read `Art. 1 costituzione`) |
| act node `titolo`, `estremi`, authority (amending acts) | `pipeline/multivigenza.py:212, 879` | `Legge n. 154 del 17/02/1992`, `LEGGE 17 febbraio 1992, n. 154`, `Governo` for a d.lgs.; its authority table says `Re d'Italia` for a regio decreto where `ingestion.py` says `Regio Decreto` |
| article suffixes | `utils/urn_labels.py:28` | a fifth copy of the ordinal table, with entries (`duodevicies`, `undevicies`) that `article_suffixes.py` does not have |

**In the graph today** (read-only): 930 article nodes, 902 untyped stubs; stubs
of the codice civile read `Art. 771 c.c.`; articles of ordinary acts read
`Art. 11 LEGGE 17 febbraio 1992, n. 154` (multivigenza) or `Art. N` (stubs);
the two code nodes are `Codice Civile` / `Regio Decreto` and `Costituzione` /
`Parlamento`.

## 4. Labels of decisions

| Producer | Where | Cass. civ. SU 31310/2024 (Rv. 673165-01) | Others |
|---|---|---|---|
| Massimario `estremi` (graph) | `massimario/identity.py:62` | `Cass. civ., n. 31310/2024` | `Corte cost., n. 71/2020`; `Cass. civ., n. 2633` (no year) |
| Massimario `label` (chip in the article's review panel) | `identity.py:69`, `DecisionChip.tsx` | `Sez. U, n. 31310/2024 · Rv. 673165-01` | `Sez. 7, n. 10787/2024` (penal, but nothing says so); `Sez. 3, n. 2633` |
| Brocardi graph node `estremi` | `ingestion.py:1236` | — | `Cassazione civile 31191/2025` |
| Brocardi chips in the reader | `MassimeSection.tsx:207` | — | `Cass. civ.` + `n. 31191/2025` |
| Q&A source chip | `features/merlt/qa/format.ts:51` | `cassazione:civile:31310:2024` (the raw key) | `Cass. civ. 31191/2025` for a Brocardi node |
| Sentenze page (PR B, being built) | `formatDecisionHeading`, `formatDecisionCitation` in `decisionLinks.ts` (plan `2026-10-01-sentenze.md`, Task 8) | heading `Corte di cassazione · Sezioni Unite civili · Sentenza n. 31310/2024 · depositata il 6 dicembre 2024`; copy `Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310` | penal `Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787` (the plan's answer to Italgiure giving only the deposit; the spec's older `(dep. …)` form needed a date the source lacks) |
| mcp-legal-it (reference) | `src/prompts.py:884`, `src/tools/italgiure.py:672` | `Cass. civ./pen., sez., n./anno` | `Sez. III n. 10787 del 22 aprile 2024` |

## 5. What this means for the convention

- **Identity needs few changes**: VisuaLex's URN for norms and the shared key
  for decisions are already right where they are used; the defects are at the
  edges (year-only, no number, ministerial decrees, EU articles) and in old graph
  data. No stored key has to change: the keys at rest (`buildItemKey`,
  `uniqueArticleIdFromNorma`, the graph's URN keys) stay as they are, and the
  identity is derived next to them.
- **Labels need one formatter per language and one table** of act types and
  abbreviations, in place of eleven styles and seven tables.
- **Stored labels are a trap**: `QuickNorm.label` and the planned decision
  `etichetta` freeze today's style into user data. The convention derives labels
  at read time: a label the app stored is a cache, one the user wrote is the user's text.
- **The citation style of decisions** is worded by the Sentenze plan but not yet
  confirmed for every area, and one fact constrains it: the only date the app
  has for every Cassazione decision is the date of deposit.

## Appendix A — every producer on every norm

Generated from the measurement run. `vlx` is the Python API, `merlt` MERL-T,
`web` the web app, `server` the Node server. Inputs are the norm as the reader
stores it (`norma_data`). Several producers only ever see some of these inputs
(the palette sees what the user typed, not the stored norm), so an odd output
here means "this is what the function writes for these fields", not always
"this is on a screen today".

#### cc-2043

Stored norm: `tipo_atto: codice civile, tipo_atto_reale: regio decreto, numero_atto: 262, data: 1942-03-16, allegato: 2, numero_articolo: 2043`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice civile` |
| vlx /parse_query display app.py:802 | `Art. 2043 — codice civile` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 2043 c.c.` |
| merlt estremi_from_urn (stub estremi) | `Art. 2043 c.c.` |
| merlt build_node_label (stub node label) | `Art. 2043 c.c.` |
| merlt citation_router italian_legal | `R.D. 16 marzo 1942, n. 262` |
| merlt act node is code? act_name_from_urn | `codice civile` |
| web citation.ts head (lawyer style, past texts only) | `art. 2043 c.c.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 2043 c.c.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice civile n. 262 del 1942-03-16, Art. 2043 (Allegato 2)` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `R.D. 16 marzo 1942, n. 262` |
| web tab label SearchPanel.tsx:234 | `codice civile 262` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 2043 (All. 2) - codice civile n. 262` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice civile n. 262 · Art. 2043` |
| web dossier row SortableDossierItem.tsx:140 | `codice civile 262` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 2043 CC n. 262` |
| web compare label CompareView.tsx:91 | `Art. 2043 - codice civile n. 262` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 2043 (All. 2) codice civile n. 262` |
| web palette preview citationParser.formatParsedCitation | `Art. 2043 C.C. 262/1942` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 2043 C.C. 262/1942-03-16` |
| web normattivaParser.generateLabelFromParams | `Art. 2043 C.C. n. 262 /1942` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-civile--262--1942-03-16--all2--2043` |
| web key buildNormaKey | `codice-civile--262--1942-03-16` |
| web uniqueArticleIdFromNorma | `all2:2043` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 2043 c.c.` |

#### cc-2645-bis

Stored norm: `tipo_atto: codice civile, tipo_atto_reale: regio decreto, numero_atto: 262, data: 1942-03-16, allegato: 2, numero_articolo: 2645-bis`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2645bis` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice civile` |
| vlx /parse_query display app.py:802 | `Art. 2645-bis — codice civile` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 2645-bis c.c.` |
| merlt estremi_from_urn (stub estremi) | `Art. 2645-bis c.c.` |
| merlt build_node_label (stub node label) | `Art. 2645-bis c.c.` |
| merlt citation_router italian_legal | `R.D. 16 marzo 1942, n. 262` |
| merlt act node is code? act_name_from_urn | `codice civile` |
| web citation.ts head (lawyer style, past texts only) | `art. 2645-bis c.c.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 2645-bis c.c.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice civile n. 262 del 1942-03-16, Art. 2645-bis (Allegato 2)` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `R.D. 16 marzo 1942, n. 262` |
| web tab label SearchPanel.tsx:234 | `codice civile 262` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 2645-bis (All. 2) - codice civile n. 262` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice civile n. 262 · Art. 2645-bis` |
| web dossier row SortableDossierItem.tsx:140 | `codice civile 262` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 2645-bis CC n. 262` |
| web compare label CompareView.tsx:91 | `Art. 2645-bis - codice civile n. 262` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 2645-bis (All. 2) codice civile n. 262` |
| web palette preview citationParser.formatParsedCitation | `Art. 2645-bis C.C. 262/1942` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 2645-bis C.C. 262/1942-03-16` |
| web normattivaParser.generateLabelFromParams | `Art. 2645-bis C.C. n. 262 /1942` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-civile--262--1942-03-16--all2--2645-bis` |
| web key buildNormaKey | `codice-civile--262--1942-03-16` |
| web uniqueArticleIdFromNorma | `all2:2645-bis` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 2645bis c.c.` |

#### cost-81

Stored norm: `tipo_atto: costituzione, numero_articolo: 81`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art81` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `costituzione` |
| vlx /parse_query display app.py:802 | `Art. 81 — costituzione` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 81 Cost.` |
| merlt estremi_from_urn (stub estremi) | `Art. 81 Cost.` |
| merlt build_node_label (stub node label) | `Art. 81 Cost.` |
| merlt citation_router italian_legal | `Costituzione~Art81` |
| merlt act node is code? act_name_from_urn | `costituzione` |
| web citation.ts head (lawyer style, past texts only) | `art. 81 Cost.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 81 Cost.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `costituzione, Art. 81` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `Estremi non disponibili` |
| web tab label SearchPanel.tsx:234 | `costituzione` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 81 - costituzione` |
| web dossier PDF title dossierUtils.ts:119 | `1. costituzione · Art. 81` |
| web dossier row SortableDossierItem.tsx:140 | `costituzione` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 81 Cost.` |
| web compare label CompareView.tsx:91 | `Art. 81 - costituzione` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 81 costituzione` |
| web palette preview citationParser.formatParsedCitation | `Art. 81 Cost.` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 81 Cost.` |
| web normattivaParser.generateLabelFromParams | `Art. 81 Cost.` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `costituzione--81` |
| web key buildNormaKey | `costituzione` |
| web uniqueArticleIdFromNorma | `81` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 81` |

#### preleggi-12

Stored norm: `tipo_atto: preleggi, tipo_atto_reale: regio decreto, numero_atto: 262, data: 1942-03-16, allegato: 1, numero_articolo: 12`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:1~art12` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `preleggi` |
| vlx /parse_query display app.py:802 | `Art. 12 — preleggi` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 12 preleggi` |
| merlt estremi_from_urn (stub estremi) | `Art. 12 preleggi` |
| merlt build_node_label (stub node label) | `Art. 12 preleggi` |
| merlt citation_router italian_legal | `R.D. 16 marzo 1942, n. 262` |
| merlt act node is code? act_name_from_urn | `preleggi` |
| web citation.ts head (lawyer style, past texts only) | `art. 12 preleggi` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 12 preleggi` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `preleggi n. 262 del 1942-03-16, Art. 12 (Allegato 1)` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `R.D. 16 marzo 1942, n. 262` |
| web tab label SearchPanel.tsx:234 | `preleggi 262` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 12 (All. 1) - preleggi n. 262` |
| web dossier PDF title dossierUtils.ts:119 | `1. preleggi n. 262 · Art. 12` |
| web dossier row SortableDossierItem.tsx:140 | `preleggi 262` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 12 preleggi n. 262` |
| web compare label CompareView.tsx:91 | `Art. 12 - preleggi n. 262` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 12 (All. 1) preleggi n. 262` |
| web palette preview citationParser.formatParsedCitation | `Art. 12 preleggi 262/1942` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 12 Prel. 262/1942-03-16` |
| web normattivaParser.generateLabelFromParams | `Art. 12 Prel. n. 262 /1942` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `preleggi--262--1942-03-16--all1--12` |
| web key buildNormaKey | `preleggi--262--1942-03-16` |
| web uniqueArticleIdFromNorma | `all1:12` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 12 c.c.` |

#### dispatt-cc-3

Stored norm: `tipo_atto: disposizioni per l'attuazione del Codice civile e disposizioni transitorie, tipo_atto_reale: regio decreto, numero_atto: 318, data: 1942-03-30, allegato: 1, numero_articolo: 3`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-30;318:1~art3` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| vlx /parse_query display app.py:802 | `Art. 3 — disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| merlt estremi_from_urn (stub estremi) | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| merlt build_node_label (stub node label) | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| merlt citation_router italian_legal | `R.D. 30 marzo 1942, n. 318` |
| merlt act node is code? act_name_from_urn | `disposizioni per l'attuazione del Codice civile e disposizioni transitorie` |
| web citation.ts head (lawyer style, past texts only) | `art. 3 disp. att. c.c.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 3 disp. att. c.c.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318 del 1942-03-30, Art. 3 (Allegato 1)` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `R.D. 30 marzo 1942, n. 318` |
| web tab label SearchPanel.tsx:234 | `disposizioni per l'attuazione del Codice civile e disposizioni transitorie 318` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 3 (All. 1) - disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318` |
| web dossier PDF title dossierUtils.ts:119 | `1. disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318 · Art. 3` |
| web dossier row SortableDossierItem.tsx:140 | `disposizioni per l'attuazione del Codice civile e disposizioni transitorie 318` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318` |
| web compare label CompareView.tsx:91 | `Art. 3 - disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 3 (All. 1) disposizioni per l'attuazione del Codice civile e disposizioni transitorie n. 318` |
| web palette preview citationParser.formatParsedCitation | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie 318/1942` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 3 disposizioni per l'attuazione del Codice civile e disposizioni transitorie 318/1942-03-30` |
| web normattivaParser.generateLabelFromParams | `Art. 3 Disp. Att. C.C. n. 318 /1942` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `disposizioni-per-lattuazione-del-codice-civile-e-disposizioni-transitorie--318--1942-03-30--all1--3` |
| web key buildNormaKey | `disposizioni-per-lattuazione-del-codice-civile-e-disposizioni-transitorie--318--1942-03-30` |
| web uniqueArticleIdFromNorma | `all1:3` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 3` |

#### cpc-183-bis

Stored norm: `tipo_atto: codice di procedura civile, tipo_atto_reale: regio decreto, numero_atto: 1443, data: 1940-10-28, allegato: 1, numero_articolo: 183-bis`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1940-10-28;1443:1~art183bis` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice di procedura civile` |
| vlx /parse_query display app.py:802 | `Art. 183-bis — codice di procedura civile` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 183-bis c.p.c.` |
| merlt estremi_from_urn (stub estremi) | `Art. 183-bis c.p.c.` |
| merlt build_node_label (stub node label) | `Art. 183-bis c.p.c.` |
| merlt citation_router italian_legal | `R.D. 28 ottobre 1940, n. 1443` |
| merlt act node is code? act_name_from_urn | `codice di procedura civile` |
| web citation.ts head (lawyer style, past texts only) | `art. 183-bis c.p.c.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 183-bis c.p.c.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice di procedura civile n. 1443 del 1940-10-28, Art. 183-bis (Allegato 1)` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `R.D. 28 ottobre 1940, n. 1443` |
| web tab label SearchPanel.tsx:234 | `codice di procedura civile 1443` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 183-bis (All. 1) - codice di procedura civile n. 1443` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice di procedura civile n. 1443 · Art. 183-bis` |
| web dossier row SortableDossierItem.tsx:140 | `codice di procedura civile 1443` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 183-bis CPC n. 1443` |
| web compare label CompareView.tsx:91 | `Art. 183-bis - codice di procedura civile n. 1443` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 183-bis (All. 1) codice di procedura civile n. 1443` |
| web palette preview citationParser.formatParsedCitation | `Art. 183-bis C.P.C. 1443/1940` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 183-bis C.P.C. 1443/1940-10-28` |
| web normattivaParser.generateLabelFromParams | `Art. 183-bis C.P.C. n. 1443 /1940` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-di-procedura-civile--1443--1940-10-28--all1--183-bis` |
| web key buildNormaKey | `codice-di-procedura-civile--1443--1940-10-28` |
| web uniqueArticleIdFromNorma | `all1:183-bis` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 183bis` |

#### cpp-191

Stored norm: `tipo_atto: codice di procedura penale, tipo_atto_reale: decreto del presidente della repubblica, numero_atto: 447, data: 1988-09-22, numero_articolo: 191`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1988-09-22;447~art191` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice di procedura penale` |
| vlx /parse_query display app.py:802 | `Art. 191 — codice di procedura penale` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 191 c.p.p.` |
| merlt estremi_from_urn (stub estremi) | `Art. 191 c.p.p.` |
| merlt build_node_label (stub node label) | `Art. 191 c.p.p.` |
| merlt citation_router italian_legal | `D.P.R. 22 settembre 1988, n. 447, art. 191` |
| merlt act node is code? act_name_from_urn | `codice di procedura penale` |
| web citation.ts head (lawyer style, past texts only) | `art. 191 c.p.p.` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 191 c.p.p.` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice di procedura penale n. 447 del 1988-09-22, Art. 191` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `D.P.R. 22 settembre 1988, n. 447` |
| web tab label SearchPanel.tsx:234 | `codice di procedura penale 447` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 191 - codice di procedura penale n. 447` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice di procedura penale n. 447 · Art. 191` |
| web dossier row SortableDossierItem.tsx:140 | `codice di procedura penale 447` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 191 CPP n. 447` |
| web compare label CompareView.tsx:91 | `Art. 191 - codice di procedura penale n. 447` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 191 codice di procedura penale n. 447` |
| web palette preview citationParser.formatParsedCitation | `Art. 191 C.P.P. 447/1988` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 191 C.P.P. 447/1988-09-22` |
| web normattivaParser.generateLabelFromParams | `Art. 191 C.P.P. n. 447 /1988` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-di-procedura-penale--447--1988-09-22--191` |
| web key buildNormaKey | `codice-di-procedura-penale--447--1988-09-22` |
| web uniqueArticleIdFromNorma | `191` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 191` |

#### l-241-1990-2

Stored norm: `tipo_atto: legge, numero_atto: 241, data: 1990-08-07, numero_articolo: 2`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art2` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `legge` |
| vlx /parse_query display app.py:802 | `Art. 2 — legge` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 2 legge` |
| merlt estremi_from_urn (stub estremi) | `Art. 2` |
| merlt build_node_label (stub node label) | `Art. 2` |
| merlt citation_router italian_legal | `L. 7 agosto 1990, n. 241, art. 2` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 2, l. 7 agosto 1990, n. 241` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 2, l. 7 agosto 1990, n. 241` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `legge n. 241 del 1990-08-07, Art. 2` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `7 agosto 1990` |
| web tab label SearchPanel.tsx:234 | `legge 241` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 2 - legge n. 241` |
| web dossier PDF title dossierUtils.ts:119 | `1. legge n. 241 · Art. 2` |
| web dossier row SortableDossierItem.tsx:140 | `legge 241` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 2 L. n. 241` |
| web compare label CompareView.tsx:91 | `Art. 2 - legge n. 241` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 2 legge n. 241` |
| web palette preview citationParser.formatParsedCitation | `Art. 2 L. 241/1990` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 2 L. 241/1990-08-07` |
| web normattivaParser.generateLabelFromParams | `Art. 2 L. n. 241 /1990` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `legge--241--1990-08-07--2` |
| web key buildNormaKey | `legge--241--1990-08-07` |
| web uniqueArticleIdFromNorma | `2` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 2` |

#### privacy-7

Stored norm: `tipo_atto: codice in materia di protezione dei dati personali, tipo_atto_reale: decreto legislativo, numero_atto: 196, data: 2003-06-30, numero_articolo: 7`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-06-30;196~art7` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice in materia di protezione dei dati personali` |
| vlx /parse_query display app.py:802 | `Art. 7 — codice in materia di protezione dei dati personali` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 7 cod. privacy` |
| merlt estremi_from_urn (stub estremi) | `Art. 7 cod. privacy` |
| merlt build_node_label (stub node label) | `Art. 7 cod. privacy` |
| merlt citation_router italian_legal | `D.lgs. 30 giugno 2003, n. 196, art. 7` |
| merlt act node is code? act_name_from_urn | `codice in materia di protezione dei dati personali` |
| web citation.ts head (lawyer style, past texts only) | `art. 7, d.lgs. 30 giugno 2003, n. 196` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 7, d.lgs. 30 giugno 2003, n. 196` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice in materia di protezione dei dati personali n. 196 del 2003-06-30, Art. 7` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `D.Lgs. 30 giugno 2003, n. 196` |
| web tab label SearchPanel.tsx:234 | `codice in materia di protezione dei dati personali 196` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 7 - codice in materia di protezione dei dati personali n. 196` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice in materia di protezione dei dati personali n. 196 · Art. 7` |
| web dossier row SortableDossierItem.tsx:140 | `codice in materia di protezione dei dati personali 196` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 7 codice in materia di protezione dei dati personali n. 196` |
| web compare label CompareView.tsx:91 | `Art. 7 - codice in materia di protezione dei dati personali n. 196` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 7 codice in materia di protezione dei dati personali n. 196` |
| web palette preview citationParser.formatParsedCitation | `Art. 7 codice in materia di protezione dei dati personali 196/2003` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 7 codice in materia di protezione dei dati personali 196/2003-06-30` |
| web normattivaParser.generateLabelFromParams | `Art. 7 Cod. Privacy n. 196 /2003` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-in-materia-di-protezione-dei-dati-personali--196--2003-06-30--7` |
| web key buildNormaKey | `codice-in-materia-di-protezione-dei-dati-personali--196--2003-06-30` |
| web uniqueArticleIdFromNorma | `7` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 7` |

#### consumo-33

Stored norm: `tipo_atto: codice del consumo, tipo_atto_reale: decreto legislativo, numero_atto: 206, data: 2005-09-06, numero_articolo: 33`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2005-09-06;206~art33` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice del consumo` |
| vlx /parse_query display app.py:802 | `Art. 33 — codice del consumo` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 33 cod. cons.` |
| merlt estremi_from_urn (stub estremi) | `Art. 33 cod. cons.` |
| merlt build_node_label (stub node label) | `Art. 33 cod. cons.` |
| merlt citation_router italian_legal | `D.lgs. 6 settembre 2005, n. 206, art. 33` |
| merlt act node is code? act_name_from_urn | `codice del consumo` |
| web citation.ts head (lawyer style, past texts only) | `art. 33, d.lgs. 6 settembre 2005, n. 206` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 33, d.lgs. 6 settembre 2005, n. 206` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice del consumo n. 206 del 2005-09-06, Art. 33` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `D.Lgs. 6 settembre 2005, n. 206` |
| web tab label SearchPanel.tsx:234 | `codice del consumo 206` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 33 - codice del consumo n. 206` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice del consumo n. 206 · Art. 33` |
| web dossier row SortableDossierItem.tsx:140 | `codice del consumo 206` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 33 codice del consumo n. 206` |
| web compare label CompareView.tsx:91 | `Art. 33 - codice del consumo n. 206` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 33 codice del consumo n. 206` |
| web palette preview citationParser.formatParsedCitation | `Art. 33 codice del consumo 206/2005` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 33 codice del consumo 206/2005-09-06` |
| web normattivaParser.generateLabelFromParams | `Art. 33 Cod. Cons. n. 206 /2005` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-del-consumo--206--2005-09-06--33` |
| web key buildNormaKey | `codice-del-consumo--206--2005-09-06` |
| web uniqueArticleIdFromNorma | `33` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 33` |

#### terzo-settore-4

Stored norm: `tipo_atto: codice del Terzo settore, tipo_atto_reale: decreto legislativo, numero_atto: 117, data: 2017-07-03, numero_articolo: 4`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2017-07-03;117~art4` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `codice del Terzo settore` |
| vlx /parse_query display app.py:802 | `Art. 4 — codice del Terzo settore` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 4 CTS` |
| merlt estremi_from_urn (stub estremi) | `Art. 4 CTS` |
| merlt build_node_label (stub node label) | `Art. 4 CTS` |
| merlt citation_router italian_legal | `D.lgs. 3 luglio 2017, n. 117, art. 4` |
| merlt act node is code? act_name_from_urn | `codice del Terzo settore` |
| web citation.ts head (lawyer style, past texts only) | `art. 4, d.lgs. 3 luglio 2017, n. 117` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 4, d.lgs. 3 luglio 2017, n. 117` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `codice del Terzo settore n. 117 del 2017-07-03, Art. 4` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `D.Lgs. 3 luglio 2017, n. 117` |
| web tab label SearchPanel.tsx:234 | `codice del Terzo settore 117` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 4 - codice del Terzo settore n. 117` |
| web dossier PDF title dossierUtils.ts:119 | `1. codice del Terzo settore n. 117 · Art. 4` |
| web dossier row SortableDossierItem.tsx:140 | `codice del Terzo settore 117` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 4 codice del Terzo settore n. 117` |
| web compare label CompareView.tsx:91 | `Art. 4 - codice del Terzo settore n. 117` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 4 codice del Terzo settore n. 117` |
| web palette preview citationParser.formatParsedCitation | `Art. 4 codice del Terzo settore 117/2017` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 4 codice del Terzo settore 117/2017-07-03` |
| web normattivaParser.generateLabelFromParams | `Art. 4 CTS n. 117 /2017` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `codice-del-terzo-settore--117--2017-07-03--4` |
| web key buildNormaKey | `codice-del-terzo-settore--117--2017-07-03` |
| web uniqueArticleIdFromNorma | `4` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 4` |

#### dpr-445-2000-38

Stored norm: `tipo_atto: decreto del presidente della repubblica, numero_atto: 445, data: 2000-12-28, numero_articolo: 38`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:2000-12-28;445~art38` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `decreto del presidente della repubblica` |
| vlx /parse_query display app.py:802 | `Art. 38 — decreto del presidente della repubblica` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 38 decreto del presidente della repubblica` |
| merlt estremi_from_urn (stub estremi) | `Art. 38` |
| merlt build_node_label (stub node label) | `Art. 38` |
| merlt citation_router italian_legal | `D.P.R. 28 dicembre 2000, n. 445, art. 38` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 38, d.p.r. 28 dicembre 2000, n. 445` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 38, d.p.r. 28 dicembre 2000, n. 445` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `decreto del presidente della repubblica n. 445 del 2000-12-28, Art. 38` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `28 dicembre 2000` |
| web tab label SearchPanel.tsx:234 | `decreto del presidente della repubblica 445` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 38 - decreto del presidente della repubblica n. 445` |
| web dossier PDF title dossierUtils.ts:119 | `1. decreto del presidente della repubblica n. 445 · Art. 38` |
| web dossier row SortableDossierItem.tsx:140 | `decreto del presidente della repubblica 445` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 38 decreto del presidente della repubblica n. 445` |
| web compare label CompareView.tsx:91 | `Art. 38 - decreto del presidente della repubblica n. 445` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 38 decreto del presidente della repubblica n. 445` |
| web palette preview citationParser.formatParsedCitation | `Art. 38 D.P.R. 445/2000` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 38 D.P.R. 445/2000-12-28` |
| web normattivaParser.generateLabelFromParams | `Art. 38 D.P.R. n. 445 /2000` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `decreto-del-presidente-della-repubblica--445--2000-12-28--38` |
| web key buildNormaKey | `decreto-del-presidente-della-repubblica--445--2000-12-28` |
| web uniqueArticleIdFromNorma | `38` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 38` |

#### dl-18-2020-1

Stored norm: `tipo_atto: decreto legge, numero_atto: 18, data: 2020-03-17, numero_articolo: 1`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legge:2020-03-17;18~art1` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `decreto legge` |
| vlx /parse_query display app.py:802 | `Art. 1 — decreto legge` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 1 decreto legge` |
| merlt estremi_from_urn (stub estremi) | `Art. 1` |
| merlt build_node_label (stub node label) | `Art. 1` |
| merlt citation_router italian_legal | `D.L. 17 marzo 2020, n. 18, art. 1` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 1, d.l. 17 marzo 2020, n. 18` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 1, d.l. 17 marzo 2020, n. 18` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `decreto legge n. 18 del 2020-03-17, Art. 1` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `17 marzo 2020` |
| web tab label SearchPanel.tsx:234 | `decreto legge 18` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 1 - decreto legge n. 18` |
| web dossier PDF title dossierUtils.ts:119 | `1. decreto legge n. 18 · Art. 1` |
| web dossier row SortableDossierItem.tsx:140 | `decreto legge 18` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 1 D.L. n. 18` |
| web compare label CompareView.tsx:91 | `Art. 1 - decreto legge n. 18` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 1 decreto legge n. 18` |
| web palette preview citationParser.formatParsedCitation | `Art. 1 D.L. 18/2020` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 1 D.L. 18/2020-03-17` |
| web normattivaParser.generateLabelFromParams | `Art. 1 D.L. n. 18 /2020` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `decreto-legge--18--2020-03-17--1` |
| web key buildNormaKey | `decreto-legge--18--2020-03-17` |
| web uniqueArticleIdFromNorma | `1` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 1` |

#### rd-773-1931-86

Stored norm: `tipo_atto: regio decreto, numero_atto: 773, data: 1931-06-18, numero_articolo: 86`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1931-06-18;773~art86` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `regio decreto` |
| vlx /parse_query display app.py:802 | `Art. 86 — regio decreto` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 86 regio decreto` |
| merlt estremi_from_urn (stub estremi) | `Art. 86` |
| merlt build_node_label (stub node label) | `Art. 86` |
| merlt citation_router italian_legal | `R.D. 18 giugno 1931, n. 773, art. 86` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 86, r.d. 18 giugno 1931, n. 773` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 86, r.d. 18 giugno 1931, n. 773` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `regio decreto n. 773 del 1931-06-18, Art. 86` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `18 giugno 1931` |
| web tab label SearchPanel.tsx:234 | `regio decreto 773` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 86 - regio decreto n. 773` |
| web dossier PDF title dossierUtils.ts:119 | `1. regio decreto n. 773 · Art. 86` |
| web dossier row SortableDossierItem.tsx:140 | `regio decreto 773` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 86 regio decreto n. 773` |
| web compare label CompareView.tsx:91 | `Art. 86 - regio decreto n. 773` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 86 regio decreto n. 773` |
| web palette preview citationParser.formatParsedCitation | `Art. 86 R.D. 773/1931` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 86 R.D. 773/1931-06-18` |
| web normattivaParser.generateLabelFromParams | `Art. 86 R.D. n. 773 /1931` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `regio-decreto--773--1931-06-18--86` |
| web key buildNormaKey | `regio-decreto--773--1931-06-18` |
| web uniqueArticleIdFromNorma | `86` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 86` |

#### dlgs-385-1993-127

Stored norm: `tipo_atto: decreto legislativo, numero_atto: 385, data: 1993-09-01, numero_articolo: 127`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1993-09-01;385~art127` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `decreto legislativo` |
| vlx /parse_query display app.py:802 | `Art. 127 — decreto legislativo` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 127 decreto legislativo` |
| merlt estremi_from_urn (stub estremi) | `Art. 127` |
| merlt build_node_label (stub node label) | `Art. 127` |
| merlt citation_router italian_legal | `D.lgs. 1 settembre 1993, n. 385, art. 127` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 127, d.lgs. 1° settembre 1993, n. 385` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 127, d.lgs. 1° settembre 1993, n. 385` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `decreto legislativo n. 385 del 1993-09-01, Art. 127` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `1 settembre 1993` |
| web tab label SearchPanel.tsx:234 | `decreto legislativo 385` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 127 - decreto legislativo n. 385` |
| web dossier PDF title dossierUtils.ts:119 | `1. decreto legislativo n. 385 · Art. 127` |
| web dossier row SortableDossierItem.tsx:140 | `decreto legislativo 385` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 127 D.Lgs. n. 385` |
| web compare label CompareView.tsx:91 | `Art. 127 - decreto legislativo n. 385` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 127 decreto legislativo n. 385` |
| web palette preview citationParser.formatParsedCitation | `Art. 127 D.Lgs. 385/1993` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 127 D.Lgs. 385/1993-09-01` |
| web normattivaParser.generateLabelFromParams | `Art. 127 D.Lgs. n. 385 /1993` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `decreto-legislativo--385--1993-09-01--127` |
| web key buildNormaKey | `decreto-legislativo--385--1993-09-01` |
| web uniqueArticleIdFromNorma | `127` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 127` |

#### l-184-1983-6-year-only

Stored norm: `tipo_atto: legge, numero_atto: 184, data: 1983, numero_articolo: 6`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1983-01-01;184~art6` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `legge` |
| vlx /parse_query display app.py:802 | `Art. 6 — legge` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 6 legge` |
| merlt estremi_from_urn (stub estremi) | `Art. 6` |
| merlt build_node_label (stub node label) | `Art. 6` |
| merlt citation_router italian_legal | `L. 1 gennaio 1983, n. 184, art. 6` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 6, l. 1983, n. 184` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 6, l. 1983, n. 184` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `legge n. 184 del 1983, Art. 6` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `1983` |
| web tab label SearchPanel.tsx:234 | `legge 184` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 6 - legge n. 184` |
| web dossier PDF title dossierUtils.ts:119 | `1. legge n. 184 · Art. 6` |
| web dossier row SortableDossierItem.tsx:140 | `legge 184` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 6 L. n. 184` |
| web compare label CompareView.tsx:91 | `Art. 6 - legge n. 184` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 6 legge n. 184` |
| web palette preview citationParser.formatParsedCitation | `Art. 6 L. 184/1983` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 6 L. 184/1983` |
| web normattivaParser.generateLabelFromParams | `Art. 6 L. n. 184 /1983` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `legge--184--1983--6` |
| web key buildNormaKey | `legge--184--1983` |
| web uniqueArticleIdFromNorma | `6` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 6` |

#### lcost-1-2012-1

Stored norm: `tipo_atto: legge costituzionale, numero_atto: 1, data: 2012-04-20, numero_articolo: 1`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge.costituzionale:2012-04-20;1~art1` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `legge costituzionale` |
| vlx /parse_query display app.py:802 | `Art. 1 — legge costituzionale` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 1 legge costituzionale` |
| merlt estremi_from_urn (stub estremi) | `Art. 1` |
| merlt build_node_label (stub node label) | `Art. 1` |
| merlt citation_router italian_legal | `Legge Costituzionale 20 aprile 2012, n. 1, art. 1` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 1, legge costituzionale 20 aprile 2012, n. 1` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 1, legge costituzionale 20 aprile 2012, n. 1` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `legge costituzionale n. 1 del 2012-04-20, Art. 1` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `20 aprile 2012` |
| web tab label SearchPanel.tsx:234 | `legge costituzionale 1` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 1 - legge costituzionale n. 1` |
| web dossier PDF title dossierUtils.ts:119 | `1. legge costituzionale n. 1 · Art. 1` |
| web dossier row SortableDossierItem.tsx:140 | `legge costituzionale 1` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 1 legge costituzionale n. 1` |
| web compare label CompareView.tsx:91 | `Art. 1 - legge costituzionale n. 1` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 1 legge costituzionale n. 1` |
| web palette preview citationParser.formatParsedCitation | `Art. 1 legge costituzionale 1/2012` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 1 legge costituzionale 1/2012-04-20` |
| web normattivaParser.generateLabelFromParams | `Art. 1 legge costituzionale n. 1 /2012` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `legge-costituzionale--1--2012-04-20--1` |
| web key buildNormaKey | `legge-costituzionale--1--2012-04-20` |
| web uniqueArticleIdFromNorma | `1` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 1` |

#### dm-55-2014-4

Stored norm: `tipo_atto: decreto ministeriale, numero_atto: 55, data: 2014-03-10, numero_articolo: 4`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.ministeriale:2014-03-10;55~art4` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `decreto ministeriale` |
| vlx /parse_query display app.py:802 | `Art. 4 — decreto ministeriale` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 4 decreto ministeriale` |
| merlt estremi_from_urn (stub estremi) | `Art. 4` |
| merlt build_node_label (stub node label) | `Art. 4` |
| merlt citation_router italian_legal | `D.M. 10 marzo 2014, n. 55, art. 4` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 4, decreto ministeriale 10 marzo 2014, n. 55` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 4, decreto ministeriale 10 marzo 2014, n. 55` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `decreto ministeriale n. 55 del 2014-03-10, Art. 4` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `10 marzo 2014` |
| web tab label SearchPanel.tsx:234 | `decreto ministeriale 55` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 4 - decreto ministeriale n. 55` |
| web dossier PDF title dossierUtils.ts:119 | `1. decreto ministeriale n. 55 · Art. 4` |
| web dossier row SortableDossierItem.tsx:140 | `decreto ministeriale 55` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 4 decreto ministeriale n. 55` |
| web compare label CompareView.tsx:91 | `Art. 4 - decreto ministeriale n. 55` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 4 decreto ministeriale n. 55` |
| web palette preview citationParser.formatParsedCitation | `Art. 4 decreto ministeriale 55/2014` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 4 decreto ministeriale 55/2014-03-10` |
| web normattivaParser.generateLabelFromParams | `Art. 4 decreto ministeriale n. 55 /2014` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `decreto-ministeriale--55--2014-03-10--4` |
| web key buildNormaKey | `decreto-ministeriale--55--2014-03-10` |
| web uniqueArticleIdFromNorma | `4` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 4` |

#### dpcm-2020-03-08-1

Stored norm: `tipo_atto: decreto del presidente del consiglio dei ministri, data: 2020-03-08, numero_articolo: 1`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.del.consiglio.dei.ministri:2020-03-08;None~art1` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `decreto del presidente del consiglio dei ministri` |
| vlx /parse_query display app.py:802 | `Art. 1 — decreto del presidente del consiglio dei ministri` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 1 decreto del presidente del consiglio dei ministri` |
| merlt estremi_from_urn (stub estremi) | `Art. 1` |
| merlt build_node_label (stub node label) | `Art. 1` |
| merlt citation_router italian_legal | `D.P.C.M. 8 marzo 2020, art. 1` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | `art. 1, decreto del presidente del consiglio dei ministri 8 marzo 2020` |
| server citeArticle (dossier citation, MCP riferimento) | `art. 1, decreto del presidente del consiglio dei ministri 8 marzo 2020` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `decreto del presidente del consiglio dei ministri del 2020-03-08, Art. 1` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `8 marzo 2020` |
| web tab label SearchPanel.tsx:234 | `decreto del presidente del consiglio dei ministri` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 1 - decreto del presidente del consiglio dei ministri` |
| web dossier PDF title dossierUtils.ts:119 | `1. decreto del presidente del consiglio dei ministri · Art. 1` |
| web dossier row SortableDossierItem.tsx:140 | `decreto del presidente del consiglio dei ministri` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 1 decreto del presidente del consiglio dei ministri` |
| web compare label CompareView.tsx:91 | `Art. 1 - decreto del presidente del consiglio dei ministri` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 1 decreto del presidente del consiglio dei ministri` |
| web palette preview citationParser.formatParsedCitation | `Art. 1 decreto del presidente del consiglio dei ministri 2020-03-08` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 1 decreto del presidente del consiglio dei ministri` |
| web normattivaParser.generateLabelFromParams | `Art. 1 decreto del presidente del consiglio dei ministri /2020` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `decreto-del-presidente-del-consiglio-dei-ministri--2020-03-08--1` |
| web key buildNormaKey | `decreto-del-presidente-del-consiglio-dei-ministri--2020-03-08` |
| web uniqueArticleIdFromNorma | `1` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `art. 1` |

#### gdpr-5

Stored norm: `tipo_atto: regolamento ue, numero_atto: 679, data: 2016, numero_articolo: 5`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `regolamento ue` |
| vlx /parse_query display app.py:802 | `Art. 5 — regolamento ue` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 5 regolamento ue` |
| merlt estremi_from_urn (stub estremi) | — (null) |
| merlt build_node_label (stub node label) | `https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita` |
| merlt citation_router italian_legal | `//Eur-Lex Europa Eu/Eli/Reg/2016/679/Oj/Ita` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | — (null) |
| server citeArticle (dossier citation, MCP riferimento) | `art. 5, regolamento (UE) 2016/679` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `regolamento ue n. 679 del 2016, Art. 5` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `2016` |
| web tab label SearchPanel.tsx:234 | `regolamento ue 679` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 5 - regolamento ue n. 679` |
| web dossier PDF title dossierUtils.ts:119 | `1. regolamento ue n. 679 · Art. 5` |
| web dossier row SortableDossierItem.tsx:140 | `regolamento ue 679` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 5 regolamento ue n. 679` |
| web compare label CompareView.tsx:91 | `Art. 5 - regolamento ue n. 679` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 5 regolamento ue n. 679` |
| web palette preview citationParser.formatParsedCitation | `Art. 5 Reg. UE 679/2016` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 5 regolamento ue 679/2016` |
| web normattivaParser.generateLabelFromParams | `Art. 5 regolamento ue n. 679 /2016` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `regolamento-ue--679--2016--5` |
| web key buildNormaKey | `regolamento-ue--679--2016` |
| web uniqueArticleIdFromNorma | `5` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita` |

#### nis2-21

Stored norm: `tipo_atto: direttiva ue, numero_atto: 2555, data: 2022, numero_articolo: 21`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://eur-lex.europa.eu/eli/dir/2022/2555/oj/ita` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `direttiva ue` |
| vlx /parse_query display app.py:802 | `Art. 21 — direttiva ue` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 21 direttiva ue` |
| merlt estremi_from_urn (stub estremi) | — (null) |
| merlt build_node_label (stub node label) | `https://eur-lex.europa.eu/eli/dir/2022/2555/oj/ita` |
| merlt citation_router italian_legal | `//Eur-Lex Europa Eu/Eli/Dir/2022/2555/Oj/Ita` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | — (null) |
| server citeArticle (dossier citation, MCP riferimento) | `art. 21, direttiva (UE) 2022/2555` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `direttiva ue n. 2555 del 2022, Art. 21` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `2022` |
| web tab label SearchPanel.tsx:234 | `direttiva ue 2555` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 21 - direttiva ue n. 2555` |
| web dossier PDF title dossierUtils.ts:119 | `1. direttiva ue n. 2555 · Art. 21` |
| web dossier row SortableDossierItem.tsx:140 | `direttiva ue 2555` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 21 direttiva ue n. 2555` |
| web compare label CompareView.tsx:91 | `Art. 21 - direttiva ue n. 2555` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 21 direttiva ue n. 2555` |
| web palette preview citationParser.formatParsedCitation | `Art. 21 Dir. UE 2555/2022` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 21 direttiva ue 2555/2022` |
| web normattivaParser.generateLabelFromParams | `Art. 21 direttiva ue n. 2555 /2022` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `direttiva-ue--2555--2022--21` |
| web key buildNormaKey | `direttiva-ue--2555--2022` |
| web uniqueArticleIdFromNorma | `21` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `https://eur-lex.europa.eu/eli/dir/2022/2555/oj/ita` |

#### tfue-101

Stored norm: `tipo_atto: TFUE, numero_articolo: 101`

| Producer | Output |
|---|---|
| vlx generate_urn (identity today) | `https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016E/TXT` |
| vlx Norma.tipo_atto_str (norma_data.tipo_atto) | `TFUE` |
| vlx /parse_query display app.py:802 | `Art. 101 — TFUE` |
| merlt to_estremi / format_estremi (article node estremi) | `Art. 101 TFUE` |
| merlt estremi_from_urn (stub estremi) | — (null) |
| merlt build_node_label (stub node label) | `https://eur-lex.europa.eu/legal-content/IT/TXT/HT…` |
| merlt citation_router italian_legal | `//Eur-Lex Europa Eu/Legal-Content/It/Txt/Html/?Uri=Celex` |
| merlt act node is code? act_name_from_urn | — (null) |
| web citation.ts head (lawyer style, past texts only) | — (null) |
| server citeArticle (dossier citation, MCP riferimento) | `art. 101, tfue` |
| web normaMeta.formatCitation (copy trailer «Tratto da») | `TFUE, Art. 101` |
| web normaMeta.formatNormaMeta block (workspace subtitle) | `Estremi non disponibili` |
| web tab label SearchPanel.tsx:234 | `TFUE` |
| web article tab label ArticleTabContent.tsx:735 | `Art. 101 - TFUE` |
| web dossier PDF title dossierUtils.ts:119 | `1. TFUE · Art. 101` |
| web dossier row SortableDossierItem.tsx:140 | `TFUE` |
| web QuickNorm label (stored) StudyMode.tsx:62 | `Art. 101 TFUE` |
| web compare label CompareView.tsx:91 | `Art. 101 - TFUE` |
| web AskMerlt heading AskMerltEntry.tsx:36 | `Art. 101 TFUE` |
| web palette preview citationParser.formatParsedCitation | `Art. 101 TFUE` |
| web in-text link citationMatcher.formatCitationLabel | `Art. 101 TFUE` |
| web normattivaParser.generateLabelFromParams | `Art. 101 TFUE` |
| web key buildItemKey (stored: highlights, notes, bookmarks) | `tfue--101` |
| web key buildNormaKey | `tfue` |
| web uniqueArticleIdFromNorma | `101` |
| web features/merlt/qa/format.ts formatRetrievedUrn (Q&A source chip) | `https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=…` |

