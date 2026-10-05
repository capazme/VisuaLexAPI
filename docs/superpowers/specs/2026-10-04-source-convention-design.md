# One convention for legal sources: identity and labels of norms and decisions — Design

Written 2026-10-04 at the owner's request: «dobbiamo creare una convenzione
stabile per tutti i processi che coinvolgono fonti normative o
giurisprudenziali». The evidence is the inventory
`2026-10-04-source-convention-inventory.md`; the adoption is the plan
`docs/superpowers/plans/2026-10-04-source-convention.md`. The golden file is
`conventions/sources/golden.json`.

**Approved.** The owner approved this spec as a whole and took every
recommendation of §9 (Q1–Q9), in his words of 4 October 2026, relayed by the
orchestrator: «per il 31 procedi con le raccomandazione». Adoption follows the plan, one PR at a time, sequenced by the
orchestrator with the sessions that share its files.

## Why

Every area names and identifies sources its own way, and they drift. On 4
October alone the MCP server named a law «Art. 3 — legge», the graph wrote
«Art. 18 legge» as an article's extremes, created an ordinary act with a code's
properties, and titled the disposizioni di attuazione «Regio Decreto» with the
authority «Parlamento». The inventory counts eleven label styles for one
article of one law, seven tables of act abbreviations in the web app alone,
three key schemes for decisions in the graph, and 127 decisions stored twice.

The fix is not a twelfth formatter. It is one definition of **who** a source is
(identity) and one definition of **how it is written** for each use (labels),
each implemented once per language and pinned by one golden file that every
suite reads.

## Goals

- One identity for a norm and one for a decision, which every store and every
  join uses.
- One set of labels per source, one per use, in the owner's style.
- One golden file in a neutral format, read by the web, server, MCP, Python API
  and MERL-T suites: no area can change a label or an identity without a red
  test.
- Adoption without touching `article_text` (root rule 23) and without breaking a
  stored key, an anchor or a URL.

## Non-goals

- Regional acts, acts of the old states, administrative and EU case law beyond
  naming how they will fit (§2.4, §3.3).
- Changing what the sources return, or the reading text.
- Rewriting a key that user data is stored under (annotations, highlights,
  bookmarks, watches, discussions, study cards, dossier items, decision paths).
  Those keys stay; the identity sits next to them. The only keys that move are
  the graph's malformed and legacy ones (§5.3), with every reference to them.

## Principles

1. **Identity is derived, never typed in.** One function per language turns the
   fields a norm or a decision is stored with into its identity. Nothing stores
   an identity it did not get from that function.
2. **Keys at rest are frozen.** `buildItemKey`, `uniqueArticleIdFromNorma`, the
   graph's URN keys, the decision paths `/sentenze/...` and the decision key
   stay byte-identical. New data may add the identity next to them; nothing
   rewrites them.
3. **Labels are derived at read time.** A label is never the source of truth. A
   label stored by the user (`QuickNorm.label`, `Bookmark.title`) is the user's
   own text and is left alone; a label stored by the app (`DossierItem.title`,
   the graph's `estremi`) is a cache that may be recomputed.
4. **One formatter per language, one table.** TypeScript (web, with a pinned
   copy in the server) and Python (API, with a pinned copy in MERL-T, which must
   not import `visualex_api`). Each copy reads the same golden file.
5. **Never a guess.** A missing part makes a shorter label, never an invented
   one: no synthetic `-01-01`, no `None`, no ISO date in a sentence, no act
   inferred from a shared decree number (the preleggi are not the codice
   civile).

## 1. Norms: identity

### 1.1 The form

The identity of an article is the URN VisuaLex already builds
(`generate_urn`, `urn_flag=True`): the Normattiva resolver URL around a NIR URN.

```
https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art2
└──────────── resolver ──────────────┘ └── authority:type:date;number ──┘└ article ┘
```

| Part | Rule |
|---|---|
| resolver | always `https://www.normattiva.it/uri-res/N2Ls?`. A bare `urn:nir:` string is accepted as input and wrapped. The graph already keys every norm with the wrapper (MERL-T `canonical_urn`). |
| authority | `stato` for the acts VisuaLex reads today. See §1.4 for ministerial decrees. |
| type | lower case, words joined by dots: `legge`, `decreto.legislativo`, `decreto.legge`, `decreto.del.presidente.della.repubblica`, `regio.decreto`, `legge.costituzionale`, `decreto.ministeriale`, `decreto.del.presidente.del.consiglio.dei.ministri`. Never a space, never a hyphen (`decreto-legge` and `decreto legislativo` are malformed: §5.3). |
| date | the full ISO date of the act. A year alone is not an identity (§1.3). |
| number | `;` and the number, no leading zeros. Absent when the act has none (§1.3). |
| annex | `:` and the annex as Normattiva numbers it (`;262:2`). Part of the identity: the codice civile is annex 2 of the r.d. 262/1942, the preleggi annex 1. |
| article | `~art`, the number and its extension concatenated (`~art2645bis`, `~art270bis.1`, `~art314/2`). The data form keeps the hyphen (`2645-bis`); `generate_urn` turns the data form into the URN form (`urngenerator.py:107-111`), `normalize_article_key` canonicalises what a source returns, and both stay as they are. |
| version | never part of the identity. `!vig=…`, `!orig=…`, `@originale` are cut (`canonical_urn`, `normalizeGraphUrn`); the version travels as its own field (`versionKey`). |

The identity of an **act** is the article identity without `~art…`. The **join
key** of a norm is that string, as the graph already uses it.

### 1.2 Codes and the Constitution

A code is identified by its enacting decree and annex, from the one table
`NORMATTIVA_URN_CODICI` (`codice civile` → `regio.decreto:1942-03-16;262:2`),
never by Normattiva's alias form (`codice.civile:1942-03-16;262`), which is
mapped on the way in (as the Massimario already does with `CODE_ACTS`). The
Constitution is `stato:costituzione`. The table has two copies (API and MERL-T):
the golden file pins both (§7).

### 1.3 Edge cases

| Case | Identity |
|---|---|
| **Year only** (`legge`, `1983`, `184`) | none until the date is known. The full date comes from Normattiva's resolver **checked against the page's title** (`act_dates.py`, `POST /resolve_act_dates`): the resolver matches year and number only and can answer with another act (`act_dates.py:11-13`). The year-only form `…:legge:1983;184` is what is handed to that check, never a URN text is fetched from, and never stored as an identity, a key or a graph node. `generate_urn` must stop writing `1983-01-01`; the owner chose how (4 October 2026: «se davvero non serve più complete_date sostituiamola»): `act_dates` replaces `complete_date` where no caller still needs it, in the small-fixes job; this spec's PR 3b follows it. |
| **No number** (a d.p.c.m. of 8 March 2020) | `…:2020-03-08~art1`, with no `;`. Never `;None`. The exact form Normattiva accepts for an unnumbered act is checked live in the adoption PR before it is frozen in the golden file. |
| **Annexes** of an ordinary act | `:N` after the number, as for the codes. |
| **Preleggi, disp. att.** | their own annex or decree from the codes table (`262:1`, `318:1`, `1368:1`); never the codice civile's. |
| **Ministerial regulations in the codes table** (the regulations of the c.p.i. and of the c.p.p.) | the table stores them as `/uri-res/N2Ls?urn:nir:ministero…`, so `generate_urn` writes `…urn:nir:stato:/uri-res/N2Ls?urn:nir:ministero.sviluppo.economico:decreto:2010-01-13;33~art1` today. They take the form of §1.4; the exact string is checked live before the golden case leaves `proposed`. |
| **Regi decreti** | `regio.decreto`, like any act. |
| **Past and future versions, repealed articles** | the same identity as the text in force. A version is a reading of the identity (`versionKey`, `validity`), not another identity. |

### 1.4 Ministerial decrees

Normattiva's own URN for a ministerial decree names the ministry
(`urn:nir:ministero.giustizia:decreto:2014-03-10;55`); VisuaLex writes
`urn:nir:stato:decreto.ministeriale:2014-03-10;55`. The resolver answers both
with the same act (checked on 2026-10-04). **The identity is VisuaLex's form**,
so nothing stored moves; a ministry-form URN read from another source (a
Massimario link) is mapped into it at the boundary by the same normaliser as the
code aliases. Risk accepted and recorded: two ministries issuing decrees with the
same date and number would collide; the resolver itself makes the same
assumption.

### 1.5 Acts of the European Union

| Part | Rule |
|---|---|
| identity of the act | its **CELEX** number: `32016R0679` (regulation), `32022L2555` (directive), `12016E` (TFUE), `12016M` (TUE), `12016P` (CDFUE). |
| identity of an article | `celex:32016R0679~art5`, the NIR shape with the CELEX in place of the URN. |
| links | the ELI or EUR-Lex page is derived from the CELEX (today's `get_uri`), never stored as identity. |
| consolidated texts | a version (`celex_consolidated`), never another identity. |

Today an EU article has no identity string at all: the ELI page URL names the act
only.

### 1.6 What does not change

`buildItemKey` (`codice-civile--262--1942-03-16--all2--2043`) and
`uniqueArticleIdFromNorma` (`all2:2043`) are the keys every highlight, note,
bookmark, watch, discussion and study card is stored under. They stay as they
are, including their known weakness: a year-only act and the same act with its
date have two keys (inventory §2.1). The plan reads both rather than rewriting
either (§8.2).

## 2. Decisions: identity

### 2.1 The form

Unchanged from the Sentenze design §1, which this convention adopts for every
area:

| Field | Values |
|---|---|
| `corte` | `cassazione`, `corte_costituzionale`; future courts add values (§2.4) |
| `numero` | integer 1–999999, no leading zeros |
| `anno` | the year of the number (for the penal Cassazione, the year of deposit) |
| `archivio` | `civile`, `penale`; the Cassazione only, and always there |

**Key:** `cassazione:<archivio>:<numero>:<anno>`, `corte_costituzionale:<numero>:<anno>`.
**Path:** `/sentenze/cassazione-civile/<numero>/<anno>`,
`/sentenze/cassazione-penale/…`, `/sentenze/corte-costituzionale/…`; without
the archive `/sentenze/cassazione/<numero>/<anno>?sezione=…` is a reference, not
an identity.

### 2.2 Rules

- **The section is never part of the identity.** It is an attribute
  (`normalize_section`: `1`–`7`, `U`, `L`, `F`; the tributaria is `5` civil).
- **ECLI is an attribute**, kept where the source publishes it (the Corte
  costituzionale: `ECLI:IT:COST:2020:71`). VisuaLex never computes one.
- **A reference without the archive or the year is not an identity.** It is
  never keyed and never linked as one; it is written with what it has (§4.4).
  In the graph it keeps its legacy key and gains no identity (§5.3).
- **Two implementations, one key.** The API's `decisions/model.py` and MERL-T's
  `massimario/identity.py` stay separate (MERL-T does not import the API) and
  are both pinned by the golden file; the web's `decisionLinks.ts` too.

### 2.3 Attributes the labels read

`tipo` (sentenza, ordinanza, decreto), `sezione`, `data_deposito`, and for the
Corte costituzionale `data_decisione` and `ecli`. **Measured:** Italgiure gives
the Cassazione's date of deposit and no date of decision or hearing, civil and
penal; the Massimario's paragraphs sometimes give a hearing date
(`data_udienza`). A label never states a date the app does not have.

### 2.4 Courts to come

A new court adds a `corte` value and its key shape `<corte>:<numero>:<anno>`,
with the court's own qualifiers in place of `archivio` when its numbering
needs them (a TAR's seat and section, the Consiglio di Stato's section). Where
the court's own identifier is the ECLI (CGUE, CEDU), the key is the ECLI. Not
built now.

## 3. Norms: labels

### 3.1 The uses

| Label | What it is | Where it is used |
|---|---|---|
| **citation** | how a lawyer cites the article | copy and export of any text (with the version clause, §3.5), dossier `citation`, MCP `riferimento`, norms route `display`, notifications |
| **short** | the article in little room | tabs of a single article, dossier rows, comparison headers, chips (Q&A, links), quick-norm suggestions, the graph's `estremi`, PDF headings |
| **act citation** | the act alone, as cited | workspace block subtitle, «Fonte:» lines |
| **act short** | the act in little room | workspace tabs, dossier groups |
| **act heading** | the act as a title: the name for the acts cited by their own name (the codes cited by name, the Constitution, the preleggi, the disp. att.), the act citation for every other act (decided: the dossier spec `2026-10-04-dossier-per-atto-design.md` §2, interview Q6) | the dossier's act block, the graph's act node `titolo`, the index window title |

### 3.2 The forms

| Source | citation | short | act citation | act short | act heading |
|---|---|---|---|---|---|
| l. 241/1990, art. 2 | `art. 2, l. 7 agosto 1990, n. 241` | `art. 2 l. 241/1990` | `l. 7 agosto 1990, n. 241` | `l. 241/1990` | `l. 7 agosto 1990, n. 241` |
| c.c., art. 2043 | `art. 2043 c.c.` | `art. 2043 c.c.` | `c.c.` | `c.c.` | `Codice civile` |
| Cost., art. 81 | `art. 81 Cost.` | `art. 81 Cost.` | `Cost.` | `Cost.` | `Costituzione` |
| preleggi, art. 12 | `art. 12 preleggi` | `art. 12 preleggi` | `preleggi` | `preleggi` | `Preleggi` |
| disp. att. c.c., art. 3 | `art. 3 disp. att. c.c.` | `art. 3 disp. att. c.c.` | `disp. att. c.c.` | `disp. att. c.c.` | `Disposizioni di attuazione del codice civile` |
| d.lgs. 196/2003 (codice privacy), art. 7 | `art. 7, d.lgs. 30 giugno 2003, n. 196` | `art. 7 d.lgs. 196/2003` | `d.lgs. 30 giugno 2003, n. 196` | `d.lgs. 196/2003` | `d.lgs. 30 giugno 2003, n. 196` |
| d.p.r. 445/2000, art. 38 | `art. 38, d.p.r. 28 dicembre 2000, n. 445` | `art. 38 d.p.r. 445/2000` | … | `d.p.r. 445/2000` | `d.p.r. 28 dicembre 2000, n. 445` |
| reg. (UE) 2016/679, art. 5 | `art. 5, reg. (UE) 2016/679` | `art. 5 reg. (UE) 2016/679` | `reg. (UE) 2016/679` | `reg. (UE) 2016/679` | `reg. (UE) 2016/679` |
| TFUE, art. 101 | `art. 101 TFUE` | `art. 101 TFUE` | `TFUE` | `TFUE` | `Trattato sul funzionamento dell'Unione europea` |

**Status of each form.** The citation column for national acts is the owner's
(decided 1 October: «art.» lower case, a comma after the number, the act in
lower case; codes, the Constitution, preleggi and disp. att. by their own name
and with no comma; an aliased code cited by the act it is). The short forms, the
EU forms and the new abbreviations were the questions of §9; the owner took
every recommendation (4 October), so the golden file marks them `decided`. The
act headings follow the dossier spec the owner approved (§3.1); the strings of the named acts are the dossier's own table.

### 3.3 The tables

One table of **types** (type in full → abbreviation in a citation): `legge` →
`l.`, `decreto legislativo` → `d.lgs.`, `decreto legge` → `d.l.`, `decreto del
presidente della repubblica` → `d.p.r.`, `regio decreto` → `r.d.` (decided); a
type the table does not know is written in full, in lower case (decided). Q4
asks whether `decreto ministeriale`, `legge costituzionale`, `decreto del
presidente del consiglio dei ministri` and the historical types gain an
abbreviation.

One table of **codes cited by their own name** (`c.c.`, `c.p.`, `c.p.c.`,
`c.p.p.`, `Cost.`, `preleggi`, `disp. att. c.c.`, `disp. att. c.p.c.`; decided).
Every other entry of `NORMATTIVA_URN_CODICI` is cited by its decree (decided).
MERL-T's 29-row `CODE_ABBREVIATIONS` (`cod. cons.`, `CTS`, …) is not a citation
table: Q3 decides whether it becomes the short form of those codes or goes.

Both tables exist once per language and are pinned by the golden file. The
seven web tables, MERL-T's two and the citation export's become these.

### 3.4 Edge cases

| Case | citation | short |
|---|---|---|
| year only, date not resolved | `art. 6, l. n. 184 del 1983` | `art. 6 l. 184/1983` |
| no number | `art. 1, d.p.c.m. 8 marzo 2020` (no number clause) | `art. 1 d.p.c.m. 8 marzo 2020` |
| annex of an ordinary act | `art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)` (decided) | `art. 1 d.lgs. 81/2008 (All. A)` |
| first of the month | `1° settembre 1993` (decided) | — (no day in the short form) |
| a part missing (no date, no number) | the parts there are, never `None` | idem |

### 3.5 Versions

The version clause is the golden file `citationGolden.ts` (decided, round «Testo
alla data»): «, nel testo in vigore al …», «, nel testo originale», «, abrogato
dal …», and no citation for what cannot be cited honestly. It stays where it is
and is not repeated in the JSON golden file: it is a clause appended to the
citation, not a label of the source. Q8 asks whether the copy of the **text in
force** also starts using the citation (today it ends with «Tratto da: legge n.
241 del 1990-08-07, Art. 2»); the owner deferred it on 1 October «a un
intervento a parte», and this convention is that intervention.

## 4. Decisions: labels

### 4.1 The uses

| Label | Where |
|---|---|
| **citation** | «Copia citazione» on the decision page, export, dossier item, MCP |
| **short** | chips (Massimario, Brocardi, Q&A), lists, the graph's `estremi` |
| **page line** | the identity line at the top of the decision page (Sentenze design §4.1; unchanged) |

### 4.2 The forms (decided: Q1–Q2, 4 October 2026)

The baseline is the form of the Sentenze design §4, which the owner approved
with that spec (court and archive, section, type, date, number), as its plan
words it: `formatDecisionCitation` in `apps/web/src/utils/decisionLinks.ts`
(plan `2026-10-01-sentenze.md`, Task 8, being built in Sentenze PR B). The
forms below are what that function writes: Q1 asks the owner to confirm them
as the convention for every area, not to choose them from scratch. The short
form is the same function with neither type nor date, which it already writes
as `Cass. civ., sez. un., n. 10787/2024`.

| Decision | citation | short |
|---|---|---|
| Cass. civ. SU 31310/2024, sentenza depositata 6 dicembre 2024 | `Cass. civ., sez. un., sent. 6 dicembre 2024, n. 31310` | `Cass. civ., sez. un., n. 31310/2024` |
| Cass. civ. sez. L 12789/2022, sentenza depositata 21 aprile 2022 | `Cass. civ., sez. lav., sent. 21 aprile 2022, n. 12789` | `Cass. civ., sez. lav., n. 12789/2022` |
| Cass. pen. sez. 7 10787/2024, ordinanza depositata 14 marzo 2024 | `Cass. pen., sez. VII, ord. dep. 14 marzo 2024, n. 10787` | `Cass. pen., sez. VII, n. 10787/2024` |
| idem, hearing date known (Massimario) | `Cass. pen., sez. VII, ord. 10 gennaio 2024 (dep. 14 marzo 2024), n. 10787` | idem |
| Corte cost. 71/2020, sentenza decisa 12 febbraio, depositata 24 aprile 2020 | `Corte cost., sent. 24 aprile 2020, n. 71` | `Corte cost., n. 71/2020` |
| with a massima (Massimario chip) | — | `Cass. civ., sez. un., n. 31310/2024 · Rv. 673165-01` |

### 4.3 Section names

`sez. I` … `sez. VII` (Roman, as the courts print them), `sez. un.`, `sez. lav.`,
`sez. fer.`; the tributaria is printed as the source gives it (`sez. V`), since
Italgiure does not tell sez. V from the tributaria. Lower case, like «art.».

### 4.4 Incomplete references

| Missing | citation / short |
|---|---|
| year (Massimario, implicit year not found) | `Cass. civ., sez. III, n. 2633` — no link (`linkableDecisionPath` needs a year) |
| section | omitted: `Cass. civ., sent. …, n. …` |
| archive (Brocardi's bare «Cassazione») | `Cass., n. 2633/1982` — linked as a reference (`/sentenze/cassazione/2633/1982`, which the page resolves, Sentenze design §2), never keyed |
| type | omitted |

## 5. The graph

### 5.1 Norm nodes

- **Key:** the identity of §1 (unchanged for every well-formed node).
- `estremi` = the short label (§3.2) for an article, the act citation for an act
  node that has one; `titolo` of an act node = the act heading;
  `titolo` of an article node is not the extremes (today «Art. 1 costituzione»):
  it is the rubric, or absent.
- `autorita_emanante` is derived from the type through one table: `legge`,
  `legge costituzionale` → `Parlamento`; `decreto legislativo`, `decreto legge`
  → `Governo`; `decreto del presidente della repubblica` → `Presidente della
  Repubblica`; `regio decreto` → `Re`; `costituzione` → `Assemblea costituente`;
  `decreto ministeriale` → `Ministro`; an EU act → its institution is not
  inferred (absent). This is a proposal (low impact, my call): two contradictory
  tables exist today (`ingestion.py` writes `Regio Decreto` for the codice
  civile, `multivigenza.py` writes `Re d'Italia`).
- A stub stays a stub (`schema.stub_properties`, #63/#65): it carries key,
  article number and `estremi`, never a type it does not know.

### 5.2 Decision nodes

- **Key:** `node_id` = the decision key of §2.1.
- `estremi` = the short label of §4.2.
- Brocardi's massime are attached to the identity when Brocardi names the
  archive (`Cass. civ.`, `Cass. pen.`: 496 + 4 of 500 for art. 2043 c.c.).

### 5.3 Data already in the graph

Re-keying a node moves everything that names it: its relations (merged, not
duplicated), the Qdrant points whose id derives from the key (`point_id`), the
bridge rows, the RLCF tables that hold a node id or an article URN (the
experience buffer, feedback and traces), and the BFF's `MerltIngestionJob` rows.
The phase-2 work lists each with its count before it runs.

| Data | Rule | When |
|---|---|---|
| 9,892 `massima_cassazione_civile_<n>_<anno>` and 4 `…_penale_…` | re-keyed to `cassazione:<archivio>:<n>:<anno>`, merged with the Massimario node where it exists (127 measured on the pilot), relations and properties kept | graph phase 2 (the Massimario round waits for it) |
| 16 `massima_cassazione_<n>_<anno>` (no archive), 4 Corte cost., 1 Consiglio di Stato (9,917 `massima_*` in all) | Corte cost. re-keyed; the others keep their key and gain no identity | idem |
| 34 nodes under `decreto legislativo:` / `decreto-legge:` | re-keyed to `decreto.legislativo:` / `decreto.legge:`, merged with the well-formed node | idem |
| `estremi`, `titolo`, `autorita_emanante` everywhere | recomputed from key and properties by an idempotent backfill | MERL-T adoption PR |

## 6. Where each label is produced

| Language | Module | Replaces |
|---|---|---|
| TypeScript (web), norms | `apps/web/src/utils/sources/` — `normLabels.ts`, `actTypes.ts` (the tables), `normIdentity.ts` (act and article key from `norma_data`, EU CELEX) | `citation.ts`'s head, `normaMeta.formatCitation`, `abbreviateActType`, the tables in `citationParser`, `citationMatcher`, `normattivaParser`, `StudyMode`, `HistoryView`, every inline label in inventory §3.1, the Q&A chip |
| TypeScript (web), decisions | `apps/web/src/utils/decisionLinks.ts` as the Sentenze plan extends it — `decisionKey`, `decisionPath`, `linkableDecisionPath`, `formatDecisionCitation`, `formatDecisionHeading` — plus a `formatDecisionShort` | the Massimario chip's `label`, the Brocardi chips, the Q&A chip's raw keys. No second decision module |
| TypeScript (server) | `apps/server/src/norms/citation.ts` (`citeArticle`, and `citeAct`, which already writes the act citation of §3.2 for the dossier's `act_citation`) | stays a second implementation, pinned to the JSON golden file in place of the TS one |
| Python (API) | `visualex_api/tools/sources.py` | the year-only and no-number branches of `generate_urn`, `/parse_query`'s `display`, the URN normaliser |
| Python (MERL-T) | `merlt/utils/sources.py` | `format_estremi`, `act_abbreviation`, `estremi_from_urn`'s label, `urn_parser`'s tables, the citation export's formats, the two authority tables, `urn_labels`' suffix table |

`citation.ts` keeps the version clause and calls the shared head.

## 7. The golden file

**Where:** `conventions/sources/golden.json`, at the repository root, with a
`README.md` that describes its shape (the web test enforces it; no schema
library is added for one file). Neutral
ground: it belongs to no app, every CI job checks out the whole repository, and
the owner reads it as the specification, as he reads `citationGolden.ts`.

**Shape:** a version, then `norms` and `decisions`. Each case has an `id`, a
`note` in plain words, the `input` as the source is stored (a `norma_data`; a
decision reference with its attributes), the expected `identity`, and the
expected `labels`. Every expected value is `{ "value": …, "status": … }`, where
the status is:

- `decided` — the owner's words exist (quoted in the `note` or in this spec);
- `current` — what the code does today, and the convention keeps it;
- `proposed` — my call, low impact, stated here; the owner can overturn it;
- `open:Qn` — waits for question n of §9; the value is the recommendation.

From the first commit the web suite asserts the `decided` norm citations and
the `current` decision paths, and the API suite the `current` norm identities
and decision keys. An adopting suite asserts every `decided`, `current` and
`proposed` value of its area, and every `open` value once its question is
answered and the status flipped. An `open` value is never
silently skipped: a suite lists the open cases it did not assert.

**How each suite reads it:**

| Suite | Test | Asserts |
|---|---|---|
| web (vitest) | `apps/web/src/utils/sources/__tests__/golden.test.ts` | labels and act keys from `normLabels`, `normIdentity`; decision keys, paths and labels from `decisionLinks` |
| server (vitest) | `apps/server/tests/norms/sourcesGolden.test.ts` | `citeArticle`, the decision twin |
| MCP (vitest) | `apps/mcp/tests/sourcesGolden.test.ts` | a stub server answering the golden citations: the tools pass them on unchanged |
| API (pytest) | `services/visualex/tests/test_sources_golden.py` | `generate_urn` and the normaliser (identity), `decisions.model` keys |
| MERL-T (pytest) | `services/merlt/tests/unit/test_sources_golden.py` | the normaliser, `estremi`, act node title and authority, `DecisionIdentity.key`, decision `estremi` |

Each test finds the file by walking up from its own path to the directory that
holds `conventions/`, and **fails** when it is absent. MERL-T's container image
copies only `services/merlt`: a run inside a container mounts the file or
deselects that one test, by name.

The first commit ships the file with a web test
(`apps/web/src/utils/__tests__/sourcesGolden.test.ts`) that checks its shape,
its `decided` norm citations against today's `citation.ts` and its `current`
decision paths against today's `decisionLinks.ts`, and an API test
(`services/visualex/tests/test_sources_golden.py`) that checks its `current`
norm identities against `generate_urn` and its decision keys against
`decisions.model`, so the file cannot be wrong on the day it lands.

## 8. Compatibility and stored data

### 8.1 Rule 23 and anchors

No adoption PR touches `article_text`, the scraper's output, the renderer's
text nodes, or any offset. Labels are outside the text by construction (root
rule 23; web gotcha 23).

### 8.2 Keys at rest

| Key | Change |
|---|---|
| `normaKey` (`buildItemKey`), `articleId` | none. For a year-only act whose date is later resolved, the reader **reads both keys** (the year-only one and the dated one) and writes new annotations under the dated one; nothing is rewritten |
| graph URN keys | none for well-formed keys; §5.3 for malformed ones and `massima_*` |
| decision key and `/sentenze/…` paths | none |
| `DossierItem.content` (a `norma_data`) | none; the identity and labels are derived from it on read |

### 8.3 Labels at rest

| Column | Change |
|---|---|
| `DossierItem.title` (the act type) | left as it is; every reader shows the derived citation |
| `QuickNorm.label` | the user's text, untouched; new quick norms are suggested with the short label |
| `NormaChangeNotification.message` (the raw key) | new messages carry the citation; old ones are already re-labelled from their snapshot (`normaChangeLabel`) |
| decision dossier item `etichetta` and `title` (Sentenze PR C, not built) | the approved Sentenze design §6 stores the citation as `etichetta` (required) and as `title`. That freezes today's wording into user data: if Q1 or Q2 later changes, every saved decision keeps the old label. **Decided (Q9, 4 October 2026):** keep both fields, since sharing and export need a label without a lookup, but treat them as a cache: readers show `formatDecisionCitation` of the stored identity and attributes. The owner then fixed how the copy is refreshed (4 October, in the Sentenze session): «A ogni scrittura (Raccomandata)» — the stored label is recomputed on every write of the item, and opening a dossier writes nothing; that is the agreed reading of «rewritten on read». Sentenze §6 is amended accordingly by the Sentenze session |
| graph `estremi`, `titolo`, `autorita_emanante` | recomputed by the backfill (§5.3) |

## 9. Questions for the owner — answered

Sent through the orchestrator as one list, in Italian, each with real examples
and a recommendation. **Answer (4 October 2026):** «per il 31 procedi con le raccomandazione» — every recommendation
below stands, including Q1's form for a penal decision whose hearing date is
known (the Sentenze plan did not have it). The golden file marks them
`decided`. The questions were:

| Q | About | Recommendation |
|---|---|---|
| Q1 | citation of a decision: confirm the Sentenze plan's wording (section notation, type, deposit date as the only one Italgiure gives, «dep.» for the penal, deposit date for the Corte cost.) for every area | §4.2 |
| Q2 | short label of a decision (chips, lists, graph) | `Cass. civ., sez. un., n. 31310/2024` |
| Q3 | codes enacted by d.lgs. (consumo, privacy, strada, CCII, c.p.a., Terzo settore): short label by decree or by abbreviation | by decree, as the citation: `art. 33 d.lgs. 206/2005` |
| Q4 | abbreviations for `decreto ministeriale`, `legge costituzionale`, `d.p.c.m.`, historical types | `d.m.`, `l. cost.`, `d.p.c.m.`, `r.d.l.`, `d.lgs.lgt.` (lower case, as decided) |
| Q5 | short label of a norm (tabs, rows, chips, graph) | `art. 2 l. 241/1990` |
| Q6 | EU acts and treaties | `art. 5, reg. (UE) 2016/679`; `art. 101 TFUE` |
| Q7 | year-only act whose date is not known | `art. 6, l. n. 184 del 1983` |
| Q8 | the copy of the text in force cites in the lawyer's style too | yes: `art. 2, l. 7 agosto 1990, n. 241 (Normattiva, testo vigente, consultato il …)` |
| Q9 | the decision dossier item's stored label (Sentenze §6 `etichetta`) | a cache, re-derived on read (§8.3) |

## 10. Coordination

- **Sentenze PR B** (decision page): builds `decisionLinks.ts`'s wording as
  its plan says; it becomes the web implementation of §4, and the golden
  decision cases are its test cases. Q1 confirmed its forms; it adds the penal form with a known hearing date.
- **Sentenze PR C** (dossier): stores `etichetta` and `title` as a cache;
  readers re-derive the label (§8.3, Q9 decided).
- **#63 follow-up** (graph act nodes): writes no `titolo` or `autorita_emanante`
  for a stub; a code node takes the act heading and the authority table of §5.1.
- **Dossier UI rethink** (grouping by act): groups by act identity (§1.1) and
  titles groups with the act heading.
- **Graph phase 2**: re-keys per §5.3.

## Verification

The adoption of each area is done when its golden test is green with no `open`
case left unasserted that the owner has answered, its inline labels are gone
(each PR lists the sites of inventory §3 it removed), and the suites of every
touched area pass. Web adoption ends with a browser pass on the tab, the
dossier, the comparison, the copy actions and the Massimario panel.
