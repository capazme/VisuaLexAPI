# The recitals of EU acts (considerando): search, index, reading — Design

Status: **approved** (G-536, 17 November 2026), with the owner's choices G-537 to G-540 («Decisions», at the
end). Request G-521. The plan is `docs/superpowers/plans/2026-11-17-eu-recitals.md`.

## Intent, in the owner's words

The owner, in chat with the orchestrating session, 17 November 2026 (G-521):

- The request: «dobbiamo fare in modo che la piattaforma gestisca anche i considerando dei regolamenti UE».
- Why: recitals are often cited to clarify terms and definitions («spesso per chiarire alcuni termini e
  definizioni»).
- Where he starts from: «da una citazione», not from the article he is reading.
- What a recital is to him: «alla fine è parte integrante della norma, non si può ignorare. Non ha valore
  normativo primario ma secondario sì, è interpretazione, tipo soft law».
- What comes first, out of four places (the search field, the decisions the app shows, analysed documents, the
  MCP): «il campo di ricerca e l'indice».

He accepted this playback («mi trovo»):

- **Search.** Typing a recital citation opens that recital's text inside its act, as an article opens today:
  «considerando 26 GDPR», «cons. 26 reg. 2016/679», «considerando n. 26 del regolamento (UE) 2016/679».
- **Index.** In an EU act's index the recitals are a part of their own, numbered, before the articles, as in the
  Official Journal. A click opens one recital.
- **Once open.** A recital takes the same actions as an article: into a dossier, highlight, note. It stays
  recognisable as a recital, never mistaken for a binding provision.

## Goals

1. The search reads a recital citation and opens the recital (§3).
2. An EU regulation's or directive's index shows its recitals as a part before the articles; a click opens one
   (§4).
3. A recital reads like an article and is plainly not one: its own label everywhere, a line that says it does
   not bind (§5).
4. Highlights and notes on a recital, and the recital as a dossier entry (§6).
5. One identity for a recital, in the sources convention, shared by the entry, the marks and any future link
   (§2).
6. The recital's text held to rule 23 (root `CLAUDE.md`) from the first stored mark, with its tests (§7).

## Non-goals (this round)

- Recital citations inside the decisions the app shows, inside analysed documents («Analizza documento»,
  citex), and in the MCP's tools: later rounds (G-521). The MCP only learns to name a recital entry so it does not
  break (§6.4); the document analysis keeps today's behaviour (§3.2).
- A map from an article to "its" recitals. The owner starts from the citation, and EUR-Lex publishes no such
  mapping.
- Acts whose preamble is not numbered: the treaties (TUE, TFUE, CDFUE) and older acts that print «considerando
  che …» paragraphs with no number (dir. 85/374, checked on its fixture). Italian acts have no numbered recitals.
- Versions and corrigenda (§1).
- The Cronologia, bookmarks («salva»), the saved-norm watcher, «Confronta articoli», the EU case law block, the
  MERL-T graph, Forum suggestions, article discussions, LingoLex cards, the dossier's article picker
  (`TreeNavigatorModal`): none takes a recital this round.

## What exists (measured on `origin/develop`, 17 November 2026)

- **Python API.**
  - `POST /fetch_recitals` (`services/visualex/app.py`, `fetch_recitals`) returns every recital of a
    `regolamento ue` or `direttiva ue`: `{recitals: [{number, text}], count, url}`.
  - It reads the same Official Journal page the tree and the articles come from (scraper cache, namespace
    `eurlex`, 24 h), so on a warm page it costs no request.
  - The parser is `extract_recitals` in `visualex_api/services/eurlex_scraper.py`. It reads the modern markup
    (`div#rct_N`, acts since about 2014) and the legacy class-less markup (`<p>(N) …</p>` after «considerando
    quanto segue:»). A preamble with no numbers gives `[]`.
  - Consolidated texts have no preamble. Recitals always come from the OJ page of the base act. The reader's
    EU articles come from that page too: neither the web nor the server ever sends `celex_consolidated`.
  - Only `tools/archivio-normativo` calls the route today.
- **The route is out of the browser's reach.** It is in neither Vite's proxy (`apps/web/vite.config.ts`) nor the
  ingress's `@legal` list (`infra/ingress/Caddyfile`), and the scrape gate has no price for it (default 1).
- **The search.** The fixed field opens the ⌘K palette (`CommandPalette.tsx`), which reads the words through
  `useSearchQuery`, in this order:
  1. a decision;
  2. the web's own parser (`utils/citationParser.ts`, EU acts in `utils/euCitation.ts`), through
     `utils/normQuery.ts`;
  3. `POST /parse_query`, which calls `read_norm_query` (`visualex_api/tools/norm_query.py`): the preset aliases
     first (`alias_resolver.resolve_alias`, which knows only «art. N &lt;alias&gt;»), then `parse_nl_query`
     (`nl_parser.py`).

  The alias «GDPR» lives only on the server, and `normQuery.citationFromServer` copies only the act's fields,
  `article` and `annex`. `isSearchReady` (`citationParser.ts`) is shared by the palette, «Analizza documento»
  (`documentCandidates.ts`, `CompletionPicker.tsx`) and `CompareView.tsx`. Today:
  - «considerando 26 GDPR» and «cons. 26 GDPR» are read by neither parser and become a Cassazione topic search;
  - «cons. 26 reg. 2016/679» and «considerando n. 26 del regolamento (UE) 2016/679» read as the GDPR with no
    article: the 26 is dropped silently.
- **The index.** `TreeViewPanel` draws `buildActTree` (`utils/actTree.ts`), which knows two kinds of node,
  heading and article. A click opens an article through `/fetch_all_data` into the act's block of the practice
  (`utils/practice.ts`: `PracticeAct.articles: ArticleData[]`).
- **The reader.** Every article, EU ones included, is rendered by `renderArticleHtml` (`utils/articleRender.ts`)
  over the projection of `article_text` without its `\n`. A highlight that no longer matches is not drawn, and
  `LooseHighlightsList` lists such highlights on desktop. Decisions list both their highlights and their notes,
  at every width (`UnmatchedAnchors`).
- **Marks.** `highlights` and `annotations` are keyed by a string, `${normaKey}::art::${articleId}`.
  - An article's `normaKey` is `buildItemKey` (`tipo--numero--data[--allX]--articolo`).
  - A decision's is its key (`cassazione:civile:10787:2024`), with an empty `articleId`.
- **Dossier.**
  - `DossierItem.itemType` is `norm | note | section | sentenza`; the web names them `norma | note | sentenza`.
  - A decision became an entry through one enum value (migration `20261005130000_add_sentenza_dossier_item`) and
    a strict content schema (`apps/server/src/schemas/decisionItem.ts`, which allows the web's star,
    `_dossierMeta`).
  - On the web, `dossierItemFromApi` turns a kind it does not know into an empty note, and about twenty filters
    test `type === 'norma'`.
  - The server stores a `norm` entry's content as the client sends it, with no check, and titles it as sent (the
    web sends the act's type). Every reader then takes a `norm` entry for an article: the citation needs
    `numero_articolo`, and without one it is null.
- **CELEX.** Neither the web nor the server computes a CELEX identity today. The only builder is
  `euCaseLawQuery` in `apps/web/src/utils/euCaseLaw.ts`, for case law.
- **No frozen test for EU article text.** Normattiva's extraction has its hashes
  (`test_normattiva_extraction.py`) and decisions theirs (`test_decisions_text_frozen.py`); EU OJ articles have
  only prefix and contains checks.

## 1. What a recital is in the app

A recital is a numbered paragraph of the preamble of an EU regulation or directive, as published in the Official
Journal. Three consequences:

- **One text, no versions.** The OJ page is the only source: a consolidated version carries no preamble, and an
  amending act brings recitals of its own instead of changing the old ones. A recital has no «in vigore» state,
  no past text and nothing to watch. A corrigendum is a separate OJ document. Neither recitals nor the EU
  articles the app shows today read it.
- **Two kinds of act**: `regolamento ue` and `direttiva ue`, the kinds `/fetch_recitals` accepts. Older acts
  (dir. 95/46/CE, reg. (CE) n. 1907/2006) are the same kinds with older numbering. An act whose preamble has no
  numbers has no recitals the app can open (non-goals).
- **Not binding.** In the owner's words, «è interpretazione, tipo soft law». The app never shows a recital where
  an article would be read as binding text (§5.2).

## 2. Identity and labels (`conventions/sources/`)

### 2.1 Identity

- `norma_data` gains one optional field, `considerando`: the number as the OJ prints it, digits only, no
  leading zero (`"26"`). A recital's `norma_data` has the act's fields (`tipo_atto`, `numero_atto`, `data`) and
  no `numero_articolo`, `allegato`, `versione`, `data_versione` or `parte`.
- **Identity: `celex:<CELEX of the act>~rct<N>`**, e.g. `celex:32016R0679~rct26`. It has the shape of the
  article's `celex:32016R0679~art5` (convention spec §1.5), and `rct` is EUR-Lex's own name for the element
  (`div#rct_26`). The act's identity is unchanged (`celex:32016R0679`). *Call*, status `proposed`.
- **The identity is the key everywhere** a recital is stored or pointed at:
  - the marks: `normaKey` = the identity, `articleId` = `""`, wire key `celex:32016R0679~rct26::art::`;
  - the web's check that a recital is already in a dossier (§6.2);
  - any future citation link, from a decision, an analysed document or the MCP.

  Not `buildItemKey`. That key carries the act's date as stored, and an EU act is stored with either the year
  (`"2016"`) or the full date (`"2016-04-27"`), so one recital would get two keys: the hazard the Python API's
  Date System section records for articles. A CELEX uses only the year. The key cannot meet another: a
  `buildItemKey` never contains `:`, and every decision key starts with a court's name.
- **One function per language, pinned by the golden file:**
  - Python: `sources.eu_identity(tipo_atto, data, numero_atto, articolo=None, considerando=None)` writes
    `~rct<N>`, and an article and a recital together are a `ValueError`.
  - Server: a new `apps/server/src/norms/recital.ts`, with `recitalIdentity`.
  - Web: a new `apps/web/src/utils/sources/recital.ts`, with `recitalIdentity`. It takes the act's CELEX from
    a helper extracted from `euCaseLawQuery`, so case law and recitals compute it once.

### 2.2 Labels

| Label | Value | Where |
|---|---|---|
| citation | «considerando 26, reg. (UE) 2016/679» | «Copia citazione», the dossier entry's `title`, the PDF, the MCP |
| short | «considerando 26 reg. (UE) 2016/679» | the palette's row, chips, the highlights export |
| unit | «Considerando 26» | the index row, the reader's heading, the dossier row |

- The act half is the act's citation as `cite_act` writes it (`reg. (UE) 2016/679`, `dir. (UE) 2022/2555`).
  Older acts inherit that writing, defect included (see «Found while writing», 1).
- **The word is always written out.** «cons.» is read as input (§3), never written: a recital must not look like
  an abbreviation of anything else, and «art.» never appears on one. «considerando» is invariable in Italian, so
  a list reads «considerando 26 e 27, reg. (UE) 2016/679». *Call*, status `proposed`.
- Functions: Python `sources.cite_recital(norm)` (the citation; the API writes no short forms). The server and
  the web each have `citeRecital`, `shortRecital` and `recitalUnitLabel`, in the `recital.ts` files of §2.1.

### 2.3 The golden file

- **A section of its own, `recitals`**, beside `norms`. The suites that read `norms` today require
  `numero_articolo` and check every label with the article's functions: the web, the server and MERL-T (the MCP
  reads `norms` and `decisions` too). They ignore a section they do not know. *Call*.
- Each case: `id`, `note`, `input` (`tipo_atto`, `numero_atto`, `data`, `considerando`), `identity` (`act`,
  `recital`) and `labels` (`citation`, `short`, `unit`), every value with its status (`proposed`):
  - `gdpr-cons-26`: `regolamento ue` 679/2016, recital 26;
  - `nis2-cons-1`: `direttiva ue` 2555/2022, recital 1;
  - `eprivacy-cons-2`: `direttiva ue` 58/2002, recital 2, an act from before 2015. Its identity only
    (`celex:32002L0058~rct2`); its labels go in with the fix of the older acts' citations (G-540, «Found while
    writing» 1), whichever pull request merges second.
- `README.md` documents the section, and the table of who reads it, in the same pull request.
- The API asserts it in PR 1b (`test_sources_golden.py`; `test_nl_parser_convention.py` reads every citation and
  short label back through the parser), the server in PR 3, the web in PR 4a. MERL-T and the MCP do not read it
  this round.

### 2.4 The dossier entry's shape, shared (`conventions/sources/recital-entries.json`)

The content of a `norma` entry that carries `considerando` (§6.2), as inputs and, for each, the entry kept or
the Italian reason it is refused, like `norm-entries.json`. The server's `schemas/recitalEntry.ts` asserts it in
PR 3 and the web's `utils/sources/recitalEntry.ts` in PR 4b, so the two sides cannot drift although two people
build them. Cases:

- a valid entry, with and without `_dossierMeta`;
- the act's type in another case («Regolamento UE»);
- a full date;
- refused:
  - `numero_articolo` beside `considerando` (an entry is an article or a recital, never both);
  - any other key an article may carry (`allegato`, `parte`, `versione`, `data_versione`, `tipo_atto_reale`,
    `url`, `urn`), and any key at all that is not in §6.2;
  - an Italian act;
  - a treaty;
  - a number with a leading zero;
  - a number with letters;
  - non-ASCII digits;
  - `considerando` empty or not a string;
  - a missing act field.

## 3. The search

### 3.1 The forms read

A recital clause is a head, an optional «n.», and a number, a list or a range:

- head: `considerando`, `cons.`, `cons`, `consid.` (case-insensitive);
- optional `n.`, `n°`, `nr.`; the number may sit in brackets as the OJ prints it: `(26)`;
- a list, `26 e 27`, `26, 27 e 30`, or a range, `26-30`. Lists and ranges follow the same rules as the article
  field, and the same ceiling: 150 numbers once expanded (`MAX_ARTICLES_PER_REQUEST` in the API,
  `MAX_ARTICLES_PER_SEARCH` on the web). *Call*: a lawyer cites «considerando 26-30» as often as one recital.

The clause stands anywhere in the query, though it usually comes first («considerando 26 GDPR») or last («GDPR
considerando 26», «reg. (UE) 2016/679, considerando 26»). What is left once the clause and the «e» or comma
before it are taken out is the rest. When the rest also holds an article («art. 4 e considerando 26 GDPR»), the
reading is refused (§3.3). A head with no number after it is no clause: «Cons. St.» and «considerando il
contratto» are left to the other readers. The rest is the act, in every form the search reads today for an EU
act, with or without «del», «del regolamento», «della direttiva» or a comma between them:

- the aliases («GDPR», «NIS2», …);
- «reg. (UE) 2016/679», «regolamento (UE) 2016/679», «regolamento UE 2016/679», «reg. 2016/679»;
- «dir. (UE) 2022/2555», «direttiva 95/46/CE»;
- «reg. CE 1907/2006».

*Call*.

| Typed | Reading |
|---|---|
| considerando 26 GDPR | `regolamento ue` 679/2016, recital 26 |
| cons. 26 reg. 2016/679 | the same |
| considerando n. 26 del regolamento (UE) 2016/679 | the same |
| considerando (26) GDPR | the same |
| GDPR, considerando 26 | the same |
| considerando 26-30 GDPR | recitals 26 to 30 |
| considerando 2 direttiva 2002/58/CE | `direttiva ue` 58/2002, recital 2 |
| considerando 26 | incomplete: the act is missing (§3.3) |
| considerando 3 l. 241/1990 | refused, `recital_not_eu` (§3.3) |
| art. 4 e considerando 26 GDPR | refused, `recital_with_article` (§3.3) |
| Cons. St., sez. VI, n. 2270/2019 | still a Consiglio di Stato decision |

### 3.2 Where

**Python.** A new leaf module, `visualex_api/tools/recital_clause.py`, defines `split_recital_clause(text) ->
tuple[str | None, str]`: the recital spec (`"26"`, `"26,27"`, `"26-30"`, as the article field writes a list or a
range) and the rest of the text. `read_norm_query` calls it first and reads the rest as today (alias, then
parser), so both paths take a recital. Then:

- the rest is an EU act with no article: the parameters gain `recital`;
- the rest names an act that is not an EU regulation or directive: `refusal: "recital_not_eu"`;
- the rest also names an article: `refusal: "recital_with_article"`;
- the rest names no act, or is empty: `recital` with no act (incomplete). Today an empty rest reads as nothing.

`/parse_query` answers `recognized: true` with `parsed.recital`, `identifies_act` as today, and, when there is
one, a top-level `refusal`. Its `display` is:

- the recital's citation (§2.2) for a ready reading;
- «considerando 26» for an incomplete one;
- absent for a refused one.

A refused or incomplete reading is still `recognized`, so the palette never falls through to a topic search.

**`/parse_query_batch` keeps «Analizza documento» as it is.** It answers a reading that has a recital or a
refusal as not recognised, this round: the citex round will read them. A test pins it.

**Web.**

- A new `utils/recitalClause.ts`, `splitRecitalClause(text)`, applies the same rules; `parseLegalCitation` reads
  the rest, and `ParsedCitation` gains `recital` and `refusal`.
- `normQuery.citationFromServer` copies `recital` and `refusal` from the server's reading (the only way «GDPR»
  resolves).
- **`isSearchReady` does not change.** A new predicate, `isRecitalReady(reading)` (a recital and an identified
  `regolamento ue` or `direttiva ue`, no refusal), is used by the palette alone. «Analizza documento» and
  `CompareView` keep their behaviour. *Call*.
- **A refusal comes first.** A reading with an article and a refusal («art. 4 e considerando 26 GDPR») still
  passes `isSearchReady`, so `useSearchQuery` checks `refusal` before `isSearchReady`: Enter on it never starts
  the article search. The web's own parser gives the refusal, since `readNormQuery` does not ask the server when
  the local reading is ready.
- `preferredReading` is unchanged: the web's reading wins when it is ready, the server's otherwise.
- `expandRecitalSpec(spec)` (in `recitalClause.ts`) turns «26-30» or «26,27» into the numbers `openRecitals`
  takes. It applies the ceiling of §3.1.

**Decisions are not touched.** `decisionCitationParser.ts` needs «st» after «cons», so «cons. 26» is not a
decision, and «Cons. St.» stays one. One test on each side pins both.

### 3.3 What the palette shows and does

- **A ready reading**: its short label, «considerando 26 reg. (UE) 2016/679», marked as a recital (the web's
  design). Enter calls a new action, `openRecitals(act, numbers)`, beside `openDecision`. It never goes through
  `actions.search`: the article stream and the Cronologia row stay out of it (§5.1).
- **Incomplete**, the act missing: the palette asks for the act as it does for an article with no act, and
  offers only `Regolamento UE` and `Direttiva UE`.
- **Refused**:
  - `recital_not_eu`: «Solo i regolamenti e le direttive dell'Unione hanno considerando numerati.»
  - `recital_with_article`: «Cerca un articolo o un considerando alla volta.»

  Never a topic search in their place.

All three are *calls*.

## 4. The index

- **Where.** In the index of a `regolamento ue` or `direttiva ue` (`TreeViewPanel`), a part «Considerando»
  before the first heading or article, as the OJ prints the preamble before the enacting terms. It is closed when
  the index opens.
- **When it is read.** Opening the part calls `/fetch_recitals` once per act per session: no request for someone
  who never opens it. One cache, `utils/recitalsCache.ts`, serves the index, the reader and the palette. Like
  `actStructureCache`, it never keeps an empty or failed answer.
- **What it lists.** The part then reads «Considerando (173)» and lists one row per recital: «Considerando 26»,
  with the first words of the text muted, since a recital has no heading to find it by. The exact layout is the
  web side's.
- **A click** opens the recital in the act's block (§5), or reveals it if it is already open.
- **Nothing found.**
  - An empty answer: «Non trovo considerando numerati nella pagina della Gazzetta ufficiale di questo atto.»
    This is true both for a preamble without numbers and for a page the parser could not read.
  - A failure: its message and «Riprova».
- `buildActTree` gains a third kind of node, the recitals part. Annexes and headings are unchanged.

## 5. Reading a recital

### 5.1 Where it opens

- **In the act's block** of the practice, where its articles open, **before the articles**, by number.
  - The act block's model gains `recitals` beside `articles`: units keyed by the identity, holding the number
    and the text.
  - A practice saved before this change loads unchanged; one that holds recitals saves them.
- **From the search**, `openRecitals` reads the act's recitals through the cache. It opens those asked, in
  number order, and reveals the first.
- **Numbers the act does not have**: «Il reg. (UE) 2016/679 ha 173 considerando: il 200 non c'è.» A list or a
  range opens the ones that exist and names the others in the same message. An act with none answers as §4 does.
- The text comes from the cached answer: opening a recital costs no other call. No Cronologia row (non-goals).

### 5.2 How it reads

- **Heading** «Considerando 26»: never «Art.», never a rubrica.
- **The line that says what it is.** It sits under the heading, in the reader, in the dossier's reader and in the
  PDF: «Considerando: non è una disposizione vincolante, orienta l'interpretazione degli articoli.» It follows the
  owner's «è interpretazione» and the playback he accepted («never mistaken for a binding provision»). *Call*;
  the copy is the owners' to change, the style the web side's.
- **The text** is rendered by `renderArticleHtml`, the article's renderer, unchanged. The recital's text has no
  «Articolo N» first line, so no heading or rubrica is inferred, and each `\n` paragraph is a block (§7.4 tests
  it). It uses the same tools as an article, not copies of them, as decisions did:
  - `SelectionPopup`: «Evidenzia», «Nota», «Copia»;
  - the inline note composer and popover, the notes panel, the signs at the end of an annotated block;
  - the highlights toggle and the highlights export.
- **Actions**: «Copia citazione» (the recital's citation), «Aggiungi al dossier» (§6), «Copia link EUR-Lex».
  The link is the act's page, as for an article; `#rct_N` is added only if one live check shows EUR-Lex honours
  it. *Call*.
- **Not offered**:
  - versions and the in-force state, «salva» and the watcher, «Confronta articoli», the EU case law block,
    MERL-T;
  - three tools of `SelectionPopup`: «Discuti con i colleghi», «Crea scheda» and «Segnala come citazione». The
    reader does not pass their handlers. The server would refuse the first two for a recital's key: article
    discussions ask for an article, and LingoLex keys take one pattern.
- **Marks that no longer land are listed**, highlights and notes alike, at every width, with `UnmatchedAnchors`
  as on a decision. They are never dropped silently: the OJ page could one day be served with a different text.
  *Call*.

## 6. Highlights, notes and the dossier

### 6.1 Highlights and notes on the text

- The existing tables, `highlights` and `annotations`, with `normaKey` = the recital's identity and `articleId`
  = `""` (§2.1). No schema change.
- Marks belong to the recital, not to a dossier, as an article's do.

### 6.2 The dossier entry (G-538: a `norma` entry with one more field)

- **A norm entry, not a kind of its own** (G-538, the owner's choice): `itemType` `norm` on the server, `type:
  'norma'` on the web. No new kind and no migration. What makes it a recital is one field an article never has,
  `considerando`. The owner chose this knowing the cost: every part that reads a `norm` entry and is not taught
  the field would show the recital as an article. §6.3 lists every such part, and each one reads the field, with
  a test.
- **Content, strict when it carries `considerando`** (`apps/server/src/schemas/recitalEntry.ts`; the shape of
  `recital-entries.json`, §2.4):
  - `tipo_atto` (`regolamento ue` or `direttiva ue`, any case);
  - `numero_atto` (ASCII digits);
  - `data` (`YYYY` or `YYYY-MM-DD`);
  - `considerando` (ASCII digits, 1 to 4, no leading zero);
  - `_dossierMeta` (`{ important: boolean }`, strict), the web's star.

  Any other key is refused, `numero_articolo` first: an entry is an article or a recital, never both. **The key
  decides**: a content with an own key `considerando`, whatever its value, is checked as a recital; one without
  it is an article, read as today. No text is stored: it is read from the API when shown.
- **Title.** The server sets a recital entry's `title` to its citation on every write that carries content, and
  ignores a `title` sent alone. An article's title stays what the web sends. So a reader that shows only the
  title still reads «considerando 26, reg. (UE) 2016/679». *Call*.
- **Routes.**
  - `POST /dossiers/:id/items` with `itemType: 'norm'` checks a recital content with the schema and titles it.
  - `PUT /dossiers/:id/items/:itemId` does the same when the content it carries, or the content stored, has the
    key: a PUT can neither turn an article into a recital nor a recital into an article.
  - `serializeItem`'s `citation` is the recital's citation and its `act_citation` the act's (§6.3).
  - **Duplicates** are handled as an article's: the web checks that the recital is not already in the dossier
    (`inDossier.ts`, by identity) and the server does not. *Call*: an article has no server check either, and a
    second copy loses nothing.
- **A note on the whole entry** (`aboutItemId`, `POST /dossiers/:id/notes`): `assertArticleOfDossier` accepts
  any `norm` entry of the dossier, a recital included. A test pins it.
- **Where the web shows it.** In its act's block (`actKeyOf`), in a «Considerando» group before the articles,
  by number; the row «Considerando 26»; the counts line «N considerando». The dossier's reader shows the §5.2
  line and the marks.
- **The PDF** (`dossierPdf.ts`): exactly as an article. The text is printed, and the «solo le parti
  evidenziate e annotate» mode applies to it. It sits under its act, before the articles, with its heading and
  the §5.2 line. A recital is never left out of an export.
- **The trash.** The payload is kept as for every entry, and a restore brings the content back unchanged. The
  summary is the citation (§6.3).
- **Moving it.** The entry keeps `considerando` through every door, or is refused in words. It never arrives as
  an article, and never as the whole act.
  - The web's JSON export and import, and the share link: `type: 'norma'` with `considerando` kept (§6.3, web).
  - A dossier published as an environment: the server's `rebuildNormEntry`, which `environmentDossiers.ts`
    calls, learns the shape of §2.4 and keeps it. The web's `dossierPublication.ts` does the same in 4b.
  - The study import (`studyImport.itemRow`) keeps it as a recital: checked with the shape of §2.4 and titled
    with its citation. One that fails the check is counted as refused, never stored as an article. Its marks
    arrive with the recital's key (`celex:…~rct26::art::`), which `wireNormaKey` writes as it is.
  - Forum suggestions refuse it: «I considerando non si possono ancora proporre nel Forum.» The Forum learns
    recitals in a later round.
  - A LingoLex course module citing it refuses it: «un considerando non si può ancora citare in un percorso».

### 6.3 Every part that reads a `norma` entry reads `considerando` (G-538)

Each part either reads the field and treats the entry as a recital, or refuses it in words. None falls through
to the article branch. Each row has its test, in the pull request named. A part listed «unchanged» keeps its
behaviour because that behaviour is already right for a recital, and a test pins it.

**Server and MCP (PR 3).** One change carries most of the server: the stored citation reads the field, and every
answer that names an entry takes its citation from there.

| Part | Today, given a recital entry | After |
|---|---|---|
| The citation: `storedAct` and `citeStoredNorm` (`norms/citation.ts`), behind `citeStoredItem` | null: no `numero_articolo` | the recital's citation, «considerando 26, reg. (UE) 2016/679» |
| The act's citation: `citeStoredAct` | the act's citation | unchanged |
| Creating and changing an entry: `addDossierItem`, `updateDossierItem` (`dossierController.ts`) | any content; the title as sent | §6.2: checked, titled with its citation |
| A note on the entry: `assertArticleOfDossier` | accepted | unchanged |
| The trash's summary and restore (`trash/trash.ts`) | no citation | the citation; the restore unchanged |
| The entry's text for the assistant: `readEntryText` (`assistant/entryText.ts`), `routes/assistantPassages.ts` | «I dati di questa norma nella pratica sono incompleti: aggiungila di nuovo.» | refused in its own words: «Il testo di un considerando non si legge ancora da qui: aprilo nel lettore di LexCraft.» |
| Published environments: `rebuildEntry` (`utils/environmentDossiers.ts`) through `rebuildNormEntry` (`schemas/normEntry.ts`) | refused: «Numero di articolo mancante» | kept as a recital |
| Forum suggestions: `rebuildDossierEntry` (`utils/suggestionEntries.ts`) | refused: «Numero di articolo mancante» | refused: «I considerando non si possono ancora proporre nel Forum.» |
| A course module's citations: `resolveCitations` (`lingo/courses.ts`) | refused: «la norma non si può citare (Numero di articolo mancante)» | refused: «un considerando non si può ancora citare in un percorso» |
| The study import: `itemRow` (`services/studyImport.ts`) | stored as sent, titled «regolamento ue» | checked and titled with its citation, or refused |
| Adding by reference (`omnilex_aggiungi_norme_dossier`): `identify` (`norms/resolveReference.ts`) | not recognised; after PR 1b, «Manca l'articolo» | not recognised: «Un considerando si aggiunge al dossier dal lettore di LexCraft, non da qui.» |
| The same tool's duplicate check: `normIdentity` (`dossierController.ts`) | a recital has no `urn`: never matched | unchanged |
| The saved-norm watcher: `POST /notifications/normas/check` (`notificationController.ts`) | would store a watch of the recital's text | no watch for a `norma_data` with `considerando` |
| LingoLex cards (`schemas/lingo/card.ts`, the `normaKey` pattern) | refuses the recital's key | unchanged |
| MCP: `omnilex_leggi_dossier` (`entryLine`), `omnilex_leggi_pratica`, the deletion dialog (`confirm.ts`) | «Norma», and a note «Nota» | the server's citation; a note about it «Nota su considerando 26, reg. (UE) 2016/679» |
| MCP: `omnilex_leggi_testo_voce`, `omnilex_glossa_voce` | the server's «dati incompleti» | the server's refusal above, passed on |

Two parts read the kind but never the content, and change nothing: the assistant's note counts
(`assistant/notes.ts`) and the deletion dialog's count of hidden entries (`KIND_PLURALS`: a recital counts among
the «norme», the owner's own word for what a recital is part of). *Call*.

**Web (PR 4a and 4b).**

WEB_TABLE_PLACEHOLDER

- **Order.** Between PR 3 and PR 4b the server accepts a recital entry, but no client creates one: the MCP
  refuses (above), and the web learns to in 4b. No recital entry exists before 4b, so no web reader meets one
  before it is taught the field.

### 6.4 The MCP, so it does not break

- No MCP code changes. Every line the MCP writes of a `norm` entry is the server's `citation`, which PR 3 makes
  the recital's: `omnilex_leggi_dossier` lists «considerando 26, reg. (UE) 2016/679», and a note about it reads
  «Nota su considerando 26, reg. (UE) 2016/679». PR 3's MCP tests pin both.
- Reading the entry's text, or glossing it, passes on the server's refusal (§6.3).
- Creating one through the MCP: not this round. `omnilex_aggiungi_norme_dossier` refuses it in words (§6.3).

## 7. The frozen text (rule 23)

### 7.1 The contract

- A recital's `text`, as `/fetch_recitals` returns it, is the space its marks are anchored in.
- The projection is that text with every `\n` removed, exactly as an article's `article_text`. Offsets count
  characters in it.
- The extractor may add or move `\n`, never add, drop or change another character. The renderer may wrap
  characters in elements, never add, drop or change one.
- **The freeze binds from the pull request that first stores a mark on a recital** (PR 4a). After it the golden
  is never re-recorded to make a test pass.
- Root `CLAUDE.md` rule 23 gains one sentence for recitals and for the new EU article guard, in PR 1a. The file
  is reserved in the register first.

### 7.2 Settle the text once, before the freeze (PR 1a)

No mark exists yet, so the extractor's output may change now, once.

1. **Modern markup: spaces that are not in the source.** Each paragraph is read with `get_text(" ",
   strip=True)`, which puts a space between every two text nodes. So where a footnote call was removed, or next
   to an italic or a link, a space lands before punctuation. GDPR recital 173 reads today «… del Parlamento
   europeo e del Consiglio , compresi …». The rules:
   - a removed footnote call takes the whitespace just before it (the OJ glues the call to the word with a
     no-break space);
   - the paragraph's text nodes are joined with no separator of our own;
   - a `<br>` counts as whitespace;
   - inside a paragraph, every run of ASCII whitespace (space, tab, CR, LF) becomes one space, so a line break
     in the source's HTML never becomes a `\n`;
   - the paragraph is trimmed of ASCII whitespace at its two edges only.

   Recital 173 becomes «… e del Consiglio, compresi …», and recital 3 keeps «… del Consiglio ha come …».
2. **Legacy markup: the footnote call is kept.** A legacy page prints the call as plain text glued to the word:
   «… di tali dati(4) richiede …» (dir. 2002/58, recital 1). Nothing in the markup tells it from the text, and a
   rule that strips «(N)» would one day delete words. *Call*; it can be overturned until PR 4a merges. The same
   whitespace rule as 1 applies inside a legacy paragraph.
3. **Legacy markup: paragraphs between two recitals.**
   - The walker keeps only paragraphs that open with «(N)». The two legacy fixtures have no other paragraph
     between recitals (checked).
   - PR 1a captures one more legacy act (one request, through CELLAR) and checks.
   - If a paragraph without «(N)» sits between recitals N and N+1, it joins recital N with `\n`. Such paragraphs
     are held aside and join only when recital N+1 arrives. So paragraphs after the last recital stay out, as
     today, even when the enacting formula is not recognised. Empty paragraphs are ignored, and a «(k)»
     paragraph out of sequence stays a footnote, as today.
4. **The no-break space stays.** It is a character of the source, and the anchor match already tolerates
   whitespace-only differences.

`tools/archivio-normativo` reads the same route. Its tests run with PR 1a, and its archive files change at their
next run.

### 7.3 The test (Python API)

- **`tests/test_recitals_text_frozen.py`**, with `tests/fixtures/eurlex/frozen_recitals.json`. For each fixture
  and each recital number it stores the SHA-256 of the projection's UTF-8 and its length, never the text, as
  `test_decisions_text_frozen.py` does. Fixtures:
  - `gdpr_oj_trimmed.html` (recitals 1, 2, 3, 173);
  - `eprivacy_oj_legacy.html` and `cellar_eprivacy_oj_legacy.html` (49 each, which must be equal);
  - the legacy capture of §7.2.3.
- **Synthetic HTML pins each rule of §7.2**:
  - a call before a comma;
  - a call before a word;
  - an italic before a comma;
  - a line break inside a `<p>`;
  - a recital in two paragraphs;
  - a legacy continuation paragraph.
- The module's docstring states the freeze and the pull request that binds it, as the decisions' test does.
- **Found while writing: EU article text has no freeze.** Highlights on EU articles already exist, and nothing
  would notice an extractor change that moves them. PR 1a adds the same hash test over the OJ fixtures' article
  texts (GDPR and e-privacy), with no change to the extractor. *Call*.

### 7.4 The test (web)

The recitals of the fixtures are copied into the web's test fixtures, with the API's hashes beside them so the
copy is checked against the source. A recital twin of `articleRender.test.ts` checks, for each of them, that the
rendered text nodes spell the projection, with marks and signs on.

## 8. Routes and the gate

- `/fetch_recitals` becomes reachable from the browser through one pull request (PR 2) that adds:
  - the Vite proxy entry (`apps/web/vite.config.ts`);
  - the ingress's `@legal` path (`infra/ingress/Caddyfile`).

  `infra/ingress/paths.test.mjs` and `services/__tests__/legalFetch.guard.test.ts` keep the two lists in step.
  The web calls it through `legalFetch` (web gotcha 30).
- Behind the login, like every scraping route (ADR-001): `forward_auth` to `/api/auth/verify`.
- Price: 1 point, the default. One cached page and one parse; one call per act per session. *Call*.
- The answer keeps its shape. There is no per-number filter: one call per act serves the index, the reader and
  the palette. *Call*.

## 9. Who builds what

| Piece | Area | Owner's side |
|---|---|---|
| Text settled and frozen, EU article freeze (§7.2–7.3) | `services/visualex`, `tools/archivio-normativo` tests | this side |
| Identity, labels, search clause, golden section (§2.1–2.3, §3.2 Python) | `services/visualex`, `conventions/sources` | this side |
| The route reachable (§8) | `infra/ingress` (reserved file), one line of `apps/web/vite.config.ts` | this side builds; **the web owner approves the line** |
| The entry's shape, routes, every server reader, MCP tests (§2.4, §6.2–6.4) | `apps/server`, `apps/mcp` (tests only), `conventions/sources` | this side |
| Search, index, reading, marks (§3.2 web, §3.3, §4, §5, §6.1) | `apps/web` | **the web owner's side builds or approves** |
| Dossier, PDF, trash, import, publication, every web reader of a `norma` entry (§6.2, §6.3 web) | `apps/web` | **the web owner's side builds or approves** |

## Security and data

- **The new route** is behind the login and priced like any scraping route. Its inputs are already validated
  (act kind, ASCII digits, a date), and it asks only the hosts already allowed (CELLAR, EUR-Lex). No bulk
  fetching: one act per call, from cache when warm.
- **Stored data.**
  - A recital entry's content is a strict, closed shape, pinned on both sides by one fixture.
  - Its title is recomputed by the server, and no HTML or free text is stored.
  - The text is rendered escaped, by the article's renderer.
  - Marks live in the existing tables and go with the account, as they do today.
- **Silent loss is the risk this design guards against.** Six cases, each with its rule:

  | The loss | The rule |
  |---|---|
  | a recital stored, imported or shown as an article | §6.2–6.3 |
  | a recital dropped from an export | §6.2 |
  | the field `considerando` dropped on a move, leaving the whole act | §6.2–6.3 |
  | a mark dropped without a word | §5.2 |
  | a recital's number dropped by the search | §3 |
  | a text changed under its marks | §7 |
- **No migration** (G-538). The recital is a `norm` entry; the Prisma schema does not change.

## Verification

- Each pull request: the suites of its areas (API, archive, server, MCP, web, ingress paths), green in CI. The
  web: `npm --prefix apps/web run build` and `lint`.
- PR 4a and 4b: a browser pass on `http://localhost:5173`, logged in, at 1440 and 390, light and dark:
  - **search:**
    - «considerando 26 GDPR», «cons. 26 reg. 2016/679», «considerando n. 26 del regolamento (UE)
      2016/679»;
    - «considerando 2 direttiva 2002/58/CE», «considerando 26-30 GDPR», «considerando 200 GDPR»;
    - «considerando 3 l. 241/1990» refused, and «Cons. St., sez. VI, n. 2270/2019» still a decision;
  - **the GDPR's index:** the part, its count, a click;
  - **marks:** a highlight and a note on recital 173 that survive a reload;
  - **dossier (4b):** into a dossier; the dossier's reader; its PDF; the trash and back; the JSON export and
    import; a star.

## Pull requests

Each merges on its own, in this order:

1. **1a — API, the text.** §7.2 and §7.3: the extractor's rules, the frozen recitals, the EU article freeze, one
   legacy capture.
2. **1b — API, identity and search.** §2.1–2.3 for Python and the golden section, and §3.2 Python:
   - `considerando` and `~rct`;
   - `cite_recital`;
   - `recital_clause.py`;
   - `read_norm_query`, `/parse_query` and the batch.
3. **2 — The route.** §8: Caddy, Vite, their tests. The register reserves `infra/`; the web owner approves the
   Vite line.
4. **3 — Server and MCP.** §2.4 and §6.2–6.4, server side, no migration (G-538):
   - `recital-entries.json`, `schemas/recitalEntry.ts`, `norms/recital.ts`, the golden section asserted by the
     server;
   - the routes and the stored citation;
   - every server and MCP row of §6.3, each with its test.
5. **4a — Web: search, index, reading, marks** (web owner). §2.1–2.2 web, §3.2 web, §3.3, §4, §5, §6.1, the
   web rows of §6.3 that read marks, and §7.4. **The freeze binds here.**
6. **4b — Web: the dossier** (web owner). §6.2 web side and the dossier's web rows of §6.3: the entry,
   `recitalEntry.ts`, the layout, the reader, the PDF, the trash, export and import, publication, every `type ===
   'norma'` filter.

1a and 1b can go in either order. 4a needs 1a, 1b and 2. 4b needs 3 and 4a. Where 4a and 4b sit against the web
plan is the web owner's call (G-537).

A separate pull request, outside these six, fixes the citation of EU acts before 2015 with the test cases that
are missing (G-540, «Found while writing» 1).

## Decisions

The owner's answers, 17 November 2026, by ID:

- **G-536** — the spec is approved, with the choices below.
- **G-537** — order against the web plan (D-309): the server-side pieces now (1a, 1b, 2, 3); 4a and 4b where the
  web owner places them in the web plan.
- **G-538** — the dossier entry: a `norma` entry with one more field, `considerando`, and no migration. The owner
  chose it knowing that every part not taught the field would show the recital as an article; §6.3 lists every
  such part, and each one reads the field, with a test.
- **G-539** — the line under a recital's heading (§5.2): the proposed wording stands.
- **G-540** — the citation of EU acts before 2015: fixed in a pull request of its own, with the test cases that
  are missing.

## Calls made in this spec

Low-impact, mine, each open to change:

- **identity and labels:** the identity's token `~rct` (§2.1); the labels, with «considerando» always written
  out (§2.2); the golden file's own `recitals` section (§2.3);
- **search:** lists and ranges, and the clause at the start or the end (§3.1); a predicate of its own, so
  `isSearchReady` does not change (§3.2); the batch answering a recital as not recognised (§3.2); the palette's
  messages and the `openRecitals` action (§3.3);
- **index and reading:**
  - the index part read only when opened, with the first words in its rows, and the wording for an act with
    none (§4);
  - the messages for numbers an act does not have (§5.1);
  - the line «non è una disposizione vincolante…» (§5.2);
  - `#rct_N` only after a live check, and the three selection tools left out (§5.2);
  - unmatched marks listed with `UnmatchedAnchors` (§5.2);
- **dossier:** a recital entry's title set to its citation by the server; no server duplicate check, as for an
  article; the refusals of §6.3 in words (§6.2–6.3);
- **route:** one call per act, price 1 (§8);
- **frozen text:** the whitespace rules, and legacy footnote calls kept (§7.2); the EU article freeze in PR 1a
  (§7.3);
- **scope:** no Cronologia, bookmark, watcher, discussion or card this round (non-goals).

## Later

- Recital citations in the decisions the app shows, in analysed documents and in the MCP (G-521).
- The Cronologia (a nullable column on `search_history`).
- Recitals in Forum suggestions and in a course module's citations.
- The dossier's article picker.
- Article discussions and LingoLex cards on a recital.
- Preambles without numbers, if a lawyer needs them.

## Found while writing

1. **EU acts before 2015 are cited in the wrong form.**
   - `cite_act` writes «dir. (UE) 2002/58», «reg. (UE) 2006/1907» and «dir. (UE) 1995/46».
   - The forms in use are «dir. 2002/58/CE», «reg. (CE) n. 1907/2006» and «dir. 95/46/CE».
   - The golden file's EU cases are all from 2016 onwards, so no test sees it.
   - Recital labels borrow the act's citation and inherit it. Its own pull request fixes it (G-540).
2. **EU article text has no frozen test** (§7.3); PR 1a closes it.
3. **The search drops a recital's number silently today** («What exists»). PR 1b and 4a close it.
4. **The web turns a dossier entry of an unknown kind into an empty note**, and starring it writes that empty
   content back. Any new kind meets this hazard. With G-538 this round adds no kind, so it needs a fix of its
   own, outside this round.
