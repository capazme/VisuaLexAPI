# MERL-T knowledge graph: one structure, complete ingestion — Design

**Date:** 2026-09-30
**Status:** accepted by the owner on 30 September (the interview answers are in section 2).
Phase 1 is planned in `docs/superpowers/plans/2026-09-30-merlt-graph-vocabulary.md`; section 11
keeps what is still open. Amended on 1 October with what the December 2025 experiments
(`services/merlt/docs/experiments/`) measured and got wrong, with the owner's decision that a
ruling is one node with its massime as attributes, and with the two text fingerprints kept
apart: sections 1, 4.1–4.5, 5.1, 5.4, 5.7 (new), 6.1, 9 and 11.
**Round:** the MERL-T graph. It comes **before** the MCP spike, by the owner's choice (the
Gate 0 date is at risk, and the owner accepted that).
**Supersedes:** filling the graph with the mechanical ingestion as it stands
(`docs/merlt/slices/ingestion-governance/design.md`), and the July idea of `/grafo` as the
reader's main surface (`docs/merlt/slices/slice4-graph-deliberation/design.md`, decision A).

## 1. Context: what the audit of 30 September found

Two read-only audits of the code (who writes the graph, who reads it) and measurements on
the development stores. Paths are under `services/merlt/merlt/` unless they say otherwise.

**What the graph holds today.** 27,749 nodes, all from the Libro IV seed
(`scripts/load_seed_libro_iv.py`, `data/seeds/libro-iv-cc-graph.json`). Libro IV is rich:
the hierarchy (`Norma` nodes with `tipo_documento` libro/titolo/capo/sezione, linked by
`contiene`), 1,798 `Comma`, about 2.9 `Dottrina` and 12.8 massime per article, and a concept
layer of ~13,900 nodes and ~27,000 edges whose `fonti` is `manuale:Torrente-libroiv`. Outside
Libro IV the codice civile exists only as 469 text-less stubs (`is_stub`). Qdrant holds
34,768 points, almost all from the seed (20,014 `massima`, 4,990 `concettogiuridico`, 3,504
`comma`, 3,469 `dottrina`, 1,808 `norma`).

**Six writers, six structures.**

| Writer | What it writes | What it lacks |
|---|---|---|
| Seed loader | hierarchy, Comma, doctrine, massime, concepts; no norm-to-norm edges | provenance |
| Mechanical ingestion (`pipeline/mechanical_ingestion/`) | `Norma` + same-act `RINVIA` | hierarchy, Comma, doctrine, vectors, provenance |
| Lazy ingestion (`worker/tasks.py` → `core/legal_knowledge_graph.py`) | Norma, Comma, Dottrina, ≤5 massime, vectors | hierarchy (the Brocardi `position` is dropped, `core/legal_knowledge_graph.py:508-511`), working multivigenza (`:488`), numbered acts (`worker/tasks.py:73-102`) |
| Entity writer / consensus (`storage/graph/entity_writer.py`, `api/enrichment_router.py`) | `Entity:{Tipo}` nodes, stubs, `CITA` edges | a key shared with the seed's concepts (`id` vs `node_id`) |
| Co-evolution (`pipeline/provisional_writer.py`) | `LiveSource` nodes, `CORRELATO` | text in the property the readers read |
| Side scripts (`scripts/backfill_*.py`, `/pipeline/start` → graph `merl_t_test`) | partial shapes | — |

The same fact is written several ways: a reference is `RINVIA`, `CITA` or `rinvia`; relation
names mix cases (`DISCIPLINA`, `interpreta`, `contiene`); an article is "Art. 1 Cost." or "Art.
1 costituzione"; stubs have four shapes; `provenance` is missing or wrong; `fonte` has eight
spellings. Lazy ingestion keys Qdrant points with Python `hash()` (`core/legal_knowledge_graph.py:624`),
so a re-ingest after a restart duplicates them. A mechanical batch's orphan edges are dropped at
promotion and the batch can never be promoted again (`promote.py:84-91`,
`scripts/load_seed_libro_iv.py:268-272`, `api/ingestion_mechanical_router.py:250-251`).

**The readers expect other things.** The systemic expert walks a fixed relation set without
`RINVIA` (`experts/systemic.py:131-141`); the experts read `testo`, which only `Comma` has
(`experts/literal.py:297`); the precedent expert looks for `Massima`/`Sentenza` labels where the
seed writes `AttoGiudiziario` (`experts/precedent.py:346-378`); several tools query relation
names nobody writes (`tools/hierarchy.py:342,390`, `tools/historical_evolution.py:277-283`,
`tools/definition.py:286`); the retriever filters `source_type` on `norma`, `ratio`/`spiegazione`,
`massima` only (`storage/retriever/models.py:192-207`), so ~12,000 seed points are never
searched. **Any `Norma` counts as present** for the lazy-ingestion trigger
(`api/graph_router.py:83-89`, `apps/server/src/routes/merlt/events.ts:129-131`): an article
written by the mechanical ingestion, or a stub, never receives commi, doctrine or vectors.

**Signals nobody reads.** `tracking_events` (reads, highlights, dossier adds, citation clicks)
has no consumer; the learned citation model is off at inference; traversal paths are not saved,
so RLCF source ratings train only a generic head (`api/experts_router.py:665-678`).

**The data we do not use.** Per article, the doctrine source already gives structured parts:
position in the code, Ratio, Spiegazione (up to 44,000 characters for art. 832 c.c.), Massime
with court, number and year (378 for art. 640 c.p., 334 for art. 112 c.p.c.), Latin maxims,
Glossario, CrossReferences, Footnotes, RelatedArticles. Normattiva's text carries its update
notes (which act changed which comma, from when). None of it reaches the graph outside Libro IV.

**Measured costs.** Normattiva text: ~1.8 s an article under load, 10 articles a request, the
worker waiting up to 120 s (`fda072b`, `b40f34a`). Embeddings (multilingual-e5-large, CPU, in
Docker on the development Mac): **4 passages a second**. Store memory today: FalkorDB 111 MB,
Qdrant 150 MB, Postgres 490 MB.

**What the December 2025 experiments measured** (`services/merlt/docs/experiments/`, imported
from the earlier monorepo; same embedding model, older scrapers):

- Codice penale, Libro I (EXP-006): 263 articles, **6,195 massime — 23.6 an article**, almost
  twice Libro IV's 12.8 (and those 12.8 count `interpreta` edges: one node per judgment is ~13%
  fewer). Normattiva plus the doctrine source, sequential and cold: ~4 s an article.
- Fetch alone: 2.0–2.8 s an article; the full pipeline with vectors 7–8.4 s; multivigenza adds
  ~3.7 s (EXP-001, EXP-006, EXP-014). For ~15,000 articles: 17–35 hours.
- Embeddings with Apple's MPS outside Docker: ~7 passages a second (batch 32), ~9 for massime
  (batch 64), plus ~2 minutes to load the model (EXP-001).
- No memory figures exist: section 5.5 still has to measure them.

## 2. The owner's decisions (30 September)

1. **The graph comes before the MCP spike.** Phases 1 and 2 now; the spike after.
2. **The graph is not shown to end users.** It guides the model and feeds LingoLex; it does not
   make reading easier for people. The side rail "Grafo" and `/grafo` are visible only to those
   who validate (administrators now, the validators' nucleus later). The validation page keeps
   its graph views. In expert answers, sources become a list of articles.
3. **LingoLex is the first consumer.** What it needs comes first: a stable identity per article
   (URN + text fingerprint), a coverage map, and priorities from what people actually read.
4. **The doctrine layer is ingested in full** — every massima, Ratio, Spiegazione, Latin maxim,
   glossary term and curated cross-reference — with its source credited on every node and on
   screen ("Fonte: Brocardi.it").
5. **The seed's concept layer stays** (`fonti: manuale:Torrente-libroiv`).
6. **Scope:** the Gate 0 codes (codice civile, c.p.c., codice penale, c.p.p., Costituzione,
   c.p.a.) and the sector codes (section 6.6).
7. **The mechanical ingestion is stopped.** Its staged batches are not promoted; this round
   ingests those acts again, completely.

## 3. Goals and non-goals

Goals:

- **One vocabulary**, defined once and used by every writer and every reader.
- **Every article in scope has the same complete shape**, whoever wrote it, and can be
  re-ingested without duplicating anything.
- **LingoLex-ready**: canonical URN, fingerprint, completeness, coverage, reading counts.
- **Validators-only graph UI.**

Non-goals:

- Extracting concepts with a language model outside Libro IV (a later, paid round).
- Improving the experts beyond making them read the canonical vocabulary.
- Training (RLCF, citation model) — phase 3 only saves what training will need.
- Public exposure.

## 4. Phase 1 — one vocabulary

### 4.1 One schema module

`merlt/storage/graph/schema.py` (new) is the single definition of:

- **Labels**: `Norma` (with `tipo_documento`: `articolo`, `codice`, `legge`, …, and the
  partitions `parte`, `libro`, `titolo`, `capo`, `sezione`, as the seed already does), `Comma`,
  `Lettera`, `Dottrina`, `AttoGiudiziario` (a ruling, its massime as attributes: 5.1), `LocuzioneLatina` (new),
  `ConcettoGiuridico` and the rest of the seed's concept labels, `LiveSource`.
- **Relation types, all upper case**: `CONTIENE` (partition→partition→article→comma→lettera),
  `RINVIA` (article→article or act; replaces `CITA` and `rinvia`), `MODIFICA`, `ABROGA`,
  `INSERISCE`, `SOSTITUISCE`, `INTERPRETA` (ruling→article), `COMMENTA` (dottrina→article),
  `ESPRIME` (article→Latin maxim), `MENZIONA` (article→glossary concept), `CORRELATO`, and the
  seed's concept relations (`DISCIPLINA`, `APPLICA_A`, `IMPONE`, `ESPRIME_PRINCIPIO`,
  `DEFINISCE`, `PREVEDE`, `PREVEDE_SANZIONE`, `ATTRIBUISCE_RESPONSABILITA`,
  `STABILISCE_TERMINE`).
- **Property names**, with one text property for every textual node (`testo`; `testo_vigente`
  kept on `Norma` as an alias until the readers no longer need it).
- **The URN canonical form** (full Normattiva URL, no `!vig=`/`@originale`; one function, the
  one `graphClient.normalizeGraphUrn` mirrors) and the **estremi formatter** (`Art. 1 Cost.`,
  `Art. 1321 c.c.`, from the existing abbreviation table in
  `pipeline/mechanical_ingestion/parser.py:131-161`).
- **Provenance** values (`seed`, `ingestion`, `community_validated`, `live_unconfirmed`,
  `confirmed`) and **fonte** values (`Normattiva`, `Brocardi.it`, `manuale:Torrente-libroiv`,
  `community`, `mcp-legal-it`).
- **The stub shape** (`URN`, `node_id`, `numero_articolo`, `estremi`, `is_stub: true`,
  `provenance`, nothing else) and the **completeness flags** of an article (section 4.3).
- **The indexes**: FalkorDB has none today (`pipeline/enrichment/writers/graph_writer.py`
  `ensure_indexes` has no caller and speaks Neo4j's syntax), so every `MERGE` scans its whole
  label. The module lists the keys to index — `URN` and `node_id` on every label that has them —
  and the Qdrant payload fields to index (`article_urn`, `source_type`). Phase 2's volume needs
  them.
- **Historical versions keep their own key.** Multivigenza writes a past version as a `Norma`
  with `tipo_documento: 'versione_storica'`, keyed `<URN>!vig=<date>`
  (`pipeline/multivigenza.py:1208`), and links it `VERSIONE_DI` to the article. `canonical_urn`
  maps that key to the live article, which is right for readers and wrong for a writer: the
  module builds a version's key with its own function and no writer passes it through
  `canonical_urn`. How versions are modelled for good is open (section 11).

Every writer imports its names from here; every reader builds its Cypher and its Qdrant
filters from here. A contract test fails when a writer emits, or a reader asks for, a name the
module does not define.

### 4.2 Qdrant

- One collection (`storage/vectors/collection.default_chunks_collection()`).
- **Deterministic point ids**: `uuid5(namespace, "<canonical URN>|<source_type>|<index>")`.
  Re-ingesting replaces, never duplicates.
- Payload: `article_urn` (canonical), `source_type`, `text`, `numero_articolo`, `tipo_atto`,
  `fonte`; a massima's point also carries its ruling's identity (5.1).
- `source_type` values: `norma`, `comma`, `ratio`, `spiegazione`, `dottrina`, `massima`,
  `concetto`. The retriever maps experts to types in the schema module: literal and systemic
  read `norma` **and** `comma`; principles read `ratio`, `spiegazione`, `dottrina`, `concetto`;
  precedent reads `massima`.

### 4.3 Completeness instead of existence

An article is complete when it has: text, rubrica, its partition chain, its commi, its
fingerprint, its doctrine layer (or the recorded fact that the source has none), and its
vectors. `Norma.completeness` records each part with the date it was written. The lazy trigger
(`api/graph_router.py:83-89`, `apps/server/src/routes/merlt/events.ts:129-131`) asks
"complete?" instead of "exists?", so a stub or a partial article is completed the first time
someone reads it.

Phase 1 checks four parts, derived from the graph itself: text, commi, a parent through
`CONTIENE`, and the text's fingerprint (`testo_sha256`). Rubrica is left out (many articles have none). The
doctrine layer, the vectors and the dated record join in phase 2: checking them sooner would
re-ingest every seed article on its first view and duplicate its vectors, because seed and lazy
vectors are keyed differently until phase 2 re-ingests. An article that stays incomplete after
an ingestion is not asked for again within a day.

### 4.4 Migrating the graph that exists

One script, idempotent, with a dry run that prints what it would change and a report after:

- rename relation types to the canonical names (`contiene`→`CONTIENE`, `interpreta`→
  `INTERPRETA`, `commenta`→`COMMENTA`, `modifica`→`MODIFICA`, `CITA`/`rinvia`→`RINVIA`, …);
- rewrite `estremi` with the formatter; unify the four stub shapes;
- stamp `provenance` and normalise `fonte` (`Brocardi` → `Brocardi.it`; `VisualexAPI` →
  `Normattiva` for norm text);
- merge the seed's concept twins with the community's `Entity` nodes on one key;
- copy `testo_vigente` into `testo` on `Norma`;
- Qdrant: re-key the lazy points to deterministic ids and drop the duplicates, re-type
  `concettogiuridico` → `concetto`;
- create the indexes of section 4.1, in FalkorDB and Qdrant;
- the dry run and the report include integrity checks: duplicate `URN`, `Norma` without `URN`,
  an article without text, isolated nodes, `certezza` outside 0–1 (from the December 2025
  schema notes).

It runs after a backup (`scripts/backup.sh`; section 9 checks that the backup covers FalkorDB
and Qdrant).

### 4.5 Readers

- Systemic: its relation set comes from the schema and includes `RINVIA`, `CONTIENE`,
  `MODIFICA`, `ABROGA`.
- Every expert reads text through one accessor (`testo`, then `testo_vigente`, then `text`).
- Precedent: `AttoGiudiziario` is the ruling, and its massime are what the expert quotes (5.1).
- Tools (`tools/hierarchy.py`, `historical_evolution.py`, `definition.py`,
  `textual_reference.py`): canonical names; a tool whose relation nobody writes is fixed or
  removed, never left returning empty.
- RLCF `GRAPH_TO_POLICY_RELATION` covers every canonical relation.
- The retriever's graph enrichment finds an article by its canonical URN, not by
  `numero_articolo` (`storage/graph/client.py:307`, `get_related_nodes_for_article`): with two
  codes in the graph, art. 52 c.p. would get art. 52 c.c.'s neighbours, and `bis` articles none.
- `tools/external_source.py:363-370` builds c.c. and c.p. URNs without the URL wrapper and
  without the annex (`;262:2`, `;1398:1`): it builds them through the schema module.
- Web (`apps/web/src/features/merlt/graph/shared/graphStyles.ts`): styles for `RINVIA`,
  `CORRELATO`, `ESPRIME`, `MENZIONA`, since validators see them.

## 5. Phase 2 — one complete ingestion per article

### 5.1 One pipeline

The mechanical and the lazy paths become one: `ingest_article(urn)` writes the whole shape of
section 4, from:

| Part | Source | Notes |
|---|---|---|
| text, rubrica, vigenza | Normattiva via the VisuaLex API (`/fetch_article_text`) | `article_text` is taken as the scraper returns it: its formatting is a data contract (root `CLAUDE.md`, rule 23) |
| partitions | `/fetch_tree` section headings, parsed with `tools/archivio-normativo/archivio_normativo/hierarchy.py` (`walk_tree`), checked against the doctrine source's `position` (`Codice Penale>LIBRO SECONDO…>Titolo XII…>Capo I…>Articolo 575`) | a heading line can carry two levels ("LIBRO PRIMO … TITOLO PRIMO …"): the parser must split it |
| commi, lettere | the article text, the way the lazy path already cuts them | |
| fingerprints | `testo_sha256`: SHA-256 of `article_text`, the HTML-derived text VisuaLex serves; `akn_sha256`: `/fetch_act_fingerprints` (sha256 of the AKN text, one call per act) | two properties, never one overwriting the other: AKN and HTML text match 0 times in 19 (root `CLAUDE.md`, rule 23). Which one LingoLex anchors on is decided in phase 3 (6.1) |
| modifications | the update notes in the text (`AGGIORNAMENTO (n)`) and multivigenza | fixes `NormaVisitata.urn` (`core/legal_knowledge_graph.py:488`) |
| references | the text (same act and other acts), plus the doctrine source's CrossReferences | a target not in the graph becomes a stub, completed when its act is ingested |
| doctrine | `/fetch_brocardi_info`: Ratio, Spiegazione, Relazioni, Footnotes → `Dottrina`; Massime → `AttoGiudiziario` (the ruling) with its massime as attributes; Brocardi → `LocuzioneLatina`; Glossario → `ConcettoGiuridico` + `MENZIONA` | `fonte: Brocardi.it` on every node; ids qualified by act (today they collide across acts, `pipeline/ingestion.py:883,919`) |
| vectors | section 5.4 | |

Two identities the table implies, settled here because the old ones collided:

- **A ruling** (`AttoGiudiziario`) is the pronuncia, and its massime are attributes of it —
  **decided by the owner on 1 October**. Its key is the identity shared with the sentenze and
  massimario rounds: `cassazione:<archivio>:<numero>:<anno>` and
  `corte_costituzionale:<numero>:<anno>`, with the year of filing for the criminal archive.
  `(autorita, numero, anno)` alone is not enough: the civil and criminal archives of the
  Cassazione number their rulings independently, so the same number and year can name two
  rulings. The December 2025 run gave 827 massime an `unknown_<n>` id when parsing failed, so
  the same ruling cited by several articles became several nodes (EXP-001, Run 5).
- **A massima** is a Qdrant point keyed on its ruling's identity **plus a fingerprint of its
  text**, since one ruling carries several massime — not on its position in the source's list.
  A re-ingest deletes the article's massima points it no longer writes.
- **A comma or a lettera** is keyed from the canonical article URN by one schema function, so
  a non-canonical article URN cannot leak into it.

A reference keeps its kind when the text tells it (`tipo_rinvio`: `richiamo`, `rinvio_recettizio`,
…) and the words it was read from (`testo_riferimento`), as properties of `RINVIA`.

### 5.2 Governance

Batches keep the staging, the conflict report and the admin review of the mechanical design,
with three changes: a batch holds at most ~900 articles (split a code by books); orphan edges
become stubs instead of being dropped; the report shows completeness per article. Promotion
writes through the schema module.

### 5.3 Throughput and courtesy to the sources

Normattiva: ~1.8 s an article under load; the doctrine source: one request per article, to be
measured and throttled (the archive tool's `throttle.py` is the model). About 15,000 articles
in scope make **roughly a day of fetching**, spread over nights, resumable per batch, on the
`merlt_bulk` queue that readers' requests overtake.

### 5.4 Vectors

A separate job, resumable, in priority order: `norma` and `comma`, then `ratio`/`spiegazione`/
`dottrina`, then `massima`. At the measured 4 passages a second, the massime alone could take
**days** on the Mac's Docker CPU: the job runs where it is fastest (the host's GPU, or Apple's
MPS outside Docker, ~7–9 passages a second in December 2025), and the plan measures both before
committing, cold and with one method.

multilingual-e5-large reads **512 tokens** and silently drops the rest; nothing in
`storage/vectors/embeddings.py` splits a long text today. A Spiegazione of 44,000 characters
is split into passages that fit, each its own point (the `key` of `point_id` numbers them).
Every payload records `embedding_model`, since vectors may be computed on more than one
machine.

### 5.5 Size

The pilot (codice penale) is measured before anything else is ingested: nodes, edges, massime,
FalkorDB and Qdrant memory. If the massime make FalkorDB too large for the 16 GB host, their
full text moves to Postgres and Qdrant, and the graph keeps their metadata and a short excerpt.

### 5.6 Order

1. Pilot: codice penale. Measure (5.5), review, promote.
2. Codice civile (six books), c.p.c., c.p.p., Costituzione, c.p.a.
3. Sector codes (6.6).

### 5.7 Known pitfalls

Most were paid for once in the December 2025 experiments; each gets a test in the phase 2 plan.

- **The rubrica stored as comma 1**: 802 of Libro IV's 2,546 commi were a rubrica (EXP-014
  backbone validation).
- **Lettere cut into commi**: Normattiva separates lettere with a blank line; art. 117 Cost.
  became 26 commi instead of 3 (EXP-009).
- **Update notes are not commi**: the text carries its `AGGIORNAMENTO (n)` notes (5.1); the
  cutter stops before them.
- **The promulgation decree's own articles**: the codice penale's tree lists R.D. 1398/1930's
  arts. 1–3, which collide with c.p. arts. 1–3 unless the annex is kept (`;1398:1`); filter on
  the code's partitions.
- **The annex suffix** (`;262:2`, `;1398:1`) has failed both ways: doubled (`262:2:2`) and lost.
- **Multivigenza**: matching an article by prefix (art. 1 matched art. 14); a whole article
  marked repealed when one comma was; targets like "del comma 2 dell'art. 2-bis" not parsed
  (EXP-005).
- **A warm cache hides the cost**: the doctrine source's one-day cache cut a run from 41 to 7
  minutes. The pilot is measured cold.
- **Costituzione**: arts. 115, 124, 128–130 are repealed and have no commentary; the
  disposizioni transitorie e finali (I–XVIII) were never ingested (section 11).

## 6. Phase 3 — LingoLex

### 6.1 Anchors

Every article carries `URN` (canonical) and two fingerprints with their dates (5.1):
`testo_sha256`, of the `article_text` readers see and annotate, and `akn_sha256`, from
`/fetch_act_fingerprints`. They are different texts (rule 23) and never overwrite each other.
Which one LingoLex anchors a card on is decided here, in phase 3. A nightly job compares each
act's fingerprints with the source and marks changed articles (`completeness` reset, a
`changed_at` date): the "da rivedere" signal a card needs.

### 6.2 Coverage map

`GET /api/merlt/ops/coverage?act=…` (admin, then LingoLex): per act and partition, the number
of articles, how many are complete, and the counts of commi, massime, doctrine and concepts.

### 6.3 Reading priorities

A table of reading counts per article, aggregated from `tracking_events` (`article:viewed`,
canonical URN, distinct readers, last read). **Aggregates only**: no user id reaches the graph,
and an article read by fewer than three people shows no count.

### 6.4 What training will need

Traversal paths are saved in the Q&A trace, so a later training round can use them.

### 6.5 Graph visibility

The side rail, the Sidebar entry and `/grafo` render only for validators (`isAdmin` today;
the validators' role when the nucleus exists). The BFF graph read routes get the same guard,
so hiding the UI is not the only protection; the entity search stays open to contributors,
whose picker needs it. Expert answers show their sources as a list of articles that open in the
reader. The Q&A lives on `/grafo` today, so in phase 1 it follows the graph: a page for it
without the graph is a UI round of its own, when the owner chooses.

### 6.6 Sector codes

From the abbreviation table: codice del consumo, codice della privacy, codice dei contratti
pubblici, codice della crisi d'impresa, codice dell'amministrazione digitale, codice delle
assicurazioni private, codice della proprietà industriale, codice dell'ambiente, codice dei
beni culturali, codice antimafia, codice del terzo settore, codice delle comunicazioni
elettroniche, codice del processo tributario, codice di giustizia contabile, codice della
strada, codice della navigazione, codice del turismo, codice della nautica da diporto. The
owner confirms the list and its order (section 11).

## 7. What changes for the reader

Nothing visible, except that the graph disappears for non-validators and expert sources become
a list. The reading surface does not change: its text contract (rule 23) is untouched.

## 8. Security and privacy

- Reading counts are aggregates with a minimum of three readers (6.3); `tracking_events` stay in
  MERL-T's Postgres, as today.
- Graph read routes are guarded server-side (6.5).
- The MERL-T admin routes stay behind `requireAdmin` and `:8000` stays unexposed.
- Every node carries its source (`fonte`), so the doctrine source is always credited.

## 9. Verification

- Phase 1: contract tests (writers and readers against the schema); the migration's dry run and
  report on a copy of the development graph first; a before/after count of every label and
  relation type; the MERL-T suite green; **retrieval does not get worse**: the semantic gold
  standard already in code (`merlt/benchmark/gold_standard.py`, Libro IV, URNs in canonical
  form) run before and after the migration — Recall@5, MRR, hit rate — once NDCG stops counting
  several chunks of one article as several hits (`merlt/benchmark/metrics.py`; EXP-016 reports
  1.02).
- Phase 2: the pilot measured and reviewed; for a sample of articles, the complete shape checked
  node by node; a re-ingest that changes nothing (idempotence); the backup restores FalkorDB and
  Qdrant. The shape checks start from EXP-014's `validation/validation_framework.py` (article
  and comma counts, rubrica not stored as a comma, `CONTIENE` per comma, numbering from 1, URN
  form), moved to the canonical names with expected counts from `/fetch_tree`; the pilot's
  article list is checked against EXP-006's `ground_truth.json` (its `position` field is wrong
  and is not used); multivigenza against EXP-005's five articles of L. 241/1990.
- Phase 3: `akn_sha256` matches `/fetch_act_fingerprints` and `testo_sha256` matches the SHA-256
  of `/fetch_article_text`'s `article_text`; coverage numbers match counts in the
  graph; the graph hidden for a non-admin account in the browser.

## 10. Risks

- **Gate 0**: the spike starts after this round (owner's decision).
- **Volume**: massime could be hundreds of thousands of nodes and days of vector computation
  (5.4, 5.5) — the pilot decides.
- **Courtesy to the sources**: a day of fetching; throttled, at night, resumable.
- **Migration of live development data**: backup first, dry run, report.
- **The concept layer's source** (`manuale:Torrente-libroiv`): kept by the owner's decision; its
  nodes keep their `fonti`, so they can be found and isolated later.

## 11. Open

1. The sector codes' list and order (6.6).
2. The validators' role (6.5): administrators only until the nucleus exists.
3. Where the vectors are computed (5.4): measured in the plan.
4. The massime's full text in FalkorDB or outside (5.5): decided by the pilot.
5. How historical versions are modelled (4.1): a `Norma` with `tipo_documento:
   'versione_storica'` and its own key, as today, or a label of its own (`Versione`, with
   validity dates, as the December 2025 ontology proposed). Phase 2, which writes multivigenza.
6. Whether the Costituzione's disposizioni transitorie e finali are in scope (5.7).
7. Which fingerprint LingoLex anchors on, `testo_sha256` or `akn_sha256` (6.1): phase 3.
