# Court decisions through MCP, and the Court of Justice of the EU — Design

**Status:** built. Part A (#128), the convention (#127), the reader (#129); the courts of the
Union in every area with the owner's answers to §8 (12 October 2026, «continuiamo», relayed by
the orchestrator as approval of every recommendation). Written on 12 October 2026. It implements the proposal of pull request #112
(`docs/superpowers/specs/2026-10-08-mcp-decisions-design.md`, on the branch
`docs/mcp-decisions-proposal`), with the owner's answers to its §7.
**Follows:** `2026-10-01-sentenze-design.md` (decisions in the reader and in a dossier),
`2026-10-04-source-convention-design.md` (how a decision is identified and cited; this document
amends its §2.1, §2.4 and §4), `2026-10-04-mcp-second-round-design.md` (the MCP tools and the
delegated table).

## 1. The owner's answers

To §7 of the proposal, 12 October 2026, word for word: «95–100 come raccomandi, però per il 98
vediamo se riusciamo a mettere gli scraper completi». Read through the orchestrator:

| Q of #112 | Answer |
| --- | --- |
| 1. The delegated route | `POST /dossiers/:id/decisions` enters the delegated table with `dossier:write`. It only adds, like `/norms`. |
| 2. References per call | 10. One cold Corte costituzionale lookup can take minutes. |
| 3. Where the parser lives | In the Python API, beside `parse_query`, its cases pinned in the convention's golden file. |
| 4. A court VisuaLex cannot read | Full readers where feasible: the decision's text is read inside VisuaLex, as for the Cassazione and the Corte costituzionale. Only where a court's source makes that infeasible is the first step «identified, verified to exist, cited and linked to the source», reported per court before falling back. |
| 5. The Garante | A new item type («provvedimento»), with its own small design; not a `sentenza` with a court of its own. |
| 6. Part B | Wanted, in this order: CGUE, then Consiglio di Stato and TAR, then Garante and ECtHR. |

## 2. Part A — `omnilex_aggiungi_sentenze_dossier`

The twin of `omnilex_aggiungi_norme_dossier` (#112 §3), for every court `/fetch_decision` reads.

### 2.1 The words

`POST /parse_decision` (Python API, `visualex_api/services/decisions/citation.py`):
`{citazioni: [string, …]}`, 1–10 strings of at most 300 characters, → `{risultati: [ … ]}`, one per
string, in order: `{riferimento: {corte, numero, anno, archivio?, sezione?}}`, or
`{corte_non_supportata: "<the court's name>"}`, or `{non_riconosciuta: true}`. It reads what lawyers
write («Cass. civ., sez. un., n. 31310/2024», «Corte cost. n. 71 del 2020») into the reference
`/fetch_decision` takes. It names a court it recognises and VisuaLex has no reader for (Consiglio
di Stato, TAR, Garante, Corte EDU), so that the answer can say which court it read.

- **One reading in two languages.** The palette's `decisionCitationParser.ts` keeps parsing in
  the browser, on every keystroke and with no request: a request per keystroke would spend the
  user's scraping quota and fail offline. Both read the same cases from the golden file
  (`decision_citations`, §3.4), so they cannot drift; a court without a reader is the API's alone
  (the palette answers `null`, and the norm parser keeps the input).
- **Flat patterns.** The Python parser takes the web's patterns as they are: no nested
  quantifier, the text scanned capped at 600 characters (Studia PR A had a ReDoS). A fuzz test
  feeds it hostile and random input with a time bound.
- **Internal.** The server calls it directly (`LEGAL_API_URL`), as it calls `/parse_query`; no
  browser does, so it joins neither the Vite proxy nor the ingress's `@legal` list, and from
  outside the ingress does not route it.

### 2.2 The route

`POST /api/dossiers/:id/decisions` `{ references: string[] }` (`apps/server`), the twin of
`/norms`: 1–10 references of at most 300 characters; one call to `/parse_decision`; for each
recognised reference, `POST /fetch_decision`, at most two at a time (ten cold lookups must not hold
ten sockets to one source); then one transaction adds the decisions found. The stored content is
what `decisionItemContentSchema` admits and nothing else; the label is recomputed by the server
(`withDecisionLabel`).

- **Duplicates, by key.** The server checks none today (`POST /dossiers/:id/items` stores a
  decision twice; only the web app's `dossierContainsDecision` stops it). This route compares the
  identity's key (`cassazione:civile:31310:2024`) with the dossier's decision items and with the
  references before it in the same call.
- **Time.** The server's client gives the Python API 30 seconds; a cold Corte costituzionale
  lookup can take 240, and the MCP server waits 120 for the whole call. So `/fetch_decision` gets
  its own timeout and the call a budget of 100 seconds: a lookup still running then is
  `unavailable` («la fonte non ha risposto in tempo: riprova tra qualche minuto»), and nothing is
  added for it. The tool never reports an error for a call whose decisions were in fact stored.
- **Quota.** Two points per reference (`referencesWeight`, as `/norms`); an `unavailable` gives its
  two back (`delegatedRefund`).

One outcome per reference, the others never stopped by one that fails:

| Outcome | When |
| --- | --- |
| `added` | resolved to one decision, the source confirms it, stored |
| `already_present` | the same decision (by key) is in the dossier, or earlier in the same call |
| `not_recognised` | the words do not name a court, a number and a year |
| `court_not_supported` | a court VisuaLex has no reader for; the answer names the court it read |
| `ambiguous` | `ambigua`: the Cassazione, same number and year in both archives and no archive given; the candidates are listed by their citation |
| `does_not_exist` | `non_trovata` with the reason `inesistente`, and the penal suggestion when the route gives one |
| `unavailable` | `fonte_non_raggiungibile`, a timeout, a refusal of the quota, any other answer, and `non_trovata` for a year the archive does not or only partly covers (`fuori_archivio`, `anno_parziale`: the source cannot say): never "does not exist" |

Each `added` and `already_present` carries the server's `citation`; nothing else names a
decision. Nothing is updated, moved or deleted.

### 2.3 The delegated entry

`oauth/delegatedRoutes.ts`: `POST /dossiers/:id/decisions`, scope `dossier:write`, weighted per
reference like `/norms`. The route's own tests hold a 401 without a token and a 403 for an
exchanged token with any other scope.

### 2.4 The tool

`omnilex_aggiungi_sentenze_dossier` (`apps/mcp/src/tools/dossier.ts`): `dossier` (id or exact
name), `sentenze` (1–10 strings). Same shape of answer as the norms tool: one result per
reference, with the outcome, the citation, and for `ambiguous` and `does_not_exist` what the
route said. Its description tells the model that a decision that cannot be verified is not
stored, and that it must not fall back to writing it into a note as if it were one.

## 3. The convention: the Court of Justice and the General Court

### 3.1 Identity (amends source convention §2.1 and §2.4)

A decision of the Court of Justice of the EU is named by its **case**, as lawyers cite it:
`C-634/21`, `T-123/20`, and before 1989 `26/62`. Two courts, because they are two courts with
two ECLI codes and two ways of being cited:

| `corte` | Court | Case number |
| --- | --- | --- |
| `corte_giustizia_ue` | Court of Justice | `C-<numero>/<yy>` (cases registered from 1989), `<numero>/<yy>` before |
| `tribunale_ue` | General Court (Court of First Instance until 2009) | `T-<numero>/<yy>` |

- `numero` is the case number (1–9999), `anno` the year of the case in four digits (the year it
  was registered, not the year of the judgment: C-634/21 is a judgment of 2023).
- **Key:** `corte_giustizia_ue:634:2021`, `tribunale_ue:123:2020` — the `<corte>:<numero>:<anno>`
  shape §2.4 foresaw, with no qualifier. **Path:** `/sentenze/corte-giustizia-ue/634/2021`,
  `/sentenze/tribunale-ue/123/2020`.
- **First year:** 1953 for the Court of Justice, 1989 for the General Court.
- **The ECLI is an attribute** (`ECLI:EU:C:2023:957`), as for the Corte costituzionale. This
  replaces §2.4's «where the court's own identifier is the ECLI (CGUE, CEDU), the key is the
  ECLI»: the ECLI names one document of a case (the judgment, the Advocate General's opinion,
  an order each have one), lawyers cite the case number, and #112 proposed the case number,
  which the owner accepted.
- **The decision is the case's judgment.** Orders and the Advocate General's opinions are not
  read in this round (§7).
- **Joined cases.** A judgment on joined cases is filed under the first case (C-293/12 and
  C-594/12 are both in CELEX 62012CJ0293). A reference to another of them resolves to the first
  case's identity, as a Cassazione reference without archive resolves to its archive, with a
  notice; the attribute `cause_riunite` lists them all as the source writes them. So one
  judgment has one key, whatever case it was cited by.

### 3.2 Labels (amends source convention §4.2)

| Decision | citation | short |
| --- | --- | --- |
| C-634/21, First Chamber, 7 December 2023 | `Corte giust. UE, sez. I, sent. 7 dicembre 2023, causa C-634/21` | `Corte giust. UE, C-634/21` |
| C-293/12 and C-594/12, Grand Chamber, 8 April 2014 | `Corte giust. UE, grande sez., sent. 8 aprile 2014, cause riunite C-293/12 e C-594/12` | `Corte giust. UE, C-293/12` |
| T-612/17, General Court, Ninth Chamber (extended composition), 10 November 2021 | `Trib. UE, sez. IX ampliata, sent. 10 novembre 2021, causa T-612/17` | `Trib. UE, T-612/17` |
| 26/62, the full Court, 5 February 1963 | `Corte giust. UE, sent. 5 febbraio 1963, causa 26/62` | `Corte giust. UE, 26/62` |

- **The court**, as Italian doctrine abbreviates it, like «Corte cost.»: «Corte giust. UE» and
  «Trib. UE», for every judgment. The court is one institution under its present name; writing
  «Corte giust. CE» or «Trib. I grado» by date would need a table of renamings (1993, 2009) and is
  a guess for the cases on either side of them. Q11.
- **The formation**, as the Cassazione's section: «sez. I» … «sez. X», «grande sez.», «sez. IX
  ampliata», «sez. impugnazioni»; omitted when the source names none (a full Court of 1963 is
  written without one). Q11.
- **The date** is the day the judgment was delivered (`data_decisione`): the Court has no deposit.
- **The case**, with a plain `-` (the source writes U+2011) and a slash (the source writes old
  cases «26-62»). A Court of Justice case registered before 1989 has no letter.
- **No parties.** The source gives their full names («Digital Rights Ireland Ltd contro Minister
  for Communications, Marine and Natural Resources e a. e Kärntner Landesregierung e a.»), not the
  short name a lawyer adds; the decision's tab shows them.

### 3.3 Attributes

`tipo` (`sentenza`), `sezione` (the formation, as the source's title names it: `I`…`X`, with
` ampliata` for an extended composition, `grande`, `plenaria`, `impugnazioni`), `data_decisione`, `ecli`, `parti`, `cause_riunite`,
`lingua_processuale`. The dossier item stores `tipo`, `sezione` and `data_decisione` (as for the
Corte costituzionale) and the joined cases; the rest is the page's.

### 3.4 The words, in the golden file

`golden.json` gains `decision_citations`: words → the reference `/parse_decision` and the palette
read, or `null`, or a court without a reader. The palette's own cases move there from its test
(status `current`: what it reads today), and the CGUE cases join them (status `open:Q13`).
`decision-keys.json` gains the keys of the two courts and the shapes refused with the CGUE pull
request: its cases carry no status, and every suite asserts them all.

What the parser reads for the two courts:

- the court: «CGUE», «C.G.U.E.», «CGCE», «Corte giust.», «C. giust.», «Corte di giustizia»
  (with «UE», «dell'Unione europea», «CE», «delle Comunità europee», or alone); «Trib. UE»,
  «Tribunale UE», «Tribunale dell'Unione europea», «Trib. I grado», «Tribunale di primo grado»;
- the case: «C-634/21», «causa C-634/21», «cause riunite C-293/12 e C-594/12» (the first case),
  any dash or none («C‑634/21», «C 634/21»), a four-digit year («C-634/2021»), and «causa 26/62»;
- a bare case number with its letter («C-634/21») is the court its letter names, with or without
  the court's name; the letter wins over a court's name that contradicts it («CGUE, T-123/20» is
  the General Court).

## 4. The reader

`services/visualex/visualex_api/services/decisions/curia.py`, behind `/fetch_decision` for the
two courts. **The source is the Publications Office's repository (CELLAR), by CELEX**, the
repository EUR-Lex itself serves. Measured on 12 October 2026, with the honest User-Agent and
three seconds between requests:

- EUR-Lex's own page (`legal-content/IT/TXT/HTML/?uri=CELEX:62021CJ0634`) answers a server
  request with HTTP 202 and an empty body: the challenge of its firewall. It cannot be read
  without a browser.
- CELLAR answers `GET https://publications.europa.eu/resource/celex/62021CJ0634` with
  `Accept: application/xhtml+xml` and `Accept-Language: ita` by redirecting to the Italian
  XHTML of the judgment (106 KB, the Court's own markup, `coj-*` classes). A CELEX that does
  not exist is a 404 that says so («Resource … not found»); an existing one without that format
  is a 404 that says that instead.
- Its SPARQL endpoint (`publications.europa.eu/webapi/rdf/sparql`) answers in 0.3 s which
  judgment holds a case number, joined cases included, with its CELEX, ECLI and date.

**A lookup is two requests.** (1) One SPARQL query: the judgments (CELEX type `CJ` for the Court,
`TJ` for the General Court) of the case's year whose Italian case identifier holds the number and
the year as whole tokens, with any dash or a slash between them (the source writes «Causa
C‑634/21», «Cause riunite C‑293/12 e C‑594/12», and old cases «Causa 26-62.»), with CELEX, ECLI,
date and title; the code then keeps only exact tokens of the right letter («C-594/12» is not
«T-594/12» nor «C-1594/12»). (2) The XHTML of the judgment found. None found: a second chance by
CELEX alone (`6<anno><CJ|TJ><numero:04d>`), since the query needs an Italian expression; still
none: `non_trovata`. Two judgments for one case (a rare second judgment, on costs or a
revision): `ambigua`, with both. The 2026-08-29 case-law design and its plan
(`docs/superpowers/plans/2026-08-29-giurisprudenza-backend.md`, a `CellarAdapter` never built)
had chosen the same endpoint.

**Older judgments.** Measured on 12 October 2026: a judgment of 1963 (26/62) has no Italian
XHTML, only the HTML EUR-Lex used to publish, with its sections named by anchors (parties,
subject, reasons, costs, operative part). The reader falls back to it and leaves out its keywords
and its summary (`Massima`), which are the Office's, not the judgment. A case joined to one of an
earlier year is not in its own year's works: when the year finds nothing, a second query looks
for «<number>/<yy>» in any year.

**The text.** `epigrafe`: from the title to «ha pronunciato la seguente / Sentenza» (the parties,
the formation, the representatives); `motivazione`: the numbered points, with their headings, up
to «Per questi motivi»; `dispositivo`: from «Per questi motivi» to the signatures (the General
Court's closing «Indice» is left out). The procedure
language footnote becomes the attribute `lingua_processuale`. Every block is the source's
characters: the paragraph and table cells become lines, the number of a point its line's start
(«1 La domanda …»), and nothing is added, dropped or changed beyond that. Footnote calls in the
text («( *1 )») are dropped with their notes: they are the Court's references to the procedure
language, never text of the judgment. This is the reader's data contract from the day it ships:
`test_decisions_text_frozen.py` gains synthetic XHTML fixtures (written for the test, no text of
the Court) and its `_local` twin real judgments kept out of the repository.

**Cache, as the other readers:** found 30 days, not found 1 hour, without text a day, errors
never; one entry per case (the list of its judgments) under a versioned key (`curia:v1:…`); the
whole lookup within 45 seconds. `fonte_non_raggiungibile` (503) for a timeout, a 5xx, a 429 or an
answer that cannot be read — never `non_trovata`. Egress: `publications.europa.eu` joins
`tools/egress.py` and `SECURITY.md`. `fonte`: «Corte di giustizia dell'Unione europea —
EUR-Lex (Ufficio delle pubblicazioni)», with the EUR-Lex address of the judgment
(`https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:…`) as «Apri sulla fonte», and the
licence the Commission's reuse decision gives (2011/833/EU, attribution).

## 5. Everything a new court touches

`decisionItemContentSchema` (server) and `parseSentenzaContent` (web), together; the decision keys
(`readDecisionKey`, `identityFromKey`, `decision-keys.json`); the paths (`decisionPath`,
`parseDecisionPath`); the labels (`decisionCitation.ts` on the server, `decisionLinks.ts` on the
web, the golden file); the model (`model.py`: `CORTI`, `FIRST_YEAR`, the key); the reader and
the resolver's dispatch; the decision tab (the identity line, the source line, «Apri sulla
fonte», the PDF's footer); the scrape gate's cost of `/fetch_decision` is unchanged (2).

## 6. Pull requests

1. **The convention** (this document, the golden file, the source convention spec amended): to
   the owner before any CGUE code. Every CGUE value in it is `open`, so no suite asserts one yet.
2. **Part A** (the parser for the courts read today, the route, the delegated entry, the tool).
3. **The CGUE reader and its court in every place of §5**, once §8 is answered.
4. A design note for the Consiglio di Stato and the TAR (giustizia-amministrativa.it needs a
   search step first), to the owner before any code.

## 7. Not in this round

Orders and the Advocate General's opinions (each a document of its own, with a CELEX of its own:
`CO`, `CC`); the Civil Service Tribunal (`F-`); the Consiglio di Stato, the TAR, the Garante and
the ECtHR (§6.4 and later notes); a decision's text in a dossier.

## 8. Questions for the owner — answered

Answered on 12 October 2026: «continuiamo», every recommendation taken (relayed by the
orchestrator, who asked Q10–Q14 with these recommendations).


| Q | About | Recommendation |
| --- | --- | --- |
| Q10 | The identity of a judgment of the Court of Justice or the General Court (§3.1) | the case, `corte_giustizia_ue:634:2021`, in two courts, `corte_giustizia_ue` and `tribunale_ue`; the ECLI an attribute. It replaces the source convention's «the key is the ECLI» |
| Q11 | How they are cited (§3.2) | «Corte giust. UE, sez. I, sent. 7 dicembre 2023, causa C-634/21»; short «Corte giust. UE, C-634/21»; «Trib. UE» for the General Court; the formation when the source names it; no parties |
| Q12 | Joined cases (§3.1) | one judgment, one key, the first case's; the citation names them all |
| Q13 | What the words parser reads for them (§3.4) | as listed, with a bare «C-634/21» read as the Court of Justice |
| Q14 | The source (§4) | CELLAR, the Publications Office's repository behind EUR-Lex, since EUR-Lex's page is closed to a server by its firewall; two requests per lookup |
