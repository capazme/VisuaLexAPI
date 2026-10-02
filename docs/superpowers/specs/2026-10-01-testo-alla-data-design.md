# The text as at a date — Design

**Date:** 2026-10-01
**Status:** APPROVED by the owner on 1 October 2026, with the questions of §10 answered; built on
1–2 October 2026 in three pull requests (the server states the window, the reader shows it, the
dossier keeps it), as the plan describes. The citation style is the owner's (§5.2); the wording of
the Massimario row (§9, P4) was decided by the owner on 1 October.
**Plan:** `docs/superpowers/plans/2026-10-01-testo-alla-data.md`.
**Branch:** `docs/testo-alla-data`
**Round:** the reading surface, after rounds A–C (`2026-09-25-lettura-testo-design.md`,
`2026-09-25-annotazioni-sul-testo-design.md`). Vanilla: no MERL-T dependency.
**Coordinated with:** the Massimario round (`2026-10-01-rassegne-massimario-design.md`: §9
answers its open point on placement) and the sentenze round (`2026-10-01-sentenze-design.md`:
both build lawyer-style citations).

## 1. Context and intent

In this round the owner reads a norm for two things, as the owner described them:

- **(a) to qualify a fact that already happened** — "which rule applied that day";
- **(b) to cite a norm "in the text in force at…"**, in a pleading or an opinion.

The owner did not choose the two other uses offered: seeing *what changed between then and
now* (an amendment timeline, a comparison of versions), and verifying the text somebody else
cited. Both stay out of the first slice (§3).

**What exists today.** The toolbar's "…" menu has "Cerca versione…", which asks for a date and
opens the result in a *second floating window* labelled `… - Ver. <date>`
(`ArticleTabContent.tsx:1156-1213`, `SearchPanel.tsx:237,431-441`). Read against the code and the
live pages (§2), it has these faults:

1. **The reader is told a date the source never gave.** The toolbar prints `Aggiornato al:
   <data_versione>` (`ReadingToolbar.tsx:79-84`). `data_versione` is the *echo of the date the
   reader typed* (`services/visualex/app.py:571`), not a fact from Normattiva. The version that
   comes back actually runs, say, from 25-12-2003 to 29-12-2007.
2. **"Vigente" is not a status, it is a default.** The badge renders for every read that is not
   historical (`ReadingToolbar.tsx:69-78`) and nothing in the toolbar checks for repeal. The
   current text of art. 594 c.p. is the notice "ARTICOLO ABROGATO DAL D.LGS. 15 GENNAIO 2016,
   N. 7". What the badge shows next to it was not observed live; the code says "Vigente".
   `originale` without a date is not marked historical either (`SearchPanel.tsx:150-157`).
3. **Doctrine is requested for the historical text** (`show_brocardi_info: true` in the dialog,
   `ArticleTabContent.tsx:1190`, and in `dossierUtils.searchParamsFromNorma`, line 68). Brocardi's
   commentary and massime carry no date: a 2005 text appears with today's commentary. The stream
   handler also waits for it (`asyncio.gather` of the text and the Brocardi fetch,
   `services/visualex/app.py:236-240`), and `fetch_all_data` (line 1114) fetches it for every
   Normattiva article whatever the version, except an explicit request for a code's dispositivo.
4. **The date is not checked against what comes back.** A future date makes Normattiva answer
   with the *current* text, with no sign that the date was ignored (§2). A date before the
   article existed comes back as an article whose text is "… NON ANCORA ESISTENTE O VIGENTE".
5. **Annotations are version-blind.** `buildItemKey` has no version segment
   (`utils/normaKeys.ts`; the key contract is described in `apps/web/CLAUDE.md`, "Reading
   surface", and rule 23 of the root `CLAUDE.md` governs the text): a note made on one version
   is the same note on every other. This round does not change the key (§5.2); it keeps notes
   and highlights out of historical texts.
6. **The dossier mostly keeps the version, with two gaps.** `searchParamsFromNorma` honours
   `versione` and `data_versione` when an item is reopened (`dossierUtils.ts:57-70`), and the
   article toolbar's "Aggiungi a dossier" stores the whole `norma_data`, version included. But
   the window header's "Aggiungi a dossier" builds its own object *without* `versione` or
   `data_versione` (`WorkspaceTabPanel.tsx:93-131`), so adding from a historical tab that way
   saves the current text under the same label; and `dossierContainsArticle` ignores the
   version (`dossierUtils.ts:115-125`), so two versions of one article cannot sit in the same
   dossier ("Già presente", `AddToDossierPopover.tsx:160-166`).

## 2. What was measured

All on 2026-10-01, from live Normattiva pages and from the code named. 27 article pages from
seven acts were fetched one at a time, three seconds apart, with the URN the app itself builds
(`generate_urn`, annex added the way `create_norma_visitata_from_data` adds it: the c.c. is
`:2`, the c.p. and c.p.c. are `:1`). Plus six calls to the update-table endpoint. The pages were
kept outside the repository and none is committed; §7 recaptures trimmed fixtures.

| Act | Articles and dates |
|---|---|
| c.c. | art. 1284 at 2007-12-29, 2007-12-30, 2025-12-27, 2030-01-01 |
| Costituzione | art. 9 (2020), art. 81 (2010), art. 117 (2000) |
| c.p. | art. 594 (2015, 2020, original), art. 640 (2005, 2015) |
| c.p.c. | art. 183 (2005, 2015), art. 183-bis (2010, 2016, 2024) |
| D.Lgs. 196/2003 | art. 7 (2010, 2019), art. 2-ter (2017) |
| L. 241/1990 | art. 2 (2000, 2012, 2016) |
| L. 300/1970 | art. 18 (original, 2010, 2013, 2016) |

**Findings.**

- **Every page states its own window.** 27 of 27 carry "Testo in vigore dal: D-M-YYYY" with one
  of three shapes: `dal … al …` (22 pages), `dal` only (3: the version in force, or an article
  repealed from that day on), `al` only (2: the article did not exist yet; the window ends the
  day before it did). Dates are written without padding (`1-1-1948`). In the repository's
  fixtures the start sits in `<span id="artInizio" class="rosso">` inside `div.vigore`
  (`tests/fixtures/normattiva/attachment.html`, `abrogato.html`); the end date's markup is read
  from a historical page in the plan (§7), because the spike read the page's text, not its ids.
- **The requested date always falls in the returned window**: 0 exceptions on the 25 pages that
  had a date (2 of them the not-yet-existing pages, whose window is "up to").
- **Windows are contiguous.** Art. 1284 c.c.: version 7 runs to 29-12-2007, version 8 starts on
  30-12-2007.
- **Same window, same text** (checked twice): art. 1284 on 2005-06-01 (a page captured on
  2026-09-30) and on 2007-12-29, and art. 18 St. lav. on 2013-01-01 and on 2016-01-01, returned
  identical article text. One request per version is enough.
- **A future date returns the current text** (art. 1284 at 2030-01-01: "dal 28-12-2025", no
  `al`), with no sign that the date was ignored.
- **Not yet existing.** Art. 183-bis c.p.c. at 2010-01-01: "al: 12-9-2014" and the text "…
  NON ANCORA ESISTENTE O VIGENTE"; the same article at 2016-01-01 starts on 13-9-2014.
- **Repeal is a fact of the source.** Art. 594 c.p. at 2020-01-01: version 2, "dal 6-2-2016",
  body `((ARTICOLO ABROGATO DAL D.LGS. …))`. The repository already knows the markup:
  `div.ins-akn.art_abrogato-akn` (`tests/fixtures/normattiva/README.md`).
- **The page names its own version.** The link to the update table carries `art.versione=N`
  (absent when the article was never amended). That is how version 7 of art. 1284 was told
  from version 8.
- **Latency.** Normattiva alone answered in 0.18–2.26 s (median 0.66 s), pages from 90 KB to
  1.65 MB. The 15–25 s a reader waited for a historical text in the development stack (an audit run
  on 2026-09-30, not kept in the repository) is therefore not Normattiva's; the stream handler
  also waits for Brocardi (§1.3). Measured on 2 October 2026 with the app's own handlers
  against the real portals, five cold requests each, median: the text in force with Brocardi
  2.5 s; without it 2.6 s; a past text, Brocardi asked for and not fetched, 2.5 s (four cold
  reads of 2.4–3.0 s and one answered from the cache in 0.2 s). Brocardi, fetched alongside the
  text, did not lengthen the read in this sample, so leaving it out of a past text is a
  correctness guard (doctrine is current and carries no date), not a speed-up, and the 15–25 s
  of the audit run are not reproduced; the guard is checked by counting the fetches (five in
  force, none for a past text).
- **Which act produced a version.** The update table is reachable (needs a Normattiva session;
  0.1–0.6 s) and returns the article's *whole* list of amendments (24 rows for art. 1284,
  identical for versions 7 and 8). Attributing version N to row N−1 held 4 times out of 5
  (art. 1284 v7 and v8, art. 2 L. 241/1990 v5, art. 18 St. lav. v4) and failed on art. 183
  c.p.c. v9 (17 updates, no row fits). **It is not used in this round.** For art. 1284 the
  window starts exactly 15 days after the Gazzetta Ufficiale date of the newest note on the
  page (4 of 4 versions); the other acts' notes do not carry that date in a usable form.
- **A request that is not for the article asked can still answer 200.** The first run built the
  c.c. URN without its annex and Normattiva answered with the page of the *decree* that
  approves the code. The extraction therefore checks that the page is the article requested
  (§5.1).
- **Not covered:** an act without history. None of the seven was one, so the rule "the date must
  fall inside the window, otherwise warn" (§5.2) is built from the 25 cases above but has not
  met a real counter-example.

A legal point the examples make concrete. Art. 1284 c.c. reads "5 per cento" in the 2003–2007
version and in the current one; the rate that applies is in the notes. The 2003–2007 version is
"in vigore dal 25-12-2003", while the note says the new rate runs "con decorrenza dal 1°
gennaio 2004". Another note ties other changes to proceedings begun after a date, not to the
date of the fact. So *the window says which text was in force; it does not say which discipline
governs a fact*. Everything the reader sees in this round says the first and never the second.

## 3. Goals and non-goals

Goals:

- A reader can ask for the text of an article as at a date, see **which version came back** (the
  source's own window) and which state it is in (in force, historical, not yet existing,
  repealed), and cite it in the way a lawyer writes.
- "Vigente" stops being a default: a status is shown only when the source states it.
- A historical text is a *reading*: it carries no commentary of undated provenance, and it
  takes no notes, highlights or discussions, so nothing is anchored to the wrong text.
- The dossier keeps the version from every door and holds two versions of one article.

Non-goals (this slice):

- An amendment timeline, a list of versions, a comparison of two versions. (Later, §8.)
- Naming the act that produced a version (§2: 4 of 5).
- Annotating a historical text. It needs the version in the annotation key: a Prisma change
  that is for the other developer to approve.
- EU acts. `generate_urn` returns the EUR-Lex URI before the version is appended
  (`urngenerator.py:114` against `:157`), so the date is ignored there. The control is
  disabled for them, with the reason stated.
- Changing the text or its offsets, or any line of `normattiva_scraper.py`.
- Deciding which date is the relevant one in a case (the fact, the claim, the filing): the
  reader chooses.

## 4. Decisions

| # | Decision | Why |
|---|---|---|
| T1 | **The window comes from the source's page, never from the request.** | The request's date is an echo (§1.1). The window is the only statement the source makes about which version it returned. |
| T2 | **One state vocabulary: `current`, `historical`, `not_yet`, `abrogated`, and no state at all when the page cannot be read.** No state is a default. | "Vigente" as a default is the defect (§1.2). Silence is truer than a guess. |
| T3 | **A historical text is read-only reading:** no Brocardi, no notes, highlights, discussions or quick-norm, no Study Mode, no saved-norm check. | The doctrine is undated; the annotation key is version-blind (§1.3, §1.5). Switching them off is a UI rule; the data model is untouched. |
| T4 | **The server enforces, the client mirrors.** A future date is refused and Brocardi is not fetched when the request is historical, whichever door the request came from. | Historical requests also come from the dossier, History, `/?norma=` links and the command palette. One guard covers them all. |
| T5 | **In this slice the historical text stays in its own tab, as today.** Switching the text inside the page comes after the reader is extracted from the window. | It is where the redesign work lies (`ArticleTabContent` is 1,234 lines with ~25 consumers of `article_text`); the pure parts below survive any layout. |
| T6 | **No claim about the act that produced a version.** | 4 of 5 is not good enough for a citation (§2). |
| T7 | **The dossier tells versions apart.** Two items are the same only if act, article, version and date agree. Every add path stores the version. | §1.6. |
| T8 | **One pure function builds the citation,** with a golden file the owner reviews. | The wording is a legal call, and it must not drift between the toolbar, the banner, the dossier and the copy action. |
| T9 | **`article_text` is untouched and the window is read without a second request.** A new module reads the raw page the scraper already keeps in its persistent cache. | Rule 23 of the root `CLAUDE.md`; `normattiva_scraper.py` needs the other developer's approval. |

## 5. Detailed design

### 5.1 The server

**A new module,** `services/visualex/visualex_api/services/normattiva_validity.py`, pure
functions plus one reader of the cache. It does not import the scraper.

*Where it reads.* `NormattivaScraper.get_document` stores the raw page in the persistent cache
under the URN it returns (`normattiva_scraper.py:25,34,39`, namespace `normattiva`, shared by
the filesystem and the Redis backends, `tools/cache_manager.py`). After `get_document` returns
`(text, urn)` the handler asks `get_cache_manager().get_persistent("normattiva").get(urn)`. No
page, no `validity`: the field is simply absent. No network, no change to the extraction.

*What it extracts*, from the HTML as served (never from `article_text`):

| Field | Source |
|---|---|
| `valid_from` | `#artInizio` in `div.vigore` (text fallback: `Testo in vigore dal:`) |
| `valid_to` | the date after `al:` in the same block (confirmed against a historical fixture, §7); `None` when absent |
| `version_number` | `art.versione=N` in the `data-href` of `vediAggiornamentiAllArticolo…`; `None` when the link is absent |
| `act_updated` | "Ultimo aggiornamento all'atto pubblicato il dd/mm/yyyy", when present (not on every act) |
| `state` | below |

*State, from the page, in this order:*

1. `not_yet` — the window has only `al`, and the body says "NON ANCORA ESISTENTE O VIGENTE".
   `valid_from` is `None`; `valid_to` is the last day before the article exists.
2. `abrogated` — `div.ins-akn.art_abrogato-akn` is inside `div.bodyTesto` **and nothing else of
   substance is**: remove the label ("Art. N", "Codice Penale-art. N"), the abrogation div and
   punctuation, and nothing remains. A partial notice ("COMMA ABROGATO…") leaves text behind
   and is *not* this state. `valid_from` is the day the abrogation takes effect; `valid_to` may
   be set if the article came back later.
3. `current` — an open-ended window (`al` absent), or one that ends today or later (today in
   Rome): on the last day of its window the text is still the one in force.
4. `historical` — a window that ended before today (in Rome).

*Read cheaply.* The window, the version link and the act line come from targeted regexes over
the raw string (the page is up to 2.6 MB; the scraper already parses it once and it should not
be parsed twice). The abrogation test parses only a bounded slice (≤ 200 KB) starting at
`div.bodyTesto`.

*Check that the page is the article asked for.* The label found in `div.bodyTesto` is compared
with `nv.numero_articolo` through `normalize_article_key` (`akn_parser.py`). On a mismatch the
module returns nothing: `validity` is absent and the UI says nothing (§2, last-but-one finding).

*Check that the window contains the request.* When the request carried a date, the result has
`request_in_window`: true or false. False is not an error for the server; the client treats the
text as unreliable (§5.2).

**The wire.** `validity` is added next to `article_text` in the three handlers that serve an
article from `get_document`: `stream_article_text` (`app.py:203`), `fetch_article_text` (`:788`)
and `fetch_all_data` (`:1114`). Additive: a client that ignores the key behaves as today.

```json
"validity": {
  "state": "historical",
  "valid_from": "2003-12-25",
  "valid_to": "2007-12-29",
  "version_number": 7,
  "act_updated": "2026-08-11",
  "request_in_window": true
}
```

**Guards,** written once:

- **A future `version_date`** (later than today in Europe/Rome) raises `ValidationError` inside
  `create_norma_visitata_from_data` (`app.py:382`), which every handler that reads an article
  calls first, so no door skips it. The message says why: Normattiva would answer with the
  current text. Date *format* is already strict (`text_op.parse_date`, `:174`; the extended
  Italian form is not calendar-checked, a pre-existing gap noted in §8).
- **A historical request** (`version == 'originale'` or a `version_date`) never fetches
  Brocardi. One helper decides, and it is called at the three places that call
  `brocardi_scraper.get_info`: `stream_article_text` (`:238`), `fetch_brocardi_info` (`:1081`)
  and `fetch_all_data` (`:1155`). The text then no longer waits for the slowest source.

**Cost and approvals.** The stream route costs 3 points of quota (`scrapeGate.ts:14`) and stays
at 3: no new route, no new egress host. Brocardi is no longer asked on a historical read, which
only removes work. Nothing here is on the other developer's approval list
(`normattiva_scraper.py`, auth, Prisma, `.github/`, `infra/`, the data scripts); `app.py` and
the new module are flagged in the pull request all the same.

### 5.2 The client

**Types.** `ArticleValidity` in `types/index.ts` mirrors the wire (§5.1); `ArticleData.validity?`.
`versionInfo.effectiveDate`, today the echo (`SearchPanel.tsx:153-157`), is dropped;
`isHistorical` is derived from the *request* (`version === 'originale'` or a date) so that
`originale` stops looking current, and what is *displayed* comes from `validity`.

**A single pure function** decides what is shown, `utils/versionDisplay.ts`
(`validity`, request) → `{ chip, banner, textVisible, actionsDisabled }`. It carries the whole
table below and is tested without a DOM.

| State | Chip (toolbar) | Banner | Text area |
|---|---|---|---|
| `current` | In vigore dal {d} | none; if the request carried a date: "La data richiesta cade nel testo attuale" | the text |
| `historical` | Testo storico · dal {d1} al {d2} | the historical banner (below) | the text, update notes **open** |
| `abrogated` | Abrogato dal {d} | none (the notice is the text) | the notice, as served |
| `not_yet` | Non ancora esistente | the not-yet banner | **not rendered**; an empty state with the way forward |
| no validity | nothing | none | the text |

`not_yet` shows "Questo articolo non esisteva al {d}. È in vigore dal {d+1}" with a button to
open that day's text and one to pick another date. The served text ("… NON ANCORA ESISTENTE O
VIGENTE") is not drawn as an article, and the add-to-dossier, copy and citation actions are off.

**The chip replaces the "Vigente" and "Aggiornato al" badges** (`ReadingToolbar.tsx:69-93`) and
is a button that opens the date dialog. The "Allegato N" badge is left as it is. The "…" menu's
"Cerca versione…" is renamed "Testo alla data…" and opens the same dialog.

**The date dialog,** `TextAtDateDialog`, replaces the modal at `ArticleTabContent.tsx:1146-1213`:
a labelled date field with `max` = today; a "Testo originale" choice; one line saying what the
date means and what it does not (§2, last paragraph). It validates before it sends (a future
date is not sent); it refuses EU acts with the reason; it sends `show_brocardi_info: false`. The
result opens in a new tab, as today; the tab is labelled `{atto} — testo al {dd/mm/yyyy}` (the
requested date, in Italian format), while the toolbar shows the real window.

**The historical banner,** `HistoricalTextBanner`, sits inside the article card above the text,
outside the text root (rule 23: nothing is added to the text nodes). It says which window, that
it is the consolidated text of Normattiva for information, that it is not the current text, and
that the window does not say which discipline applies to the fact. Its actions: "Vai al testo
attuale" and "Copia citazione".

**A historical text switches the following off**, in `ArticleTabContent` (and, for Study Mode,
in the norm header that opens it):

- the Brocardi block (not requested; also not rendered if present);
- notes, highlights, passage discussions and their signs: the renderer receives empty lists, and
  the selection popup keeps only "Copia";
- the notes, highlights, discussions and quick-norm buttons (disabled, with the reason as a
  tooltip); the saved-norm check already ignores a non-current text (`isCurrentText`, line 275);
- Study Mode, whose tools create notes keyed by the article.

The update notes (AGGIORNAMENTO) stay in the text and are **open by default** on a historical
text, because for delegated values (art. 1284's rate) the rule is in the notes. The existing
`vlx-updates-open` class does it; no DOM is added.

**The dossier.**

- `WorkspaceTabPanel.handleAddToDossier` stores `versione` and `data_versione` in all three
  branches (norma, loose article, collection).
- `dossierContainsArticle` compares `versione` (default `vigente`) and `data_versione` (default
  empty) as well, so a legacy item without them is a current-text item.
- `searchParamsFromNorma` sets `show_brocardi_info: false` for a historical item.
- A dossier row and the dossier reader show "Testo al {dd/mm/yyyy}" for a historical item. Two
  typed dates inside one window are two items with the same text: harmless, and the dossier does
  not try to merge them.
- Items already saved from a historical tab through the window button lost their version and
  cannot be repaired (§8).

**The citation,** `utils/citation.ts`, pure: `formatNormCitation(norma, validity?, requestedDate?,
consultedAt?)` returns a short and a long form, from one table of act abbreviations (the codes,
the Costituzione) and a generic form for other acts. The style was decided by the owner on
1 October 2026, who gave the model "art. 2, l. 7 agosto 1990, n. 241": `art.` in lower case, a
comma after the article number, the act's abbreviation in lower case, then date and number; a
code or the Costituzione with no comma ("art. 1284 c.c.", "art. 81 Cost."). The rest of the
sentence is as proposed:

- short: *art. 1284 c.c., nel testo in vigore al 29 dicembre 2007*
- long: *art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007
  (Normattiva, testo consolidato, consultato il 1° ottobre 2026)*
- another act: *art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore al 15 marzo 2014*; with an
  annex: *art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A), nel testo in vigore al …*

The copy actions of a historical article start with that line. A golden file of expected
strings, which the owner reads, is the test. This closes the open follow-up of dossier round 1
(ISO dates in citations) for past texts; the sentenze round does the same for decisions. The
owner decided on 1 October that the text in force keeps its present citation for now: extending
the new wording to it is a separate intervention.

**What is wrong when the window does not contain the date.** If `request_in_window` is false the
text is shown with a warning, "Normattiva ha restituito una versione che non comprende la data
richiesta: non va considerata attendibile", and the citation is off. It is the rule the spike
could not test on a real counter-example (§2, last bullet).

### 5.3 Copy (Italian), to be read by the owner

| Where | Text |
|---|---|
| Chip, current | In vigore dal {d} · tooltip: *Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.* |
| Chip, historical | Testo storico · dal {d1} al {d2} |
| Chip, abrogated | Abrogato dal {d} |
| Chip, not yet | Non ancora esistente |
| Banner, title | Testo storico |
| Banner, body | In vigore dal {d1} al {d2}, secondo il testo consolidato di Normattiva (a fini informativi). Non è il testo attuale. Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono contare disposizioni transitorie, efficacia retroattiva o norme più favorevoli. |
| Banner, second line | Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico. |
| Banner, actions | Vai al testo attuale · Copia citazione |
| Not yet | Questo articolo non esisteva al {d}. È in vigore dal {d+1}. · Vai al testo del {d+1} · Scegli un'altra data |
| Dialog | Testo alla data · *Normattiva mostra il testo in vigore in quel giorno.* · Data · Testo originale |
| Errors | La data non può essere futura: Normattiva mostrerebbe il testo attuale. · Atti dell'Unione europea: il testo a una data non è disponibile. |
| Tab | {atto} — testo al {dd/mm/yyyy} |
| Dossier | Testo al {dd/mm/yyyy} |
| Disabled | Non disponibile su un testo storico |

Dates in the interface are written `25-12-2003` (as Normattiva writes them, but padded) or, in
sentences and citations, `25 dicembre 2003`.

### 5.4 Cost, quota and cache

A historical read is one request of 3 points. The client's `articleFetchCache` already keys on
act, article, version and date (`utils/articleFetchCache.ts:41-42`); two dates inside one window
are two requests although the text is the same (§2). Reusing a known window on the client is a
follow-up (§8); it is not needed for correctness. The server's persistent cache is keyed by URN,
which carries the date, so the same applies there.

## 6. Security and privacy

- **The date goes into an outbound URL.** It is already validated (`parse_date`: strict ISO, or
  the Italian extended form); this round adds "not in the future". The version word is matched
  against two literals (`originale`, `vigente`), so no other string reaches the URN.
- **Third-party HTML is parsed, never executed.** Regexes plus `html.parser` over a bounded
  slice; the output is dates, an integer and four enum values. The client renders text through
  React; nothing from the page is injected as HTML.
- **No new route, no new egress host, nothing stored.** `validity` is derived and not persisted;
  the dossier item gains no new field (it already carries `versione` and `data_versione`).
- **Quota.** The guard that refuses a future date also removes one way of spending quota on a
  request whose answer is known to be wrong. Nothing here adds a request.
- **Logs.** The module logs the state and the window, never the page.
- **No private data.** Nothing from the owner's workspaces enters the repository; the fixtures
  (§7) are public-law pages.

## 7. Verification

- **Extraction (pytest).** Fixtures: the current-window pages already in the repository
  (`attachment.html`, `akn_comma_div.html`, `abrogato.html`) and the trimmed abrogation pages
  (`cp_544_abrogato_trimmed.html`, `cp_524_abrogato_malformed_trimmed.html`). **The first task of
  the plan recaptures three trimmed pages, with the owner's approval of the download:** a
  middle version (`dal … al …`, with the end date's markup), a not-yet-existing page, and a
  partial abrogation (art. 183 c.p.c. at 2015-01-01 carries a "COMMA ABROGATO" notice), to prove
  it is *not* `abrogated`. Tests: each state; the article-label check (a synthetic page in the
  portal's markup whose label differs from the article requested must yield nothing, which is
  what the decree's page for the c.c. URN without its annex looked like); a page without the
  window yields nothing.
- **The wire.** A contract test on the three handlers with a stub scraper: `validity` present,
  `article_text` byte-identical to today's.
- **The guards.** A future date is refused; a historical request does not call Brocardi, on all
  three handlers.
- **Web.** `versionDisplay.test.ts` (the table of §5.2); `citation.test.ts` (the golden file);
  `dossierUtils` (`dossierContainsArticle` with versions, `searchParamsFromNorma`); a test that the
  window header's add keeps the version; component tests for the chip, the banner and the dialog.
  Rule 23's suite (`articleRender.test.ts` on its 27 texts) stays green and is the proof that
  nothing was added to the text.
- **A real browser pass** on `http://localhost:5173` with a login, on: art. 1284 c.c. at
  2007-12-29 (the window, the notes open, the citation); art. 594 c.p. current (state
  "Abrogato", no "Vigente"); art. 183-bis c.p.c. at 2010-01-01 (not yet existing, the way
  forward); a future date (refused before it is sent); "Testo originale" of art. 18 St. lav.;
  adding a historical article to a dossier from both buttons and reopening it; two versions of
  one article in one dossier; a phone width. The tour (`TOUR_VERSION`) and the shortcuts modal
  are checked for anchors the chip replaces.
- **Measure** the stream's time for a historical read with and without Brocardi, in the
  development stack, and record it here.
- The suites of every area touched, green: `npm --prefix apps/web run test -- --run`,
  `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`, the visualex pytest.

## 8. Phases and what stays out

1. **v1 (this document).** Sections 5.1–5.3.
2. **v1.1 — the amendments of an article, on request.** A "Modifiche registrate" list from
   Normattiva's update table: a route behind the same login gate (it needs a Normattiva session;
   the cost goes in `scrapeGate.ts`, which sits next to authentication, and the ingress's
   `@legal` list is under `infra/`: the other developer reviews both), no attribution of a
   version to an act (§2).
3. **v2 — the text switches inside the page.** After the reader is extracted from the window
   (the base of the article-page redesign).
4. **v3 — comparing two versions.** A word-level comparison computed from two reads; the
   existing `CompareView` diff is a starting point and needs normalising to avoid noise.
5. **Annotations on a historical text.** The version enters the annotation key (Prisma, other
   developer).

Recorded, not done here:

- Items already saved from a historical tab through the window button lost their version.
- The Italian extended date form is not calendar-checked (`31 febbraio 2019` passes the parser).
- When the text comes from the AKN fallback (accents transliterated), nothing marks it
  (`normattiva_scraper.py:57-67`). Checked while planning: `get_document` returns the same
  `(text, urn)` pair whichever path produced the text, so it is not distinguishable without a
  change to the scraper, which the other developer approves.
- Reusing a known window for a second date (§5.4).
- An act without history has not been met (§2).
- A request for an article absent from a decree's own body answers 200 with the decree's page.
- Inside a tab opened by "Testo alla data" the annex index and the arrows
  (`useAnnexNavigation`) load the text in force, not the version of the tab, so the tab's label
  ("… — testo al 29/12/2007") can sit over a different text (the article's own chip stays true
  when `validity` is present). Carried over to v2, with the reader extracted from the window.
- Decisions taken in review, beyond what this document says: a version that does not contain the
  asked day is not copied, exported or saved; the export of a past text is off until its header
  carries the citation; a repealed article is cited "abrogato dal …"; an act of the Union is
  never cited as a text at a date; a historical version reached with no day is cited by its window;
  a window that ends today or later is `current` (§5.1: the first rule called every closed window
  `historical`, which labelled the text in force as past on the last day of its window).
- The graph side rail (`article_sidebar`) still describes the current article on a past text.

## 9. The Massimario panel on the article page

The Massimario round asks where its panel goes (`2026-10-01-rassegne-massimario-design.md`, §7
and open point 2). The article-page redesign is not decided, so this is a placement that holds
whatever is decided.

**Decision P1 — a closed row in the `article_content_after` slot, directly under the article
text and its apparatus, above Brocardi's block.** Today's order is the text, the loose
highlights, "Chiedi su questo articolo", the slot, the graph rail, then Brocardi
(`ArticleTabContent.tsx:980-1111`). The panel keeps the place its spec already chose. It is not
part of "Approfondimenti & Dottrina", not a drawer, a popover or a margin item, and it opens
nothing over the text.

*Why.* (1) It is a source of another class than Brocardi (the Court's own office, dated): it is
read *before* the doctrine and kept apart from it, which is the order all five redesign
proposals put to the owner on 30 September share (they are not recorded in the repository):
norm, Normattiva's apparatus, case law, then doctrine. (2) It is closed by
default, so it never competes with the law; its body is paged by year, ten at a time, with no
nested scroller (the 500-card list is the counter-example). (3) With MERL-T off it is simply
absent, with no placeholder: vanilla first.

**P2 — it is a self-contained row.** The component takes `articleUrn` and an optional
`validity` and returns one collapsible; it assumes nothing about its neighbours and injects
nothing into the text root. Under the redesign it is mounted into whatever list of layers is
chosen (a "Giurisprudenza" row, a side-panel chip, a "Materiali" row) with no change.

**P3 — on a historical text it stays visible.** It is dated by year, so it does not carry the
hazard that makes Brocardi unfit there. The host adds `validity` and `isHistorical` to the slot's
props (additive: today the props are `articleUrn` and `containerRef`). The panel's first version
ignores them; later it may mark the years outside the viewed window. It never claims a link
between a year's review and the version shown.

**P4 — the dating line (decided by the owner on 1 October).** The row says only *Rassegna
dell'anno {AAAA}*, and each year's heading carries the link *Vedi il testo in vigore al 31
dicembre {AAAA}*. No caution sentence follows. The line the Massimario spec proposed,
"Orientamenti datati: riferiti al testo vigente nell'anno della rassegna", is dropped: the data
does not support it (a review of year Y reports decisions of year Y, and a Court may apply the
law of the facts or of the proceedings, which can be an earlier version; §2, last paragraph).
The link opens this round's historical tab through the existing `triggerSearch` with
`version_date` (no new API). An annual review is always of a closed year, so the date is never
in the future and the guard of §5.1 never refuses it.

**P5 — loading.** One request per article view, after the text has rendered, cached per session
by URN; the row appears only when at least one passage cites the article. It sits below the text,
so a late arrival moves nothing the reader is reading. On a phone it is the same closed row.

**The August revert.** The 29 August case-law panel was reverted because the owner had other
priorities, not because of a defect: the sentenze spec records it so, and the owner confirmed it
on 1 October. The Massimario spec's different wording is corrected by that round.

## 10. Questions for the owner — answered on 1 October 2026

The first by the owner's own model; the others approved as proposed in this document and in the
plan, with «ok a tutto».

1. **The citation wording** (§5.2): short and long forms, "nel testo in vigore al/dal … al …",
   and whether "consultato il …" belongs. *Decided: the owner's style, "art. 2, l. 7 agosto
   1990, n. 241", as written in §5.2; "consultato il …" stays.*
2. **The banner's text** (§5.3), above all the sentence on transitional provisions: is it the
   right caution, and is it enough? *Approved as written.*
3. **Update notes open by default** on a historical text (§5.2). *Yes.*
4. **A separate tab in this slice** (T5), with the in-page switch later. *Yes.*
5. **"Testo originale"** as a choice in the dialog (§5.2): wanted? *Yes.*
