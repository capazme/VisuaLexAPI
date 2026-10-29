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
`act_resolver.py`), the scraping quota (`apps/server/src/middleware/scrapeGate.ts`), the source convention
(`conventions/sources/`).
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
  norm in reading**. The matcher (`utils/citationMatcher.ts`) has eight pattern blocks (0, with 0a and 0b; 1a; 1b; 1;
  2; 3; 4; 5); the last two, bare «art. 5» and «artt. 8 e 9», run only with a norm in reading
  (`citationMatcher.ts:508`, `:569`), so on this page **a bare article is never found**. It is not listed as unknown:
  it is not there.
- Pattern 2 (`citationMatcher.ts:450`, «artt. 1 e 2 c.c.») keeps the **first article only** (`:467`): «artt. 1223 e
  1225 c.c.» lists art. 1223 and loses art. 1225.
- Patterns 1a and 1 read a numbered act only as `N/YYYY` (`NATIONAL_ACT_SOURCE`, `:154`, with `\d+\s*[/\\]\s*(\d{4}|\d{2})`):
  «legge 7 agosto 1990, n. 241» and «l. n. 300 del 1970», the forms of every brief, are not read.
- The matcher knows no alias: «art. 82 GDPR», «art. 13 del Testo unico edilizia», «art. 18 dello statuto dei
  lavoratori» are not found, though the search reads all three.
- `readDocx` reads `word/document.xml` only: a DOCX's footnotes and endnotes, where an opinion often puts its
  citations, are not read today, and this spec does not change that (§8, a follow-up).
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
  searchable (`isSearchReady`), the server's `/parse_query`, 250 ms after typing stops. The client's reading wins
  when it is already searchable; otherwise the server fills in.
- `isSearchReady` (`citationParser.ts:678`) requires an article, and a number and a date for the types in
  `ACT_TYPES_REQUIRING_DETAILS` (`constants/actTypes.ts:61-66`). That list lacks the decreto ministeriale and the
  DPCM, and spells the EU types in capitals («Regolamento UE») where the server answers «regolamento ue»: the server's
  reading of «art. 2 d.m.» — a decreto ministeriale with no number — passes it, though it cannot be opened.
- `/parse_query` as served (`services/visualex/app.py:1043`, routed by the ingress, `infra/ingress/Caddyfile:107`,
  and by Vite in development, `vite.config.ts:110`) runs `resolve_alias` (the preset aliases of `preset_aliases.yaml`,
  then `act_resolver.resolve_atto`) and then `nl_parser.parse_nl_query`. **It then builds a URN and a display line**
  through `create_norma_visitata_from_data`, which may complete a year into a date and read an article range on
  Normattiva (`urngenerator.complete_request_date`, `text_op.parse_article_input` → `get_tree`): a network call per
  query, and info-level log lines carrying the parsed norm (`app.py:462`, `:507`, `:516`, `:519`), which in
  development also go to the file `visualex_api.log` (`visualex_api/tools/logging_config.py:22-25`). The search uses
  only `parsed` from the answer.
- `services/visualex/visualex_api/app.py` holds a twin of the routes under `/api/` (its `parse_query` builds no URN).
  The ingress and Vite route the root app (`asgi.py`). This spec changes the root app; the twin is left as it is.
- `/parse_query` has other callers, which PR 1's parser fixes (§4.8) reach as well: the server's reference resolver
  (`apps/server/src/norms/resolveReference.ts:122`), MERL-T's client (`services/merlt/merlt/clients/visualex_client.py:206`)
  and the MERL-T contribution picker (`apps/web/src/features/merlt/contrib/NormaPicker.tsx:63`).
- `/fetch_alias_catalog` (`app.py:1548`) already hands the browser, behind the login, the preset aliases (an object,
  trigger → act parameters) and `known_act_names()` (410 names: the hand-checked acts, the named acts, the codes and
  the 151 keys of `NORMATTIVA_SEARCH`, bare type words such as «legge», «l.», «d.lgs.» among them).
- The scraping routes cost a user points of a quota on the Node server, which the ingress asks before it lets a
  request through (`scrapeGate.ts`, 300 points a minute, `/parse_query` 1 point, `DEFAULT_SCRAPE_COSTS`); the Python
  app keeps its own per-address limit besides (`rate_limit_middleware`).

### 2.3 The server's text linker

`citation_linker.extract_citations` (`/extract_citations`) reads a whole text and lets a bare article inherit the
last act named before it; MERL-T calls it (the web reader marks citations with `citationMatcher` in the browser). For
documents it would mean sending the whole text, and it does worse than the page's matcher on what it reads: of its
34 wrong in §3.2, some are lists cut to their first article, about ten are bare articles that inherit the wrong act
across the document («art. 28 GDPR» → d.lgs. 196/2003), and the rest are the long forms of a numbered act, read with
no number («art. 3 della legge 15 luglio 1966, n. 604» → an article of «legge»). It is not the recognizer this page
needs.

## 3. Measure

### 3.1 The corpus

Six documents written for this spec, invented from start to end (no client's, no real party), in
`2026-10-29-document-analysis/corpus/`: a writ in a contract case, an opinion on employee data, an appeal to a
regional administrative court, a defence brief in a dismissal case, an appeal to the Court of Cassation in a
criminal case, and a statement of defence written as a DOCX reads (one line per paragraph, headings in capitals).
Each citation a lawyer would expect is marked in place, `[[as written|act type|number|year|articles|flag]]`: 103
article citations, 9 acts named without an article, 1 citation outside VisuaLex's sources (the ECHR).

The documents hold the forms a brief holds — «art. 1453, comma 1, c.c.», «artt. 7 e 8 della legge 7 agosto 1990, n.
241», «art. 82 GDPR», «art. 13 del Testo unico edilizia», «artt. 1362-1371 c.c.», «art 2043 c.c.» with no dot,
«Regolamento (UE) 2016/679, art. 9», «codice civile, art. 1337», «l'art. 21-octies, comma 2» after the act — and its
traps: «art. 7 del contratto», «articolo 12 delle condizioni generali», «art. 3 della policy aziendale», «art. 15 del
contratto collettivo», «l'art. 5 dell'accordo individuale», a decision number («n. 13533/2001»), «la costituzione
oltre il suddetto termine», a heading «COSTITUZIONE IN GIUDIZIO» and a line «Costituzione del convenuto: … l'art.
167», «La CTU ha accertato che … l'art. 2087» («CTU» is also the code of tourism's acronym), «CAP 00100», «il TUA
non rileva», «in materia di smart working, art. 4 dell'accordo individuale», «Come rilevato dalla CTU, art. 3 della
relazione», «quanto alla costituzione, art. 5 del contratto di consulenza».

### 3.2 Results

| Path | Found | Wrong or lost in a list | To complete by hand | Missed | Non-norms to dismiss |
| --- | ---: | ---: | ---: | ---: | ---: |
| Today: the page's `extractCitations` | 49 | 5 | — | 49 | — |
| The server's text linker on the whole text (reference only) | 66 | 34 | 3 | 0 | 9 wrong extras |
| **Proposed**: candidates in the browser, the server's resolution, inheritance within the paragraph | **96** (7 inherited) | **0** | **7** | **0** | 9 |
| Proposed, inheritance across the whole document | 97 (8 inherited) | 0 | 6 | 0 | 9 |

By document, today → proposed (found of total): writ 13 → 20 of 20; opinion on data 3 → 17 of 20; appeal to the
court 6 → 15 of 16; dismissal brief 11 → 16 of 17; criminal appeal 10 → 17 of 17; statement of defence 6 → 11 of
13. The opinion on data shows the gap best: «art. 82 GDPR», «artt. 13 e 14 GDPR» and «art. 4 della legge 20 maggio
1970, n. 300» are read by the search today and by the page not at all.

The seven left to complete are honest gaps, each settled by a lawyer in a second:

- «art. 6, paragrafo 1, lettera c), del Regolamento» and «art. 13 del Regolamento»: a defined term with no number;
- «art. 46» two paragraphs after the regulation was named (paragraph scope, §4.6);
- «art. 4, comma 1, St. lav.» and «art. 18 del T.U. sicurezza»: two spellings the server's tables lack (§4.8);
- «art. 6 T.U.E.», written for the building code; the browser's vocabulary has no dotted «T.U.E.», so it is not
  sent — but the server would read it as the Treaty on European Union (§4.8);
- «art. 167» under the heading «COSTITUZIONE IN GIUDIZIO»: no act in its paragraph, and «Costituzione» alone is not
  taken as the context (§4.3) — read as the Constitution it would have been wrong.

The nine non-norms are the eight clauses of contracts, agreements, a policy and an expert's report, and «art. 6
CEDU», which the page offers as «Non è una norma»; «Come rilevato dalla CTU, art. 3 della relazione» and «quanto alla
costituzione, art. 5 del contratto» are among them, not read as the code of tourism or the Constitution (§4.3). «La CTU ha accertato che … l'art. 2087» inherits the codice civile named before it, not the code of
tourism. The 9 acts named without an article are all recognised (0 today, where the page skips them by design);
they matter as context. «GDPR» in «(di seguito, GDPR)» is not a candidate at all: an acronym alone is never
context (§4.3).

The candidates on the corpus: 78 «article, then act», 4 «act, then article», 9 «act alone» used as context, 23 bare
articles. The page's client parser reads 67 of the 87 distinct query strings as searchable and agrees with the
server on all of them but four, where the server adds the decree's number to the code of administrative procedure
(the same act); the other 20 go to the server, as in the search.

### 3.3 Method, and its limits

- `2026-10-29-document-analysis/measure/` holds the measuring sketch, which is not product code: `corpus.py` turns
  the marked corpus into plain texts and expected citations, `proposed.py` is the proposed path in Python (§4's
  candidate rules, then `resolve_alias` → `parse_nl_query` exactly as `/parse_query` runs them, then the
  inheritance), `today.test.ts` runs today's matcher as the page calls it and the client parser on the query strings,
  `score.py` scores each path and compares the client with the server. The commands are in its `README.md`. The
  sketch makes no request and starts no service.
- A citation counts as found when a mark overlaps it with the same article and the same act (a code by its name,
  any other act by type, number and year). Each article of a list counts on its own; a range counts once.
- The sketch reads plain text: it does not exercise the HTML and DOCX readers (§4.6's paragraphs), nor the client
  half of the resolution on the act phrases (it sends every candidate to the server's functions).
- **The limit that matters:** the corpus and the candidate rules were written by the same hand, and the rules were
  corrected after an independent review added traps to the corpus. 96 of 103 is what the rules do on texts their
  author knew. Before the web PR is merged (§8), a second corpus written by someone who has not read §4 — three briefs,
  one of them HTML, one a DOCX with footnotes, plus public decisions of the Corte costituzionale — is scored the same
  way, and that figure, not this one, is the one the owners judge.

### 3.4 Against Claude through MCP (G-375)

Not run here: it needs the setup the owners use with LibreLex (mcp-legal-it). The method, so the two figures are
comparable: give each plain document of the corpus (`corpus.py` writes them) to Claude with that MCP server and ask
«Elenca tutte le norme citate in questo documento: per ciascuna l'atto e l'articolo, nell'ordine in cui compaiono.»;
write its answer as the scorer's predictions, each with the passage it names located in the text; score with
`score.py`. Run it on the blind corpus as well.

## 4. Design: one recognizer

### 4.1 The pipeline

```
browser                                                  server (behind the login in production)
───────                                                  ──────────────────────────────────────
file ─▶ text (as today, never sent)
            │
            ├─ vocabulary ◀───────────── GET /fetch_alias_catalog (names only; once per page)
            ▼
   candidates (§4.3): spans in the text, each with a query string
            │
            ├─ read by the client parser (user's aliases) ── identifies the act? ─▶ resolved
            │                                                 no
            ▼                                                  │
   distinct query strings, in chunks ──────────────────────────┴──▶ POST /parse_query_batch {queries:[…]}
            ◀──────────────────────────── [{recognized, parsed}] in order (tables only, no network)
            ▼
   inheritance for bare articles (§4.6), in the browser
            ▼
   list: resolved · from context · to complete · not a norm
```

### 4.2 The vocabulary

The browser cannot find «art. 13 del Testo unico edilizia» without knowing that «Testo unico edilizia» names an act,
and it must not send the text around it to ask. So the names come to the browser, never the document to the server.

- `/fetch_alias_catalog` already sends the preset aliases and the known names. PR 1 adds one list, `act_names`: the
  names, of both, that identify an act (§4.4's predicate on `resolve_alias(name)`). Bare type words — «legge»,
  «decreto legislativo», «d.lgs.», «dpcm» — are left out: they name an act only with a number, which §4.3 reads on its
  own. With today's tables: 415 names.
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

- **Article head:** «art.», «artt.», «articolo», «articoli», after a non-letter («l'art.», «dell'articolo»); «art» and
  «artt» with no dot only when a digit follows («art 2043 c.c.», as the matcher's pattern 3 reads it today).
- **List:** numbers with their suffix («21-octies», «615 ter», «615ter» → `615-ter`, as `toApiArticleNumber`), or a
  range («1362-1371»), joined by «,» or «e»; «e ss.» / «e seguenti» closes it and marks the first article «e
  seguenti».
- **Clause:** read and kept for the row («comma 2», «secondo comma», «par. 1», «paragrafo 1», «lett. b)», «lettere
  c) ed e)», «n. 6») — **never put in the query string**. The search's parser reads some clauses and not others
  (§4.8), and the clause is what can make «n. 7» a number of the act.
- **Act phrase:** an EU act (the search's own pattern, `build_eu_act_pattern` / `euCitation.ts`); a numbered act — a
  type word («legge», «l.», «d.lgs.», «decreto legislativo», «d.l.», «decreto-legge», «d.P.R.», «r.d.», «d.m.»,
  «d.p.c.m.», «l. cost.») followed by one of the number forms `N/YYYY`, `n. N/YY`, `n. N del YYYY`, `n. N del 7
  agosto 1990`, `7 agosto 1990, n. N`, `7/8/1990, n. N`; or a name of the vocabulary.
- **Separator:** a comma or spaces, then optionally «del», «della», «dello», «dei», «degli», «delle», «dell'».
- **Cap:** a query string is at most 200 characters (the corpus's longest is 39); a longer span is not a candidate.
- **An act named alone becomes context** (§4.6) only when it is a numbered or an EU act, or a vocabulary name that
  opens with an act word («codice», «cod.», «legge», «l.», «decreto», «testo unico», «t.u.», «regolamento»,
  «direttiva», «statuto», «disp.», «ordinamento»): «d.lgs. 81/2008», «Codice privacy», «statuto dei lavoratori».
  Never a short acronym alone — «CTU», «CAP», «TUA», «COM», «Dora», «GDPR» are also words of a brief, or read as
  another act — and never a subject the presets list («smart working», «affido condiviso», «unioni civili»). A
  capital at the start of a sentence or in a heading proves nothing («COSTITUZIONE IN GIUDIZIO»). In a candidate
  «article, then act» every vocabulary name counts, whatever its case, as in the search («art. 82 GDPR»).
- **An act before an article** («act, then article») is held to the same rule as an act alone, and the article must
  not go on with «del/della/… <word>»: «Come rilevato dalla CTU, art. 3 della relazione» and «quanto alla
  costituzione, art. 5 del contratto» are a bare article each, which §4.3's next rule sends to «Da completare».
- **A bare article followed by something else** is marked so: when what follows the clause is «del/della/… <word>»
  that is not «medesimo», «stesso», «citato», «predetto», «suddetto» (with their endings), or a capital, or an
  abbreviation of up to four letters with a dot («St.», «T.U.»), the article names something the page could not
  read — a contract clause, a defined term, an act the tables lack. It is never inherited (§4.6): it goes to «Da
  completare», with what follows shown («seguito da «del contratto»»).

What a candidate is **not**: the words around it. The query string is built from the parts the rules read (the
list, and the act phrase as written, spaces folded); nothing else of the line goes into it.

### 4.4 Resolution: the search's own path

1. **One predicate, one table.** «Identifies an act»: a type that needs no number, or a type with its number, the
   type compared with its case folded. «Searchable»: identifies an act, and has an article. The types that need a
   number are one list — today two that disagree, `ACT_TYPES_REQUIRING_DETAILS` on the web and
   `_NUMBERED_ACT_TYPES` in the linker, and none in the parser — written once in `conventions/sources/` beside the
   golden file, with the decreto ministeriale and the DPCM in it. The Python image does not carry `conventions/`
   (`tar_seats.py` keeps its own copy for that reason), so each side keeps a copy — the linker's and the web's — and
   each side's suite has a test that compares its copy with the convention's file, as the golden is compared today.
   `isSearchReady` is rewritten on the web's copy, so the search stops offering «art. 2 d.m.» as searchable.
2. **One reading function.** PR 2 takes the client half of `useSearchQuery` out into a pure function
   (`readNormQuery(query, customAliases)`) that the hook and the document page both call, and one function that turns
   the server's `parsed` into a `ParsedCitation` (today inline, `useSearchQuery.ts:92-106`). The same string goes
   through the same code in both places.
3. **Client first.** Each distinct query string is read by the client parser with the user's aliases. When the
   reading identifies the act (and, for a candidate with articles, is searchable), it is resolved and nothing is sent.
4. **Server for the rest,** each distinct string once, in chunks, one after the other.
5. **The answer per candidate:** identifies the act → resolved (with its articles, or as context for an act alone);
   otherwise «Da completare», the reading so far kept for the picker.

**The endpoint (Q1): a new path, `/parse_query_batch`.**

- The body is `{"queries": [string, …]}`: at most 200 strings, each non-empty and at most 200 characters, the body
  at most 48 KB encoded; the browser cuts its chunks by count and by bytes (accented letters and JSON escapes make 200
  strings of 200 characters more than 48 KB). Anything else is a 400 that names the limit.
- Each string is resolved by the function `/parse_query` uses for its first half — `resolve_alias`, then
  `parse_nl_query` — taken out of the handler so the two routes cannot drift.
- **No URN, no display, no network:** the batch stops at `parsed`. The URN step reaches Normattiva and logs the norm
  (§2.2); the page needs `parsed` only, as the search does; a citation's URN is built when it is opened.
- The answer is `{"results": [{"recognized": bool, "parsed": {...} | null, "source": "alias" | "nl_parser"}]}`, in
  the order asked.
- `parse_nl_query` and `resolve_alias` are regex and table lookups (200 hostile strings take about 0.1 s), run off
  the event loop all the same (`asyncio.to_thread`), as `/extract_citations` is.
- **Its price:** the quota sees the path, not the body (`scrapeCost` reads the forwarded URI). A path of its own gets
  a price of its own in `DEFAULT_SCRAPE_COSTS` — proposed 3 points a call: a document of 300 pages with a few hundred
  distinct strings costs a handful of calls, and nobody can resolve 200 strings for the price of one search. That
  file is authentication's area and its owner reviews the change.
- **Routing:** the ingress matches `/parse_query*` and Vite proxies by prefix (`startsWith`), so the new path is
  routed by both with no change to `infra/` or to the Vite configuration, and the ingress's path test
  (`infra/ingress/paths.test.mjs`, which compares the two by prefix) holds as it is. The web calls it through
  `legalFetch`, as every scraping route (`legalFetch.guard.test.ts`).

Why not a list in `/parse_query`'s body: it would cost one point whatever its size, and keep in one handler a form
that reaches the network and one that must not. Why not `/extract_citations`: it takes the whole text (§6), and it
reads worse (§2.3).

### 4.5 Lists and the rows

A list makes one row per article, each marked on its own number when the list names more than one («artt. 1223 e
1225 c.c.» marks «1223» and «1225», as the matcher's EU lists already do), the act phrase marked with the last of
them. The server answers a list as `article: "1223,1225"`; the browser splits it. A range is one row («artt.
1362-1371 c.c.»), opened as the search opens a range. «e ss.» is one row, the first article, labelled «art. 167 e
ss.».

### 4.6 Inheritance

A bare article takes the act of the last resolved candidate in **the same paragraph**, and also across paragraphs
when it is followed by «del medesimo decreto», «dello stesso regolamento» and their kin. It never inherits when §4.3
marked it «followed by something else», and an act named alone is context only under §4.3's rule. An act that does
not identify itself (a type with no number) never becomes the context, as in the linker (`_NUMBERED_ACT_TYPES`).

**A paragraph is a line** of the text as read, in every format. The DOCX reader already ends each Word paragraph
with one line break (`documentFile.ts`), and also a manual line break (`<w:br/>`): such a break cuts the paragraph,
which can only leave more to complete, never inherit wrongly. The HTML reader today takes `body.textContent`, which
puts no break between two `<p>`: PR 2 makes it end each block element (`p`, `div`, `li`, `h1`–`h6`, `tr`,
`blockquote`, `br`) with a line break — the drawn text gains line breaks, nothing else, and documents carry no
anchors. A TXT or Markdown file with hard-wrapped lines cuts its paragraphs at each line: fewer inherited, more to
complete, nothing wrong.

An inherited citation is drawn as found, with «dal contesto: d.lgs. 231/2002» on its row and a dashed mark in the
text, and «Cambia atto» beside «Apri». It does not wait for a confirmation: the point is seconds, and the row says
where the act came from.

The measure (§3.2) gives 96 with paragraph scope and 97 across the document, both with no wrong one. Across the
document is one more right on this corpus, but the linker's own warning stands («a rhetorical "E l'art. 2043?" after
"legge 241/1990" is read as art. 2043 of that law»), and its measured errors are that: in a brief that moves from one
statute to the next, a bare article three paragraphs on is a guess. Paragraph scope is the recommendation (Q2).

### 4.7 When the server does not answer

The catalog or a chunk fails (a network error, 8 seconds with no answer, a 429, a 5xx):

- what was resolved stays; for the candidates left unresolved, the page runs today's matcher over the text and keeps
  only its matches that fall inside those candidates' spans, so nothing is listed twice; the bare articles go to «Da
  completare», so completion by hand still works (the picker reads with the client parser and the palette's act list,
  both local);
- without the catalog, the candidates are found with the client's own act names (`citationParser.ts`) and the user's
  aliases: fewer, nothing wrong;
- a line above the list says so: «VisuaLex non risponde: ho riconosciuto solo le forme che conosco nel browser.»
  with «Riprova», which asks again for what is still unresolved; a failed chunk is not retried by itself.

### 4.8 What the measure taught the search

Found by probing the server's resolution with the corpus's citations as a lawyer would type them; each is a defect
of the search today, fixed in PR 1, and each reaches the document page through §4.4:

- **«art. 4, n. 7, GDPR» reads as regulation number 7** (`_ACT_NUM_DATE_PATTERNS`' «n. N» wins over the alias's
  number). A wrong norm, not a missing one. The page avoids it by leaving clauses out of the query (§4.3); the search
  must stop doing it: a «n. N» right after an article and its clause is the article's number, not the act's.
- **«art. 82, par. 1, GDPR» and «art. 360, primo comma, n. 3, c.p.c.» are not recognised:** `nl_parser`'s
  `_COMMA_CLAUSE_RE` knows «comma», «co.», «c.», not «par.», «paragrafo», an ordinal before «comma», or «n. N» after
  it; the linker's `_COMMA_CLAUSE_SOURCE` reads ordinals and «n. N» but not «par.» either. PR 1 writes one clause
  source with all of them, used by both.
- **Two spellings missing from the tables:** «St. lav.» (statuto dei lavoratori) and «T.U. sicurezza» (d.lgs.
  81/2008), added to `preset_aliases.yaml`.
- **«T.U.E.» is read as the Treaty on European Union** today (`act_resolver`'s dotted acronyms, `_DOTTED_ACRONYM`,
  fold «t.u.e.» into «tue»), and the corpus writes it for the building code, as lawyers do. There is no rule for an
  ambiguous name today; PR 1 adds a short list of spellings the resolver refuses because they name two acts —
  «t.u.e.» the first — so the search asks instead of guessing (Q9). «TUE» without dots stays the Treaty.
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
  «testo unico edilizia», «codice del consumo» — and the field reads **the act alone** with the same function as the
  search (§4.4: client first; then `/parse_query_batch` with that one string, 250 ms after typing stops — not
  `/parse_query`, whose URN step logs and reaches the network). Whether the citation is searchable is worked out in
  the browser, the row's article added to the reading; the article never leaves. The reading shows under the field in
  the convention's words («Legge 7 agosto 1990, n. 241»). «Scegli» is enabled when the reading identifies the act.
- **The document's acts first.** Under the field, before anything is typed: «Atti citati in questo documento», the
  resolved acts, the nearest one above the citation first, then the rest in the order of the document. One tap picks
  one. This is the common case the owner described: the act will often be the same.
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
  characters, each distinct string once, in a POST body (never in an address); and, while the user types in the
  picker, the act they type, alone. In production behind the login: the ingress asks the server before it lets a
  scraping path through (`Caddyfile:106-120`, which also caps a body at 1 MB). In development Vite forwards to the
  Python app directly, as it does for every scraping route. The strings are what the user would type in the search
  bar, built only from the citation's own words (§4.3).
- **Never goes out:** the document, a passage, a clause, the words around a citation, the file's name, the count of
  citations, a bare article, an article in the picker, a choice made there.

### 6.2 What the server keeps of them

Checked on the code as it stands:

- `log_query_stats` (`app.py:374`) logs the path, method, duration and a token count of the **answer** — not the
  request body;
- `parse_query` logs a failure with `str(e)` (`app.py:1108`), and its URN step logs the parsed norm at info level
  (`app.py:462`, `:507`, `:516`, `:519`) and, in development, into `visualex_api.log`: the batch has no URN step, and
  the picker uses the batch (§5.3);
- nothing on the resolution path is cached or written to the history (`add_to_history` is called by the fetch
  routes only);
- the ingress writes no access log (no `log` directive in `Caddyfile`), and would log addresses, not bodies.

PR 1 keeps it so: the batch logs the number of strings and the duration, nothing else. Its test captures the
structured log the way `services/visualex/tests/test_akn_fetch.py:41-49` does (structlog writes to stdout, which a
bare `caplog` never sees), asserts that the count-and-duration record is there, and asserts that no query string
appears in any attribute of any record, including when a string makes the resolver fail.

### 6.3 The risk, said plainly

The norms a document cites say what it is about. «art. 609-bis c.p.», «art. 4 l. 300/1970» and «art. 2087 c.c.»
together tell a reader the subject of a brief without a word of it. The proposal sends no more than a lawyer would
send by searching those norms one by one — which VisuaLex receives today, in the same way, for every search — but it
sends them in one go, for a document the user may consider confidential. Two consequences:

- the page must say it (§6.4), not imply that nothing leaves;
- the user should be able to keep a sensitive document wholly local: a switch «Riconosci solo nel browser» on the
  page, which runs the candidate rules with the client parser and the client's own act names only (as §4.7, by
  choice) — Q3.

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

The owner called the pairs a lawyer completes by hand a possible source of data: each says how lawyers write a norm
that VisuaLex could not read («art. 4 St. lav.» → legge 300/1970, art. 4). Gathered, they are the list of spellings
the tables lack, ordered by how often they are written — the most direct way to widen the recognizer.

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
| 1 | Python API, conventions, server quota | `/parse_query_batch` (§4.4) on a resolving function `/parse_query` shares, limits and their 400s, logging test (§6.2); `/fetch_alias_catalog` adds `act_names` (§4.2); the list of numbered types in `conventions/sources/` (§4.4), the linker's copy and its comparison test; the clause source, «n. N» after an article, the two spellings and the ambiguous «t.u.e.» (§4.8), each with tests from the corpus's strings; the batch's price in `DEFAULT_SCRAPE_COSTS`; the suites of `/parse_query`'s other callers (the server's, the web's, MERL-T's in CI); `services/visualex/CLAUDE.md` updated | M: ~350 lines and their tests |
| 2 | Web, logic | the web's copy of the numbered types, its comparison test, and `isSearchReady` on it; `readNormQuery` out of `useSearchQuery` (the hook unchanged in behaviour, its tests green); `documentCandidates.ts` (§4.3) and the resolution and inheritance (§4.4–§4.6), pure, tested on the corpus with recorded server answers; the HTML reader's line breaks (§4.6); the corpus test prints §3.2's table and fails below the agreed floor; the fallback (§4.7); the page calls it, the list unchanged in look but for the counts | L: ~650 lines and their tests |
| 3 | Web, screens | «Da completare», the picker, applying and undo, «Non sono norme», the inherited and hand-chosen tags, phone and keyboard (§5); the promise's new words (§6.4) and the switch if Q3 is yes; `apps/web/CLAUDE.md`'s «no request at all» rewritten; a browser pass on the corpus's documents | L |
| 4 | Both | Phase 2, only if the owners decide it (§7) | — |

PR 1 can merge on its own: the search gains from it at once. PR 2 needs PR 1 deployed for its server half and falls
back without it (§4.7). PR 3 needs PR 2. The blind corpus (§3.3) and the MCP comparison (§3.4) are run before PR 3
merges. A follow-up, not in this plan: the DOCX reader reads footnotes and endnotes (`word/footnotes.xml`,
`word/endnotes.xml`), drawn after the text under «Note».

## 9. Questions for the owners

1. **The endpoint.** A new path `/parse_query_batch`, or a list in `/parse_query`'s body? *Recommendation:* the new
   path — it gets a price of its own in the quota, keeps the network-free form apart from the one that builds URNs,
   and is routed by the ingress and Vite as they stand (§4.4). One cost to accept: the picker reads one string per
   pause in typing through it, so a reading costs 3 points where a search costs 1 — a few readings per completion.
2. **How far a bare article inherits.** Within its paragraph (plus «del medesimo decreto»), across the whole
   document, or never (all to complete)? *Recommendation:* the paragraph, drawn «dal contesto» and changeable in
   one tap: 96 of 103 found with no wrong one, and no guess three paragraphs on (§4.6).
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
8. **The blind corpus.** Who writes it? *Recommendation:* three briefs by the other owner or a validator — one HTML,
   one DOCX with footnotes — plus two public decisions of the Corte costituzionale, never a client's document.
9. **Ambiguous names in the search.** Should the resolver refuse a spelling that names two acts («T.U.E.»: the
   building code or the Treaty), so the search asks instead of guessing? *Recommendation:* yes, with a short list kept
   by hand; «TUE» without dots stays the Treaty.
