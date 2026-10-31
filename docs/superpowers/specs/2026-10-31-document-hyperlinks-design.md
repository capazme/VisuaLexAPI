# «Analizza documento» puts the hyperlinks in — pasted text and a copy of the Word file

**Status:** proposal, 31 October 2026. Nothing here is decided: the owners choose from the options and the
questions of §12. No product code is written until they do.
**Asked by:** one owner, 31 October 2026, in chat with the orchestrator: let the user also paste the text, and aim
at a mechanism that inserts the hyperlinks to the cited sources by itself; and, when a Word file is given, apply the
changes to the Word file directly. The same owner handles the web side of «Analizza documento» for this feature.
**Why it matters to a lawyer, in one neutral line:** a filing whose cited sources are hyperlinked can raise the
lawyer's fee (the owner puts it at 30%); this spec makes no assessment of that rule.
**Extends:** spec `2026-10-29-document-analysis-design.md` (PR #376, approved on 30 October, G-393; its PR 1 is
#381, merged). This spec adds to #376's plan, it replaces none of it (§11). It reuses the address rules of «Copia
link Normattiva» (#385, merged; `apps/web/src/utils/normattivaLink.ts`).
**Decisions it rests on:** G-393 (the nine answers of #376 §9), G-375 (the page goes when it finds at least as much
as Claude through MCP), G-355 (Normattiva answers an undated address with its latest text). Open and cited, not
decided here: G-395 (a link dated today or undated).
**Migration:** none.

---

## 1. What was asked, in five lines

1. **Paste.** A text box beside the drop zone; the same text comes back with the recognised citations as links,
   ready to paste into Word or Pages with the links kept.
2. **The Word file.** The user drops a `.docx`, reviews the citations, and downloads a new copy with the links in
   it. The original is never changed.
3. **No wrong link.** A wrong link in a court filing is worse than none: the spec says what keeps one out.
4. **Honesty about the file.** #376 proposed the promise's new words («Il documento resta sul tuo computer»; not yet
   on the page, PR 3 of #376 writes them); whatever this adds must keep them true.
5. **The PDF.** Filings are deposited as PDF: one line on how the links survive.

## 2. What exists (checked on `develop` at 77da0c17)

### 2.1 The page

- `DocumentReviewPage.tsx` reads a dropped or chosen file (`documentFile.ts`: TXT, Markdown, HTML, DOCX up to
  `MAX_DOCUMENT_BYTES`, 15 MB; a PDF is refused with words) and runs `extractCitations(result.text)`
  (`DocumentReviewPage.tsx:158`). There is **no text box**: the only input is a file. The page makes no request.
- A citation is a `CitationMatch` with a span and a `parsed` reading; **it carries no address**. «Apri» runs a search
  (`openCitation`, `triggerSearch` after `navigate('/')`), and the address is built only then, on the server.
- `readDocx` (`documentFile.ts:28-76`) is a hand-written ZIP reader: it finds the central directory, takes
  `word/document.xml` only, inflates it with `DecompressionStream('deflate-raw')`, and turns the XML into text with
  five regular expressions, then decodes entities and folds whitespace (`[ \t]+\n` → `\n`, three line breaks → two,
  `trim`). Three things follow, each checked by running those expressions on a sample (§10.1 keeps the sample):
  - **The text has no map back to the XML.** The folding and the entity decoding move offsets, and nothing records
    which run a character came from. Writing links into the file needs that map (§6.1).
  - **Text that Word does not show is read as text.** The last expression strips tags and keeps whatever lies
    between them, so a tracked deletion (`w:delText`), a field's instruction (`w:instrText`, e.g. ` REF _Ref1 \h `)
    and the fallback copy of a text box (`mc:Fallback`, which repeats the text of `mc:Choice`) all reach the text:
    `<w:del>…<w:delText>art. 5 c.c.</w:delText>…</w:del>` gives «art. 5 c.c.», a citation the reader of the document
    does not see. Today that is a false citation in a list; once links are written it would be a link aimed at
    deleted text.
  - **Nothing caps the inflation.** The deflated part is inflated whole, with no bound: a 15 MB part can inflate to
    some 15 GB (deflate's ratio reaches about 1000:1) and take the tab down. The file is the user's, but a DOCX can
    come from the other side of a case.
- Footnotes, endnotes, headers and footers are not read (#376 §2.1 and §8 list the notes as a follow-up).

### 2.2 #376's plan, where this lands

- PR 1 (#381, merged): `/parse_query_batch` reads up to 200 query strings and **stops at the reading**: no address,
  no network, a log line with the count, the failures and the duration only (`services/visualex/app.py:1285`), priced at 3 points
  (`apps/server/src/middleware/scrapeGate.ts:21`).
- PR 2 (web, logic, not written): candidates (§4.3 of #376), resolution, inheritance within the paragraph, the HTML
  reader's line breaks, the fallback.
- PR 3 (web, screens, not written): «Da completare», the picker, «Non sono norme», the promise's new words, the
  switch «Riconosci solo nel browser» (Q3 of #376, off by default). PR 2 and PR 3 wait for the other owner's words
  and the blind corpus (#376 §3.3).

### 2.3 «Copia link Normattiva» (#385)

`normLink` takes **the address the API returned** (`norma_data.urn`), never one rebuilt in the browser, so a code's
annex (`;262:2`) and the version marker (`!vig=`, `!vig=<day>`, `@originale`) come with it; it accepts only `https`
on `www.normattiva.it`, `normattiva.it` and `eur-lex.europa.eu` (`sourceAddress`); an act of the Union links the
act's EUR-Lex page, which has no address per article; `linkPinDay` fixes an undated address to a day where Normattiva
would open another text (G-355); `copyNormLink` writes `text/html` and `text/plain` in one
`navigator.clipboard.write`, falling back to `writeText`. Decisions were left out of #385. Some decisions do carry a
public address in the data (`DecisionSource.url`, `types/decisions.ts:80`): the Corte costituzionale's, the Court of
Justice's EUR-Lex page by CELEX (`decisions/curia.py:394`), the administrative courts' page
(`decisions/giustizia_amministrativa.py:300`); the Cassazione's have none that is stable.

### 2.4 How the server builds an address

`create_norma_visitata_from_data` (`services/visualex/app.py:516`), which `/fetch_norma_data` and every fetch route
run, is where an article's address comes from. It is **not** a pure function of the reading:

- a year cited without the full date («l. 241/1990») is completed from Normattiva (`complete_request_date` →
  `act_dates.complete_year`, a lookup with a time budget); when the lookup fails the year stands, and
  `generate_urn` then writes **`<year>-01-01`** into the address (`urngenerator.complete_date_or_parse`), an address
  that is not the act's;
- an act cited by type, date and number whose article sits in an annex is found by reading the act's index from
  Normattiva (`get_tree`, the «smart lookup», `app.py:648-700`); a code takes its annex from the table
  (`codice_urn`);
- that lookup **guesses** where it cannot tell: an article found in several annexes goes to the one with the most
  articles, an article in both the body and an annex goes to the body (`app.py:677-706`); a failed lookup is logged
  and the body is used (`app.py:707-708`); and an existence check that cannot read the index answers «unknown»,
  which the route treats as present (`_source_spelling`, `app.py:725`). Right for a reader, who sees the text and
  its heading; not for a link nobody will open before the judge;
- a range is expanded on the act's index (`parse_article_input`);
- every step logs the request at info level (`app.py:520`, `:566`, `:575`, `:578`, the annex lines, `:727`, `:846`;
  `urngenerator.generate_urn` writes the act, number and article into `norma.log`; `treextractor.get_tree` logs the
  act's URN, `treextractor.py:93`, `:106`, `:124`; `eurlex_scraper.get_uri` the EUR-Lex address, `:345`, `:348`;
  `act_dates` logs a failed lookup with the act's URN). `urngenerator` and `treextractor` use the standard `logging`
  module, the rest structlog.

So the browser cannot build the address (the annex and the date need Normattiva, and #385 forbids it anyway), and
the existing route cannot be called once per citation (one point each, 300 citations is the whole minute's quota,
and each call logs the norm).

## 3. The address of a citation

### 3.1 A batch of its own

**Proposed: `POST /fetch_norm_links`**, a new path, never part of `/parse_query_batch` (which must stay without
network, #376 §4.4).

- **Body** `{"norms": [{act_type, act_number, date, article, annex?}, …]}`: the `parsed` readings the page already
  holds (client or server), one per distinct norm, one article each (for a range or «e ss.» the browser sends the
  first article, §4.4), **never a query string or a passage**. At most 200 norms and 30
  distinct acts per call, the body at most 48 KB; anything else is a 400 that names the limit. The browser groups by
  act and cuts chunks by both counts.
- **One function, two routes.** The address half of `create_norma_visitata_from_data` (date completion, annex, URN,
  version) is taken out into a function both call, so the fetch and the link cannot drift — as `read_norm_query`
  was shared by `/parse_query` and the batch in PR 1. The function reports **how sure** it is (the date completed or
  not, the annex from the table, found, guessed or not looked up, the article present, absent or unknown); the fetch
  keeps its behaviour, guesses included, and the link route refuses every guess (below).
- **Answer** `{"results": [{"href": str | null, "reason": "ok" | "date_incomplete" | "article_missing" |
  "ambiguous_part" | "source_unavailable" | "not_linkable"}]}`, in the order asked. `href` is set only with `ok`.
- **What makes it `null`** (the server's part of «no wrong link», §4.3):
  - `date_incomplete`: the date is not a full ISO date after completion. The `-01-01` fallback is never sent as an
    address.
  - `article_missing`: the article is not in the act's index (the index Normattiva gives, read once per act and kept
    in the persistent tree cache `treextractor` already uses). For a code, the index of its annex.
  - `ambiguous_part`: the article is in more than one part of the act (the body and an annex, or two annexes) and
    the citation does not say which; the fetch's guess (§2.4) is never used for a link. The row says «l'articolo è
    sia nel testo sia in un allegato: scegli tu» and the user can name the annex, which makes it «scelto da te».
  - `source_unavailable`: Normattiva did not answer within the budget, or the index could not be read, or the
    article's existence came back unknown. Never the body by default. The page offers «Riprova» for these.
  - `not_linkable`: a type with no address, a reading that does not identify the act.
- **A time budget per call:** 20 seconds for the whole call (`LINKS_BATCH_BUDGET`); a date lookup alone may take up
  to 15 (`act_dates.LOOKUP_BUDGET`), so the norms not settled when the budget runs out come back
  `source_unavailable` and the browser asks again for those, in a smaller chunk. The browser waits 25 seconds for
  this route, not #376's 8.
- **Version.** The address is the text in force (`version: vigente`, an empty `!vig=`), as «Apri» opens it. Whether a
  filing's link should be dated (the day of the download) or undated is **G-395, open**: the body takes an optional
  `pin_day` (ISO), which the server writes as `!vig=<day>`, so either answer fits without a second endpoint. Without
  the article fetched, the page does not know `validity` or `upcoming`, so `linkPinDay`'s cases (#385) cannot be
  applied per article; if G-395 is answered «undated», an article with a change already announced links to
  Normattiva's latest text (G-355). That is the cost of not fetching 300 articles, and the spec says it in the
  report's help text, not hidden.
- **EU acts:** the act's EUR-Lex address (`EurlexScraper.get_uri`), as #385. `get_uri` builds it from the type, year
  and number without asking EUR-Lex, so a wrong number or a directive read as a regulation would give a dead link or
  another act's: the route checks the act exists by reading its EUR-Lex page through the scraper's own persistent
  cache (`_load_soup`), and answers `article_missing` when the article is not in it, `source_unavailable` when EUR-Lex
  is silent. The report says «link all'atto: EUR-Lex non ha un indirizzo per articolo».
- **Logging:** one line with the count, the number of distinct acts, the reasons counted and the duration; never an
  act, an article or an address, in this route and in everything it calls: every norm-carrying info line listed in
  §2.4 goes to debug or loses the norm. The test fakes the network at the HTTP layer (not by stubbing `get_tree`,
  which would hide `treextractor`'s lines), captures both structlog (as `test_akn_fetch.py:41-49` does) and the
  standard `logging` records, and asserts no act, article or address in any record, including on failure.
- **Price:** it reaches Normattiva (a date lookup and an index per new act, both cached), so 5 points a call in
  `DEFAULT_SCRAPE_COSTS`. A brief citing 60 norms in 15 acts costs one call. `scrapeGate.ts` is not in
  `.github/CODEOWNERS` (only `infra/` is, among the files this PR touches), so the other owner's review of the price
  is asked by hand.
- **Routing:** `/fetch_norm_links` matches no prefix the ingress and Vite already route, so the path goes into the
  `@legal` matcher of `infra/ingress/Caddyfile`, into `apps/web/vite.config.ts`'s proxy, and the ingress path test
  (`infra/ingress/paths.test.mjs`) holds them in step. `infra/` is a shared file: reserved in the owners' register
  before the branch. The web calls it through `legalFetch`.
- **The browser re-checks the answer** with `sourceAddress` (#385): an address outside the two hosts, or not `https`,
  is dropped even if the server sent it.

### 3.2 Decisions

A judgment gets a link only where a stable public address is already in the data (§2.3: the Corte costituzionale,
the Court of Justice, the administrative courts; not the Cassazione). But the page does not recognise decisions at
all (#376 treats «n. 13533/2001» as a number to dismiss), so there is nothing to link yet. **Out of scope**, listed: decisions as citations of the page, and their links,
are a spec of their own.

## 4. Which citations get a link

### 4.1 The states, from #376

| State on the row (#376) | Where it came from | Linked by default? |
| --- | --- | --- |
| resolved | its own words read by the client parser or `/parse_query_batch`, identifies the act, has an article | **yes**, once its address is `ok` |
| «scelto da te», this row | completed by hand on this row (#376 §5.4, «Solo a questa citazione») | **yes**: the user named the act for it |
| «scelto da te», applied to others | the act applied with «Anche alle altre N» or «A tutte le N da completare» (#376 §5.4) | **no**, until confirmed: the user did not look at each one |
| «dal contesto» | inherited within the paragraph (#376 §4.6) | **no**, until confirmed (below) |
| «Da completare» | not resolved | never; completing it makes it «scelto da te» |
| «Non è una norma» | dismissed | never |

### 4.2 Confirming, and leaving out

- **Inherited citations, and those completed in bulk, wait for one action.** Above the list, when there are any:
  «7 citazioni non avranno il link finché non le confermi» with «Rivedile», which filters the list to them; each row
  gets «Conferma» and the group «Conferma tutte (7)». Confirming does not change the act; «Cambia atto» stays.
- **Any row can be left out:** «Senza link» in its menu, undone the same way. A left-out row stays in the list, its
  mark plain.
- **No silent link.** The download and the copy carry exactly the rows the list shows as «con link», and the summary
  before the download counts them («38 citazioni avranno il link · 9 no: vedi perché»).

### 4.3 What keeps a wrong link out

1. **A link only from the citation's own words or the user's choice for that row** — never from a guess or a bulk
   choice not confirmed (§4.1).
2. **The address from the server's builder only** (§3.1), re-checked against the two hosts in the browser.
3. **No address on a doubt:** no full date, the article not in the act or its existence unknown, the part of the act
   ambiguous, an EU act not found, the source silent — `null`, and the row says why («Normattiva non conferma
   l'articolo 2943 in questo atto»).
4. **The link covers the citation, nothing more:** from the article head to the end of the act phrase, leaving out
   «l'», «dell'» and the punctuation after it (§6.3); a list links each number on its own (§4.4).
5. **The measure:** on #376's corpus and the blind one, zero wrong links is a condition of the PRs (§10).

### 4.4 Lists, ranges, acts alone

- **A list** («artt. 1223 e 1225 c.c.») is one link per article, as the marks of #376 §4.5: the first covers the head
  and the first number («artt. 1223»), the middle ones their number, the last its number and the act phrase («1225
  c.c.»).
- **A range** («artt. 1362-1371 c.c.») and «art. 167 e ss.»: Normattiva has no address for a range. Proposed: the
  link goes to the first article, said on the row (Q7).
- **An act named alone** («d.lgs. 81/2008», «Regolamento (UE) 2016/679»): proposed **not linked in this phase** —
  it is context for #376, and «codice civile» in a sentence of prose is not a citation the lawyer meant to link
  (Q6).
- **A clause** («art. 1453, comma 1, c.c.»): inside the link, which goes to the article. Normattiva has no address
  for a comma that the page could rely on.

## 5. Paste

### 5.1 The box

- Beside the drop zone on a computer, under it on a phone: a field «Oppure incolla il testo» (a `textarea`, up to
  2 million characters, 16 px text on a phone), and «Analizza il testo». The text goes through #376's pipeline as a
  TXT file would (a paragraph is a line); the page then looks as it does for a file, its title «Testo incollato».
- **Plain text in** (recommended, Q5): pasting from Word into a `textarea` keeps the words and the paragraphs, not
  bold, italics or styles. The other way — a field that takes the rich paste and keeps the formatting — needs the
  pasted HTML sanitised (DOMPurify 3.4, already a web dependency) and an HTML reader with a map, and it still would
  not keep a Word style. For a whole filing the Word file (§6) keeps every bit of formatting; the box is for a
  paragraph, a note, an email.

### 5.2 What comes back

**The addresses first.** A browser lets a page write the clipboard only close to the user's click (Safari inside
the click's handler, unless the `ClipboardItem` is given promises; Chrome within a few seconds), and the addresses
come from the server (§3). So the result page asks for the addresses when the user first asks for links — «Prepara i
link», which shows the summary of §6.7 — and «Copia con i link» then writes what is already in memory, at once. The
`ClipboardItem` is also built with promises, so a browser that accepts them waits for a late chunk without losing the
click. #385 had no such step: its address was already in the page.

«Copia con i link» writes, in one `navigator.clipboard.write` as #385:

- `text/html`: the text, each line a `<p>`, every character escaped, each linked citation an `<a href>` with the
  address of §3.1, and no other markup — no font, no colour, no class — so the destination's own style applies;
- `text/plain`: the same text with the address in brackets after each linked citation («art. 2043 c.c.
  (https://www.normattiva.it/…)»), for a field that takes no links;
- with no `ClipboardItem`, or a refusal: the plain form through `writeText`, and the toast says the links are in
  brackets.

The toast: «Testo con 12 link copiato». Under the button, one line: «In Word incolla con «Unisci formattazione»: i
link restano e il carattere è quello del tuo atto.» (Word's default for text from another program keeps the
source's look; «Unisci formattazione» keeps links and takes the document's font. Pages keeps the links on a plain
paste.) Checked by hand in Word and Pages in the browser pass of L5, as #385 did with its single link.

The HTML is built from the text, never from pasted markup: no sanitiser is on the path, and an address that fails
`sourceAddress` is not written.

## 6. The Word file

### 6.1 Reading with a map

L2 (§11) replaces `readDocx`'s expressions with a reader that walks the package's XML and returns, beside the text, a
map from each character to where it lives: the part (`word/document.xml`, `word/footnotes.xml`, …), the `w:t`
element, and the offset in its decoded text.

- **The same text as today** on every DOCX without the three defects of §2.1, hidden text, page breaks
  (`<w:br w:type="page"/>`, dropped today, a line break from now on) and the special characters of a run
  (`w:noBreakHyphen`, `w:softHyphen`, `w:sym`, `w:cr`, dropped today) — a test pins it on the fixtures — so #376's
  measures and the paste path see what they saw. Those special characters are characters of the text from now on
  («21‑bis» with a non-breaking hyphen reads as written), mapped to their run with no `w:t`; a citation that covers
  one is cut around it in the run, which the splice handles like a `w:t` boundary.
- **What Word does not show is not read:** `w:delText` and `w:moveFrom` content, `w:instrText`, `mc:Fallback` (the
  `mc:Choice` copy is read), `w:vanish` (hidden text) — fixed in the reading, so no citation is listed that the
  reader of the document cannot see. A tab, a break and a paragraph end are characters of the text with no `w:t`
  behind them.
- **Footnotes and endnotes are read** (#376's follow-up, done here): `word/footnotes.xml` and `word/endnotes.xml`,
  skipping the separator notes (`w:type="separator"`, `"continuationSeparator"`), drawn after the text under «Note»,
  each note a paragraph with its number («1. V. art. 7 l. 241/1990.»). A citation in a note is a citation like any
  other, inheriting within its note.
- **Bounded:** the central directory's declared sizes are checked before anything is inflated (each part at most
  50 MB inflated, the parts read at most 120 MB together, at most 2,000 entries, a part to be inflated whose declared
  ratio passes 200:1 refused — the entries copied raw are not inflated and not held to it), and the inflating stream is
  cut when it passes the declared size. The work runs in a Web Worker
  (§7.1), so a 300-page filing does not freeze the page.
- **Refused with words:** an encrypted DOCX (a CFB file, not a ZIP: «Il documento è protetto da password: aprilo in
  Word, togli la password e salvalo di nuovo.»), Strict Open XML (another namespace: «Salva il file da Word come
  «Documento Word» e riprova.»), duplicate entry names, entry names with `..`, a leading `/` or `\`, a part with a
  `<!DOCTYPE` (no OOXML part carries one: refusing it closes entity expansion at the door). `.doc` and `.docm` are not
  accepted, as today.

### 6.2 Writing: what the copy is

The download is a new file, «<nome> (con link).docx», built in memory; the file the user chose is not touched (a
page cannot write to it anyway). The copy is the original package with **only these parts changed**:

- `word/document.xml`, `word/footnotes.xml`, `word/endnotes.xml`, where a link goes;
- their relationship parts (`word/_rels/document.xml.rels`, `word/_rels/footnotes.xml.rels`,
  `word/_rels/endnotes.xml.rels`), created when a note part has none;
- `word/styles.xml`, only when it lacks the link style (§6.4);
- `[Content_Types].xml`, only in the rare package with no `rels` default.

Every other entry is copied **byte for byte, compressed as it was** — its local header, its data and its data
descriptor if it has one; its central record is copied with only the local header's offset rewritten (it moves when
an entry before it changes size), and a ZIP64 package is refused rather than half-carried (no filing of 15 MB needs
it) — so images, embedded fonts, settings, comments and custom XML come through untouched by construction, and the
test compares their data (§10).

**Edits are spliced into the original XML text**, not made on a parsed tree and serialised back: a browser's
`XMLSerializer` drops the XML declaration and rewrites quoting, empty elements and character references, which makes
the round trip unprovable byte for byte (§10.2) even where Word would accept the result. Splicing changes only the bytes of the runs a
link wraps; the rest of the part is the original, byte for byte (§10.2 checks it).

### 6.3 A link in the XML

A citation becomes:

```xml
<w:hyperlink r:id="rIdVlx3" w:history="1">
  <w:r><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:i/></w:rPr><w:t xml:space="preserve">art. </w:t></w:r>
  <w:proofErr w:type="spellStart"/>
  <w:r><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:b/><w:i/></w:rPr><w:t>2043</w:t></w:r>
  <w:proofErr w:type="spellEnd"/>
  <w:r><w:rPr><w:rStyle w:val="Collegamentoipertestuale"/><w:i/></w:rPr><w:t xml:space="preserve"> c.c.</w:t></w:r>
</w:hyperlink>
```

with, in the part's relationships,
`<Relationship Id="rIdVlx3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
Target="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043!vig="
TargetMode="External"/>`.

- **A citation across runs.** Word splits text into runs at every change of formatting, at the spelling checker's
  marks (`w:proofErr`), at an edit session (`w:rsidR`). The link takes the runs the citation covers, in order; a run
  only partly covered is cut in two at the citation's edge, **each half keeping the run's whole `w:rPr`**, so the
  formatting of every character is what it was. A half whose text starts or ends with a space gets
  `xml:space="preserve"` (without it Word drops the space).
- **Carried inside, as Word itself does:** `w:proofErr`, `w:bookmarkStart`/`w:bookmarkEnd` (Word's hidden
  `_GoBack` bookmark lands anywhere), `w:lastRenderedPageBreak` (inside a run). The schema allows them in a
  `w:hyperlink`; any other element between the covered runs leaves the citation untouched (§6.5).
- **The relationship's id** is new in its part (`rIdVlx` and a number not already used); one relationship per
  link, as Word writes them; the target escaped for XML.
- **The link text is exactly the citation's** (§4.3 point 4), cut on the map of §6.1.
- **Word is stricter than LibreOffice.** The children of `w:rPr` follow the schema's order (`w:rStyle` first; `w:color`
  and `w:u` in their places among the others): an element out of order is tolerated by LibreOffice and makes Word
  call the file damaged. The writer inserts by the schema's order, and a Vitest check walks every changed `w:rPr`
  against it — LibreOffice cannot be the test for this.

The probe of §10.1 builds this shape by hand — a link across three runs with a bookmark and spelling marks, a link
in a footnote, the localized style id — and LibreOffice 26.8 reads both links, the style and the text, and exports
both to PDF as links.

### 6.4 The link's look

- **The style Word uses for links** is the character style whose `w:name` is `Hyperlink`; its `w:styleId` is
  localized — `Collegamentoipertestuale` in a document made by Italian Word, `Hyperlink` in an English one. The
  writer looks it up by name in `styles.xml` and uses the id it finds. If there is none, it adds the definition Word
  adds (`w:name="Hyperlink"`, `w:uiPriority="99"`, `w:unhideWhenUsed`, colour `0563C1` with
  `w:themeColor="hyperlink"`, single underline), so the user sees the document as Word would make it. Its id is
  `Hyperlink` when free; when a style of another name already holds that id, a free one (`HyperlinkVlx`). A package
  with no `styles.xml` gets no style: the link's colour and underline go on its runs as direct formatting.
- **A run that already has a character style** (`w:rStyle`, e.g. a quotation style) keeps it — a run takes one
  — and gets the link's look as direct formatting (the colour and the underline), only where the run sets neither.
- **The alternative** is to keep the text's look and add no style: the links work, but a judge reading on screen
  cannot see them. Recommended: Word's style (Q4).

### 6.5 What is left untouched, and said

A citation is **not linked** — it stays exactly as it is, and the report names it with the reason — when it:

| Case | Why | The report says |
| --- | --- | --- |
| is already a link (`w:hyperlink`, or a `HYPERLINK` field) | the author linked it | «già collegata» |
| lies in a field's result (`w:fldSimple`, or between `w:fldChar` `separate` and `end`) | Word rewrites a field's result when it updates it | «in un campo di Word» |
| touches a tracked change (`w:ins`, `w:del`, `w:moveTo`, `w:moveFrom`, `w:rPrChange` on its runs) | a link inside a revision not accepted is the author's call | «in una revisione non accettata» |
| lies in a content control (`w:sdt`) | a template or a form owns that text | «in un campo modulo» |
| crosses a comment's range edge (`w:commentRangeStart`/`End` strictly inside it) | moving the edge changes what the comment covers | «a cavallo di un commento» |
| lies in a text box, a `w:smartTag` or `w:customXml` wrapper, or crosses a tab, a break or a paragraph end | the splice would have to rebuild structure | «in una posizione che non modifico» |
| lies in a header or a footer | not read (Q3) | not listed at all |

The comments themselves (`comments.xml`) are copied as they are, and not read.

**The whole file is refused for writing**, with its reason, when it is digitally signed (`_xmlsignatures/` in the
package: «Il documento è firmato digitalmente: una copia con i link perderebbe la firma.») — the reading and the
list still work.

### 6.6 Tracked changes: weighed, not recommended

Writing the links as tracked changes would let the lawyer accept or reject each in Word. Three ways exist in Word's
format:

- **as a formatting change** (`w:rPrChange` on the runs): rejecting it removes the blue and the underline and
  **leaves the link** — the review would lie;
- **as a deletion and an insertion** of every linked citation: rejecting restores the text, but the document fills
  with 40 or 100 revisions, each citation shown struck out and written again, among the author's own revisions;
- **as a `HYPERLINK` field** whose field characters and instruction are a tracked insertion (`w:ins` around the
  runs holding `w:fldChar` and `w:instrText`), the citation's own runs left as the field's result: rejecting should
  leave the plain text with no struck-out copy. It is the least noisy, but still one revision per link, and how Word
  shows and rejects it has not been tried; it would have to be proved in Word before it is offered.

**Recommended:** none of the three for now — a plain copy, reviewed on the page before the download (§4.2) and
described after it (§6.7). The original stays as it was, so nothing is lost if the lawyer does not want the copy. If
the owners want revisions, the field form is the one to prove first (Q2).

### 6.7 What the user sees

1. On the result page, a second button beside «Scegli un altro documento» for a DOCX: «Scarica una copia con i
   link», and under it «Il file originale non viene modificato.»
2. «Prepara i link» (shared with the paste path, §5.2) asks the server for the addresses, then shows a summary in
   place (not a dialog): «38 citazioni avranno il link (34 nel testo, 4 nelle note) · 9 no», the nine grouped by
   reason (§4, §6.5), each opening its row. «Scarica» and «Annulla».
3. After the download, the same summary stays as «Copia scaricata: 38 link inseriti», with the list of the citations
   left without one and why, and the PDF line (§9). The report is on the page only: nothing is added to the file.

## 7. Where the work happens

The DOCX must be read (it already is, in the browser), changed and packed again. The addresses come from the server
in every option (§3). The options differ in **where the file goes**.

### 7.1 (a) In the browser — recommended

- **What leaves the computer:** the norms to link, as `{act, number, date, article}` (§8). The file, its text and
  its name never do. The promise of #376 stays true, with one more thing named.
- **Libraries:** none new. The package is read and written by the page's own code, which grows from `readDocx`:
  inflating with `DecompressionStream('deflate-raw')` (as today), deflating the changed parts with
  `CompressionStream('deflate-raw')`, a CRC-32 (a 256-entry table, a few lines), and the ZIP records. Copying the
  unchanged entries raw (§6.2) is the reason to keep it in-house: the libraries' high-level writers recompress every
  entry. The alternative is `fflate` (MIT, small, tree-shakeable; one maintainer): if the web owner prefers it,
  pinned to an exact version and approved by the web owner, as any web dependency (I-2: the owners' rule that a
  change to the web alone needs the web owner's agreement).
- **Browser support:** the same as the reader's today — Compression Streams with `deflate-raw` are in current Chrome,
  Edge, Firefox and Safari (16.4 and later).
- **OWASP, still:** the attacker is a file from the other side of a case and the target the user's tab. Zip bomb:
  the bounds of §6.1. Entity expansion: a `<!DOCTYPE` refuses the part; the reader is a tokenizer that knows the five
  predefined entities and numeric references, nothing else. Path traversal: no file system, but names with `..`,
  `/` or `\` at the start and duplicates are refused all the same, so the copy never carries an ambiguous package.
  Size: the 15 MB limit on the file stays. Links: only addresses that pass `sourceAddress`.
- **Cost:** about 900 lines of web code and their tests (reader with map, writer, worker); the web owner's area.

### 7.2 (b) On the Python server

- **What leaves:** the whole filing, uploaded on each analysis, held in memory, sent back. The promise becomes «il
  documento viene inviato a VisuaLex per inserire i link e non viene conservato», true only as long as no log, crash
  report or proxy keeps a body; the ingress caps scraping bodies at 1 MB (`Caddyfile`), so the route needs its own
  cap and a change to `infra/`. A filing is client data, and the repository's rule is that nothing private leaves
  without need: here there is no need, since the browser can do it.
- **Libraries:** `zipfile` (standard library) and `lxml` (BSD, already required, `>=5.0`), parsed with
  `resolve_entities=False`, `no_network=True`, `load_dtd=False`, `huge_tree=False`; or `defusedxml` (PSF) in front.
  `python-docx` (MIT) does not write hyperlinks and re-serialises every part it opens: not suited.
- **OWASP:** zip bomb (the same bounds, enforced before `ZipFile.read`, which trusts the declared size only loosely),
  XXE and billion laughs (the parser flags above), zip slip (never extract to disk; read entries into memory only),
  memory exhaustion under concurrent uploads (a semaphore and a per-user price), and a new upload surface behind the
  login.
- **What it buys:** the same writer for the MCP server one day (LibreLex could ask for a linked copy). Not asked now.

### 7.3 (c) On the Node server

The same costs as (b), with `jszip` (MIT or GPL-3.0, dual) or `fflate` and an XML tokenizer; the address still comes
from Python, so the file and the norms would cross two services. No reason to prefer it.

### 7.4 Recommendation

**(a), in the browser** (Q1): it keeps the document on the user's computer, which #376 promised and the repository's
rule asks; it needs no new dependency; and the reader it extends is already there. Its cost is web code in one owner's
area, which that owner handles for this feature.

## 8. What leaves the computer — #376 §6, updated

- **For the list** (#376, unchanged): the query strings the client parser could not resolve.
- **For the links, new — and a change to #376 §6.1:** #376 lists among what never leaves «a bare article, an
  article in the picker, a choice made there». A link needs the address of the norm the row resolves to, so a request
  for links sends every norm the user will link, as its reading `{act_type, act_number, date, article}` — including
  the norm of a bare article inherited and confirmed, or completed by hand (the act chosen, joined to the article).
  What it never sends is unchanged otherwise: the article as typed in the picker, the passage, the place. In detail:
  every norm the user will link,
  each distinct norm once, in POST bodies of `/fetch_norm_links`; the act (not the document) may then be looked up by
  VisuaLex's server on Normattiva, from the server's address, cached. This is more than #376 sends — #376 sends
  nothing for a citation the browser resolves alone — and it is sent only when the user asks for links («Copia con i
  link», «Scarica una copia con i link»), not on reading.
- **Never:** the document, a passage, a clause, the file's name, which citation sits where, which rows were
  completed by hand or inherited (the server sees a norm, not how it was found).
- **With «Riconosci solo nel browser» on** (#376 Q3): no request at all, so no links; the two buttons say «Per
  inserire i link VisuaLex deve ricevere le norme citate (non il testo).» and offer to turn the switch off for this
  document.
- **The words** are the web owner's. Proposed, under the two buttons, the first time: «Per i link, a VisuaLex arriva
  l'elenco delle norme citate (per esempio «art. 2043 c.c.»), non il testo del documento.»

## 9. The PDF

One line in the report after the download, and under «Copia con i link»:

«Per depositare un PDF con i link attivi, esporta il PDF da Word («Salva con nome» › PDF), non stamparlo in PDF: la
stampa toglie i link.»

## 10. Measures

### 10.1 Already run for this spec

- The three reading defects of §2.1 (deleted text, a field's instruction, a text box read twice): `readDocx`'s
  expressions run on a twelve-line sample give «Visto lart. 5 c.c. REF _Ref1 \h art. 7BOX\nBOX». L2 turns the
  sample into a test.
- The link shape of §6.3, built by hand in a synthetic DOCX (body link across three runs with `_GoBack` and spelling
  marks, a footnote link, the Italian style id) and converted by LibreOffice 26.8 headless: to HTML, both `<a href>`
  with the Normattiva addresses and the link colour from the localized style; to PDF, the links present as URI
  annotations. No product code; the probe stays out of the repository.

### 10.2 What each PR proves

On #376's synthetic corpus and on DOCX fixtures built for this spec, **synthetic text only — never a real filing**:

- **Fixtures:** written as unpacked XML in the repository (readable, reviewable, diffable) and zipped by the test
  helper; each from a corpus text plus one structure: a citation across runs with three formats; `_GoBack` and
  `proofErr` inside a citation; leading and trailing spaces at a cut; an existing `w:hyperlink` and a `HYPERLINK`
  field; a `REF` field; `w:ins`, `w:del`, `w:moveTo`; a `w:sdt`; a comment range across a citation; a text box with
  its fallback; hidden text; footnotes and endnotes with separators; a note part with no relationships; `styles.xml`
  with `Collegamentoipertestuale`, with `Hyperlink`, and with neither; a run with its own `w:rStyle`; entities
  (`&amp;`, `&#8217;`) inside a citation; a signed package; a ZIP bomb by declared ratio; a `<!DOCTYPE`; duplicate and
  `..` names. Plus **two packages saved by the real programs** — one by Word, one by LibreOffice — with a synthetic
  text typed into them, to catch the producers' habits (data descriptors, `mc:Ignorable`, `w14` attributes), kept as
  binary fixtures. **Cleaned before they enter the repository**, which is public: `docProps/core.xml`
  (`dc:creator`, `cp:lastModifiedBy`), `docProps/app.xml` (`Company`, `Template`), `word/settings.xml`
  (`w:attachedTemplate`, which holds a path) and every `w:author` and `w:initials` on revisions and comments are set
  to neutral values («Autore di prova»); a test unpacks every fixture and fails on a path (`/Users/`, `C:\`, `\\`),
  an e-mail address or any author other than the neutral one.
- **Round trip, in the web suite (Vitest):**
  1. every entry not in §6.2's list is byte-identical between input and output;
  2. the reader of §6.1 gives the same text, character for character, for input and output;
  3. per character, the effective run properties are the same, once the link style and the direct link formatting
     of §6.4 are taken away;
  4. taking every inserted `w:hyperlink` wrapper out, the link style or direct link formatting and the
     `xml:space` the writer added, and merging back the runs cut in two, gives the original part byte for byte;
  5. each inserted relationship is `External`, its id unique, its target an address that passes `sourceAddress`;
  6. the citations of §6.5 are untouched and reported with their reason;
  7. the corpus as DOCX: the links inserted equal the rows «con link», and **zero wrong** (a link whose article or
     act differs from the corpus's mark);
  8. every changed `w:rPr` has its children in the schema's order, and no two styles share an id (§6.3, §6.4).
- **Opens in the programs:** a script (`tools/e2e/docx-roundtrip/`, run by hand and in the browser pass, not in CI,
  which has no LibreOffice) converts every output with `soffice --headless --convert-to html` and `pdf`, fails on a
  conversion error, counts the `<a href>` per address against the report, and compares the text to the input's
  conversion. Word: an owner opens the corpus outputs on a Mac once per writer PR and says so in the PR; Word reports
  a damaged file with a dialog that cannot be missed.
- **Paste:** the HTML builder tested on the corpus (escaping, one `<p>` per line, `<a>` only for linked rows, plain
  form with addresses in brackets); pasted into Word and Pages by hand in L5's browser pass.
- **Server (pytest):** `/fetch_norm_links` limits and their 400s; `date_incomplete` when the lookup fails (the
  `-01-01` never returned); `article_missing` on a cached index; `ambiguous_part` for an article in the body and an
  annex; `source_unavailable` for an unreadable index and an unknown existence (never the body); the budget; a code's
  annex; an EU act found and not found; `pin_day`; the logging test (§3.1); the shared function returns for `/fetch_norma_data` exactly what it returned before (its suite unchanged
  and green).

## 11. The pull requests, in order

They extend #376's plan; #376's numbering is kept for its own PRs.

| # | Area | What | Needs | Approves |
| --- | --- | --- | --- | --- |
| L1 | Python API, quota, ingress | `/fetch_norm_links` (§3.1) on the address function shared with `create_norma_visitata_from_data`; the shared function's sureness, limits, reasons, budget, `pin_day`, the EU check, logging test; the price in `DEFAULT_SCRAPE_COSTS`; the path in `Caddyfile`, `vite.config.ts`, `paths.test.mjs`; the area `CLAUDE.md` files. M | #381 (merged); `infra/` reserved in the register | the owner; CODEOWNERS asks the other owner for `infra/`, the quota's price is asked by hand |
| L2 | Web, logic | the DOCX reader with its map (§6.1): notes, the three reading defects fixed, bounds, refusals, in a Web Worker; `readDocx` becomes a wrapper giving the same text; fixtures. M–L | none: can go before #376 PR 2 | the web side: the owner, who handles it for this feature (in place of I-2's web owner, by the owner's word of 31 October) |
| L3 | Web, logic | the link set (§4) and the address client (chunks by norms and acts, `sourceAddress`, «Riprova»); «Prepara i link» as state; the paste HTML/plain builder (§5.2); pure, tested on the corpus with recorded answers. M | #376 PR 2, L1 | as L2 |
| L4 | Web, logic | the DOCX writer (§6.2–§6.5): splicing, run cutting, relationships, style lookup, untouched cases, signed refusal, the package writer copying raw entries; round-trip tests (§10.2), the cleaned fixtures and their check, and the LibreOffice script. L | L2, L3 | as L2; Word check by an owner |
| L5 | Web, screens | the paste box, «Prepara i link», «Copia con i link», «Scarica una copia con i link», «Conferma» / «Senza link», the summary and report, the words of §8 and §9; phone and keyboard as #376 §5.6; browser pass with Word and Pages. M | #376 PR 3, L4 | as L2; the words with the other owner, as #376 PR 3 |

L5 ships with #376 PR 3 or after it, under the same bar (G-375, run on the blind corpus). If the owners want the paste
path before the Word file, L4 can follow L5 and L5 shows only «Copia con i link» until it does.

## 12. Questions for the owners

1. **Where the work happens** (§7). *Recommendation:* in the browser — the filing never leaves the computer, no new
   dependency; the server builds addresses only.
2. **Tracked changes for the links** (§6.6). *Recommendation:* not now — a rejected formatting change leaves the
   link, delete-and-insert buries the author's revisions, and the field form is untried in Word; review on the page
   instead, and a copy beside the untouched original. If wanted, prove the field form in Word first.
3. **Headers and footers.** *Recommendation:* not read, not linked: a header repeats on every page and rarely cites a
   norm; footnotes and endnotes are read and linked.
4. **The links' look** (§6.4). *Recommendation:* Word's own link style (blue, underlined), so the judge sees what can
   be clicked; a run with its own character style keeps it and takes colour and underline directly.
5. **The paste box** (§5.1). *Recommendation:* plain text in, rich text with links out; the Word file is the way to
   keep formatting.
6. **Acts named alone** (§4.4). *Recommendation:* not linked in this phase; only article citations.
7. **Ranges and «e ss.»** (§4.4). *Recommendation:* the link goes to the first article, said on the row.
8. **Inherited citations and acts applied in bulk** (§4.1). *Recommendation:* no link until confirmed, with «Conferma
   tutte»: within the paragraph #376 measured no wrong one, but a filing's link is the lawyer's statement, the bulk
   scopes of #376 §5.4 reach citations the user did not look at, and the blind corpus has not run yet.
9. **G-395, a dated or an undated link** — already open, not answered here. This spec is built to take either
   answer (`pin_day`, §3.1); it only adds that a filing is read later than it is written, which may weigh for the
   day of the download.
10. **What the links send** (§8) — a change to #376 §6.1, decided there. *Recommendation:* accept that a request for
    links sends the list of norms, those of bare articles inherited or completed by hand included (never text, never
    the place), only when the user asks for links; say it with an example under the buttons; disable links with
    «Riconosci solo nel browser» on.
