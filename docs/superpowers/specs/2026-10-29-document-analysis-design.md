# «Analizza documento» — one recognizer with the search, and completion by hand

**Status:** draft for the owners, 29 October 2026. A specification only: nothing here is built yet.
**Asked by:** one owner, 29 October 2026, in chat with the orchestrator: widen what «Analizza documento» recognises
as far as it will go, let the user complete by hand what it leaves half-read («the user spends 5–10 minutes looking
at where that article is cited and adds the reference by hand, which will often be the same one»), and align the
page with the search, «which was built quite well». The user's corrections as a source of data are a second phase,
to decide with the other owner (§7).
**Decisions it rests on:** G-375 (25 October): «Analizza documento» goes only when the analysis Claude makes
through MCP finds at least as much on the same documents. This spec raises the page towards that bar; it does not
replace it (§3.4).
**Builds on:** the page as it stands (`apps/web/src/components/features/documents/`, brief D2 and D6 in its
comments), the search's reading of a query (`apps/web/src/hooks/useSearchQuery.ts`), the server's resolver
(`services/visualex/app.py` `parse_query`, `visualex_api/tools/nl_parser.py`, `alias_resolver.py`,
`act_resolver.py`), the source convention (`conventions/sources/`).
**Migration:** none in phase 1. Phase 2 would need one (§7), not reserved.
**Corpus and measure:** `2026-10-29-document-analysis/` beside this file (§3).

---

## 1. What the owners asked, in four lines

1. **More found.** The page should read every way a lawyer writes a norm, not the subset its own regex knows.
2. **One recognizer.** The same words should name the same norm in the search and in a document, and an improvement
   to the search should reach documents without a second copy of the rules.
3. **Completion by hand.** What is found but not resolved («art. 5» with no act) is completed by the user, who sees
   where it stands in the document, picks the act once and applies it to the citations that need the same act.
4. **Honesty about the file.** The page promises today that nothing leaves the browser. Whatever changes, the
   promise must stay true, in new words.

## 2. What exists

### 2.1 The page

- `DocumentReviewPage.tsx` reads the file in the browser (`documentFile.ts`: TXT, Markdown, HTML, DOCX; a PDF is
  refused with an explanation) and calls `extractCitations(result.text)` (`DocumentReviewPage.tsx:158`) — with **no
  norm in reading**. The matcher (`utils/citationMatcher.ts`) has seven patterns; the last two (4 and 5, bare «art. 5»
  and «artt. 8 e 9») run only with a norm in reading (`citationMatcher.ts:508`, `:569`), so on this page **a bare
  article is never found**. It is not listed as «unknown»: it is not there.
- Pattern 2 (`citationMatcher.ts:450`, «artt. 1 e 2 c.c.») keeps the **first article only** («Aggiungi solo il
  primo articolo»): «artt. 1223 e 1225 c.c.» lists art. 1223 and loses art. 1225.
- Pattern 1a and 1 read a numbered act only as `N/YYYY` (`NATIONAL_ACT_SOURCE` with `(\d+)\s*[/\\]\s*(\d{4}|\d{2})`):
  «legge 7 agosto 1990, n. 241» and «l. n. 300 del 1970», the forms of every brief, are not read.
- The matcher knows no alias: «art. 82 GDPR», «art. 13 del Testo unico edilizia», «art. 18 dello statuto dei
  lavoratori» are not found, though the search reads all three.
- Each citation opens the reader as a search would (`openCitation`, `triggerSearch` after `navigate('/')`).
- The list groups by act (`citationGroups.ts`), the text is drawn as it is (`DocumentText.tsx`, every character
  once), and a row and its mark select each other.
- The promise: the page's line «Trova le norme citate in un atto: il file resta nel tuo browser.», the badge «Resta
  nel tuo browser: il documento non viene inviato al server né salvato.», the box «Il file resta nel tuo browser»
  (`DropZone.tsx`), all three pinned by `DocumentReviewPage.test.tsx:41-43,166`. Today they are literally true: the
  page makes no request.

### 2.2 The search

- `useSearchQuery.ts` reads what a search box holds in a fixed order: a court decision first; then the client's
  parser (`citationParser.ts` `parseLegalCitation`, with the user's own aliases); and when that reading is not yet
  searchable (`isSearchReady`), the server's `/parse_query`, 250 ms after typing stops. «The client wins when its
  own parse is already searchable; otherwise the server fills in.»
- `/parse_query` as served (`services/visualex/app.py:1043`, routed by the ingress, `infra/ingress/Caddyfile:107`,
  and by Vite in development) runs `resolve_alias` (the preset aliases of `preset_aliases.yaml`, then
  `act_resolver.resolve_atto`: 410 act names «as a lawyer writes them, never guessed») and then
  `nl_parser.parse_nl_query`. **It then builds a URN and a display line** through
  `create_norma_visitata_from_data`, which may complete a year into a date and read an article range on
  Normattiva (`urngenerator.complete_request_date`, `text_op.parse_article_input` → `get_tree`): a network call per
  query. The search uses only `parsed` from the answer.
- `services/visualex/visualex_api/app.py` holds a twin of the routes under `/api/` (its `parse_query` does no URN).
  The ingress and Vite route the root app (`asgi.py`). This spec changes the root app; the twin is left as it is.
- `/fetch_alias_catalog` (`app.py:1548`) already hands the browser the preset aliases and the 410 known act names
  (`useAliasCatalog.ts`), as plain lists, behind the login.

### 2.3 The server's text linker

`citation_linker.extract_citations` (`/extract_citations`) reads a whole text and lets a bare article inherit the
last act named before it. It is what MERL-T and the reader use. For documents it would mean sending the whole text,
and it reads the long forms of a numbered act badly: «art. 3 della legge 15 luglio 1966, n. 604» comes out as an
article of «legge» with no number (measured in §3: 31 wrong out of 90). It is not the recognizer this page needs.

## 3. Measure

### 3.1 The corpus

Five documents written for this spec, invented from start to end (no client's, no real party), in
`2026-10-29-document-analysis/corpus/`: a writ in a contract case, an opinion on employee data, an appeal to a
regional administrative court, a defence brief in a dismissal case, an appeal to the Court of Cassation in a
criminal case. Each citation a lawyer would expect is marked in place, `[[as written|act type|number|year|articles|flag]]`:
90 article citations, 9 acts named without an article, 1 citation outside VisuaLex's sources (the ECHR). The
documents also hold the traps a real brief holds: «art. 7 del contratto», «articolo 12 delle condizioni generali»,
«art. 3 della policy aziendale», «art. 15 del contratto collettivo», a decision number («n. 13533/2001»), «la
costituzione oltre il suddetto termine».

### 3.2 Results

| Path | Found | Wrong or lost in a list | To complete by hand | Missed | Non-norms to dismiss |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today: the page's `extractCitations` | 43 | 5 | — | 42 | — |
| The server's text linker on the whole text (reference only) | 58 | 31 | 1 | 0 | 5 wrong extras |
| **Proposed**: candidates in the browser, `/parse_query`, inheritance within the paragraph | **85** (5 inherited) | **0** | **5** | **0** | 5 |
| Proposed, inheritance across the whole document | 86 (6 inherited) | 0 | 4 | 0 | 5 |

By document, today → proposed (found of total): writ 13 → 20 of 20; opinion on data 3 → 17 of 20; appeal to the
court 6 → 15 of 16; dismissal brief 11 → 16 of 17; criminal appeal 10 → 17 of 17. The opinion on data shows the gap
best: «art. 82 GDPR», «artt. 13 e 14 GDPR» and «art. 4 della legge 20 maggio 1970, n. 300» are read by the search
today and by the page not at all.

The five left to complete are honest gaps, each of which a lawyer settles in a second: «art. 6, paragrafo 1,
lettera c), del Regolamento» (a defined term, «Regolamento», with no number), «art. 46» two paragraphs after the
regulation was named (paragraph scope), «art. 4, comma 1, St. lav.» and «art. 18 del T.U. sicurezza» (two spellings
the server's tables lack, §4.8), «art. 6 T.U.E.» (written for the building code, but «T.U.E.» is also the Treaty on
European Union: it must stay a question). The five non-norms are the four contract clauses and «art. 6 CEDU», which
the page should offer as «Non è una norma».

The 9 acts named without an article are all recognised by the proposed path (0 today, where the page skips them by
design); they matter as the context bare articles inherit.

The page's own client parser agrees with the server on every candidate it reads (60 of the 80 distinct candidate
strings; the other 20 go to the server, as in the search): the one difference is that the server adds the decree's
number to the code of administrative procedure, the same act.

### 3.3 Method, and its limits

- `2026-10-29-document-analysis/measure/` holds the measuring sketch, which is not product code: `corpus.py` turns
  the marked corpus into plain texts and expected citations, `today.test.ts` runs today's matcher as the page calls
  it, `proposed.py` is the proposed path in Python (§4's span rules, then `resolve_alias` → `parse_nl_query` exactly
  as `/parse_query` runs them, then the inheritance), `score.py` scores each path. The commands are in its
  `README.md`. The sketch makes no request and starts no service.
- A citation counts as found when a mark overlaps it with the same article and the same act (a code by its name,
  any other act by type, number and year). Each article of a list counts on its own.
- **The limit that matters:** the corpus and the span rules were written by the same hand, in the same session.
  85/90 is what the rules do on texts their author knew. Before the web PR is merged (§8), a second corpus written
  by someone who has not read §4 — three briefs, or public decisions of the Corte costituzionale — is scored the same
  way, and that figure, not this one, is the one the owners judge.

### 3.4 Against Claude through MCP (G-375)

Not run here: it needs the setup the owners use with LibreLex (mcp-legal-it). The method, so the two figures are
comparable: give each plain document of the corpus (`corpus.py` writes them) to Claude with that MCP server and ask
«Elenca tutte le norme citate in questo documento: per ciascuna l'atto e l'articolo, nell'ordine in cui compaiono.»;
write its answer as the scorer's predictions (one per article, act and article; no positions needed if each answer
names the passage, which the scorer can locate); score with `score.py`. Run it on the blind corpus as well.

## 4. Design: one recognizer

### 4.1 The pipeline

```
browser                                                  server (behind the login, as today)
───────                                                  ──────────────────────────────────
file ─▶ text (as today, never sent)
            │
            ├─ vocabulary ◀───────────── GET /fetch_alias_catalog (names only; once per page)
            ▼
   candidates (§4.3): spans in the text, each with a query string
            │
            ├─ query read by the client parser (user's aliases) ── searchable? ─▶ resolved
            │                                                    no
            ▼                                                     │
   unique query strings, in chunks ───────────────────────────────┴──▶ POST /parse_query {queries:[…]}
            ◀──────────────────────────── [{recognized, parsed}] in order (tables only, no network)
            ▼
   inheritance for bare articles (§4.6), in the browser
            ▼
   list: resolved · from context · to complete · not a norm
```

### 4.2 The vocabulary

The browser cannot find «art. 13 del Testo unico edilizia» without knowing that «Testo unico edilizia» names an act,
and it must not send the text around it to ask. So the names come to the browser, never the document to the server.

- `/fetch_alias_catalog` already sends the preset aliases and the 410 known names. PR 1 adds one list,
  `act_names`: the names that resolve to an identified act (`resolve_alias(name)` gives a type that needs no number,
  or a type with its number). Bare type words — «legge», «decreto legislativo», «d.lgs.» — are left out: they name an
  act only with a number, which §4.3 reads on its own. On the corpus: 419 names.
- The user's own aliases (`useAppStore` `customAliases`) join the vocabulary in the browser, as they join the search.
- The browser builds one pattern from the list, longest name first, each name whole (a letter or a digit may not
  follow), a dot followed by a space or not («cod. civ.», «cod.civ.»), the apostrophe either way.
- Asked once when the page opens (not when the file arrives: the file then waits on nothing), kept for the page's
  life, not stored.

### 4.3 Candidates

A candidate is a span of the text and the query string the browser would type in the search bar for it. Four kinds,
claimed in this order, a character belonging to one candidate at most:

| Kind | Shape | Example | Query string |
| --- | --- | --- | --- |
| article, then act | article head, list, clause, separator, act phrase | «artt. 7 e 8 della legge 7 agosto 1990, n. 241» | `art. 7 e 8 legge 7 agosto 1990, n. 241` |
| act, then article | act phrase, comma, article head, list, clause | «d.lgs. 196/2003, art. 7» | `art. 7 d.lgs. 196/2003` |
| act alone | act phrase | «Regolamento (UE) 2016/679» | `Regolamento (UE) 2016/679` |
| bare article | article head, list, clause | «l'art. 21-octies, comma 2» | — (never sent) |

- **Article head:** «art.», «artt.», «articolo», «articoli», after a non-letter («l'art.», «dell'articolo»).
- **List:** numbers with their suffix («21-octies», «615 ter», «615ter» → `615-ter`, as `toApiArticleNumber`), joined
  by «,» or «e»; «e ss.» / «e seguenti» closes it and marks the first article «e seguenti».
- **Clause:** read and kept for the row («comma 2», «secondo comma», «par. 1», «paragrafo 1», «lett. b)», «lettere
  c) ed e)», «n. 6») — **never put in the query string**. The search's parser reads some clauses and not others
  (§4.8), and the clause is what can make «n. 7» a number of the act.
- **Act phrase:** an EU act (the search's own pattern, `build_eu_act_pattern` / `euCitation.ts`); a numbered act — a
  type word («legge», «l.», «d.lgs.», «decreto legislativo», «d.l.», «decreto-legge», «d.P.R.», «r.d.», «d.m.»,
  «l. cost.») followed by one of the number forms `N/YYYY`, `n. N/YY`, `n. N del YYYY`, `n. N del 7 agosto 1990`,
  `7 agosto 1990, n. N`, `7/8/1990, n. N`; or a name of the vocabulary.
- **Separator:** a comma or spaces, then optionally «del», «della», «dello», «dei», «degli», «delle», «dell'».
- **Cap:** a query string is at most 200 characters (the corpus's longest is 39); a longer span is not a candidate.
- **An act alone in prose** counts only with a capital, a dot or a digit in it: «Costituzione», «GDPR», «MiCA»,
  «d.lgs. 81/2008» — not «la costituzione in giudizio», not «non è mica vero», not «whistleblowing» as a word. In a
  candidate with an article the case does not matter, as in the search.
- **A bare article followed by something else** is marked so: when what follows the clause is «del/della/… <word>»
  that is not «medesimo», «stesso», «citato», «predetto», «suddetto» (with their endings), or a capital, or an
  abbreviation of up to four letters with a dot («St.», «T.U.»), the article names something the page could not
  read — a contract clause, a defined term, an act the tables lack. It is never inherited (§4.6): it goes to «Da
  completare», with what follows shown («seguito da «del contratto»»).

What a candidate is **not**: the words around it. The query string is built from the parts the rules read (the
list, and the act phrase as written, spaces folded); nothing else of the line goes into it.

### 4.4 Resolution: the search's own path

1. **One reading function.** PR 2 takes the client half of `useSearchQuery` out into a pure function
   (`readNormQuery(query, customAliases)`: `parseLegalCitation`, then `isSearchReady`) that the hook and the
   document page both call, and one function that turns `/parse_query`'s `parsed` into a `ParsedCitation` (today
   inline, `useSearchQuery.ts:92-106`). The same string goes through the same code in both places.
2. **Client first.** Each distinct query string is read by the client parser with the user's aliases. Searchable:
   resolved, nothing sent.
3. **Server for the rest.** The others go to the server, each distinct string once, in chunks, one chunk after the
   other.
4. **The answer per candidate:** recognised and searchable → resolved; recognised but not searchable (a type with
   no number), or not recognised → «Da completare», with the reading so far kept for the picker.

**The endpoint (Q1): `/parse_query` with a list.** The body takes `queries: string[]` beside today's `query`:

- at most 200 strings per call, each a non-empty string of at most 200 characters, the body at most 64 KB; anything
  else is a 400 that names the limit;
- each string resolved as today's handler does — `resolve_alias`, then `parse_nl_query` — through one function both
  forms call, so the single and the list cannot drift;
- **no URN, no display, no network**: the list form stops at `parsed`. The URN step can reach Normattiva for each
  string (§2.2); the page needs `parsed` only, as the search does; a citation's URN is built when it is opened;
- the answer is `{"results": [{"recognized": bool, "parsed": {...} | null, "source": "alias" | "nl_parser"}]}`, in
  the order asked;
- `parse_nl_query` and `resolve_alias` are pure regex and table lookups: a call of 200 strings is milliseconds, but it
  runs off the event loop all the same (`asyncio.to_thread`), as `/extract_citations` does;
- one call counts once against the per-address limit (`rate_limit_middleware`, `RATE_LIMIT` per
  `RATE_LIMIT_WINDOW`); the chunk cap is what bounds the work. A document of 300 pages with 2,000 citations has a few
  hundred distinct strings: two or three calls.

Why this and not a new path: the ingress lists the Python paths by prefix (`Caddyfile:107`) and Vite its proxies
(`vite.config.ts:110`); a new path would touch `infra/` and the shared Vite configuration, both reserved areas, for
nothing a list in the body does not do. Why not `/extract_citations`: it takes the whole text (§6), and it reads the
long forms badly (§2.3).

### 4.5 Lists and the rows

A list makes one row per article, each marked on its own number when the list names more than one («artt. 1223 e
1225 c.c.» marks «1223» and «1225», as the matcher's EU lists already do), the act phrase marked with the last of
them. The server answers a list as `article: "1223,1225"`; the browser splits it. «e ss.» is one row, the first
article, labelled «art. 167 e ss.».

### 4.6 Inheritance

A bare article takes the act of the last resolved candidate (with or without an article) **in the same paragraph**
— for a DOCX a line (its reader ends each Word paragraph with one line break), for TXT, Markdown and HTML the text
between two blank lines — and
also across paragraphs when it is followed by «del medesimo decreto», «dello stesso regolamento» and their kin. It
never inherits when §4.3 marked it «followed by something else». An act that cannot be opened (a type with no
number) never becomes the context, as in the linker (`_NUMBERED_ACT_TYPES`).

An inherited citation is drawn as found, with «dal contesto: d.lgs. 231/2002» on its row and a dashed mark in the
text, and «Cambia atto» beside «Apri». It does not wait for a confirmation: the point is seconds, and the row says
where the act came from.

The measure (§3.2) gives 85 with paragraph scope and 86 across the document, both with no wrong one. Across the
document is one more right on this corpus, but the linker's own warning stands («a rhetorical "E l'art. 2043?" after
"legge 241/1990" is read as art. 2043 of that law»): in a brief that moves from one statute to the next, a bare
article three paragraphs on is a guess. Paragraph scope is the recommendation (Q2).

### 4.7 When the server does not answer

The catalog or a chunk fails (a network error, 8 seconds with no answer, a 429, a 5xx):

- the page runs today's matcher over the text, as today, and lists what it finds; the bare articles the candidate
  rules found are listed «Da completare», so completion by hand still works (the picker reads with the client parser
  and the palette's act list, both local);
- a line above the list says so: «VisuaLex non risponde: ho riconosciuto solo le forme che conosco nel browser.»
  with «Riprova», which asks the server again for what is still unresolved;
- a chunk that failed is not retried by itself, and nothing is lost: what was resolved stays.

### 4.8 What the measure taught the search

Found by probing `/parse_query`'s resolution with the corpus's citations as a lawyer would type them; each is a
defect of the search today, fixed in PR 1, and each reaches the document page through §4.4:

- **«art. 4, n. 7, GDPR» reads as regulation number 7** (`_ACT_NUM_DATE_PATTERNS`' «n. N» wins over the alias's
  number). A wrong norm, not a missing one. The page avoids it by leaving clauses out of the query (§4.3); the search
  must stop doing it: a «n. N» right after an article and its clause is the article's number, not the act's.
- **«art. 82, par. 1, GDPR» and «art. 360, primo comma, n. 3, c.p.c.» are not recognised**: `_COMMA_CLAUSE_RE`
  knows «comma», «co.», «c.», not «par.», «paragrafo», an ordinal before «comma», or «n. N» after it. The linker's
  `_COMMA_CLAUSE_SOURCE` reads more; the two become one source.
- **Two spellings missing from the tables:** «St. lav.» (statuto dei lavoratori) and «T.U. sicurezza» (d.lgs.
  81/2008), added to `preset_aliases.yaml`. Not «T.U.E.»: it is also the Treaty on European Union, and an ambiguous
  name is left unread rather than guessed (`act_resolver`'s rule).
- **Outside the sources:** the ECHR and the Charter of Fundamental Rights are not in the tables; a citation of them
  is «Da completare» and the picker cannot complete it. Whether the page should say «fuori dalle fonti di VisuaLex»
  for them is a later question; not in this spec.

## 5. Completion by hand

The web side builds it, with the web owner's agreement on the screens and the words.

### 5.1 The list

- The count line becomes «24 citazioni in 6 atti · 3 da completare».
- **«Da completare (3)»** is the list's first group when it has rows. Each row: the article as read («art. 46»), the
  passage around it (`citedPassage`, as today), and «Completa» where the other rows have «Apri». A row «followed by
  something else» shows it under the passage («seguito da «del contratto»») and has «Non è una norma» in its menu.
- The act groups follow as today. A row completed by hand moves into its act's group with «scelto da te»; an
  inherited row carries «dal contesto: …».
- **«Non sono norme (2)»**, collapsed, at the end: the rows the user dismissed, each with «Ripristina».

### 5.2 The context

Selecting a «Da completare» row does what selecting any row does — the text column scrolls to its mark and the mark
pulses once — and the picker opens with the passage at its top, longer than the row's: the whole sentence, up to
240 characters each side, within the paragraph, the citation in bold. On a phone, where the columns are stacked,
the picker covers the text, so the passage at its top is the context.

### 5.3 The picker

- **A field that reads like the search.** The user types the act as in the search bar — «l. 241/1990», «gdpr»,
  «testo unico edilizia», «codice del consumo» — and the field reads it with the same function as the search
  (§4.4: client first, `/parse_query` for one string as the search does, 250 ms after typing stops), the reading
  shown under the field in the convention's words («Legge 7 agosto 1990, n. 241»). The article is the row's: the
  user names only the act. «Scegli» is enabled when the reading, with the article, is searchable.
- **The document's acts first.** Under the field, before anything is typed: «Atti citati in questo documento», the
  resolved acts, the nearest one above the citation first, then the rest in the order of the document. One tap picks
  one. This is the common case the owner described («spesso magari sarà anche lo stesso»).
- **Then the palette's acts.** «Scegli l'atto» as the palette lists it (`search/paletteActs.ts`), filtered by what is
  typed, for a code named by its name.
- **Offline,** the field reads with the client parser only and says so; the document's acts and the palette's list
  need no server.

### 5.4 Applying

When an act is chosen, the picker asks where it goes, with the counts:

- «Solo a questa citazione»;
- «Anche alle altre 3 «art. 5» da completare» — the identical ones: the same article, written the same way once
  spaces and case are folded — the default when there are any;
- «A tutte le 12 da completare».

«Applica» applies; the rows move to the act's group; a notice at the foot says «Atto applicato a 4 citazioni» with
«Annulla» for 8 seconds, which puts all four back. A row completed by hand has «Cambia atto» and «Torna da
completare» in its menu.

### 5.5 What the choices are

They live in the page's memory, for this document: never sent (§6), never stored, gone with «Scegli un altro
documento» or a reload. Whether they should survive a reload is Q4.

### 5.6 Phone, keyboard, tokens

- **Phone (below `lg`):** the picker is a sheet from the bottom, the full width, at most 85% of the height, its own
  body scrolling; every row and button 44 px high; the field's text 16 px (iOS zooms below that); no horizontal
  scroll at 320 px, a long act name wrapping (`[overflow-wrap:anywhere]`). The list stays above the text, as today.
- **Computer:** a dialog anchored to the row (`shadow-lg`, as windows and dialogs), the text column visible beside it.
- **Keyboard:** «Completa» opens the picker with the focus in the field; the arrows move through the acts, Enter
  picks, a second Enter applies with the default scope; Esc closes and the focus returns to the row. The live region
  says «Atto applicato a 4 citazioni» and, on «Annulla», «Annullato».
- **Inchiostro** (`apps/web/CLAUDE.md`, Y1): «Completa», «Applica» and the focus in `primary-*`; the rows, passages,
  tags and the «Non sono norme» group in `slate-*`. In the text, a resolved citation keeps today's solid underline, an
  inherited one is dashed, one to complete is dotted in `slate-400`. The «Da completare» heading's count is the one
  colour the page adds: `amber-50`/`amber-800` (dark: `amber-950/40`/`amber-300`), the badge's shape — the web owner
  decides it. No text under 11 px; reduced motion moves nothing.

## 6. What leaves the computer

### 6.1 What is sent, and what is not

- **Comes in:** the vocabulary (§4.2), names only, the same for every user.
- **Goes out:** the query strings of the candidates the client parser could not resolve, each at most 200
  characters, each distinct string once, in a POST body (never in an address), behind the login (the ingress asks
  the server before it lets `/parse_query` through, `Caddyfile:106-120`, which also caps a body at 1 MB). They are what the user would type in the
  search bar, built only from the citation's own words (§4.3).
- **Never goes out:** the document, a passage, a clause, the words around a citation, the file's name, the count of
  citations, a bare article, a choice made in the picker. While the user types in the picker's field, what is typed
  goes to `/parse_query` as in the search: an act name, typed by the user.

### 6.2 What the server keeps of them

Checked on the code as it stands:

- `log_query_stats` (`app.py:374`) logs the path, method, duration and a token count of the **answer** — not the
  request body;
- `parse_query` logs only on failure (`str(e)`, `app.py:1108`); the URN step logs the parsed norm («Creating
  NormaVisitata from data», `app.py:462`), which the list form skips;
- nothing on the resolution path is cached or written to the history (`add_to_history` is called by the fetch
  routes only);
- the ingress writes no access log (no `log` directive in `Caddyfile`), and would log addresses, not bodies.

PR 1 keeps it so: the list form logs the number of strings and the duration, nothing else, and a test runs the
handler with `caplog` and asserts that no query string appears in any record.

### 6.3 The risk, said plainly

The norms a document cites say what it is about. «art. 609-bis c.p.», «art. 4 l. 300/1970» and «art. 2087 c.c.»
together tell a reader the subject of a brief without a word of it. The proposal sends no more than a lawyer would
send by searching those norms one by one — which VisuaLex receives today, in the same way, for every search — but it
sends them in one go, for a document the user may consider confidential. Two consequences:

- the page must say it (§6.4), not imply that nothing leaves;
- the user should be able to keep a sensitive document wholly local: a switch «Riconosci solo nel browser» on the
  page, which runs today's matcher and the candidate rules with the client parser only (as §4.7, by choice) — Q3.

### 6.4 The words of the promise (the web owner decides)

Proposed, to replace the three that are true today and would not be:

- line under the title: «Trova le norme citate in un atto. Il documento resta sul tuo computer: a VisuaLex arrivano
  solo le citazioni trovate, come in una ricerca.»
- badge: «Il documento resta sul tuo computer» with, for a screen reader and on hover: «Il testo del documento non
  viene inviato né salvato. Le sole citazioni trovate (per esempio «art. 82 GDPR») vengono riconosciute da VisuaLex,
  come quando le cerchi.»
- box: «Il documento resta sul tuo computer».
- with the switch on (Q3): badge «Tutto nel tuo browser», line «Il riconoscimento è più limitato: VisuaLex non riceve
  nulla.»

The PDF refusal («Il file non è stato inviato al server») stays true and stays.

## 7. Phase 2: the corrections as a source of data (a proposal only)

The owner called the pairs a lawyer completes by hand «una bella eventualmente fonte dati»: each says how lawyers
write a norm that VisuaLex could not read («art. 4 St. lav.» → legge 300/1970, art. 4). Gathered, they are the list of
spellings the tables lack, ordered by how often they are written — the most direct way to widen the recognizer.

**What would be sent**, only with consent: the string as written (the query string of §4.3, or the bare article and
the words §4.3 showed after it, «del Regolamento»), and the act chosen. **Never**: the document, a passage, the
file's name, a link between two pairs of the same document, a document identifier, a time finer than the day.

**How it would work, as a sketch:** an opt-in in the settings («Aiuta VisuaLex a riconoscere più citazioni»), off by
default, with its own words of consent and its date; after «Applica», a pair is queued in the browser and sent in a
batch when the page is left, without the user's id in the stored row (an aggregate count per spelling, with the day);
a reviewer — an owner or a validator — turns frequent spellings into entries of `preset_aliases.yaml` by hand, never
automatically; the user can see and export what they sent, and withdraw.

**Open questions, for the owners:**

1. Pseudonymous or anonymous: does a row keep any link to the account (needed for export and withdrawal), or only
   an aggregate (no export possible, no personal data)?
2. Retention: how long a raw pair is kept once it has been reviewed or discarded.
3. Can a spelling itself be personal or confidential («art. 3 del contratto Alfa-Beta» completed by mistake)? A
   reviewer sees everything: who reviews, and under what duty.
4. The legal basis and the notice: consent (as the MERL-T consent ladder) or legitimate interest; where the notice
   lives; whether the privacy policy changes.
5. Does it wait for the 2.0 (the first public alpha), or start with the owners as the only senders?

Recommendation: decide after phase 1 has run for a few weeks with the owners using it; start with an aggregate
count per spelling and the chosen act, no account link, opt-in, reviewed by an owner. The migration would be one
table; not reserved now.

## 8. The pull requests, in order

| # | Area | What | Size |
| --- | --- | --- | --- |
| 1 | Python API | `/parse_query` takes `queries` (§4.4), one resolving function for both forms, no URN in the list form, limits and their 400s, logging test (§6.2); `/fetch_alias_catalog` adds `act_names` (§4.2); the clause fixes and the two spellings (§4.8) with tests from the corpus's strings; `services/visualex/CLAUDE.md` updated | M: ~250 lines and their tests |
| 2 | Web, logic | `readNormQuery` out of `useSearchQuery` (the hook unchanged in behaviour, its tests green); `documentCandidates.ts` (§4.3) and the resolution and inheritance (§4.4–§4.6), pure, tested on the corpus with recorded server answers; the corpus test prints §3.2's table and fails below the agreed floor; the fallback (§4.7); the page calls it, the list unchanged in look but for the counts | L: ~600 lines and their tests |
| 3 | Web, screens | «Da completare», the picker, applying and undo, «Non sono norme», the inherited and hand-chosen tags, phone and keyboard (§5); the promise's new words (§6.4) and the switch if Q3 is yes; `apps/web/CLAUDE.md`'s «no request at all» rewritten; a browser pass on the corpus's documents | L |
| 4 | Both | Phase 2, only if the owners decide it (§7) | — |

PR 1 can merge on its own: the search gains from it at once. PR 2 needs PR 1 deployed for its server half and falls
back without it (§4.7). PR 3 needs PR 2. The blind corpus (§3.3) and the MCP comparison (§3.4) are run before PR 3
merges.

## 9. Questions for the owners

1. **The endpoint.** `/parse_query` with a list in the body, or a new path? *Recommendation:* the list on
   `/parse_query` — same resolution by construction, no change to the ingress or to Vite (§4.4).
2. **How far a bare article inherits.** Within its paragraph (plus «del medesimo decreto»), across the whole
   document, or never (all to complete)? *Recommendation:* the paragraph, drawn «dal contesto» and changeable in
   one tap: 85 of 90 found with no wrong one, and no guess three paragraphs on (§4.6).
3. **A switch to stay wholly local.** *Recommendation:* yes, «Riconosci solo nel browser», off by default and said
   in the page's words: the norms a document cites can reveal its subject (§6.3), and a lawyer should be able to
   choose for a sensitive file.
4. **Should hand choices survive a reload?** *Recommendation:* not in phase 1 — kept in memory, and the browser asks
   before the page is left while there are choices (`beforeunload`). Storing them on the device would mean storing a
   trace of the document; that is a decision of its own.
5. **The words of the promise** (§6.4) are the web owner's. *Recommendation:* say what goes out with an example («per
   esempio «art. 82 GDPR»»), as proposed.
6. **The bar of G-375.** *Recommendation:* the page goes when, on the blind corpus, it finds at least as many as
   Claude through MCP with no more wrong ones, counting a citation completed by hand as found only if the page put it
   in «Da completare» (it found the place, the user named the act).
7. **Phase 2** (§7): go or no, and the five questions there. *Recommendation:* decide after a few weeks of phase 1;
   if go, aggregate counts, opt-in, no account link.
8. **The blind corpus.** Who writes it? *Recommendation:* three briefs by the other owner or a validator, plus two
   public decisions of the Corte costituzionale, never a client's document.
