# Court decisions: lookup, page, link and dossier — Design

Round opened 2026-10-01. It builds priority 2 of
`2026-08-29-giurisprudenza-design.md` — a cited decision can be pulled up by
body, number and year — and amends that design (D3, D8, D9: see Decisions).
The owner approved every section below, one at a time, on 2026-09-30 and
2026-10-01. Decisions recorded outside this repository are cited by ID only.

## Why

LibreLex-IT, a separate open-source project whose only part in OMNILEX V1 is
its bridge to VisuaLex (D-030), opens the norms cited in a lawyer's document in
VisuaLex's article reader through `/?norma=`. Tried on judgments on 2026-09-30,
it cannot open them: VisuaLex has no page for a decision.

This round gives a decision of the Corte di cassazione or of the Corte
costituzionale an address in VisuaLex that anyone can build from its citation
alone, a page that reads it, and a dossier item that keeps it.

## What was measured

All on 2026-09-30, from live sources or from the code named.

- **Civil and penal numbers overlap.** The Cassazione numbers decisions per
  year in two separate series, civil and penal. n. 10787/2024 exists in both:
  Sez. III civile and Sez. VII penale. Both series have sections I–III and the
  Sezioni Unite, so the section does not separate them in general. A reference
  without "civ." or "pen." is ambiguous by nature, and a key without the
  archive collides.
- **A penal number belongs to the year of deposit.** "n. 1399 del 15/12/1999,
  dep. 2000" is n. 1399/2000, and that is the year Italgiure indexes. A year
  taken from the hearing date misses every decision heard in December and
  deposited in January.
- **The case-law round of 2026-08-29 was built, then reverted the same day**
  (merges b849acc, 11f9061, f72f945; reverts 52453df, 855bcc1, 084509e). The
  owner's reason: other priorities, not a defect. Its Italgiure adapter, its TLS
  module and their tests are in history. Its single-decision lookup
  (`ItalgiureAdapter.leggi`) has three faults this round fixes:
  - it filtered neither civil nor penal;
  - it did not zero-pad the number as Italgiure stores it;
  - it returned metadata and a guessed link, not the text.
- **mcp-legal-it's readers serve a model's context, not a reader.** Read in
  v2.15.0:
  - the Cassazione text is cut to 30 000 characters, keeping the first 12 000
    and the last 18 000 and omitting the middle;
  - the Corte costituzionale text is cut to fit 25 000;
  - the output is markdown only, with no decision type for the Cassazione and
    no ECLI or source URL;
  - Italgiure is called with TLS verification off and a browser User-Agent.

  In this repository's stack the container is built from `vendor/mcp-legal-it`
  at 2.3.3, which has no Corte costituzionale tools, and runs only with the
  MERL-T profile.
- **The Corte costituzionale has no per-decision route.** The complete source
  is the open-data distribution of `dati.cortecostituzionale.it`:
  - three range bundles (1956–1980, 1981–2000, 2001 to today), each a zip of
    per-year zips holding one JSON file, latin-1 encoded;
  - the last bundle is regenerated daily;
  - recent years weigh 7–11 MB of JSON each.

  Sentenze and ordinanze share one number series per year, so (number, year)
  identifies a decision. Licence: CC BY-SA 3.0, as measured on 2026-08-29; the
  plan checks it again.
- **The login drops everything after the path.** `ProtectedRoute` hands
  `LoginForm` the whole location; `LoginForm` keeps only `pathname`. A failed
  token refresh (`handleUnauthenticated` in `services/api.ts`) redirects with no
  location at all. Every `/?norma=` link opened while logged out is lost today.
- **The premise of D9 no longer holds.** D9 kept the Corte costituzionale out
  because fetching a large bundle per request was disproportionate on the host
  of the time. That host is no longer in use.

## Goals

- A decision of the Cassazione (civil or penal) or of the Corte costituzionale
  opens in VisuaLex from an address anyone can build from its citation.
- The page shows the full text and the particulars. It says plainly when a
  reference is ambiguous, carries a wrong section, lies outside the archive or
  cannot be reached, and it never shows an empty page.
- A decision can be kept in a dossier, and goes wherever a dossier item goes.
- A decision has one identity across the link, the dossier, the future remote
  MCP server (D-036, D-037) and the MERL-T graph.

## Non-goals

- Notes and highlights on a decision's text. They come later; S6 keeps the way
  open.
- Courts other than the Cassazione and the Corte costituzionale. Their readers
  need identifiers that only a search returns.
- The norm → decisions panel and free-text search: priorities 1 and 3 of the
  2026-08-29 design.
- Storing decision texts. Caches only.
- Judging what a decision says.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **VisuaLex reads the sources itself.** An Italgiure reader recovered from the 2026-08-29 round and corrected, and a Corte costituzionale reader of the open data, both in `services/visualex`. mcp-legal-it's readers are not used by the page. | A reading page needs the whole text from a verified connection. mcp-legal-it truncates on purpose and calls Italgiure unverified; changing that would mean work in a third repository plus a container upgrade. It also keeps mcp-legal-it the engine for models (D-036) and the two engines apart (A1). |
| S2 | **The Corte costituzionale is in this round**, read from the open-data distribution cached on disk. This exercises D3's exception and supersedes D9. | The host D9 was sized for is gone, the data is official and licensed, and D3 was written for exactly this case. |
| S3 | **A decision has an identity, distinct from a reference.** Dossier, graph and MCP store identities only (§1). | A reference can be ambiguous or wrong; what is stored must not be. |
| S4 | **The link is a readable path**, `/sentenze/<corte>/<numero>/<anno>`, not an encoded token (§2). | A lawyer can read it, type it and paste it, and it survives today's login redirect. A decision's identity is short and stable. `/?norma=` keeps its token, because it carries search parameters. |
| S5 | **The first build includes the page, the lookup form, the login return, and the `sentenza` dossier item** wherever an item goes: export, share links, environments and the Forum. | The owner's choice. A dossier that silently loses items when shared breaks the posture of gotcha 18: nothing is lost in silence. |
| S6 | **The page never adds, drops or changes a character of the text it receives.** | Notes on decisions can then come under a contract like gotcha 23's, with no change to how the text is rendered. |
| S7 | **mcp-legal-it is used at 2.15 wherever it is used.** Bumping this repository's submodule is a task of its own. | The owner's rule. The MERL-T expert tools call that container, so their check belongs to the MERL-T work. |

**Amendments to `2026-08-29-giurisprudenza-design.md`:**

- **D3 is exercised for the Corte costituzionale.** "The current year is always
  live" becomes "the current year comes from the daily bundle, at most 24 hours
  old": no per-decision route exists.
- **D8.** The first build is the direct lookup (priority 2) for the Cassazione
  and the Corte costituzionale, not the four-source panel.
- **D9 is superseded by S2.**
- **D4–D7 apply unchanged.** D7's port of Italgiure exists in history. The Corte
  costituzionale reader is ported from mcp-legal-it 2.15's open-data client,
  with the corrections in §3. That client is Apache-2.0 and by the same author,
  and is relicensed MIT as the README already records for other parts.

## Detailed design

### 1. Identity and reference

A **reference** is what a text says: `{corte, numero, anno, archivio?,
sezione?}`. It may be ambiguous or wrong.

An **identity** is what VisuaLex resolved: `{corte, numero, anno, archivio}`,
with `archivio` for the Cassazione only and always present there. It is unique.

| Field | Values |
|---|---|
| `corte` | `cassazione`, `corte_costituzionale` (LibreLex's vocabulary; future courts add values) |
| `numero` | integer from 1 to 999999, no leading zeros (Italgiure pads; normalise on read) |
| `anno` | the year of the number, from 1900 (1956 for the Corte costituzionale) to the current year. For a penal decision this is the year of deposit. |
| `archivio` | `civile`, `penale` (Cassazione only) |

**The canonical key** is `cassazione:<archivio>:<numero>:<anno>` or
`corte_costituzionale:<numero>:<anno>`, for example
`cassazione:penale:10787:2024`. The fields are stored separately; the string is
used only where one key is needed (graph nodes, deduplication). The MERL-T
graph work that models decisions adopts the same key.

**The section is not part of the identity.** It is an attribute of a decision
and, in a reference, a hint. Accepted forms, case-insensitive:

| Section | Accepted as |
|---|---|
| sezioni semplici | `1`–`7` or `I`–`VII` |
| Sezioni Unite | `SU`, `U`, `unite` |
| lavoro | `L` |
| tributaria | `T`, which is sezione 5 civile and implies `archivio` civile |
| feriale | `F` |

Any other form is ignored with a notice on the page, never an error.

**Other attributes**, carried once the decision is resolved and never part of
the identity: type (sentenza, ordinanza, decreto), date of deposit, date of
decision (Corte costituzionale), ECLI where the source publishes it, relatore,
presidente.

### 2. The link

| Path | Meaning |
|---|---|
| `/sentenze/cassazione-civile/<numero>/<anno>` | an identity |
| `/sentenze/cassazione-penale/<numero>/<anno>` | an identity |
| `/sentenze/cassazione/<numero>/<anno>` | a reference without the archive |
| `/sentenze/corte-costituzionale/<numero>/<anno>` | an identity |
| `/sentenze` | the lookup form |

**The section** goes in the query, `?sezione=<form>`, for the Cassazione only.
The number comes before the year, so the address reads "10787/2024" as a
citation does. VisuaLex builds its own links (page, dossier, copy) through one
utility, `utils/decisionLinks.ts`. LibreLex builds them from its citations
(§7).

**Resolution:**

1. **Parse.** A corte, number or year that cannot be read sends the reader to
   the lookup form, filled in with what could be read and a message saying what
   is wrong. Never a blank page.
2. **Read the archive.** With the archive given, that archive is read. Without
   it, both are read:
   - one hit opens that decision;
   - two hits: the section picks one if exactly one matches;
   - otherwise the page lists both, with section, type and date of deposit, and
     the reader chooses.
3. **Check the section.** A section that differs from the decision's opens the
   decision with a visible notice: "La citazione indica la Sez. I; la decisione
   è della Sez. III."
4. **Rewrite the address.** Once resolved, the address is replaced (history
   replace) with the identity's path, without the section hint, so whoever
   copies it copies the right one.
5. **Corte costituzionale.** It is read by number and year alone; a section is
   ignored.

**Compatibility.** The paths are a contract and are not renamed. New optional
query parameters can be added, and new courts get new path names. A VisuaLex
older than this round answers with its "pagina non trovata" page; LibreLex's
README states the minimum version.

### 3. The data route

**The route.** One Python route, `POST /fetch_decision`, the name used in the
2026-08-29 round.
- **Body:** `{corte, numero, anno, archivio?, sezione?}`.
- **Answer:** JSON with `esito`, for every answer the handler writes. The
  others are not: the per-IP rate limit (429 `{"error": …}`) and the login
  gate's 401 or 429 passed through by the ingress, both before the handler,
  and the framework's own pages, 405 (a method other than POST or OPTIONS),
  408 (a stalled body) and 413 (a body over 16 MB; 1 MB behind the ingress,
  whose own page answers).

| `esito` | Status | Content |
|---|---|---|
| `trovata` | 200 | `identita`, `attributi`, `testo` (`epigrafe?`, `motivazione?`, `dispositivo?`, each whole), `fonte` (`nome`, `licenza?`, `url?`), `avvisi` (wrong section, archive deduced from the section, unknown section form, text missing: `attributi.testo_assente` says `oscuramento` or `valutazione_oscuramento` when the source withholds it) |
| `ambigua` | 200 | `candidati`: identity and attributes of each |
| `non_trovata` | 404 | `motivo` (see below), `archivio_dal` when known, `suggerimento` when found |
| `fonte_non_raggiungibile` | 503 | `fonte` |
| invalid request | 400 | the field errors |
| `errore_interno` | 500 | nothing else: an unexpected failure, whose details stay in the log |

`motivo` is one of:
- `inesistente`;
- `fuori_archivio`, for a decision before the start of Italgiure's public
  archive;
- `anno_parziale`, for the first year of that archive, which is only partly
  covered.

**The penal year.** When a penal reference, or one without the archive, is not
found, the route also tries the next year. If that year holds a penal decision
with the same number, its identity comes back as `suggerimento`. The page shows
it as a suggestion with a link and never jumps there by itself: a different
year may be a different decision.

**The Italgiure reader** is recovered from history and corrected.
- **Requests.** A plain `GET` of the site for the session cookie, then a `POST`
  to the Solr endpoint.
- **Query.** `kind:"snciv"` or `kind:"snpen"` per archive, `numdec` zero-padded
  to five digits, the form the index stores (measured on 2026-10-02: the bare
  form never matched, so it is not queried), and `anno`. **No section in the
  query**: the section is compared after reading, so a wrong section is
  reported instead of silently dropped.
- **Fields.** `numdec`, `anno`, `szdec`, `datdep`, `tipoprov`, `materia`,
  `relatore`, `presidente`, `kind`, `ocr` (the motivazione), `ocrdis` (the
  dispositivo, often empty at the source) and the document id.
- **Text.** Never truncated.
- **Archive start.** Read from the archive itself (the earliest date of deposit
  per archive), cached for a day, and used in `fuori_archivio` and
  `anno_parziale`.
- **Values in the query** are integers and fixed codes only. The 2026-08-29
  phrase escaping stays for any free text that may ever reach Solr.

**The Corte costituzionale reader:**

- **Check first.** Before writing it, the plan checks whether the publisher now
  serves a per-year file or a per-decision page. If it does, that lighter route
  replaces the bundle.
- **Cache.** The range bundle is downloaded into the API's cache directory and
  only the requested year is extracted.
  - **Expiry:** 30 days for closed years; 24 hours for the current year, since
    the bundle is regenerated daily. When a refresh fails, the copy on disk
    still confirms a decision it holds for a year before the current one,
    however old. A number it does not hold is answered 503: it cannot be
    verified, since the copy may have been written before that decision was
    deposited, so it is never `non_trovata`. The current year is never read
    from a copy that could not be refreshed.
  - **Downloads:** one per bundle at a time, so concurrent misses wait for the
    same download.
- **Lookup.** The year's JSON is parsed once and indexed by number in memory,
  with a small least-recently-used cache of years.
- **Matching.** A record matches on its own `numero` and `anno` fields, not on
  the file it sits in.
- **Fields.** Type, dates of decision and deposit, ECLI, presidente, relatore
  or redattore, epigrafe, testo, dispositivo. Measured on the 2001–today
  bundle, 3,592 of 4,056 ordinanze (2001–2026) have an empty `testo`, and in
  3,577 of them (3,514 + 63) the reasoning inside `epigrafe` starts at a line
  whose first word is "Ritenuto" or "Considerato": the reader splits such an
  epigrafe there, searching after "ha pronunciato la seguente" when it is
  there. An epigrafe without such a line stays whole, and the page labels it
  «Testo» (decided by the owner on 2026-10-04).

**Common to both readers:**

- **TLS verification is always on.**
  - Italgiure omits an intermediate certificate (TI Trust Technologies OV CA,
    valid to 2029-07-29). It ships in the repository as a file, and a test
    checks its SHA-256 and its chain to a root already in certifi.
  - The 2026-08-29 runtime download from the plaintext AIA URL is dropped,
    along with its egress host.
- **VisuaLex identifies itself honestly** (D5). Requests go through
  `ThrottledHttpClient`: throttle, retries and the egress allowlist (D6). It
  has no circuit breaker (only the `/api` twin server has one): when Italgiure
  is down, a lookup spends its retries, about 16–25 s, before its 503.
- **Egress.** `www.italgiure.giustizia.it` and `dati.cortecostituzionale.it` go
  into `visualex_api/tools/egress.py` and `SECURITY.md`.
- **Caching** is per archive lookup, and the answer is composed from those
  lookups. Caching a composed answer would hide a homonym deposited later in
  the other archive.

  | Lookup result | Kept for |
  |---|---|
  | found | 30 days: a deposited decision does not change |
  | not found | 1 hour: indexing lags, and the other series may reach that number later |
  | found without its text | 24 hours: withheld by the source while personal data are removed, or missing at the source |
  | error | never |

- **Behind the login** with the per-user quota (ADR-001). The route is added
  to:
  - `app.py`;
  - the Vite proxy list;
  - the ingress `@legal` list (`paths.test.mjs` keeps the last two in step);
  - `scrapeGate`'s cost table, at 2 per call, whatever the call sends
    upstream. A Cassazione search sends at most 10 requests (decided by the
    owner on 2026-10-04): a homepage `GET` and a Solr `POST` per query, for
    both archives when none is named, for each archive's start on the first
    miss of the day, and, for the penal archive, for the next year's lookup.
    Retries of a failed request are not counted (the owner's reading). A Corte
    costituzionale call makes at most one download, shared by concurrent
    callers.

### 4. The page

Routes `/sentenze/:corte/:numero/:anno` and `/sentenze`, under `ProtectedRoute`
and `Layout`, loaded lazily. It is a page in the flow of the app, not a window
over the reader. From the top:

1. **One identity line**, in the form "Corte di cassazione · Sez. III civile ·
   <tipo> n. 10787/2024 · depositata il <data>". For the Corte costituzionale
   it also carries the date of decision and the ECLI.
2. **The notices**, when there are any (§3).
3. **The actions:**
   - **Copia citazione**, in the form lawyers write:
     - "Cass. civ., sez. III, <sent.|ord.> <data di deposito>, n. 10787";
     - "Cass. pen., sez. VII, <sent.|ord.> <data> (dep. <data di deposito>),
       n. <numero>";
     - "Corte cost., <sent.|ord.> <data>, n. 1".

     The plan fixes which date each court cites, from the fields its source
     actually carries.
   - **Aggiungi al dossier** (§6).
   - **Apri sulla fonte**, only if the plan verifies a stable per-decision
     address at the source; otherwise it is absent. Verified on 2026-10-02 for
     the Corte costituzionale
     (`www.cortecostituzionale.it/scheda-pronuncia/<anno>/<numero>`); none for
     the Cassazione.
4. **The text**, in the blocks the source gives (epigrafe, motivazione,
   dispositivo), at the reader's 68ch measure. Where the Corte costituzionale's
   open data leave the reasoning in the epigrafe, the data route splits it
   (§3), so the page shows the blocks as the route divides them. Rendering
   follows S6: within a block, the text nodes spell the received text minus
   `\n`, as gotcha 23 prescribes for articles. Italgiure's texts carry no line
   break at all (measured on 2026-10-04: 45 of 45 sampled texts, up to 82,322
   characters), so the data route restores the paragraphs by inserting a blank
   line before each heading («FATTI DI CAUSA», «RAGIONI DELLA DECISIONE»,
   «Rilevato che:» …), before «P.Q.M.» and before each numbered point that
   starts a sentence, and changes nothing else (decided by the owner on
   2026-10-04). A combined heading («RITENUTO IN FATTO E CONSIDERATO IN
   DIRITTO») stays one, and a numbered point keeps the words it opens, with no
   break between «3.» and a «P.Q.M.» or a heading right after it. The page
   draws each group of lines between blank lines as a paragraph. Text is
   rendered as React text, never as HTML. The blocks are labelled «Epigrafe»,
   «Motivazione» and «Dispositivo»; an epigrafe without a motivazione holds the
   reasoning too and is labelled «Testo» (decided by the owner on 2026-10-04).
   A decision without its text shows no block.
5. **The source**, at the foot: "Fonte: Corte di cassazione — archivio pubblico
   SentenzeWeb (Italgiure)" or "Fonte: Corte costituzionale — dati aperti". A
   dossier's PDF names it too. Neither shows the licence (the owner's decisions
   of 2026-10-04); the data keep `fonte.licenza`.

**Each outcome has its own screen:**
- loading;
- the decision;
- the decision without its text: its particulars and the notice (§3), no text
  block;
- the choice between two candidates;
- not found, with the reason, the form filled in and, for a penal decision, the
  suggested next year;
- outside the archive, with the date it starts;
- partly covered year;
- source unreachable, with "Riprova";
- an unexpected failure (`errore_interno`), with "Riprova", never
  "non trovata";
- invalid address, with the form and the message.

**The lookup form** (`/sentenze`, "Apri una sentenza") asks for:
- the court: Cassazione civile, Cassazione penale, Cassazione with the archive
  unknown, or Corte costituzionale;
- the number and the year;
- for the Cassazione, an optional section.

It leads to the §2 address.

**Navigation.** A "Sentenze" entry in the sidebar opens it.

**Layout.** Mobile keeps the 16px gutter and 44px touch targets.

### 5. The login return

- **The full address.** `LoginForm` and `AdminRoute` return to the whole
  location: `pathname`, `search` and `hash`.
- **A failed token refresh.** `handleUnauthenticated` keeps the current
  location in `sessionStorage` before it redirects. `LoginForm` reads, in
  order: the router state, then that stash, then `/`. It clears the stash once
  used.
- **Only paths of the app itself.** A value must start with exactly one `/`;
  anything else becomes `/`. There is no `next=` parameter in any URL, so no
  link can be crafted that sends a reader elsewhere after login.
- **Review.** This touches the login screen, which the repository rules reserve
  for the other developer's review. The pull request says so.

### 6. The dossier

**Storage.**
- **Prisma.** `DossierItemType` gains `sentenza`, through a hand-written
  migration applied with `migrate deploy`, never `migrate dev`. Schema and
  migrations are for the other developer to review; the pull request says so.
- **Content.** `{corte, numero, anno, archivio?, sezione?, tipo?,
  data_deposito?, etichetta}`, with `archivio` required for the Cassazione.
  `title` is the label: the citation of §4, "Copia citazione". Never the text.

**Validation** is strict and lives in one schema, used by the dossier routes,
by environment payloads and by imports:
- `corte` and `archivio` from their enums;
- integers in range;
- `sezione` and `tipo` from their enums, or absent;
- dates in ISO form;
- the label plain text, at most 200 characters;
- no unknown keys.

**On the client.**
- **The type.** The `DossierItem` union gains
  `{type: 'sentenza'; data: DossierSentenzaData}`. The branches that treat
  "anything not a norm" as a note become exhaustive switches with a `never`
  check: counts, hydration in `useAppStore`, and the Forum mapping in
  `SuggestContentModal` and `AddItemsDialog`. A future type can then no longer
  fall silently into "note".
- **Adding.** `AddToDossierPopover` takes a decision as well as a norm and
  stays the only add-from-reading entry point.
- **The row.** It shows the label, a "Sentenza" badge and the star. It expands
  in place to the page's text component, fetched on opening, and offers "Apri
  pagina".
- **Counts** read "3 norme · 2 sentenze · 1 nota".
- **"Apri tutte le norme"** stays norms only.

**Wherever an item goes.**
- **Export.** The PDF lists the decision's citation, its VisuaLex address and
  the attribution. The JSON carries the item.
- **Share link and import** (`/dossier?import=`). Each decision item is
  validated against the schema above before it is shown, and rendered as text
  only. The result is reported: "N voci importate, M scartate", with the reason
  per item. A partial import is never announced as complete. For decisions this
  answers two requests from LibreLex: validate imported items, and report a
  partial import.
- **Environments and the Forum.** Decisions travel in environment payloads and
  dossier suggestions, validated by the same schema. The attribution contract
  (gotchas 20 and 21) is untouched.
- **Ignored.** The saved-norm watcher and the MERL-T integrations skip decision
  items: a deposited decision does not change.

### 7. LibreLex

LibreLex builds §2's paths from its canonical judgment references. Its
extractor learns to keep "civ."/"pen." and to read "dep. <year>" as the
number's year, which also makes mcp-legal-it 2.15's verification narrow to the
right archive. Consiglio di Stato, TAR and CGUE are refused with a reason. The
details, and the tests, live in LibreLex's bridge spec, updated in its own
repository.

## Security and data

- **Input.** Path parameters and the route's body are checked against enums
  and ranges. No supplied URL ever reaches a request, so nothing can be forged
  server-side; only integers and fixed codes reach Solr.
- **Output.** Decision text is rendered as text. No HTML from a source reaches
  the DOM.
- **Transport.** TLS verified, with the pinned intermediate; an honest
  User-Agent; the egress allowlist; the per-user quota.
- **Personal data.** A decision is shown as its source publishes it, with the
  anonymisation the source applies, and is held only in caches, whose expired
  entries are swept every six hours. The owner confirmed this posture. When
  the source withholds a text while it removes personal data (Italgiure
  answers with its own notice), the page shows the decision's particulars and
  says so: the notice is never shown as the text. It gives that reason only
  when the source did (`attributi.testo_assente` is `oscuramento` or
  `valutazione_oscuramento`): a text missing for any other reason carries none.
- **Login.** No open redirect (§5).
- **Imports.** Imported items are untrusted (§6).
- **Licences.** The README's third-party sentence names the Corte di cassazione
  and the Corte costituzionale, with the CC BY-SA attribution, and its
  derived-code sentence names the Corte costituzionale reader.

## Verification

**Automated:**

- **Readers.** Offline tests over real responses recorded once:
  - Italgiure: civil, penal, the two homonyms, not found, an anti-bot page
    instead of JSON;
  - one real year of the Corte costituzionale data.
- **Live tests** behind `pytest -m live`, on fixed public cases: Cass. civ. SU
  41994/2021, the homonyms 10787/2024 (civ. III, pen. VII), Corte cost. 1/2014
  and 194/2018, a number that does not exist. They warn when a source changes
  shape, before a reader does.
- **TLS:** verification on, the pinned intermediate accepted, a substituted
  certificate rejected.
- **Egress:** the new hosts are declared, and nothing else is reachable.
- **The route:** every outcome, each status, invalid bodies, the quota cost.
- **Web:**
  - parsing and building every path and section form;
  - every page state;
  - the login return with a path and a query, and after a failed refresh;
  - dossier counts and rendering;
  - crafted import payloads rejected and reported;
  - environments and Forum carrying decisions.
- **Builds:** `npm --prefix apps/web run build` for the real type-check, and
  lint.
- **Server:** the content schema, the dossier and environment routes with
  decision items, the migration applied on a disposable database.

**By hand, before "done":** a logged-in browser on `http://localhost:5173`:
- a decision link opened while logged out lands on the decision after login;
- the civil/penal choice;
- a Corte costituzionale decision of the current year;
- a source made unreachable on purpose;
- add to a dossier, expand, export, share link and import.

Then from LibreLex, with a local VisuaLex: a Cass. civ., a Cass. pen. and a
Corte cost. opened from the Citazioni list.

## Rollout and coordination

- **Phase 0.** Only the specs and plans are written until the owner says to
  build.
- **The other developer's review** covers the migration and the login screen,
  flagged in the pull requests.
- **The MERL-T graph work** keys decisions on §1's identity: the re-keyed
  Brocardi massime, and other sources of decisions it plans. Their links to a
  decision open §2's path.
- **The sidebar** file is also touched by the MERL-T graph round: the merge
  order is agreed with that work.
- **The submodule.** `vendor/mcp-legal-it` moves to 2.15 in its own task, with
  the MERL-T expert tools checked against it (S7).
- **LibreLex's README** records the first VisuaLex release that has
  `/sentenze`.

## Later

- Notes and highlights on decisions, under a contract like gotcha 23.
- Consiglio di Stato, TAR and CGUE, whose readers need a search step first.
  For the CGUE the CELEX number can be built from the case number.
- Judgment citations recognised in the documents page and in the command
  palette (typing "Cass. n. 10787/2024").
- Validating the norm and note items of a share link, and capping how many one
  link may carry: LibreLex asked for both, and this round covers decision items
  only.
- The massime numbers ("Rv.") shown on the page, read from the graph.
- Upstream data anomalies, such as a Corte costituzionale record filed under
  another year's file (69/1982 sits in the 1980 file).
