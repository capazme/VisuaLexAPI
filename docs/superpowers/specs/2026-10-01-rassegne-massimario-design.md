# The Massimario's annual reviews: in MERL-T's stores, on the article page — Design

**Date:** 2026-10-01
**Status:** DRAFT 1 for the owner's review. The design was approved section by section in
conversation on 30 September and 1 October; section 13 keeps what is still open.
**Depends on:** the schema module of the MERL-T graph round
(`services/merlt/merlt/storage/graph/schema.py`, spec
`docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md` §4.1). It is written and
reviewed on `refactor/merlt-graph-vocabulary` and reaches `develop` with that round's first pull
request (its Tasks 1–5); this round builds on `develop` after that merge.
**Coordinated with:** the sentenze round for LibreLex (decision identity and the decision page),
the article-page redesign (placement), the graph round (the `AttoGiudiziario` key).

## 1. Context

The Ufficio del Massimario of the Corte di cassazione publishes every year a review of the
Court's case law, civil and criminal, written by its magistrates and organised by subject: the
**rassegne annuali** (`https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali.do`).
For each topic they say which decisions of the year mattered and how they read which norms.

**What the portal offers.** Besides one PDF per volume, a public JSON service that its own viewer
uses:

| Call | Returns |
|---|---|
| `/publicServices/{volume}/getIndex.do` | the tree Volume → Parte → Capitolo → Sezione (→ sub-sections), with ids |
| `/publicServices/{capitolo}/getCapitolo.do?activateLinks=true` | title, **authors**, **subject tags** (`materie`), and every section's HTML text |
| `/publicServices/{sezione}/getSezione.do?activateLinks=true` | one section (for sections that belong to no chapter) |
| `/publicServices/{parte}/getParte.do`, `/publicServices/{volume}/{campo}/getDada.do` | a part's title; volume-level texts (premessa, ringraziamenti) |

With `activateLinks=true` the portal itself turns every reference to a norm into a Normattiva
link — `art. 369, comma 2, n. 2, c.p.c.` becomes
`urn:nir:stato:codice.procedura.civile:1940-10-28;1443~art369-com2-num2`. The text is otherwise
identical to the unlinked version (measured: only a trailing newline differs). Decisions are
cited in the CED style: `Sez. U, n. 13319/2024, Di Paolantonio, Rv. 671516-02` (civil) and
`Sez. 1, n. 1399 del 15/12/1999, dep. 2000, Moccia, Rv. 215228-01` (criminal).

**Measured on the whole corpus** (downloaded on 30 September into a local archive outside the
repository, with the portal's legal notes and listing saved and dated):

- 63 volumes, 2010–2024: 40 civil, 22 criminal, 1 mixed (`Massimario 2019 CIVILE E PENALE`);
  1,375 chapters, 14,106 sections; 60 sections belong to no chapter (four criminal volumes).
- **98,840 paragraphs**, 62.9 million characters; paragraph length median 552, 95th percentile
  1,503, 1,841 paragraphs over 2,000 characters.
- **79,316 links to norms** in 43,695 paragraphs, over ~9,700 distinct acts. On a sample of 18
  volumes: `legge` 28 %, c.p.c. 19 %, c.c. 14 %, d.lgs. 13 %, c.p.p. 8 %, c.p. 6 %, d.l. 5 %,
  Costituzione 4 %.
- **68,083 mentions of `Rv.`**; 27,075 paragraphs cite both a norm and a decision.
- Corte costituzionale cited ~3,500 times. On the sample: CGUE ~470, Corte EDU ~340.
- On the sample, a simple pattern recognises 69 % of the `Rv.` citations; what it misses is almost all the
  criminal form (`n. N del gg/mm/aaaa, dep. AAAA`) and civil variants (`n. 28928 del 2019`, no
  rapporteur, `Rv. 66701301` without the dash, `Sez. L, 09136/2024` without `n.`).
- On 9,452 decision keys (sample), 51 appear with two section labels — `T` and `5`, `6-3` and
  `6`: the same decision written two ways. The section is not part of a decision's identity.
- The portal sits behind a web application firewall. One request in ~1,400 came back as an
  invalid page and succeeded on retry.

**What VisuaLex has today.** The article page shows case law only as Brocardi's massime
(`MassimeSection`, inside "Approfondimenti & Dottrina"). No code parses CED citations. A
case-law panel built on 29 August was reverted the same day; the owner's reason, given on
30 September: **the results were not relevant enough**. MERL-T keeps text chunks in Qdrant, the
graph in FalkorDB, and a `bridge_table` in Postgres that links a chunk to graph nodes with a
relation type, a confidence and a per-expert affinity that RLCF learns
(`services/merlt/merlt/storage/bridge/`).

## 2. The owner's decisions (30 September – 1 October)

1. **Everything is downloaded** and structured as historical data: every review stays tied to
   its year and is never presented as current law.
2. **Facts and prose, attributed.** The paragraphs' text enters the graph's stores and the
   vectors, with the source and the authors visible, as for Brocardi. The portal's legal notes
   reserve the Ufficio del Massimario's copyright and allow use "esclusivamente per uso
   scientifico e didattico, non finalizzato a scopo di lucro"; the owner has weighed this and
   decided. The prose must stay removable in one operation (section 9).
3. **The first consumer is the reader**: on the article page, what the Cassazione said about
   this article, year by year. The experts and LingoLex read the same data afterwards.
4. **Approach A: MERL-T's stores and the bridge.** Paragraphs go to Qdrant, decisions and norms
   to the graph, the links to the bridge; the reader's panel asks the bridge by URN. VisuaLex's
   own database keeps no legal content. The panel exists only when MERL-T is on.
5. **Strong and weak links are kept apart** (the lesson of 29 August). A paragraph's link to a
   norm or a decision was written by its author: strong. A decision's link to a norm inferred
   because both appear in one paragraph is weak, and is labelled so.
6. **One identity for decisions**, shared with the sentenze round (section 5.2).
7. **Scope of v1:** Cassazione and Corte costituzionale. CGUE and Corte EDU are counted, not
   parsed.

## 3. Goals and non-goals

Goals:

- Every paragraph of the 63 volumes in Qdrant, with its place in the review, its year, its
  authors and its source.
- Every cited Cassazione and Corte costituzionale decision a graph node with the shared
  identity; every cited norm linked to its `Norma` node.
- A reader who opens an article sees the review paragraphs that cite it, by year, credited.
- Re-running any volume changes nothing; next year's review is one more volume.

Non-goals:

- CGUE, Corte EDU, other courts (counted in the reports).
- Reading the full text of decisions (the sentenze round's page does that).
- Structural nodes for review, chapter and section (the structure lives in each chunk; they can
  be derived later from the same data).
- Extracting concepts or principles with a language model.
- Adding a paragraph to a dossier, annotating it, searching inside the panel.

## 4. The source and its archive

- **Courtesy.** One request every ~1.5 s, an honest User-Agent, retries with back-off; a page
  that is not valid JSON is retried after a pause before the fetch fails; a firewall rejection
  stops the run and reports it. Re-runs resume.
- **The raw archive** (JSON as served, PDFs, the dated legal notes) is kept outside the
  repository, as the evidence of what was taken and when. Production does not read it.
- **Who fetches.** A VisuaLex route fetches a volume for MERL-T, as `VisualexTreeAdapter` already
  does for Normattiva: `GET /fetch_massimario_volume?id=<volume>` returns the index and every
  chapter, part, loose section and volume field, raw. It goes through `ThrottledHttpClient`; the
  portal's host is added to `egress.ALLOWED_HOSTS` and to `services/visualex/SECURITY.md`. The
  route is internal: it is not in the web's `legalFetch` list, the Vite proxy or the ingress's
  `@legal` list, and the ingress does not route it.
- **Quirks the fetch handles:** sections outside any chapter (fetched one by one); the mixed
  2019 volume (no civil/criminal from the volume); volume titles without a number.

## 5. Data model

Every name below is defined in the schema module of the graph round; this round adds the ones
marked *new* to its enums (`SourceType.RASSEGNA`, a `Fonte` for the Massimario, the bridge
relation names — in `Rel` if they ever appear as graph edges). Its contract test
(`services/merlt/tests/unit/test_graph_vocabulary_contract.py`) scans every Cypher string under
`merlt/` and fails on a literal the schema does not define. Ids come from `point_id()`, URNs from
`canonical_urn()`, stubs from `stub_properties()`.

### 5.1 Paragraph → Qdrant

- The unit is a paragraph (`<p>`) of a section. A paragraph over 2,000 characters is cut at
  sentence boundaries into pieces for the vector; each piece carries the same links.
- Point id: the schema module's `point_id()` (uuid5, stable across processes), keyed by the
  paragraph's locator `massimario|<volume>|<section>|<paragraph>|<piece>`.
- `source_type`: `rassegna` (*new*). Payload: `text`, `anno` (of the review), `archivio`
  (`civile`, `penale`, `misto`), `volume`, `parte`, `capitolo`, `sezione` (number and title
  each), `autori`, `materie` (the chapter's tags), `url` (the section on the portal),
  `fonte: Ufficio del Massimario` (*new*), `article_urns` (the canonical URNs the paragraph
  cites).

### 5.2 Decision → `AttoGiudiziario`

- **Identity** (agreed with the sentenze round): `corte` (`cassazione` | `corte_costituzionale`),
  `archivio` (`civile` | `penale`, Cassazione only), `numero` (integer, no leading zeros),
  `anno` (integer). String key, where one is needed: `cassazione:civile:13319:2024`,
  `cassazione:penale:1399:2000`, `corte_costituzionale:1:2014`.
- `anno` is **the year of the number**: for criminal decisions the deposit year
  (`n. 1399 del 15/12/1999, dep. 2000` → 2000); without `dep.`, the year of the date. `archivio`
  comes from the volume; in the mixed volume from the chapter, and if the chapter does not say,
  the citation stays a reference without identity (reported, not guessed).
- Attributes: `sezioni` (as written: `U`, `L`, `T`, `6-3`…), `relatore`, `data_udienza`,
  `tipo`, `rv` (the massime numbers), `fonte`.
- Brocardi's massime take the same identity in the graph round's phase 2, when the doctrine
  layer is re-ingested; from then on a decision cited in a review and a Brocardi massima meet in
  one node. Until then they are separate nodes: the seed's key (`massima_{corte}_{numero}`) has
  no year and no archive, and cannot be re-keyed in place because decisions with the same number
  in different years already collapsed into one node.
- `AttoGiudiziario` as **the decision**, with its massime as attributes (the `Rv.` list, the
  massima texts, each text still its own Qdrant point), is what this round and the graph round
  both recommend; the alternative is a child `Massima` node. It changes the data model, so the
  owner decides (section 13).

### 5.3 Norm → `Norma`

- The portal's URN is converted to the canonical form of the schema module. The codes differ:
  `codice.civile:1942-03-16;262` is `regio.decreto:1942-03-16;262:2` in VisuaLex and the graph,
  `codice.procedura.civile:1940-10-28;1443` is `regio.decreto:1940-10-28;1443:1`, and so on
  (`services/visualex/visualex_api/tools/map.py`, `NORMATTIVA_URN_CODICI`). Acts cited without
  a date (`legge:1983;184`) are resolved once per act through the VisuaLex API and cached.
- The article is the join level; the comma, number or letter (`com2-num2`) is kept on the link.
- A norm not yet in the graph becomes a stub in the schema module's stub shape, completed when
  its act is ingested. A URN that cannot be resolved keeps the portal's form as an alias and is
  reported.

### 5.4 Links

| Link | Where | Strength | Carries |
|---|---|---|---|
| paragraph → `Norma` | bridge (*new* relation type) | 1.0 | the citation as written (`art. 369, comma 2, n. 2, c.p.c.`), the comma part |
| paragraph → `AttoGiudiziario` | bridge (*new* relation type) | 1.0 | the citation as written, the `Rv.` |
| `AttoGiudiziario` → `Norma` | graph, `INTERPRETA` | below 1, `tipo: co-citazione` | the years and the number of paragraphs in which both appear |

### 5.5 Citation grammar

One tolerant parser, one test per form: civil `n. N/AAAA` and `n. N del AAAA`, with or without
`n.`, rapporteur and dash in the `Rv.`; criminal `n. N del gg/mm/aaaa[, dep. AAAA]`; lists of
citations separated by `;`; Sezioni Unite spelt `U`, `U.`, `Un.`; Corte costituzionale
`Corte cost. n. N del AAAA` and `sent./ord. n. N/AAAA`. **Target: at least 95 % of the `Rv.`
mentions of each volume**, measured in the batch report; what is not recognised is counted and
sampled, never guessed.

## 6. Pipeline

A new adapter of the mechanical ingestion, `MassimarioAdapter`
(`services/merlt/merlt/pipeline/mechanical_ingestion/`), with `source_ref = {"volume": <id>}`.
It reuses the batch, staging, report and promotion of that design, with the graph round's three
changes (orphans become stubs, completeness, promotion through the schema module).

1. **Run**: an administrator starts a volume from the Ingestione tab of the AdminPage.
2. **Parse** (worker, `merlt_bulk` queue): fetch through VisuaLex (section 4) → paragraphs →
   citations → canonical URNs → nodes, edges, chunks, bridge rows.
3. **Stage**: one batch per volume (~1,570 paragraphs on average), `pending_review`. The batch
   holds chunks and bridge rows next to nodes and edges.
4. **Report**: paragraphs; citations recognised per form and coverage, with samples of the
   unrecognised; norms linked to existing nodes, stubs created, URNs unresolved; decisions new
   and already in the graph; keys seen with more than one section; references without identity.
5. **Promote**, on the administrator's approval: graph, then bridge, then Qdrant with the
   vectors computed in the job (~7 minutes a volume on the development Mac's CPU at the measured
   4 passages a second; where the vectors run is the graph round's open point 3).

**Idempotence.** Same ids on every run; a corrected text replaces its point; links are merged,
not duplicated. **Failure.** A fetch that fails marks the batch `failed` with its reason; a
promotion that stops half-way is re-run and converges, because every write is an upsert.

**Sizes.** Qdrant from ~35,000 to ~135,000 points (~550 MB more); ~35,000 decision nodes and
~80,000 weak edges; ~140,000 bridge rows. The whole corpus: 63 batches, ~7–8 hours of vectors,
run at night.

## 7. The reader

- **Where**: a new component in the `article_content_after` plugin slot
  (`apps/web/src/plugins/registry.tsx`), after the article body and before Brocardi's section,
  present only with MERL-T on. The article text is untouched (root `CLAUDE.md`, rule 23).
  Placement is subject to the article-page redesign (section 13).
- **Closed by default.** Header: **Nelle rassegne della Cassazione** · *N passi, AAAA–AAAA*, and
  below it *Orientamenti datati: riferiti al testo vigente nell'anno della rassegna.* Nothing is
  rendered when no paragraph cites the article.
- **Open**: grouped by year, newest first; ten paragraphs at a time within a year; a
  civile/penale filter only when both appear. Each paragraph shows:
  - where it comes from: `Rassegna civile 2024 · vol. 1 › Cap. I › § 2 <section title>`, and the
    authors;
  - the paragraph, cut at four lines with "mostra tutto", the citation of this article
    highlighted as the author wrote it, with its comma when it has one;
  - the decisions it cites as chips (`Sez. U, n. 13319/2024 · Rv. 671516-02`), marked when
    the graph holds a Brocardi massima for them (after the graph round's phase 2). A chip opens the sentenze round's page in the app
    (`/sentenze/cassazione-civile/13319/2024`, `/sentenze/cassazione-penale/1399/2000`,
    `/sentenze/corte-costituzionale/1/2014`, no `?sezione=`); a reference without identity uses
    `/sentenze/cassazione/<n>/<a>?sezione=<label>`. Until that page exists the chip is a plain
    label, not a dead link;
  - the credit: *Fonte: Ufficio del Massimario della Corte di cassazione* and a link to the
    section on the portal.
- **Only strong links.** The panel lists paragraphs whose author cited this article. It never
  lists "decisions about this article" from co-citation.
- **Data path**: the web calls `GET /api/merlt/rassegne?urn=<canonical>&anno=&cursor=` on the
  BFF (authenticated); the BFF calls MERL-T, which reads the bridge by URN, fetches the points by
  id (no semantic search) and groups them. The call records no reading event. A MERL-T error
  shows one discreet line, *Rassegne non disponibili ora*; errors are not swallowed.

## 8. Dependencies and coordination

- **Graph round, first pull request** (schema module, canonical URN, stub shape, contract test):
  this round's writer is built on it and adds the names marked *new* in section 5. Nothing here
  is written before it is in `develop`.
- **Graph round, phase 2**: Brocardi's massime are re-ingested with the identity of section 5.2.
- **Sentenze round**: the decision page and its routes; the chips link to it once it exists.
- **Article-page redesign**: the panel's placement.
- The mechanical ingestion is stopped for the codes (graph round, decision 7); this is a new
  adapter with its own batches, reviewed and promoted one volume at a time.

## 9. Rights and attribution

- Every point, node and bridge row carries `fonte: Ufficio del Massimario`; every paragraph its
  authors and its link. The panel credits the source on every item.
- **Reversible**: deleting by `fonte` removes the prose (Qdrant points) and the bridge rows in
  one operation, leaving decisions and norms, which are facts.
- The repository holds no text from the reviews: tests use synthetic fixtures written in the
  portal's format.

## 10. Security and privacy

- The fetch route is internal and not reachable through the ingress (section 4); the portal's
  host is on the egress allowlist; the route builds no path from input it did not validate
  (`services/visualex/CLAUDE.md`, gotcha 30).
- The BFF route is behind authentication; MERL-T's `:8000` stays unexposed; promotion stays
  behind `requireAdmin`.
- The panel's request records nothing about the reader.
- The reviews name magistrates as authors and rapporteurs, and parties in criminal citations
  (`Moccia`): public case-law metadata, shown as the portal shows it.

## 11. Verification

- Parser: a test per citation form, including the December-hearing/January-deposit case and the
  mixed volume; the URN conversion for every code in the table; synthetic fixtures only.
- A contract test: the adapter emits no name the schema module does not define.
- Pilot: one civil and one criminal volume, their reports read by the owner, coverage ≥ 95 %;
  a sample of paragraphs checked by hand against the portal (text, links, decisions).
- Idempotence: a second run of a promoted volume changes nothing.
- Reversibility: deleting by `fonte` on a copy removes exactly the prose and the bridge rows.
- Reader: a browser pass on `http://localhost:5173` with MERL-T on (an article cited in many
  years, one never cited, MERL-T stopped).
- The suites of every area touched, green.

## 12. Risks

- **Rights**: decided by the owner (section 2, decision 2); the prose is removable in one operation.
- **The portal's firewall**: slow fetch, resumable, one volume at a time.
- **Graph round timing**: this round waits for the graph round's first pull request.
- **Weak links read as strong**: the reader never shows them; experts must read `tipo`.
- **Size**: Qdrant roughly quadruples; measured on the pilot before the rest.

## 13. Open

1. `AttoGiudiziario`: the decision with its massime as attributes (recommended by this round
   and the graph round), or a child `Massima` node — the owner decides.
2. The panel's placement in the article-page redesign.
3. Where the vectors are computed (graph round, open point 3).
