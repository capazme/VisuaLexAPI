# Norms and decisions in one search space — Design

Round opened 2026-10-05. The owner asked: «dobbiamo integrare meglio le sentenze
nella tab di ricerca, insieme alle norme. Deve essere uno spazio dove il dato
normativo fluisce smoothless». It builds on the court-decision round
(`2026-10-01-sentenze-design.md`), takes back priorities 1 and 3 of
`2026-08-29-giurisprudenza-design.md` (the decisions bearing on an article, and
search by words), and uses the labels of `2026-10-04-source-convention-design.md`.

**Amendments to `2026-10-01-sentenze-design.md`:** notes and highlights on
decisions, a non-goal there, are built here (§8), and S6 becomes a contract like
root rule 23 (§8.5); the page of §4 becomes a tab of the search space and its
form goes (§1–§3); the addresses of §2 are unchanged.

The interview went to the owner as one list through the orchestrating session.
His answers, verbatim (5 October 2026):

| # | Question | Answer |
|---|---|---|
| 1 | Where real work starts: A exact citation, B the article, C a topic in words | «A e B, C magari sfruttando il glossario» |
| 2 | One search box (⌘K) for norms and decisions | «Sì» |
| 3 | Where a decision opens: A beside the article, B a window of its own, C the separate page | «A, in una propria tab» |
| 4 | `/sentenze/…` opens the search space with the decision | «Sì» |
| 5 | Under the article: A the existing massime made clickable, B a live list of Cassazione decisions citing the article, C the MERL-T graph | «A e B» |
| 6 | Norms cited in a decision's text become links | «sì» |
| 7 | Decisions enter the Cronologia (schema change) | «Vai fallo» |
| 8 | On a phone the decision opens full screen, with a way back | «Sì» |
| 9 | Notes and highlights on decisions stay out of this round | «No, includile» |

Four questions stayed open after the interview; the owner answered them on
5 October 2026 with the spec («spec ok»). They are recorded under **Questions
for the owner — answered**, and the sections below are written to the answers.

## Why

Today a norm is searched in the command palette (⌘K) and read in the
workspace; a decision lives on a page of its own (`/sentenze/…`) with its own
form. From an article, the massime of Brocardi are text with no link, and the
Massimario's chips lead away from the article. There is no way to ask «which
decisions apply art. 2043 c.c.», nor to search decisions by words. A lawyer who
moves between a norm and the case law on it changes tool at every step and loses
the article each time.

## What was measured

All on 2026-10-05 unless stated.

- **Italgiure answers a search by text, sorted, with the passage found.** Eight
  requests to the public Solr endpoint (`sn-collection/select`), two seconds
  apart, from the same client and TLS context as the decision reader:
  - civil decisions whose text contains `"art. 2043 c.c."`: **939**;
    `"art. 2043 cod. civ."`: **583**; `"articolo 2043 c.c."`: **98**; the bare
    `"art. 2043"`: **1,588** (it also catches art. 2043 of other acts — the
    weakness the 08-29 design described);
  - `"perdita di chance"`: **742**; together with `"art. 2043 c.c."`: **34**;
  - `sort=pd desc` orders by date of deposit, newest first (the first result was
    n. 24908/2026, deposited 1 September 2026); `sort=datdep desc` is refused
    (400);
  - highlighting works (`hl=true&hl.fl=ocr&hl.snippets=1&hl.fragsize=200`): one
    fragment of about 200 characters per decision, the matched words wrapped in
    `<em>`;
  - each query answered in 0–16 ms of Solr time.
- **The archive is the last five years**, a moving window (in 2026 it starts in
  2021: `ItalgiureReader.archive_start`). An empty result means «nothing in the
  public archive», never «nothing».
- **The workspace is a set of windows, one per tab** (`WorkspaceTabPanel`:
  position, size, z-index; the dock `WorkspaceNavigator` lists them; «Allinea»
  tiles them). Each tab holds norm blocks, loose articles and collections
  (`TabContent` in `store/useAppStore.ts`). Nothing in a tab can hold a decision.
  In round 2a the owner said a floating window is right for a tool and wrong for
  content; round 2b (one table per context) was agreed and never built.
- **The reading layer is generic over its key.** Highlights and annotations are
  stored under a `normaKey` string (`Highlight`, `Annotation` in Prisma) with an
  offset and the text; the store's actions take `(normaKey, articleId)`.
  `buildItemKey` only ever writes `[a-z0-9_-]` joined by `--`, so a decision key
  (`cassazione:civile:10787:2024`, with colons) can never collide with a norm's.
  No schema change is needed to anchor a note to a decision.
- **The history is norm-shaped.** `SearchHistory` requires `act_type`; a decision
  has none.
- **Brocardi's massime carry the court, number and year** (`MassimaStructured`:
  `autorita`, `numero`, `anno`) and render as plain text (`MassimeSection`). For
  art. 2043 c.c. 496 of 500 name the archive (`Cass. civ.`, `Cass. pen.`;
  convention §5.2), which is enough for a link.
- **«Il glossario» in the code is Brocardi's.** Under an article, Brocardi links
  the terms its legal dictionary defines (`GlossaryEntry`: `termine`, `url`,
  `dizionario_id`; `BrocardiDisplay` → «Glossario», opening brocardi.it). The
  MERL-T graph has `ConcettoGiuridico` nodes and an article→concept relation
  (`MENZIONA`), seeded for Libro IV of the codice civile and shown only to
  validators. LingoLex cards carry an `istituto` string.
- **Decision texts already follow S6** (Sentenze design): the readers insert only
  `\n` (Italgiure's paragraphs, the Corte costituzionale's line breaks) and
  `DecisionTextView` draws each block, paragraph and line with no character
  added. Italgiure's text arrives as one line, up to 82,322 characters (measured
  on 2026-10-04).

## Goals

- One search box finds a norm or a decision, by citation.
- A decision opens in a tab of its own, beside the article it was opened from,
  without losing the article.
- Under an article, the decisions that bear on it: the massime and the
  Massimario's chips as links, and a live list of Cassazione decisions whose text
  mentions the article, labelled as such.
- A topic in words, starting from Brocardi's glossary, finds the decisions that
  use it.
- In a decision's text, the norms it cites are links to the article.
- A decision can be highlighted and annotated like an article, and those anchors
  never disappear in silence.
- Opened decisions are in the Cronologia.

## Non-goals

- Courts other than the Cassazione and the Corte costituzionale (their readers
  need a search step first; Sentenze design, «Later»).
- Searching norms by topic. Brocardi's glossary links a term to a definition,
  not to the articles that use it; see §6 for what it would cost.
- Passage discussions on decisions (the Forum's article discussions). Notes and
  highlights only.
- The MERL-T graph's norm↔decision edges (5C, not chosen).
- Ranking decisions by relevance. The list is ordered by date of deposit and says
  how each decision was found.
- Storing decision texts. Caches only, as in the Sentenze design.
- The dossier's decision rows and reader: the Sentenze PR C and the dossier
  round's PR 3 own them; notes on a decision appear there when that reader adopts
  §8's renderer (Coordination).

## Decisions

| # | Decision | Rationale |
|---|---|---|
| N1 | **The command palette reads decision citations** next to norm citations, and the «Sentenze» entry of the sidebar opens it. The form at `/sentenze` goes. | Answer 2. One box, one gesture. |
| N2 | **A decision is a tab of its own** (a tab whose `view` is `decision`), holding its identity only; the text is fetched, never persisted. Opened from an article, it is placed beside that article's tab. §2.2 draws the two readings of «beside». | Answer 3: «A, in una propria tab». |
| N3 | **`/sentenze/<corte>/<numero>/<anno>` opens the search space with that decision's tab**, like `/?norma=` for a norm. The address does not change: LibreLex, the Massimario chips and every link already built keep working. | Answer 4. The paths are a contract (Sentenze design §2). |
| N4 | **Under the article, one section «Giurisprudenza»**: Brocardi's massime with a link when they name the archive, the Massimario panel as it is, and «Cassazione — menzionano l'articolo», a live list asked for only when the reader opens it. | Answer 5 (A and B). Nothing is fetched from Italgiure unless the reader asks. |
| N5 | **The live list says how a decision was found: «menzionato nel testo».** Never «citato», never a relevance score. | D2 of the 08-29 design: a text match is not a declared citation, and the reader must be able to tell. |
| N6 | **One new Python route, `/search_decisions`**, serves both the article list (N4) and the topic search (§6), through the decision reader's own throttled client, with a cache and a bound on requests. | One way of asking Italgiure, one place to keep it polite. |
| N7 | **A topic starts from Brocardi's glossary**, or from words typed in the palette; it finds decisions, narrowed by default to those that also mention the article. | Answer 1C, «magari sfruttando il glossario»; §6 lists the alternatives and their cost. |
| N8 | **A decision's text links the norms it cites**, through the same matcher and preview as an article's text, wrapping characters and never changing one. | Answer 6; S6. |
| N9 | **Notes and highlights on decisions** are stored in the existing tables under the decision key, anchored by offset and text over one projection of the whole decision. | Answer 9. No schema change; the key cannot collide (measured). |
| N10 | **A decision's text becomes a data contract like `article_text`** (root rule 23): from this round on, no reader change may add, drop or change a character of it; only `\n` is free. | Anchors depend on it, exactly as for articles. |
| N11 | **An anchor that no longer matches is shown, never dropped.** Unlike an article's, a decision's unmatched highlights and notes are listed with their quoted text and can be removed. | Italgiure withdraws texts for anonymisation (about 82,000 records at the last count); a note must not vanish when that happens. |
| N12 | **Decisions enter `search_history`** through a nullable `decision_key` column; `act_type` becomes nullable, and a check constraint requires exactly one of the two. | Answer 7. One table keeps one ordered, paged history. |
| N13 | **Labels come only from `utils/decisionLinks.ts`** (`formatDecisionCitation`, `formatDecisionHeading`, and the short form of convention §4.2). | Convention §6: no second decision module. |

## Detailed design

### 1. One search box

**Decision citations in the palette.** A pure parser,
`utils/decisionCitationParser.ts` → `parseDecisionCitation(input):
LooseDecisionRef | null`, reads what lawyers type and paste:

| Typed | Reference |
|---|---|
| `Cass. 10787/2024`, `Cassazione n. 10787 del 2024` | Cassazione, archive unknown |
| `Cass. civ. 10787/2024`, `Cass. civ., sez. III, n. 10787/2024` | civil, section III |
| `Cass. pen., sez. VII, 10787/2024` | penal, section 7 |
| `Cass. SU 31310/2024`, `Cass. civ., sez. un., n. 31310/2024`, `S.U. 31310/2024` | section U |
| `Cass. civ., sez. lav., 21 aprile 2022, n. 12789` | year read from the date |
| `Cass. pen., sez. VII, 10 gennaio 2024 (dep. 14 marzo 2024), n. 10787` | year of deposit |
| `Corte cost. 71/2020`, `C. cost. n. 71 del 2020`, `Corte costituzionale, sentenza n. 71/2020` | Corte costituzionale |

Sections go through the same names as the page (`1`–`7`, `U`, `L`, `F`), the
archive through `civ.`/`pen.` and their spelled-out forms. A two-digit year is
expanded by `expandTwoDigitYear`. Anything the parser cannot read fully returns
`null` and the palette treats the input as it does today: the norm parser keeps
everything it already recognises. The decision parser runs first and reads only
an input that starts with a court («Cass», «Cassazione», «S.U.», «SU», «Sez.
Un.», «Corte cost», «C. cost», «Corte costituzionale»), which no act name of the
palette or of the server's resolver starts with; the one exception is a user's
own alias whose trigger is the input's first word, which keeps the input for the
norm parser, as a custom alias wins elsewhere.

When a decision is recognised, the palette shows one line in the place of the
norm preview: «Sentenza → Cass. civ., sez. III, n. 10787/2024 · Invio apre»
(the short form, built from the reference). Enter opens the decision's tab
(§2). The parser's cases are a golden table in its test, real citations taken
from the Massimario and Brocardi.

**The sidebar.** «Sentenze» stays in the sidebar and opens the palette with its
placeholder showing a decision example («Es. 'art 2043 cc' o 'Cass. civ.
10787/2024'»). The palette is mounted only on the search page (gotcha 27), so
from another route the entry navigates to `/` with a flag that opens it on
arrival. The form at `/sentenze` (`DecisionLookupForm`) is removed;
`/sentenze` with no decision redirects to `/` and opens the palette.

### 2. A decision in a tab of its own

#### 2.1 The tab

A new kind of tab: a `WorkspaceTab` with `view: { kind: 'decision'; reference:
DecisionReference }` and no content. It is a field of the tab, not a new
`TabContent`, on purpose: 27 places switch over `TabContent` (drag and drop,
the global search, «Aggiungi al dossier» of the tab, the comparison), several
with an `else` that would draw an unknown item as a loose article. A tab with a
`view` draws the view instead of its content, and its header hides the actions
that work on content. The store persists the reference only (`partialize`
already persists tabs); the text
is fetched with `fetchDecision` and held by a session cache like
`articleFetchCache` (in-flight de-duplication, errors not cached). Once found,
the reference is replaced by the identity (`identityOf`), so a reload asks the
route for exactly that decision.

A decision tab has one decision. Opening a decision that already has a tab
brings that tab to the front instead of making a second. Its label is the short
form (convention §4.2); until the answer arrives, the short form of the
reference.

The content is the decision page's body, moved into a component of its own,
`DecisionView`, used by the tab: the identity line, the notices, the actions
(«Copia citazione», «Aggiungi al dossier» from Sentenze PR C, «Apri sulla fonte»
where there is one, «Copia collegamento» for the `/sentenze/…` address), the
text and the source. Every outcome of `/fetch_decision` keeps its own screen
(Sentenze design §4): loading, the decision, the decision without its text, the
choice between candidates (each opens in this tab), not found with the reason
and the penal suggestion, outside the archive, source unreachable with
«Riprova», `errore_interno` with «Riprova». An invalid reference shows the
message and a button that opens the palette with the citation typed in.

#### 2.2 «Beside the article, in a tab of its own»: two readings

The owner chose A (beside the article) and added «in una propria tab». Both
readings below give the decision a tab of its own; they differ in what «tab»
means here.

**Reading 1 — a tab of the workspace, placed beside the article's tab
(chosen by the owner).** The decision becomes a tab like a norm's: it has its own entry
in the dock, and can be closed, brought forward and tiled. Opened from an
article, the two tabs are laid out side by side, the article's on the left
half, the decision's on the right; opened from the palette with nothing on
screen, it takes the space.

```
 ┌ art. 2043 c.c. ───────────────┐ ┌ Cass. civ., sez. III, n. 10787/2024 ┐
 │ Qualunque fatto doloso o      │ │ Corte di cassazione · Sez. III      │
 │ colposo, che cagiona ad altri │ │ civile · Ordinanza n. 10787/2024 …  │
 │ un danno ingiusto…            │ │ [Copia citazione] [Aggiungi…]       │
 │                               │ │                                     │
 │ GIURISPRUDENZA                │ │ Motivazione                         │
 │ ● Cass. civ., n. 10787/2024 ──┼─▶ … ai sensi dell'art. 2043 c.c. …    │
 └───────────────────────────────┘ └─────────────────────────────────────┘
 dock: [ art. 2043 c.c. ] [ Cass. civ., n. 10787/2024 ] [ … ]
```

It costs one store action (`openDecisionTab(reference, { besideTabId })`) that
creates or focuses the tab and places both: the article's tab on the left half
of the workspace, the decision's on the right half, each as tall as the
workspace. It changes nothing in how norm tabs work, and it is what round 2b's
table would hold as two contexts.

**Reading 2 — a second pane inside the article's tab, with tabs of its own.**
The article's tab splits into two columns; the right column has a strip of
tabs, one per decision opened from that article.

```
 ┌ art. 2043 c.c. ─────────────────────────────────────────────────────┐
 │ Qualunque fatto doloso o     │ [Cass. civ. 10787/2024 ×] [Cass. … ×]│
 │ colposo, che cagiona ad      │ Corte di cassazione · Sez. III …     │
 │ altri un danno ingiusto…     │ Motivazione                          │
 │ GIURISPRUDENZA               │ … ai sensi dell'art. 2043 c.c. …     │
 │ ● Cass. civ. … ──────────────┼▶                                     │
 └──────────────────────────────┴──────────────────────────────────────┘
```

It keeps the decisions with the article that led to them, but it adds a second
kind of tab inside a tab, a pane layout the workspace does not have, and a width
problem: a window narrower than two 68ch columns must switch the pane to a
drawer.

Either way: a candidate chosen on an ambiguous decision's screen opens in that
same tab; anything else opened from a decision opens a tab of its own; the
reading back-stack (`readingBackStack`) records the jump, so «‹ Torna a art. 2043
c.c.» works as for citation jumps.

#### 2.3 On a phone

On a phone the search page already shows one tab at a time, full width, with a
swipe and arrows between tabs (`SearchPanel`, `mobileActiveTabIndex`); today it
draws only norm blocks there. A decision tab is drawn there too, and opening a
decision makes its tab the one shown, with the back control naming the article
(«‹ art. 2043 c.c.»). Answer 8.

### 3. The address opens the space

`/sentenze/:corte/:numero/:anno` keeps its route (and the login return, which
preserves the whole address). Its element parses the address
(`parseDecisionPath`), queues the reference in the store
(`requestOpenDecision`), and redirects to `/`; the search page drains the queue
on mount and opens the tab, as `?norma=` is drained today (gotcha 14: one atomic
action, so StrictMode's second run finds the queue empty). An address that does
not parse opens the space with the message and the palette (§2.1).

**Links inside the app do not navigate.** A shared `DecisionLink` component
renders an anchor with the `/sentenze/…` href (middle click and «copy link»
still work) and, on a plain click while the search page is mounted, calls
`openDecisionTab` with the tab it sits in as `besideTabId`. The Massimario's
`DecisionChip`, Brocardi's massime (§4) and the live list (§4) use it. Outside
the search page it navigates, and §3's route does the rest.

### 4. From the article to its decisions

The article's tab gains one section after the text, **«Giurisprudenza»**,
closed by default and remembered per tab (UI state). It groups three sources,
each with its own heading and its own empty or failure state (08-29 design,
«Failure»: one source down never empties the others):

1. **«Massime (Brocardi)»** — `MassimeSection` moves here from the Brocardi
   block. Each massima's court and number become a `DecisionLink` when
   `linkableDecisionPath` can build one: `Cass. civ.` and `Cass. pen.` give the
   archive, a bare `Cassazione` gives a reference the page resolves (convention
   §4.4), anything else stays text. The label is the convention's short form.
   This is the work of the convention's PR 1c (decision chips); whichever
   lands first writes it, the other adopts it (Coordination). The section keeps
   «Fonte: Brocardi.it» with its link, as every Brocardi section does.
2. **«Rassegne del Massimario»** — the MERL-T panel as it is, behind its flag;
   its chips become `DecisionLink`s.
3. **«Cassazione — menzionano l'articolo»** — a button, «Cerca nell'archivio
   della Cassazione», and nothing fetched until it is pressed. Then a list from
   `/search_decisions` (§5): each row the short form, the type and date of
   deposit, and the fragment Italgiure found, with «menzionato nel testo» as the
   row's kind; twenty per page, «Altri risultati» for the next page. Above the
   list, the count and the coverage: «312 decisioni nell'archivio pubblico della
   Cassazione (dal 3 gennaio 2021)». A row opens the decision beside the
   article. Supported for the acts §5.2 can phrase; for any other act the
   section says the search is not available for this act.

A past text (gotcha 32) shows the section too: the decisions do not depend on
the version, and the list searches the article as cited, which is the same in
every version.

### 5. The search route

#### 5.1 The route

`POST /search_decisions` on the Python API, behind the login like every
scraping route (ADR-001: `vite.config.ts` proxy list, the ingress paths,
`legalFetch` on the client). Body:

```json
{ "norma": { "tipo_atto": "codice civile", "numero_articolo": "2043", … },
  "tema": "perdita di chance",
  "archivio": "civile" | "penale" | null,
  "pagina": 1 }
```

At least one of `norma` and `tema`. Answers, all JSON with `esito` like
`/fetch_decision`: `risultati` 200 (`totale`, `archivio_dal`, `pagina`,
`decisioni: [{ identita, attributi, frammento }]`), `non_supportata` 200 (an act
§5.2 cannot phrase), `richiesta_non_valida` 400, `fonte_non_raggiungibile` 503,
`errore_interno` 500.

`frammento` is plain text plus the ranges to emphasise
(`{ testo, evidenziati: [[start, end], …] }`), built on the server from Solr's
`<em>` markers. The client never receives or renders HTML from Italgiure.

#### 5.2 How an article is phrased

The query is the decision text field (`ocr`) matched against the ways lawyers
write the article, never the bare «art. N», which catches other acts (1,588 vs
939 for art. 2043 c.c.):

- **Codes, the Constitution, the preleggi, disp. att.**: «art. N <abbr>», «art. N
  <abbr. alternate>», «articolo N <abbr>», «art. N del <name>», «articolo N del
  <name>», from one table (`c.c.`/`cod. civ.`/`codice civile`; `c.p.c.`/`cod.
  proc. civ.`; `c.p.`/`cod. pen.`; `c.p.p.`/`cod. proc. pen.`; `Cost.`/
  `Costituzione`; …), the abbreviations of convention §3.3.
- **Numbered national acts**: «art. N» within a few words of the act's number and
  year in each written form («l. n. 241/1990», «legge 7 agosto 1990, n. 241»,
  «l. 241 del 1990»), as a Solr proximity phrase. The proximity and forms are
  fixed by plan Task 1, measured on a sample before they are frozen.
- **EU acts**: not in this round (`non_supportata`).
- Ordinal suffixes come from `article_suffixes.py`, written both joined and
  spaced («2051-bis», «2051 bis»).

The archive: the civil codes search the civil archive, the penal codes the
penal one, the others both; `archivio` in the body overrides. Order: date of
deposit, newest first (`sort=pd desc`).

#### 5.3 Polite to Italgiure

- The decision reader's own `ThrottledHttpClient` (`decisions_http_client`):
  its own semaphore and minimum interval, the egress allowlist, honest
  User-Agent, verified TLS.
- One Solr request per page, plus the homepage request that opens the session.
  The homepage is fetched once per client session, not once per query (today's
  `_select` fetches it every time; plan task).
- Answers cached 24 hours per (query, page) in the existing cache manager.
- The route counts against the per-IP rate limit; a page beyond the tenth is
  refused (`richiesta_non_valida`): 200 decisions is a reading list, not an
  export.
- Never fetched without the reader's gesture (§4, §6).

#### 5.4 The words a user types

A topic is user input placed in a Solr query: the route keeps letters, digits,
spaces, apostrophes and hyphens, collapses spaces, caps the length at 80
characters, and sends it as a quoted phrase with every Solr special character
escaped. It never passes a field name, an operator or a wildcard through.

### 6. A topic, through the glossary

Answer 1: «C magari sfruttando il glossario». What exists (measured above):
Brocardi's glossary under each article it covers — terms its dictionary
defines, linked to brocardi.it.

**Chosen (the owner, «ok»):** the glossary becomes the way into a topic.

- Under the article, the «Glossario» terms stay where they are; each term gains
  an action «Sentenze su questo tema» beside the link to Brocardi's definition.
- It opens a results tab, «Tema: danno ingiusto», beside the article: the
  decisions whose text contains the term **and** mentions the article (the 34
  of «perdita di chance» with art. 2043 c.c., against 742 with the term alone),
  with a switch «Solo il tema» that drops the article from the query. Each row
  as in §4 («menzionato nel testo»), a row opens the decision beside the list.
- In the palette, words that are neither a norm nor a decision offer one line,
  «Cerca "<parole>" nelle sentenze della Cassazione», which opens the same
  results tab with the topic alone.
- Cost: no new data and no new source. The same route as §4 (`tema`), one more
  kind of tab (`view: { kind: 'decision-search'; query }`, persisted as its query).
  Limits, said in the tab: the last five years of the Cassazione only; the
  words as written (no synonyms, no stemming beyond Solr's); the glossary only
  where Brocardi covers the article (mostly the codes).

**Alternatives, not built in this round:**

- **A VisuaLex glossary built from Brocardi's dictionary** (term → definition →
  the articles that use it), which would also give norms by topic. It means
  crawling thousands of dictionary pages and keeping them: a stored corpus (the
  08-29 design's D3 forbids one, so that design is amended first) and a new
  table: several days. Brocardi's permission is not an obstacle: the owner
  states that VisuaLex already has every permission it needs from Brocardi
  (recorded as D-038). A possible later phase, not ruled out.
- **MERL-T's concept layer** (`ConcettoGiuridico`, article→concept relations):
  norms by concept and decisions by concept through the graph. It covers the
  seed (Libro IV of the codice civile), lives behind the MERL-T flags, and the
  graph is now shown only to validators. It is a research path
  (`docs/merlt/`), not a search box.

### 7. From the decision to the norms

The decision's text is passed through `extractCitations` (`utils/citationMatcher.ts`,
the matcher the article text and the documents page use) with no act in context,
so «art. 2043 c.c.», «art. 360, n. 3, c.p.c.», «art. 2, l. 7 agosto 1990, n. 241»
become links. The renderer (§8.3) wraps the matched characters in an element; it
never adds, drops or changes one. Hovering shows the article's preview
(`CitationPreviewPopup`, as in an article); clicking opens the article in the
search space, beside the decision, and records the jump in the back-stack. A
citation the matcher cannot attribute to an act stays text.

Decision citations inside a decision («Cass. n. 1234/2019») are not linked in
this round (Later).

### 8. Notes and highlights on decisions

#### 8.1 The key

A decision's anchors are stored in the existing tables (`highlights`,
`annotations`) with `normaKey` = the decision key (`decisionKey(identity)`:
`cassazione:civile:10787:2024`, `corte_costituzionale:71:2020`) and the store's
`articleId` = `""`. A norm key never contains `:` (measured: `buildItemKey`
writes `[a-z0-9_-]` and `--`), so the two spaces cannot meet. Only an identity
is a key: a decision reached by a reference without its archive is keyed once
the route has resolved it. A decision with no identity (an ambiguous reference
before the choice) takes no notes.

#### 8.2 The projection

A decision's text, for anchoring, is **its blocks in reading order — epigrafe,
motivazione, dispositivo — concatenated, minus every `\n`**. Offsets count
characters in that string, as an article's count characters in
`article_text` minus `\n` (rule 23). Two properties follow:

- the readers may add or move `\n` freely (paragraph rules can still be
  refined);
- moving a boundary between blocks without changing a character — the Corte
  costituzionale's split of the epigrafe at «Ritenuto» or «Considerato», the
  Cassazione's cut of the dispositivo off the end of the reasons — moves no
  anchor, because the concatenation is the same.

#### 8.3 The renderer

`utils/decisionRender.ts` → `renderDecisionHtml({ testo, highlights, notes,
citations })` replaces `DecisionTextView`'s React spans with the same structure
as escaped HTML: one `section.vlx-dec-block` per block (its label in CSS, as
today), one `p.vlx-dec-para` per paragraph, one `span.vlx-dec-line` per line, cut
at every mark and link edge with a stack, so the HTML is well-formed and every
text node is escaped. It reuses `resolveAnchors` (`utils/articleAnnotations.ts`)
over the projection, so a decision's highlight matches exactly as an article's
does (case-insensitive, whitespace-only differences tolerated, nothing else).

The reading interactions are the article tab's: `SelectionPopup` with
`getSelectionAnchor` over the text root («Evidenzia», «Nota», «Copia»), the
inline note composer and popover, the Notes peek panel on the decision's
toolbar, the highlight visibility toggle. Copy keeps
`decisionClipboardText` (a copy reads as the text reads). No signs per block,
no discussions (non-goals).

#### 8.4 When the source's text changes

A decision's text changes under its anchors in three known ways: Italgiure
withdraws a text while personal data are removed (the decision then comes back
without its text: `testo_assente`); Italgiure replaces it with an anonymised
version (names become «omissis»); a reader is changed against N10. The 30-day
cache delays the first two; it does not prevent them.

None of them may lose a note in silence (N11). The decision tab computes, from
`resolveAnchors`, which anchors did not land, and shows them under the text in
a box **«Non ritrovate nel testo attuale (n)»**: each highlight with its quoted
text and colour, each note with its passage and content, each removable; the box
explains «Il testo della fonte è cambiato dopo che le hai create». A decision
without its text shows every anchor there, under the notice that says why.
Nothing is deleted or moved automatically.

#### 8.5 The contract, and what it freezes

From this round, root rule 23 covers decision texts too. Frozen — the output of
each reader minus `\n`:

- `services/visualex/visualex_api/services/decisions/italgiure.py`: which fields
  make the text (`ocr`, `ocrdis`), `split_dispositivo`'s cut, the withheld-text
  detection (`_WITHHELD_*`); `paragraphs` may insert only `\n`;
- `corte_cost.py`: the fields that make each block and the order; the epigrafe
  split may move, never drop or change a character;
- the caches (the resolver's `italgiure:v2:` and `corte_cost:v2:` entries): the
  resolver's rule «raise the version whenever the reader changes the shape of
  what it returns» stays for shape (blocks, `\n`); a change of characters is
  refused, so no bump of a cache key may serve as a way to change texts already
  cached. The resolver's comments say so.

Tests that hold it:

- **web**: `decisionRender.test.ts` renders real decision texts (fixtures: a
  civil and a penal Cassazione decision, a Corte costituzionale sentenza after
  2001, a typewritten one before 2001, an ordinanza split at «Ritenuto») with
  highlights and links on, and asserts that the rendered text nodes spell the
  projection — the same check as `articleRender.test.ts`;
- **API**: `test_decisions_text_frozen.py` runs each reader on recorded raw
  records (Solr JSON, open-data JSON) and compares the projection of its output
  with a stored golden string, so any change of character fails before it
  reaches a user.

The root `CLAUDE.md` rule 23 and `services/visualex/CLAUDE.md` gain the
sentence that says so.

#### 8.6 Where the anchors travel

Highlights and notes on decisions are user-owned and server-backed (gotcha 17)
like any other, and they travel with environments and through the Forum as an
article's do (the owner, answer 4: «sì con la cautela»). The environment viewer
labels them by the decision's short form instead of the raw key.

**The caution: VisuaLex never spreads words a court has withdrawn.** A note or
highlight on a decision travels only if it still lands in the decision's
current text. When an environment is created or published, or an item is
offered to the Forum, each anchor keyed by a decision is checked with
`resolveAnchors` against the decision's text fetched now (through the session
cache); one that does not land — the text was obscured, anonymised or is
missing — is left out, and so is every anchor of a decision that cannot be
fetched at that moment (the source is down: nothing is sent on trust). The
dialog says how many were left out and why («2 evidenziazioni su sentenze non
incluse: il loro testo non è più presente nella fonte»). The anchors stay in
the user's own account, in §8.4's box. A test covers each case: a landing
anchor travels; an anchor on an obscured decision, one whose words changed, and
one on a decision that cannot be fetched do not; the count is shown.

### 9. The Cronologia

**Schema** (hand-written migration, dated after every migration on `develop`,
announced to the orchestrator; never `prisma migrate dev`):

```sql
ALTER TABLE search_history ADD COLUMN decision_key TEXT;
ALTER TABLE search_history ALTER COLUMN act_type DROP NOT NULL;
ALTER TABLE search_history ADD CONSTRAINT search_history_one_kind
  CHECK ((act_type IS NULL) <> (decision_key IS NULL));
```

Existing rows all have `act_type`, so the constraint holds at once.

**Server**: `POST /history` accepts either the norm fields or `{ decision_key }`
(validated against the key's shape: court, archive for the Cassazione, number
1–999999, year), with the same five-minute de-duplication; `GET /history`
returns `decision_key` (null for norms) and `act_type` (null for decisions).

**Web**: a decision is recorded when its tab shows a found decision, once per
opening. `HistoryView` lists it among the norms by date, labelled with the short
form computed from the key (court, archive, number, year: no section, which the
key does not hold), and reopens it in its tab. The MCP and the dossier are not
touched.

### 10. Labels

Every label is the convention's (§4 of `2026-10-04-source-convention-design.md`)
and comes from `decisionLinks.ts`: the tab and history labels, the rows of the
lists and the massime use the short form; «Copia citazione» the citation; the
tab's heading the page line. The short form is `formatDecisionShort`, which the
convention names and the golden file pins; if PR 1c has not written it when this
round needs it, this round writes it to the golden cases and PR 1c adopts it.

## Security and data

- **Query injection (OWASP A03).** Topic words go into a Solr query: §5.4's
  whitelist, length cap and escaping, and a test with every Solr special
  character and field syntax (`ocr:*`, `kind:"snpen" OR`, `\`, `{!…}`).
- **Markup from the source (XSS).** Italgiure's fragments carry `<em>`; the
  server turns them into ranges, the client renders text. The decision renderer
  escapes every text node (as `renderArticleHtml`).
- **Scraping behind the login** (ADR-001): the new route is in the proxy list,
  the ingress list and `legalFetch`'s guard test.
- **Load on the source**: §5.3; nothing fetched without a gesture.
- **Personal data in user-owned excerpts.** A highlight stores the words it
  covers. When the court later withdraws or anonymises a decision, the user's
  highlights still hold the original words, including names. That is the user's
  own data, and it stays so: the owner chose to do nothing more about it
  (answer 3), beyond §8.4's box where the user sees and can delete it. What
  VisuaLex must not do is spread those words: §8.6.
- **Validation of keys**: the history's `decision_key` and the anchors' decision
  keys are validated server-side against the key's shape.

## Verification

- Web: the palette parser's golden cases; the store actions (open, focus, place
  beside, drain the queue once under StrictMode); `DecisionView`'s outcomes
  (moved tests of `DecisionPage.test.tsx`); `decisionRender.test.ts` (§8.5);
  unmatched anchors listed, not dropped; history labels and reopening;
  `npm --prefix apps/web run build`, tests, lint.
- API: `/search_decisions` offline over recorded Solr answers (phrasing per act
  family, archive choice, paging bound, `non_supportata`, fragments to ranges,
  the injection cases); the frozen-text test; one `live` test that the endpoint
  still answers the article query; the full Python suite.
- Server: history with a decision key, the constraint, validation — on the test
  database only after the orchestrator's go.
- Browser, on a separate port against the shared backend with a test account:
  art. 2043 c.c. → «Giurisprudenza» → a massima → the decision beside it; the
  live list, a row, «Altri risultati»; a glossary term → «Tema: …» → «Solo il
  tema»; the palette with «Cass. civ. 10787/2024»; a `/sentenze/…` link opened
  cold and after login; «art. 2043 c.c.» inside the decision → back to the
  article; a highlight and a note on a decision, reload, still there; an
  unmatched anchor (forged on the test account) listed; the Cronologia; a phone
  width.

## Questions for the owner — answered

Answered by the owner on 5 October 2026 with the spec, verbatim: «spec ok, 39=1,
40 ok, ma abbiamo già tutti i permessi, 41 nulla, 42 sì con la cautela» (39–42
were the orchestrator's numbers for the four questions below).

| # | Question | Answer |
|---|---|---|
| 1 | «In una propria tab» (§2.2): reading 1 or 2 | Reading 1: a workspace tab placed beside the article's |
| 2 | The glossary (§6) | The glossary as the way into a topic; the dictionary download is possible later — the permissions are there (D-038) |
| 3 | Excerpts with personal data of a decision later withdrawn | Nothing more: the user's own data, visible and deletable in §8.4's box |
| 4 | Notes and highlights on decisions in environments and the Forum | Yes, with the caution of §8.6: an anchor whose words are no longer in the decision's current text does not travel |

## Coordination

- **Sentenze (PR C and later)**: `DecisionPage` becomes `DecisionView` in a tab,
  and the route only redirects; the reader files become frozen (§8.5) as they
  are on `develop` when PR 1 merges. The Sentenze session reviews §8.5 when it
  is back, through the orchestrator.
- **Convention PR 1a** (web labels: `SearchPanel`, `ArticleTabContent`,
  `NormaCard`): this round touches `ArticleTabContent` (the «Giurisprudenza»
  section) and the palette; order agreed through the orchestrator.
- **Convention PR 1c** (decision chips: Brocardi, Massimario): §4's links and
  `formatDecisionShort` are the same work; one of the two writes them.
- **Dossier PR 3** (decision rows and reader): adopts `renderDecisionHtml` so
  notes made in a tab show in the dossier.
- **Prisma**: one migration, after every migration on `develop`, announced
  before it is written.

## Later

- Decision citations inside a decision's text, linked to their decision.
- Decision citations in the documents page.
- The Corte costituzionale in the live list (its open data can be searched on
  disk, without the source).
- Norms by topic: a VisuaLex glossary from Brocardi's dictionary (§6), or MERL-T's concept layer.
- Notes and highlights in the dossier's decision reader (dossier PR 3).
- Passage discussions on decisions.
