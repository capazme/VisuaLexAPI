# The text as at a date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader asks for the text of an Italian norm as at a date (or for its original text), is told which version came back — the window the source's own page states — and in which state it is, can cite it the way a lawyer writes, and cannot attach notes, highlights, discussions or doctrine to it; the dossier keeps the version from every door.

**Architecture:** The Python API reads the window ("Testo in vigore dal … al …") off the raw Normattiva page the scraper already keeps in its cache and serves it as `validity` next to `article_text`; it refuses a date after today and never asks Brocardi for a past text. The web app turns `validity` and the request into one display table (`utils/versionDisplay.ts`: the chip, the banner, what is switched off), a date dialog, and one citation function with a golden file the owner reads; the dossier tells versions apart. `article_text` and `normattiva_scraper.py` are not touched.

**Tech Stack:** Python 3.12 in the image (Quart, BeautifulSoup, pytest with `asyncio_mode = auto`); React 19 + TypeScript + Vitest (jsdom) + Testing Library; Tailwind v4. No new dependency, no new route, no new egress host.

**Spec:** `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`. Read it before the first task: decisions T1–T9, the wire in §5.1 and the Italian copy in §5.3 are the contract this plan implements, and §10 records the owner's answers to the five questions it asked (they change wording, not structure).

**Measured on develop `593746b` (1 October 2026):** Python suite 823 passed (6 live tests deselected); web suite 137 files, 1,522 tests; `npm --prefix apps/web run build` clean. After this plan: 954 passed (12 deselected) and 147 files, 1,700 tests.

## What the owner reads

The plan is long because the code is in it. Five places carry the legal and the product decisions; the rest is mechanical.

| Where | What | Task |
|---|---|---|
| `apps/web/src/utils/__fixtures__/citationGolden.ts` | the wording of every citation, case by case: the specification of `formatNormCitation` | 4 |
| `apps/web/src/utils/versionDisplay.ts`, the `describeVersion` table and its test | every Italian string of the chip and the banner, and what each state switches off | 4 |
| `apps/web/src/components/features/search/TextAtDateDialog.tsx` | the dialog's text and its two refusals | 5 |
| "Decisions taken while planning" below | where the plan went beyond or differs from the spec | — |
| "Review Focus" below | the inputs the spec implies but does not state | — |

## Global Constraints

Copied from the spec, `CLAUDE.md`, `services/visualex/CLAUDE.md` and `apps/web/CLAUDE.md`; every task's requirements include them.

- **Git flow:** "Branch from `develop` (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`), open a pull request into `develop`, merge it yourself with a merge commit titled `merge: <branch> — <what changes>` once CI is green." A hook refuses commits and pushes on `main` and `develop`.
- **Commits, pushes, pull requests and merges wait for the owner's go-ahead**, asked once per PR with the commit messages proposed. If the owner authorises the commits of a PR in writing, a subagent is given that sentence verbatim in its dispatch: without it, it refuses.
- **Nothing private enters the repository** (it is public): the fixtures are public-law pages; no personal path, no host address, no key.
- **`article_text` is a data contract** (root rule 23): never alter, re-derive or add to it; no element is added inside the text root; the chip and the banner sit beside the text. **`normattiva_scraper.py` is not touched.**
- **Not touched, because they need the other developer's approval:** authentication, the Prisma schema and migrations, licences, `.github/`, `infra/`, the data scripts, `.claude/settings.json`, `normattiva_scraper.py`. `services/visualex/app.py` and the new module are flagged in PR 1's description all the same.
- **No new route, no new egress host, nothing persisted.** The stream route keeps costing 3 points of quota (`apps/server/src/middleware/scrapeGate.ts`).
- **The window says which text was in force, never which discipline governs a fact.** Nothing the reader sees says the second; the banner says so in terms.
- **The server enforces, the client mirrors** (T4): a `version_date` after today in Europe/Rome is a 400; a request for a past text (`version: "originale"` or a `version_date`) never fetches Brocardi; both hold whichever door the request came from.
- **A past text is a read-only reading** (T3): no notes, highlights, passage discussions, quick-norm, Study Mode, saved-norm check or Brocardi; the update notes open. The data model is untouched.
- **No state is a default** (T2): with no `validity` there is no chip. The four states are `current`, `historical`, `not_yet`, `abrogated`.
- **The source's window, never the request's date** (T1): `norma_data.data_versione` is an echo of what the caller sent.
- **Dates:** on chips `25-12-2003`; in sentences and citations `25 dicembre 2003` (`1° ottobre 2026` for the first of a month); the tab `{atto} — testo al {dd/mm/yyyy}`; the dossier `Testo al {dd/mm/yyyy}`.
- **UI copy is Italian; code, comments, commits and docs are English.**
- **Web:** no `any`; `verbatimModuleSyntax` (types come in with `import type`); the real type-check is `npm --prefix apps/web run build` (a bare `tsc --noEmit` reports a false green); only Tailwind tokens that exist (gotcha 29); what the page shows is rendered through React, never injected as HTML.
- **Python:** async all the way, no blocking call on the event loop (`asyncio.to_thread` for CPU work on a page); errors through `ValidationError` and friends; log with structlog, never the page.
- **Errors you surface in files you touch are fixed**, pre-existing ones too.
- **Gates for every PR:** `(cd services/visualex && .venv/bin/python -m pytest tests/ -q)`, `npm --prefix apps/web run test -- --run`, `npm --prefix apps/web run build`, `npm --prefix apps/web run lint`.

## Review Focus

Inputs the spec implies but does not state, most likely first. Each has a test in the task that owns the code.

1. **A range asked at one date whose articles differ** — one did not exist yet, one is readable, one has no page in the cache. Each article carries its own window or none, and the text of all three arrives untouched. `TestARangeAtOneDate` (Task 3).
2. **A date that arrives in the Italian long form** — a shared `?norma=` link or an old history entry may carry "12 ottobre 2007". The server accepts it and refuses it when it is in the future; the client names the tab with it as it came and repeats it in the not-yet banner. `TestRequestedDate`, `TestRejectFutureVersionDate` (Task 2) and "a day written the way a shared link may carry it" (Task 4).
3. **A date before the act itself existed.** Normattiva's answer is not among the 27 pages measured. Whatever it is, the reader must never be shown an "In vigore" status for it: the page is either a not-yet page, a version whose window does not contain the day (the warning), or a page the reader cannot read (no chip). The browser pass (Task 10) records what Normattiva does and fails the task if a status of "in force" appears.
4. **Items that come back from the server with JSON `null` in `versione` and `data_versione`.** They are the text in force. "treats the nulls a server payload may carry as absent" (Task 8) and the `null` cases of `requestIsHistorical` (Task 4).
5. **The day boundary.** A reader in another time zone, or just after midnight in Rome: the dialog's `max`, the server's guard and the day of the citation are all the day in Rome. `todayInRome` (Task 4), "accepts today" (Task 5), "a missing tz database does not refuse a valid date" (Task 2).

## Order and pull requests

Three pull requests, in this order; each leaves `develop` working.

| PR | Branch (from `develop`) | Tasks | What ships |
|---|---|---|---|
| 1 | `feat/testo-alla-data-server` | 1–3 | The server states the window and enforces the two guards. Invisible to a client that ignores the new key; no UI change. |
| 2 | `feat/testo-alla-data-reader` | 4–7 | The reader: status chip, banner, "Testo alla data" dialog, read-only past texts, the citation, tab labels. Needs PR 1 merged. |
| 3 | `feat/testo-alla-data-dossier` | 8–10 | The dossier keeps and tells apart versions; the documentation; the whole-suite check, the tour check, the latency measurement and the browser pass. Needs PR 2 merged. |

The spec and this plan are read from `docs/superpowers/`: branch from `develop` once the docs branch that carries them has merged. If it has not, branch from `docs/testo-alla-data`.

## Before you start

1. Read the spec, the root `CLAUDE.md`, `services/visualex/CLAUDE.md` and `apps/web/CLAUDE.md`.
2. **Dependencies in a git worktree are not there.** Install them (`npm --prefix apps/web ci`; create the Python venv as `docs/setup.md` says) or link the main checkout's: `ln -s <main checkout>/services/visualex/.venv services/visualex/.venv` and `ln -s <main checkout>/apps/web/node_modules apps/web/node_modules`. Both are ignored by git; `git status` must show neither.
3. Commands, from the repository root:

   | What | Command |
   |---|---|
   | one Python file | `(cd services/visualex && .venv/bin/python -m pytest tests/test_x.py -q)` |
   | all Python | `(cd services/visualex && .venv/bin/python -m pytest tests/ -q)` |
   | live Python (network) | `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity_live.py -m live -q)` |
   | some web tests | `npm --prefix apps/web run test -- --run src/utils/versionDisplay.test.ts` |
   | all web tests | `npm --prefix apps/web run test -- --run` |
   | the real type-check and build | `npm --prefix apps/web run build` |
   | lint | `npm --prefix apps/web run lint` |

4. **How this plan was checked.** Every code block below was run before it was written here, in a scratch copy of the repository, task by task: the tests first and red, then the code and green, with the type-check clean after every task and both whole suites green at the end. Where a step says what a run prints, that is what was printed. Thirty-six deliberate breakages of the code (a guard removed, a day swapped, a label check dropped, the marks drawn on a past text) were each caught by a test; one survived at first and got its test. Three things could not be run: the three captured pages of Task 1 (the tests that read them were run against stand-ins built in the portal's markup), the live test (it asks the portal) and the browser pass. One existing test (`DossierItemReader.test.tsx`, the annotation sign) timed out once, in a full run on a loaded machine, and passed in the six other full runs and alone: its wait is five seconds and nothing in this plan touches what it checks.

## Decisions taken while planning

Where the plan goes beyond the spec or differs from it. Each is small; the owner can overrule any.

1. **Copy added to §5.3's table.** The not-yet banner has a title, "Articolo non ancora esistente"; the warning for a version that does not contain the day has one too, "Versione non attendibile"; the chip's tooltip names the version when the page gives it ("Versione n. 7."), which is the only use of `version_number` in v1; the dialog adds one sentence, "La data non dice quale disciplina si applichi al fatto: possono contare disposizioni transitorie o efficacia retroattiva." (§5.2 asks for one line on what the date does not mean.)
2. **The dossier reader is read-only on a past text too.** §5.2 names only `ArticleTabContent`, but the goal in §3 ("nothing is anchored to the wrong text") holds for the reader, which creates highlights and notes with the same version-blind key. It also gets the banner, no actions, and a "Testo al …" line when the source could not be read.
3. **"Chiedi su questo articolo" (the MERL-T question) is hidden on a past text.** It asks about the article by its URN and the answer would describe the current text. Vanilla is untouched: it is already absent with MERL-T off.
4. **`show_brocardi_info` follows the version in the three other places that carry one:** the share link, the cross-reference navigation inside a block, and a reopened dossier item. The server refuses the doctrine anyway (T4); the client stops asking.
5. **A day typed that falls in the text in force** (state `current` with a date requested): notes stay on, because it is the text in force; the doctrine stays off, because it was fetched without it. The banner says "La data richiesta cade nel testo attuale."
6. **"Update notes open by default" is the class, forced** (`vlx-updates-open`), as §5.2 says; on a past text the fold toggle therefore has no effect. Making it a real initial state would mean editing `useArticleTextInteractions` for one flag.
7. **The text in force keeps `formatCitation`** ("codice civile n. 262 del 1942-03-16, Art. 2043"): only a past text gets the lawyer's wording. **Decided by the owner on 1 October 2026: "non adesso"; extending it is a separate intervention.** The spec says the new function "closes the open follow-up of dossier round 1 for norms (ISO dates in citations)"; with this plan it closes it for past texts only. (Extending it would change the copy of every article and the labels of the change notifications, which read `formatCitation` in `normaChanges.ts`.)
8. **The old modal sent no annex; the dialog does** (`buildTextAtDateParams` keeps `norma.allegato`), as `searchParamsFromNorma` already did.
9. **`effectiveDate` leaves `versionInfo` in Task 7, not Task 4**, so that every task's commit type-checks: the search panel sets it until Task 7 rewrites that line.
10. **Found, not changed:** the window header's "Aggiungi a dossier" also drops `allegato` (not only the version), so an annexed act that is not a code reopens on its dispositivo. Out of scope; one line in `normaForDossier` would fix it, and would change what `dossierContainsArticle` considers a duplicate of legacy items.
11. **The AKN fallback is not distinguishable from `get_document`'s return** (`(text, urn)` is the same pair whichever path produced the text, `normattiva_scraper.py:57-67`): §8 asked the plan to check; marking it needs a scraper change, which is the other developer's. Recorded, not done.
12. **The citation style is the owner's, decided on 1 October 2026:** "art. 2, l. 7 agosto 1990, n. 241" — lower-case `art.`, a comma after the article number, the act's abbreviation in lower case, then date and number; a code or the Constitution with no comma ("art. 1284 c.c.", "art. 183-bis c.p.c.", "art. 81 Cost."); an annex after the act's number ("art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)"). The rest of the sentence (", nel testo in vigore al …", the Normattiva parenthesis) is unchanged. **Two points this style leaves open, applied here and put to the owner:** (a) the Preleggi and the disposizioni per l'attuazione would otherwise come out as articles of the royal decree 262/1942 ("art. 12, r.d. 16 marzo 1942, n. 262"), which names the decree's own articles, so they are cited by their own name ("art. 12 preleggi", "art. 3 disp. att. c.c.", "art. 1 disp. att. c.p.c."); (b) the citation opens the first line of a copied text, where a lower-case `art.` begins a line: applied as decided, and the capital ("Art. 1284 c.c., …" at the head of the copy only) is one line in `withCitation` if the owner wants it.
13. **No automated test covers two wirings:** `SearchPanel.processResult` and the "Studio" button of `NormaBlockComponent`. The decisions they carry are pure functions with tests (`deriveVersionInfo`, `versionTabSuffix`, `describeVersion`); the wiring is checked by the type-check and by the browser pass (Task 10).

## File map

| Path | | Responsibility |
|---|---|---|
| `services/visualex/visualex_api/services/normattiva_validity.py` | create | Reads the window, the version and the state off a raw page; reads it from the scraper's cache; the two request guards |
| `services/visualex/app.py` | modify | Adds `validity` to three handlers; refuses a future date; keeps Brocardi out of a past read |
| `services/visualex/tests/validity_pages.py` | create | Page builders shared by two test files (not a test module) |
| `services/visualex/tests/test_normattiva_validity.py` | create | Extraction, label check, request-in-window, the cache reader, the guards |
| `services/visualex/tests/test_validity_wire.py` | create | The three handlers: `validity` rides along, the text is untouched, Brocardi stays out, a future date is a 400 |
| `services/visualex/tests/test_normattiva_validity_live.py` | create | The same extraction against the portal (`-m live`) |
| `services/visualex/tests/fixtures/normattiva/` | create 3, modify README | Three trimmed pages captured from the portal |
| `services/visualex/CLAUDE.md` | modify | The module, the wire, gotcha 31 |
| `apps/web/src/types/index.ts` | modify | `ArticleValidity`, `ArticleData.validity`; `versionInfo` loses the echo |
| `apps/web/src/utils/dateUtils.ts` | modify | `formatDateDashed`, `formatDateForCitation`, `addDaysToIsoDate`, `todayInRome` |
| `apps/web/src/utils/versionDisplay.ts` | create | The one table: chip, banner, what is switched off; the request helpers; the dialog's request; tab and dossier labels |
| `apps/web/src/utils/citation.ts` + `__fixtures__/citationGolden.ts` | create | The citation and its golden file |
| `apps/web/src/components/features/search/VersionStatusChip.tsx`, `VersionBanner.tsx`, `TextAtDateDialog.tsx` | create | The chip, the banner / empty state, the dialog |
| `apps/web/src/components/features/search/ReadingToolbar.tsx` | modify | The chip replaces the "Vigente" and "Aggiornato al" badges; switched-off tools; "Testo alla data…" |
| `apps/web/src/components/features/search/SelectionPopup.tsx`, `ArticleBody.tsx` | modify | `copyOnly` |
| `apps/web/src/components/features/search/ArticleTabContent.tsx` | modify | The display table drives marks, doctrine, copy, banner, dialog |
| `apps/web/src/components/features/search/SearchPanel.tsx` | modify | `versionInfo` from the request; the tab label |
| `apps/web/src/components/features/workspace/NormaBlockComponent.tsx` | modify | "Studio" off on a past text |
| `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` | modify | The window header's "Aggiungi a dossier" keeps the version |
| `apps/web/src/components/features/dossier/dossierUtils.ts` | modify | `normaForDossier`; `dossierContainsArticle` tells versions apart; `searchParamsFromNorma` keeps doctrine out |
| `apps/web/src/components/features/dossier/SortableDossierItem.tsx`, `DossierItemReader.tsx` | modify | The row label; the reader read-only on a past text |
| `apps/web/CLAUDE.md` | modify | The behaviour, the utilities, gotcha 32 |
| `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md` | modify | Status line; the measured latency |

## PR 1 — The server states the window

Branch `feat/testo-alla-data-server`, from `develop`. Nothing in the interface changes: a client that ignores the new `validity` key behaves as today, and the two guards only remove work (a request that would have come back wrong, a Brocardi fetch whose answer is not shown).

### Task 1: Three trimmed pages captured from the portal

The spike of 1 October read 27 live pages but kept none, and the repository's fixtures are all pages *in force*. The reader of Task 2 is written against the text the portal prints in `div.vigore`; this task is where that assumption meets a real page. **It needs the owner's approval to download.**

**Files:**
- Create: `services/visualex/tests/fixtures/normattiva/art1284_cc_at_2007-12-29_trimmed.html`
- Create: `services/visualex/tests/fixtures/normattiva/art183bis_cpc_at_2010-01-01_not_yet_trimmed.html`
- Create: `services/visualex/tests/fixtures/normattiva/art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html`
- Modify: `services/visualex/tests/fixtures/normattiva/README.md`
- A one-off script, kept **outside** the repository and never committed.

**Interfaces:**
- Produces: the three files above, under exactly these names; Task 2's `TestRecapturedPages` reads them. Each holds, as served and wrapped in `<html><body>`: `div.vigore`, the update link, the "Ultimo aggiornamento" line and `div.bodyTesto`.

- [ ] **Step 1: Ask the owner, and wait for a clear yes**

Send this (state the pages, the source and the size, as the rule asks), and do nothing else until the answer:

> Per scrivere i test sul formato reale delle pagine di Normattiva devo scaricare da normattiva.it tre pagine di articolo: art. 1284 c.c. al 29-12-2007, art. 183-bis c.p.c. al 1-1-2010, art. 183 c.p.c. al 1-1-2015. Ciascuna pesa tra circa 170 KB e 2,6 MB; le richieste partono a tre secondi l'una dall'altra, con lo stesso percorso dell'app. Nel repository entrano solo circa 1–3 KB per pagina (i blocchi della finestra di vigenza e del testo, che sono testo di legge). Posso procedere?

- [ ] **Step 2: Save the capture script outside the repository**

Save this as, for example, `$TMPDIR/capture_validity_fixtures.py`. `trim()` was checked against five whole fixtures of the repository: the reader returns the same answer on the trimmed page as on the whole one.

```python
"""One-off: capture the three trimmed Normattiva pages the validity tests read.

Save this file OUTSIDE the repository, and run it once, from services/visualex,
after the owner has approved the download (three article pages, three seconds
apart, through the app's own request path):

    cd services/visualex
    PYTHONPATH=. .venv/bin/python /path/to/capture_validity_fixtures.py

Each page is cut to the four blocks the reader looks at, as served: div.vigore,
the update link, the "Ultimo aggiornamento" line and div.bodyTesto.
"""
import asyncio
import re
import sys
from pathlib import Path

from app import NormaController, normattiva_scraper

OUT = Path("tests/fixtures/normattiva")

CAPTURES = [
    ("art1284_cc_at_2007-12-29_trimmed.html",
     {"act_type": "codice civile", "article": "1284", "version": "vigente", "version_date": "2007-12-29"}),
    ("art183bis_cpc_at_2010-01-01_not_yet_trimmed.html",
     {"act_type": "codice di procedura civile", "article": "183-bis", "version": "vigente",
      "version_date": "2010-01-01"}),
    ("art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html",
     {"act_type": "codice di procedura civile", "article": "183", "version": "vigente",
      "version_date": "2015-01-01"}),
]


def cut(raw, pattern, what, required=True):
    found = re.search(pattern, raw, re.S)
    if found is None:
        if required:
            sys.exit(f"{what}: not found in the page")
        return ""
    return found.group(0)


def body_block(raw):
    opening = re.search(r'<div[^>]*\bclass="[^"]*\bbodyTesto\b[^"]*"[^>]*>', raw)
    if opening is None:
        sys.exit("div.bodyTesto: not found in the page")
    depth = 0
    for tag in re.finditer(r"<div\b|</div>", raw[opening.start():]):
        depth += 1 if tag.group().startswith("<div") else -1
        if depth == 0:
            return raw[opening.start():opening.start() + tag.end()]
    sys.exit("div.bodyTesto is not balanced: cut this page by hand")


def trim(raw, note):
    parts = [
        cut(raw, r'<div[^>]*\bclass="[^"]*\bvigore\b[^"]*"[^>]*>.*?</div>', "div.vigore"),
        cut(raw, r"<a[^>]*vediAggiornamentiAllArticolo[^>]*>.*?</a>", "the update link", required=False),
        cut(raw, r"<em>\(Ultimo aggiornamento[^<]*\)</em>", "the act line", required=False),
        body_block(raw),
    ]
    return f"<!-- {note} -->\n<html><body>\n" + "\n".join(part for part in parts if part) + "\n</body></html>\n"


async def main():
    controller = NormaController.__new__(NormaController)
    for name, request in CAPTURES:
        [nv] = await controller.create_norma_visitata_from_data(request)
        raw = await normattiva_scraper.request_document(nv.urn, source="normattiva")
        note = (f"Trimmed: div.vigore, the update link, the act line and div.bodyTesto of {nv.urn}, "
                "as served on 2026-10-02, wrapped in <html><body>. See README.md.")
        trimmed = trim(raw, note)
        (OUT / name).write_text(trimmed, encoding="utf-8")
        window = cut(raw, r'<div[^>]*\bclass="[^"]*\bvigore\b[^"]*"[^>]*>.*?</div>', "div.vigore")
        print(f"{name}: {len(raw):,} bytes served, {len(trimmed):,} kept\n{window}\n")
        await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Run it**

```bash
cd services/visualex
PYTHONPATH=. .venv/bin/python "$TMPDIR/capture_validity_fixtures.py"
```

Expected: for each file one line, `<name>: N bytes served, M bytes kept`, followed by the `div.vigore` block exactly as served. Three files appear in `tests/fixtures/normattiva/`.

- [ ] **Step 4: Compare the printed blocks with what Task 2 assumes**

Strip the tags from each printed `div.vigore` and collapse the whitespace. Task 2's reader (`_WINDOW`) expects:

| Page | The text of the block |
|---|---|
| art. 1284 c.c. at 2007-12-29 | `Testo in vigore dal: 25-12-2003 al: 29-12-2007` |
| art. 183-bis c.p.c. at 2010-01-01 | `Testo in vigore al: 12-9-2014` |
| art. 183 c.p.c. at 2015-01-01 | `Testo in vigore dal: <d-m-yyyy> al: <d-m-yyyy>`, the start before 1-1-2015, the end after it |

**If the words or their order differ — `al` before `dal`, no "Testo in vigore", dates written differently — stop and tell the owner**: the regular expression of Task 2 reads exactly this text, and everything after it is built on it. Note which elements wrap the end date (their `id` and `class`): Step 6 records it.

- [ ] **Step 5: Check the three files**

```bash
cd services/visualex/tests/fixtures/normattiva
wc -c art1284_cc_at_2007-12-29_trimmed.html art183bis_cpc_at_2010-01-01_not_yet_trimmed.html art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html
grep -c 'art.versione=7' art1284_cc_at_2007-12-29_trimmed.html
grep -ci 'NON ANCORA ESISTENTE O VIGENTE' art183bis_cpc_at_2010-01-01_not_yet_trimmed.html
grep -ci 'COMMA ABROGATO' art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html
grep -il '/Users/\|/home/' *_trimmed.html
```

Expected: each file a few KB (art. 183 c.p.c. may reach a few tens); then `1`, a number of 1 or more, a number of 1 or more; and the last command prints nothing. A different version number than 7, a missing sentinel or a missing notice means the page is not the one the spike measured: tell the owner before going on.

- [ ] **Step 6: Document the captures**

In `services/visualex/tests/fixtures/normattiva/README.md`, replace:

```markdown
The extractor's output for every file here is frozen (CLAUDE.md gotcha 23:
```

with:

```markdown
Trimmed captures of 2026-10-02, for the validity reader
(`normattiva_validity.py`, spec `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`).
Each keeps the four blocks the reader looks at, as served — `div.vigore` (the window),
the update link, the "Ultimo aggiornamento" line and `div.bodyTesto` — wrapped in
`<html><body>`:

- `art1284_cc_at_2007-12-29_trimmed.html` — art. 1284 c.c. at 2007-12-29: a middle
  version, window 25-12-2003 to 29-12-2007, version 7. Both ends of the window.
- `art183bis_cpc_at_2010-01-01_not_yet_trimmed.html` — art. 183-bis c.p.c. at
  2010-01-01, before the article existed: the window only ends (12-9-2014) and the text is
  "… NON ANCORA ESISTENTE O VIGENTE".
- `art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html` — art. 183 c.p.c. at
  2015-01-01: a closed window and a "COMMA ABROGATO" notice among other commi, to prove
  that a partial notice is not the state "abrogated".

The extractor's output for every file here is frozen (CLAUDE.md gotcha 23:
```

Then add one sentence at the end of the new section of that README, in this form, with what Step 4 found: `The portal prints the end of the window as <the element, its id and class>.`

- [ ] **Step 7: Commit (ask first)**

```bash
git add services/visualex/tests/fixtures/normattiva/
git commit -m "test(visualex): three trimmed Normattiva pages for the validity reader"
```

### Task 2: The validity reader

A pure module: from a raw article page it reads the window, the version, the act's last update and a state; from the scraper's cache it fetches that page without a request; and it holds the two request guards. It does not import the scraper and never touches `article_text`.

**Files:**
- Create: `services/visualex/visualex_api/services/normattiva_validity.py`
- Create: `services/visualex/tests/validity_pages.py`
- Create: `services/visualex/tests/test_normattiva_validity.py`
- Create: `services/visualex/tests/test_normattiva_validity_live.py`

**Interfaces:**
- Consumes: `normalize_article_key` (`visualex_api/services/akn_parser.py`), `ARTICLE_SUFFIX_ALTERNATION` (`tools/article_suffixes.py`), `parse_date` (`tools/text_op.py`), `ValidationError` (`tools/exceptions.py`); the three fixtures of Task 1.
- Produces:
  - `Validity` — a `TypedDict`: `state: str` (`current` | `historical` | `not_yet` | `abrogated`), `valid_from: Optional[str]`, `valid_to: Optional[str]` (ISO days), `version_number: Optional[int]`, `act_updated: Optional[str]` (ISO day), `request_in_window: Optional[bool]`.
  - `extract_validity(raw_html: str, *, article: Optional[str] = None, requested_date: Optional[str] = None) -> Optional[Validity]` — `None` when the page cannot be read or is not the article asked for.
  - `async read_validity(cache, urn, *, article=None, requested_date=None) -> Optional[Validity]` — reads `cache.get(urn)`; never raises.
  - `is_historical_request(version, version_date) -> bool`.
  - `reject_future_version_date(version_date, today: Optional[date] = None) -> None` — raises `ValidationError` for a day after today in Europe/Rome.

- [ ] **Step 1: Write the page builders and the tests**

`services/visualex/tests/validity_pages.py` (not a test module: two test files use it):

```python
"""Pages for the validity tests: the repository's captures, and the portal's markup.

Not a test module (no `test_` prefix): the helpers are shared by
`test_normattiva_validity.py` and `test_validity_wire.py`.
"""
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"


def page(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def window(dal=None, al=None) -> str:
    """The "Testo in vigore" block, in the portal's markup.

    The start date is as served (attachment.html, abrogato.html). The end date's
    elements were read from a historical page when the three trimmed captures
    were taken; the extraction reads the block's text, so it does not depend on
    them.
    """
    if dal and al:
        inner = (f'<span>Testo in vigore dal:</span> <span id="artInizio" class="rosso">&nbsp;{dal}</span> '
                 f'<span>al:</span> <span id="artFine" class="rosso">&nbsp;{al}</span>')
    elif dal:
        inner = f'<span>Testo in vigore dal:</span> <span id="artInizio" class="rosso">&nbsp;{dal}</span>'
    elif al:
        inner = f'<span>Testo in vigore al:</span> <span id="artFine" class="rosso">&nbsp;{al}</span>'
    else:
        inner = "<span>Testo in vigore</span>"
    return f'<div class="vigore my-5">\n{inner}\n</div>'


def synthetic(*, dal=None, al=None, label="Art. 7", content=None, version=None, updated=None) -> str:
    """A page: the window, the update link, the act line, then the body."""
    content = content if content is not None else '<span class="art-just-text-akn">Il testo dell\'articolo.</span>'
    link = (
        '<a href="#" data-href="/do/atto/vediAggiornamentiAllArticolo?art.idArticolo=7'
        f'&amp;art.versione={version}" id="aggiornamenti_articolo_button">aggiornamenti</a>'
        if version else ""
    )
    act_line = f"<em>(Ultimo aggiornamento all&#39;atto pubblicato il {updated})</em>" if updated else ""
    return (
        f'<html><body>{window(dal, al)}{link}{act_line}'
        f'<div class="bodyTesto"><h2 class="article-num-akn">{label}</h2>{content}</div>'
        "</body></html>"
    )
```

`services/visualex/tests/test_normattiva_validity.py`:

```python
"""What a Normattiva article page says about its own validity window.

The pages are third-party HTML. The tests read the captured pages in
`fixtures/normattiva/` for the facts that are on them, and build the rest in the
portal's own markup: a "Testo in vigore" block in front of a `div.bodyTesto`.
`test_normattiva_validity_live.py` repeats the main cases against the portal
(`-m live`).
"""
from datetime import date

import pytest

from visualex_api.services import normattiva_validity as validity_module
from visualex_api.services.normattiva_validity import (
    extract_validity,
    is_historical_request,
    read_validity,
    reject_future_version_date,
)
from visualex_api.tools.exceptions import ValidationError

from tests.validity_pages import page, synthetic, window


class TestWindowShapes:
    def test_a_closed_window_is_a_historical_text(self):
        v = extract_validity(
            synthetic(dal="25-12-2003", al="29-12-2007", version=7, updated="11/08/2026"), article="7",
        )
        assert v == {
            "state": "historical",
            "valid_from": "2003-12-25",
            "valid_to": "2007-12-29",
            "version_number": 7,
            "act_updated": "2026-08-11",
            "request_in_window": None,
        }

    def test_an_open_window_is_the_text_in_force(self):
        v = extract_validity(synthetic(dal="28-12-2025"), article="7")
        assert v["state"] == "current"
        assert (v["valid_from"], v["valid_to"]) == ("2025-12-28", None)

    def test_a_window_that_only_ends_is_an_article_that_did_not_exist_yet(self):
        v = extract_validity(
            synthetic(al="12-9-2014", content="<span>ARTICOLO NON ANCORA ESISTENTE O VIGENTE</span>"), article="7",
        )
        assert v["state"] == "not_yet"
        assert (v["valid_from"], v["valid_to"]) == (None, "2014-09-12")

    def test_a_window_that_only_ends_is_not_guessed_when_the_notice_is_missing(self):
        assert extract_validity(synthetic(al="12-9-2014"), article="7") is None

    def test_dates_are_day_first_and_unpadded(self):
        v = extract_validity(synthetic(dal="1-2-2003"), article="7")
        assert v["valid_from"] == "2003-02-01"

    def test_a_date_that_is_not_a_day_makes_the_whole_window_unreadable(self):
        assert extract_validity(synthetic(dal="31-2-2020"), article="7") is None

    @pytest.mark.parametrize("separator", [" ", " - ", ", ", " – "])
    def test_what_sits_between_the_two_dates_does_not_matter(self, separator):
        raw = synthetic(dal="25-12-2003").replace(
            "</div><div", f'{separator}<span>al:</span> <span>&nbsp;29-12-2007</span></div><div', 1,
        )
        v = extract_validity(raw, article="7")
        assert (v["valid_from"], v["valid_to"]) == ("2003-12-25", "2007-12-29")

    def test_a_page_without_the_block_says_nothing(self):
        raw = '<html><body><div class="bodyTesto"><h2>Art. 7</h2>testo</div></body></html>'
        assert extract_validity(raw, article="7") is None

    def test_a_block_that_states_no_window_says_nothing(self):
        assert extract_validity(synthetic(), article="7") is None

    def test_a_page_without_a_body_says_nothing(self):
        assert extract_validity(f"<html><body>{window(dal='1-1-2000')}</body></html>", article="7") is None

    @pytest.mark.parametrize("raw", ["", None, "<html></html>", "plain text"])
    def test_garbage_says_nothing(self, raw):
        assert extract_validity(raw, article="7") is None


class TestCapturedPages:
    """Whole pages the repository already holds (August 2026)."""

    def test_the_text_of_art_2043_c_c_has_been_in_force_since_1942(self):
        v = extract_validity(page("attachment.html"), article="2043")
        assert v == {
            "state": "current",
            "valid_from": "1942-04-19",
            "valid_to": None,
            "version_number": None,  # never amended: the page has no update link
            "act_updated": "2026-06-12",
            "request_in_window": None,
        }

    def test_an_amended_article_names_its_version(self):
        v = extract_validity(page("akn_comma_div.html"), article="3")
        assert (v["state"], v["valid_from"], v["version_number"]) == ("current", "2005-03-08", 2)
        assert v["act_updated"] == "2026-04-20"

    def test_a_repealed_article_is_abrogated_from_the_day_of_the_repeal(self):
        v = extract_validity(page("abrogato.html"), article="3")
        assert (v["state"], v["valid_from"], v["valid_to"], v["version_number"]) == (
            "abrogated", "2018-09-19", None, 2,
        )

    def test_a_label_with_a_suffix_is_matched(self):
        v = extract_validity(page("fallback.html"), article="6-bis")
        assert (v["state"], v["valid_from"], v["version_number"]) == ("current", "2012-11-28", 1)

    def test_the_constitution_art_3_has_been_in_force_since_1948(self):
        v = extract_validity(page("akn_just_text.html"), article="3")
        assert (v["state"], v["valid_from"]) == ("current", "1948-01-01")

    @pytest.mark.parametrize("name,article", [
        ("cp_544_abrogato_trimmed.html", "544"),
        ("cp_524_abrogato_malformed_trimmed.html", "524"),
    ])
    def test_the_trimmed_repeal_pages_are_abrogated_once_they_have_a_window(self, name, article):
        """Both shapes, the healthy one and the malformed one whose notice
        html.parser moves out of the span the text extractor reads."""
        raw = page(name).replace("<body>", "<body>" + window(dal="1-1-1996"), 1)
        v = extract_validity(raw, article=article)
        assert v["state"] == "abrogated"


class TestRecapturedPages:
    """Trimmed pages captured from the portal on 2026-10-02 (`fixtures/normattiva/README.md`).

    They assert what the portal printed, so a change in its markup shows up here first.
    """

    def test_a_middle_version_states_both_ends_of_its_window(self):
        v = extract_validity(
            page("art1284_cc_at_2007-12-29_trimmed.html"), article="1284", requested_date="2007-12-29",
        )
        assert (v["state"], v["valid_from"], v["valid_to"], v["version_number"]) == (
            "historical", "2003-12-25", "2007-12-29", 7,
        )
        assert v["request_in_window"] is True
        assert date.fromisoformat(v["act_updated"])  # the day of the consolidation, not a fact of the text

    def test_an_article_that_did_not_exist_yet_states_only_the_end(self):
        v = extract_validity(
            page("art183bis_cpc_at_2010-01-01_not_yet_trimmed.html"), article="183-bis", requested_date="2010-01-01",
        )
        assert (v["state"], v["valid_from"], v["valid_to"], v["request_in_window"]) == (
            "not_yet", None, "2014-09-12", True,
        )

    def test_a_partial_abrogation_is_not_an_abrogation(self):
        requested = "2015-01-01"
        v = extract_validity(
            page("art183_cpc_at_2015-01-01_partial_abrogation_trimmed.html"), article="183", requested_date=requested,
        )
        assert v["state"] in ("historical", "current")
        assert v["valid_from"] <= requested <= (v["valid_to"] or "9999-12-31")
        assert v["request_in_window"] is True


class TestAbrogation:
    def test_a_partial_notice_is_not_an_abrogation(self):
        """art. 183 c.p.c. carries "COMMA ABROGATO" in the middle of other commi."""
        content = (
            '<div class="art-commi-div-akn">'
            '<div class="art-comma-div-akn"><span class="comma-num-akn">1. </span>'
            '<span class="art_text_in_comma">Il debitore paga.</span></div>'
            '<div class="art-comma-div-akn"><div class="ins-akn art_abrogato-akn">'
            "((COMMA ABROGATO DALLA L. 1 GENNAIO 2000, N. 1))</div></div>"
            "</div>"
        )
        v = extract_validity(synthetic(dal="1-1-2000", al="31-12-2005", label="Art. 183", content=content), article="183")
        assert v["state"] == "historical"

    def test_a_whole_article_notice_is_an_abrogation_even_with_a_closed_window(self):
        content = '<div class="ins-akn art_abrogato-akn">((ARTICOLO ABROGATO DALLA L. 1 GENNAIO 2000, N. 1))</div>'
        v = extract_validity(synthetic(dal="1-1-2000", al="31-12-2005", content=content), article="7")
        assert (v["state"], v["valid_to"]) == ("abrogated", "2005-12-31")


class TestTheArticleAskedFor:
    def test_a_page_for_another_article_says_nothing(self):
        """Normattiva answers 200 for a URN that names something else: the decree
        that approves the code, when the code's annex is missing."""
        assert extract_validity(synthetic(dal="1-1-1942", label="Art. 1"), article="1284") is None

    @pytest.mark.parametrize("label,article", [
        ("Art. 183 bis", "183-bis"),
        ("Art. 183-bis.", "183 bis"),
        ("Art. 6-bis", "6-bis"),
        ("Art. 25 undecies", "25-undecies"),
        ("Art. 2409 octiesdecies", "2409-octiesdecies"),
        ("Art. 270-bis.1", "270-bis.1"),
        ("Art. 314/2", "314/2"),
        ("Codice Penale-art. 524", "524"),
        ("  Art. 2043. (Risarcimento per fatto illecito).", "2043"),
    ])
    def test_the_label_may_be_spelled_the_portals_way(self, label, article):
        assert extract_validity(synthetic(dal="1-1-1942", label=label), article=article)["state"] == "current"

    def test_a_suffix_of_the_wrong_article_does_not_match(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Art. 183 ter"), article="183-bis") is None

    def test_an_unreadable_label_says_nothing_when_an_article_was_asked_for(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Premessa"), article="7") is None

    def test_without_an_article_the_label_is_not_checked(self):
        assert extract_validity(synthetic(dal="1-1-1942", label="Premessa"))["state"] == "current"


class TestRequestedDate:
    CLOSED = synthetic(dal="25-12-2003", al="29-12-2007")

    @pytest.mark.parametrize("requested,expected", [
        ("2005-06-01", True),
        ("2003-12-25", True),   # the first day is in
        ("2007-12-29", True),   # and so is the last
        ("2003-12-24", False),
        ("2007-12-30", False),
    ])
    def test_the_window_is_inclusive_at_both_ends(self, requested, expected):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is expected

    def test_without_a_date_there_is_no_verdict(self):
        assert extract_validity(self.CLOSED, article="7")["request_in_window"] is None

    @pytest.mark.parametrize("requested", ["29 dicembre 2007", " 2007-12-29 "])
    def test_the_italian_long_form_and_stray_spaces_are_understood(self, requested):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is True

    @pytest.mark.parametrize("requested", ["ieri", "2007-13-45", "", 20071229])
    def test_a_date_that_cannot_be_read_gives_no_verdict(self, requested):
        assert extract_validity(self.CLOSED, article="7", requested_date=requested)["request_in_window"] is None

    def test_an_open_window_does_not_contain_a_date_before_its_start(self):
        v = extract_validity(synthetic(dal="8-3-2005"), article="7", requested_date="2000-01-01")
        assert v["request_in_window"] is False

    def test_a_not_yet_page_contains_the_days_up_to_its_end(self):
        raw = synthetic(al="12-9-2014", content="<span>NON ANCORA ESISTENTE O VIGENTE</span>")
        assert extract_validity(raw, article="7", requested_date="2010-01-01")["request_in_window"] is True
        assert extract_validity(raw, article="7", requested_date="2015-01-01")["request_in_window"] is False


class FakeCache:
    def __init__(self, entries=None, error=None):
        self.entries = entries or {}
        self.error = error
        self.asked = []

    async def get(self, key):
        self.asked.append(key)
        if self.error:
            raise self.error
        return self.entries.get(key)


URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art3!vig=2007-12-29"


class TestReadValidity:
    async def test_it_reads_the_page_the_scraper_keeps_under_the_urn(self):
        cache = FakeCache({URN: synthetic(dal="25-12-2003", al="29-12-2007")})
        v = await read_validity(cache, URN, article="7", requested_date="2005-06-01")
        assert v["state"] == "historical" and v["request_in_window"] is True
        assert cache.asked == [URN]

    async def test_a_cache_miss_is_no_validity(self):
        assert await read_validity(FakeCache(), URN, article="7") is None

    @pytest.mark.parametrize("cache,urn", [(None, URN), (FakeCache(), None), (FakeCache(), "")])
    async def test_nothing_to_ask_is_no_validity(self, cache, urn):
        assert await read_validity(cache, urn, article="7") is None

    async def test_a_backend_error_never_reaches_the_caller(self):
        assert await read_validity(FakeCache(error=RuntimeError("redis down")), URN, article="7") is None

    @pytest.mark.parametrize("stored", [b"<html></html>", 42, ["x"], ""])
    async def test_a_value_that_is_not_a_page_is_no_validity(self, stored):
        assert await read_validity(FakeCache({URN: stored}), URN, article="7") is None

    async def test_a_page_that_breaks_the_parser_never_reaches_the_caller(self, monkeypatch):
        def boom(*args, **kwargs):
            raise ValueError("unexpected markup")

        monkeypatch.setattr(validity_module, "extract_validity", boom)
        cache = FakeCache({URN: synthetic(dal="1-1-2000")})
        assert await read_validity(cache, URN, article="7") is None


class TestIsHistoricalRequest:
    @pytest.mark.parametrize("version,version_date,expected", [
        ("vigente", None, False),
        ("vigente", "", False),
        ("vigente", "   ", False),
        (None, None, False),
        ("originale", None, True),
        ("ORIGINALE", "", True),
        ("vigente", "2007-12-29", True),
        (None, "2007-12-29", True),
        ("vigente", 20071229, False),
    ])
    def test_the_request_names_a_past_text_or_it_does_not(self, version, version_date, expected):
        assert is_historical_request(version, version_date) is expected


class TestRejectFutureVersionDate:
    TODAY = date(2026, 10, 1)

    @pytest.mark.parametrize("value", [
        None, "", "2026-10-01", "2000-01-01", "1 ottobre 2026",
        "ieri", "2026-02-31", "31 febbraio 2019", 20261002,
    ])
    def test_today_the_past_and_what_the_existing_parser_judges_pass(self, value):
        reject_future_version_date(value, today=self.TODAY)

    @pytest.mark.parametrize("value", ["2026-10-02", "2999-01-01", "2 ottobre 2026", " 2026-10-02 "])
    def test_a_later_day_is_refused_with_the_reason(self, value):
        with pytest.raises(ValidationError, match="futura"):
            reject_future_version_date(value, today=self.TODAY)

    def test_without_a_stated_today_the_clock_is_used(self):
        with pytest.raises(ValidationError):
            reject_future_version_date("2999-01-01")
        reject_future_version_date("2000-01-01")

    def test_a_missing_tz_database_does_not_refuse_a_valid_date(self, monkeypatch):
        def no_tz(name):
            raise validity_module.ZoneInfoNotFoundError(name)

        monkeypatch.setattr(validity_module, "ZoneInfo", no_tz)
        reject_future_version_date("2000-01-01")
        with pytest.raises(ValidationError):
            reject_future_version_date("2999-01-01")
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity.py -q)`

Expected: `1 error`: `ImportError: cannot import name 'normattiva_validity' from 'visualex_api.services'`.

- [ ] **Step 3: Write the module**

Three decisions in it are worth knowing before reading the code. The window is read from the block's *text*, so it does not depend on which element wraps each date (Task 1 recorded how the portal wraps them). The body is parsed from a slice of at most 200 KB: the page is up to 2.6 MB and the scraper has already parsed it once. And a page that is not the article asked for yields nothing: Normattiva answers HTTP 200 for a URN that names something else.

`services/visualex/visualex_api/services/normattiva_validity.py`:

```python
"""What a Normattiva article page says about its own validity.

An article page states, outside the text, the window in which that text was in
force: "Testo in vigore dal: 25-12-2003 al: 29-12-2007". This module reads that
statement, and only that, from the raw page the scraper already keeps in its
persistent cache, so the reader is told which version came back instead of an
echo of the date they typed (`NormaVisitata.data_versione` is the request).

It never touches `article_text`. Every stored highlight and note is pinned to
that text by offset (root CLAUDE.md, rule 23) and the scraper's extraction is
frozen; nothing here may alter, re-derive or "improve" it.

Everything is best effort. A page that cannot be read yields `None`, never a
guess: silence is truer than a default ("Vigente" shown for an article nobody
checked is the defect this replaces). The module does no network I/O and does
not import the scraper.
"""
from __future__ import annotations

import asyncio
import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from bs4 import BeautifulSoup, Tag

from ..tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION
from ..tools.exceptions import ValidationError
from ..tools.text_op import parse_date
from .akn_parser import normalize_article_key

log = structlog.get_logger()

STATES = ("current", "historical", "not_yet", "abrogated")

# The body is parsed from a bounded slice: the page is up to 2.6 MB and the
# scraper has already parsed it once. The label, the "not yet" sentinel and an
# abrogation notice all sit at the very start of the body.
_BODY_SLICE = 200_000

_VIGORE_DIV = re.compile(r"""<div[^>]*\bclass=["'][^"']*\bvigore\b[^"']*["'][^>]*>""", re.I)
_BODY_DIV = re.compile(r"""<div[^>]*\bclass=["'][^"']*\bbodyTesto\b[^"']*["'][^>]*>""", re.I)
_TAG = re.compile(r"<[^>]+>")
_DAY = r"(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})"
# "Testo in vigore dal: 25-12-2003 al: 29-12-2007", "... dal: 28-12-2025" or
# "... al: 12-9-2014". Read from the block's text, so it does not depend on
# which element wraps each date.
_WINDOW = re.compile(
    rf"Testo\s+in\s+vigore\s*(?:dal\s*:?\s*{_DAY})?(?:[\s,;–—-]*\bal\s*:?\s*{_DAY})?",
    re.I,
)
# "(Ultimo aggiornamento all'atto pubblicato il 12/06/2026)"; the apostrophe is
# an entity (&#39;) in the served HTML, hence the bounded wildcard.
_ACT_UPDATED = re.compile(
    r"Ultimo\s+aggiornamento\s+all.{1,8}?atto\s+pubblicato\s+il\s+(\d{1,2})/(\d{1,2})/(\d{4})",
    re.I,
)
_VERSION = re.compile(r"art\.versione=(\d+)")
_NOT_YET = "non ancora esistente"
# "Art. 2043.", "Art. 6-bis", "Art. 183 bis", "Codice Penale-art. 524".
_LABEL = re.compile(
    rf"\bart(?:icolo|\.)?\s*(\d+(?:\s*[-\s]\s*(?:{ARTICLE_SUFFIX_ALTERNATION})\b(?:\.\d+)?)?(?:/\d+)?)",
    re.I,
)
# Everything up to and including the label: "Codice Penale-art. 524" is label.
_UP_TO_LABEL = re.compile(r"^.*?" + _LABEL.pattern, re.I | re.S)


class Validity(TypedDict):
    """The wire shape: `validity` next to `article_text` in the article handlers."""

    state: str
    valid_from: Optional[str]
    valid_to: Optional[str]
    version_number: Optional[int]
    act_updated: Optional[str]
    request_in_window: Optional[bool]


def _iso(day: str, month: str, year: str) -> Optional[str]:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def _iso_day(value: Any) -> Optional[str]:
    """`YYYY-MM-DD` from what the request carried (ISO or the Italian long form), else None."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        text = parse_date(value.strip())
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _read_window(raw: str) -> Optional[Tuple[Optional[str], Optional[str]]]:
    """(valid_from, valid_to) from the "Testo in vigore" block, or None when unreadable."""
    opening = _VIGORE_DIV.search(raw)
    if opening is None:
        return None
    end = raw.find("</div>", opening.end())
    if end < 0:
        return None
    text = " ".join(html.unescape(_TAG.sub(" ", raw[opening.end():end])).split())
    found = _WINDOW.search(text)
    if found is None:
        return None
    d1, m1, y1, d2, m2, y2 = found.groups()
    valid_from = _iso(d1, m1, y1) if d1 else None
    valid_to = _iso(d2, m2, y2) if d2 else None
    if (d1 and valid_from is None) or (d2 and valid_to is None):
        return None  # a date that is not a day: do not guess
    if valid_from is None and valid_to is None:
        return None
    return valid_from, valid_to


def _read_version_number(raw: str) -> Optional[int]:
    """`art.versione=N` of the update link; absent when the article was never amended."""
    at = raw.find("vediAggiornamentiAllArticolo")
    if at < 0:
        return None
    found = _VERSION.search(raw, at, at + 1200)
    return int(found.group(1)) if found else None


def _read_act_updated(raw: str) -> Optional[str]:
    found = _ACT_UPDATED.search(raw)
    return _iso(found.group(1), found.group(2), found.group(3)) if found else None


def _read_body(raw: str) -> Optional[Tag]:
    opening = _BODY_DIV.search(raw)
    if opening is None:
        return None
    soup = BeautifulSoup(raw[opening.start():opening.start() + _BODY_SLICE], "html.parser")
    return soup.find("div", class_="bodyTesto")


def _is_abrogated(body: Tag) -> bool:
    """The whole article is a repeal notice and nothing else.

    A partial notice ("COMMA ABROGATO") leaves the other commi behind, so it is
    not this state. Consumes the notices: call it last.
    """
    notices = body.find_all(class_="art_abrogato-akn")
    if not notices:
        return False
    for notice in notices:
        notice.extract()
    rest = _UP_TO_LABEL.sub("", body.get_text(" ", strip=True), count=1)
    return not re.sub(r"[\W_]+", "", rest)


def _in_window(day: str, valid_from: Optional[str], valid_to: Optional[str]) -> bool:
    return (valid_from is None or valid_from <= day) and (valid_to is None or day <= valid_to)


def extract_validity(
    raw_html: str,
    *,
    article: Optional[str] = None,
    requested_date: Optional[str] = None,
) -> Optional[Validity]:
    """The validity a Normattiva article page states for itself, or None.

    `article` is the article that was asked for. When given, the page must be
    that article: Normattiva answers HTTP 200 for a URN that names something
    else (the decree approving a code, when the code's annex is missing), and a
    window read off the wrong page would be worse than none. This cannot tell
    art. 1 of a code from art. 1 of its approving decree; the default annex the
    controller adds is what keeps the request off that page.

    `requested_date` is the day the reader asked for (ISO, or the Italian long
    form); it only feeds `request_in_window`.
    """
    if not raw_html:
        return None
    window = _read_window(raw_html)
    body = _read_body(raw_html)
    if window is None or body is None:
        return None
    valid_from, valid_to = window

    text = body.get_text(" ", strip=True)
    if article:
        label = _LABEL.search(text[:400])
        if label is None or normalize_article_key(label.group(1)) != normalize_article_key(article):
            log.info("Validity not read: the page is not the article asked for",
                     asked=article, found=label.group(1) if label else None)
            return None

    if valid_from is None:
        # "al:" alone: the article did not exist yet on the requested day.
        if not (valid_to and _NOT_YET in text.lower()):
            return None
        state = "not_yet"
    elif _is_abrogated(body):
        state = "abrogated"
    elif valid_to is None:
        state = "current"
    else:
        state = "historical"

    day = _iso_day(requested_date)
    validity: Validity = {
        "state": state,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "version_number": _read_version_number(raw_html),
        "act_updated": _read_act_updated(raw_html),
        "request_in_window": _in_window(day, valid_from, valid_to) if day else None,
    }
    log.info("Validity read", state=state, valid_from=valid_from, valid_to=valid_to,
             version=validity["version_number"], request_in_window=validity["request_in_window"])
    return validity


async def read_validity(
    cache: Any,
    urn: Optional[str],
    *,
    article: Optional[str] = None,
    requested_date: Optional[str] = None,
) -> Optional[Validity]:
    """The validity of the page the scraper just fetched for `urn`, or None.

    Reads the raw page from the scraper's own persistent cache (key: the URN
    `get_document` returned), so no request is made. Never raises: a cache
    miss, a backend error or a page that cannot be read all mean "no validity".
    """
    if cache is None or not urn:
        return None
    try:
        raw = await cache.get(urn)
        if not isinstance(raw, str) or not raw:
            return None
        return await asyncio.to_thread(
            extract_validity, raw, article=article, requested_date=requested_date,
        )
    except Exception as exc:  # noqa: BLE001 - best effort by contract
        log.warning("Validity could not be read", error=str(exc), urn=str(urn)[:100])
        return None


def is_historical_request(version: Any, version_date: Any) -> bool:
    """Whether the request asks for a past text: the original, or a date.

    This is the request, not the page. It is what decides that Brocardi is not
    fetched: its commentary and massime carry no date.
    """
    if isinstance(version, str) and version.strip().lower() == "originale":
        return True
    return isinstance(version_date, str) and bool(version_date.strip())


def _today_in_rome() -> date:
    try:
        return datetime.now(ZoneInfo("Europe/Rome")).date()
    except ZoneInfoNotFoundError:
        # A slim image can lack the tz database. Use the latest offset Rome ever
        # has, so a valid date is never refused (one a couple of hours early may pass).
        return datetime.now(timezone(timedelta(hours=2))).date()


def reject_future_version_date(version_date: Any, today: Optional[date] = None) -> None:
    """Refuse a `version_date` later than today (Europe/Rome).

    Normattiva answers a future date with the current text and says nothing, so
    the reader would be shown today's text under a date it was not asked for.
    A value that is not a readable date is left to the existing parsing path.
    """
    day = _iso_day(version_date)
    if day is None:
        return
    if date.fromisoformat(day) > (today or _today_in_rome()):
        raise ValidationError(
            "version_date non può essere futura: Normattiva restituirebbe il testo attuale, "
            "non quello alla data richiesta"
        )
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity.py -q)`

Expected: `91 passed`. (If one of the three `TestRecapturedPages` tests fails against the real pages of Task 1, the page and not the test is the reference: read the message, compare with the block printed in Task 1 Step 4, and adjust `_WINDOW` or the sentinel, never the expected dates.)

- [ ] **Step 5: The live test**

`services/visualex/tests/test_normattiva_validity_live.py` repeats the main cases against the portal. It is excluded from the default run.

```python
"""The validity window, read off live Normattiva pages (`-m live`).

Excluded from the default run: it asks the real portal for six article pages,
three seconds apart, through the same path the app uses (the controller builds
the request, the scraper fetches and caches the page, `read_validity` reads it).
It is how the extraction is re-checked when the portal changes its markup:
`test_normattiva_validity.py` freezes what the pages looked like, this shows
what they look like now.

    cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity_live.py -m live -q
"""
import asyncio

import pytest

from app import NormaController, normattiva_scraper
from visualex_api.services.normattiva_validity import read_validity

# The scraper's HTTP client keeps one aiohttp session for the life of the process,
# so the six cases must share one event loop: with one loop per test the second case
# finds the first one's loop closed ("Event loop is closed").
pytestmark = [pytest.mark.live, pytest.mark.asyncio(loop_scope="module")]

PAUSE = 3  # seconds between two requests to the portal

CASES = {
    # A middle version: both ends of the window, and the version's number.
    "cc_1284_at_2007-12-29": (
        {"act_type": "codice civile", "article": "1284", "version": "vigente", "version_date": "2007-12-29"},
        {"state": "historical", "valid_from": "2003-12-25", "valid_to": "2007-12-29",
         "version_number": 7, "request_in_window": True},
    ),
    # The next version starts on the next day: windows are contiguous.
    "cc_1284_at_2007-12-30": (
        {"act_type": "codice civile", "article": "1284", "version": "vigente", "version_date": "2007-12-30"},
        {"state": "historical", "valid_from": "2007-12-30", "version_number": 8, "request_in_window": True},
    ),
    # An article that did not exist yet: only the end of the window is stated.
    "cpc_183bis_at_2010-01-01": (
        {"act_type": "codice di procedura civile", "article": "183-bis", "version": "vigente",
         "version_date": "2010-01-01"},
        {"state": "not_yet", "valid_from": None, "valid_to": "2014-09-12", "request_in_window": True},
    ),
    # A repealed article, read today: the notice is the text.
    "cp_594_current": (
        {"act_type": "codice penale", "article": "594", "version": "vigente"},
        {"state": "abrogated", "valid_to": None},
    ),
    # The original text of an article amended since.
    "st_lav_18_original": (
        {"act_type": "legge", "act_number": "300", "date": "1970-05-20", "article": "18", "version": "originale"},
        {"state": "historical"},
    ),
    # A text still in force.
    "cc_2043_current": (
        {"act_type": "codice civile", "article": "2043", "version": "vigente"},
        {"state": "current", "valid_to": None},
    ),
}


@pytest.mark.parametrize("name", CASES)
async def test_the_window_the_portal_states(name):
    request, expected = CASES[name]
    await asyncio.sleep(PAUSE)
    controller = NormaController.__new__(NormaController)
    [nv] = await controller.create_norma_visitata_from_data(request)
    _, urn = await normattiva_scraper.get_document(nv)

    found = await read_validity(
        normattiva_scraper.cache, urn,
        article=nv.numero_articolo, requested_date=nv.data_versione,
    )

    assert found is not None, f"{name}: the page could not be read ({urn})"
    for key, value in expected.items():
        assert found[key] == value, f"{name}: {key} is {found[key]!r}, expected {value!r}"
    if name == "st_lav_18_original":
        assert found["valid_from"].startswith("1970-")
```

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity_live.py -m live --collect-only -q)`

Expected: `6 tests collected`. Then `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity_live.py -q)`, without `-m live`: `6 deselected`.

Running it for real asks the portal for six pages (about thirty seconds). It is a new request to a third party, so ask the owner first, as in Task 1. Expected: `6 passed`. A failure says which key differs: if the reader misreads a real page, fix the module; if the portal legitimately says something else than this plan guessed (the dates of art. 594 c.p., the original text of art. 18), fix the expected value in the live test and tell the owner.

First real run (2 October 2026): the plan's first draft marked the module only `live`, and five of the six cases failed with `Event loop is closed` — pytest-asyncio gives each test its own loop and `ThrottledHttpClient` (`visualex_api/services/http_client.py`) keeps one aiohttp session for the life of the process. With the module-scoped loop above all six passed (`6 passed in 26.35s`), which also confirmed the expected values for art. 594 c.p. and art. 18 of l. 300/1970. Run the file on its own: `http_client` is a process-wide singleton, so a session another live module left bound to a closed loop would still break the first case in a combined `-m live` run.

- [ ] **Step 6: The whole Python suite**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/ -q)`

Expected: `914 passed, 12 deselected` (823 before, plus the 91 of this task).

- [ ] **Step 7: Commit (ask first)**

```bash
git add services/visualex/visualex_api/services/normattiva_validity.py services/visualex/tests/validity_pages.py services/visualex/tests/test_normattiva_validity.py services/visualex/tests/test_normattiva_validity_live.py
git commit -m "feat(visualex): read the validity window off a Normattiva article page"
```

### Task 3: `validity` on the wire, and the two guards

The three handlers that serve an article from `get_document` add `validity`; a future `version_date` is refused where every handler starts; a past read never asks Brocardi. Everything else in them is unchanged: the text comes through byte for byte.

**Files:**
- Create: `services/visualex/tests/test_validity_wire.py`
- Modify: `services/visualex/app.py` (the imports; `create_norma_visitata_from_data`; a new `_validity_for` next to `get_scraper_for_norma`; `stream_article_text`, `fetch_article_text`, `fetch_brocardi_info`, `fetch_all_data`)
- Modify: `services/visualex/CLAUDE.md`

**Interfaces:**
- Consumes: `read_validity`, `is_historical_request`, `reject_future_version_date` from Task 2; the scraper's own cache (`NormattivaScraper.cache`, the filesystem or Redis backend `get_document` writes the raw page to, key = the URN it returns).
- Produces: the wire of spec §5.1 — `"validity": {state, valid_from, valid_to, version_number, act_updated, request_in_window}` next to `article_text` in `/stream_article_text`, `/fetch_article_text` and `/fetch_all_data`; absent when the page cannot be read or the source is not Normattiva. A 400 with a message containing "futura" for a `version_date` after today. `NormaController._validity_for(scraper, nv, url)`.

- [ ] **Step 1: Write the contract tests**

They replace the scraper and Brocardi with stubs (no network), build the request the way the handlers receive it, and read the NDJSON or JSON that comes back. The text used is odd on purpose — double spaces, a non-breaking space, CRLF, accents — to prove nothing touched it.

`services/visualex/tests/test_validity_wire.py`:

```python
"""`validity` on the wire, and what a request for a past text must not trigger.

The three handlers that serve an article from the Normattiva scraper add
`validity` next to `article_text`. It is read from the page the scraper cached,
so the text itself must come through untouched: every stored highlight and note
is pinned to it (root CLAUDE.md, rule 23). A request for a past text never asks
Brocardi, and a date after today is refused before any request is made.
"""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.normattiva_scraper import NormattivaScraper
from tests.validity_pages import synthetic

URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art3!vig=2007-12-29"
# Odd on purpose: double spaces, a non-breaking space, CRLF and accents must
# reach the client byte for byte.
TEXT = "Art. 3\n\n1.  Ogni provvedimento è motivato.\r\n2. Fine del  testo. àèìòù"
PAGE = synthetic(dal="25-12-2003", al="29-12-2007", label="Art. 3", version=7, updated="11/08/2026")
BROCARDI = ("Libro I", {"Brocardi": ["Nemo iudex"]}, "https://www.brocardi.it/x")

ARTICLE_ENDPOINTS = ["/stream_article_text", "/fetch_article_text", "/fetch_all_data"]
# The three places that call `brocardi_scraper.get_info`.
BROCARDI_ENDPOINTS = ["/stream_article_text", "/fetch_brocardi_info", "/fetch_all_data"]


class FakeCache:
    def __init__(self, entries):
        self.entries = entries

    async def get(self, key):
        return self.entries.get(key)


def requested(version=None, version_date=None, tipo_atto="legge", article="3"):
    """What `create_norma_visitata_from_data` hands the handlers."""
    return SimpleNamespace(
        norma=SimpleNamespace(tipo_atto=tipo_atto),
        numero_articolo=article,
        versione=version,
        data_versione=version_date,
        allegato=None,
        to_dict=lambda: {"tipo_atto": tipo_atto, "numero_articolo": article, "versione": version,
                         "data_versione": version_date},
    )


def normattiva_serving(page=PAGE):
    scraper = NormattivaScraper.__new__(NormattivaScraper)  # no __init__: no cache, no network
    scraper.get_document = AsyncMock(return_value=(TEXT, URN))
    scraper.cache = FakeCache({URN: page} if page is not None else {})
    return scraper


@pytest.fixture
async def controller():
    ctrl = NormaController()
    ctrl.fetch_queue.spacing = 0
    await ctrl.fetch_queue.start()
    yield ctrl
    await ctrl.fetch_queue.stop()


@pytest.fixture
def brocardi():
    scraper = SimpleNamespace(get_info=AsyncMock(return_value=BROCARDI))
    with patch("app.brocardi_scraper", scraper):
        yield scraper


@pytest.fixture(autouse=True)
def _no_history_writes():
    with patch("app.add_to_history"):
        yield


async def ask(controller, endpoint, nv, scraper=None, body=None):
    """POST to an endpoint with the article(s), the scraper and Brocardi replaced."""
    scraper = scraper or normattiva_serving()
    articles = nv if isinstance(nv, list) else [nv]
    request_body = {"act_type": "legge", "article": "3", "show_brocardi_info": True, **(body or {})}
    with patch.object(NormaController, "create_norma_visitata_from_data", AsyncMock(return_value=articles)), \
            patch("app.normattiva_scraper", scraper):
        response = await controller.app.test_client().post(endpoint, json=request_body)
    raw = await response.get_data(as_text=True)
    assert response.status_code == 200, raw
    if endpoint == "/stream_article_text":
        return [json.loads(line) for line in raw.splitlines() if line.strip()]
    return json.loads(raw)


class TestValidityRidesAlong:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_text_is_untouched_and_the_window_is_added(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2005-06-01"))
        assert result["article_text"] == TEXT
        assert result["url"] == URN
        assert result["validity"] == {
            "state": "historical",
            "valid_from": "2003-12-25",
            "valid_to": "2007-12-29",
            "version_number": 7,
            "act_updated": "2026-08-11",
            "request_in_window": True,
        }

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_it_says_when_the_window_does_not_contain_the_requested_day(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2010-01-01"))
        assert result["validity"]["request_in_window"] is False

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("page", [None, "<html>not an article page</html>"])
    async def test_without_a_readable_page_the_key_is_simply_absent(self, controller, brocardi, endpoint, page):
        [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(page))
        assert result["article_text"] == TEXT
        assert "validity" not in result

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_eur_lex_text_carries_no_validity(self, controller, brocardi, endpoint):
        eurlex = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, "https://eur-lex.example/x")),
                                 cache=FakeCache({"https://eur-lex.example/x": PAGE}))
        with patch("app.eurlex_scraper", eurlex):
            [result] = await ask(controller, endpoint, requested(tipo_atto="regolamento ue"))
        assert result["article_text"] == TEXT
        assert "validity" not in result


class TestARangeAtOneDate:
    """`article: "1-3"` with a date answers one article after the other, and each
    page states its own window: art. 1 did not exist on the day, art. 2 did, and
    the page of art. 3 is not in the cache."""

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_every_article_carries_its_own_window_or_none(self, controller, brocardi, endpoint):
        urns = [f"{URN}#{n}" for n in (1, 2, 3)]
        pages = {
            urns[0]: synthetic(al="12-9-2014", label="Art. 1", content="<span>NON ANCORA ESISTENTE O VIGENTE</span>"),
            urns[1]: synthetic(dal="1-1-2005", al="31-12-2015", label="Art. 2"),
        }
        scraper = NormattivaScraper.__new__(NormattivaScraper)
        scraper.get_document = AsyncMock(side_effect=[(f"testo {n}", urns[n - 1]) for n in (1, 2, 3)])
        scraper.cache = FakeCache(pages)
        asked = [requested(version="vigente", version_date="2010-01-01", article=str(n)) for n in (1, 2, 3)]

        results = await ask(controller, endpoint, asked, scraper=scraper)

        assert [r["article_text"] for r in results] == ["testo 1", "testo 2", "testo 3"]
        assert [r.get("validity", {}).get("state") for r in results] == ["not_yet", "historical", None]
        assert "validity" not in results[2]


class TestBrocardiIsNotAskedForAPastText:
    @pytest.mark.parametrize("endpoint", BROCARDI_ENDPOINTS)
    async def test_the_text_in_force_still_gets_its_doctrine(self, controller, brocardi, endpoint):
        await ask(controller, endpoint, requested(version="vigente"))
        brocardi.get_info.assert_awaited_once()

    @pytest.mark.parametrize("endpoint", BROCARDI_ENDPOINTS)
    @pytest.mark.parametrize("version,version_date", [
        ("vigente", "2007-12-29"),
        ("originale", None),
        ("originale", ""),
        (None, "2007-12-29"),
    ])
    async def test_a_past_text_never_does(self, controller, brocardi, endpoint, version, version_date):
        [result] = await ask(controller, endpoint, requested(version=version, version_date=version_date))
        brocardi.get_info.assert_not_awaited()
        assert not result.get("brocardi_info")

    @pytest.mark.parametrize("endpoint", ["/stream_article_text", "/fetch_all_data"])
    async def test_a_past_text_does_not_wait_for_the_slowest_source(self, controller, brocardi, endpoint):
        """The stream used to gather the text and Brocardi, so a historical read
        took as long as the slower of the two."""
        brocardi.get_info = AsyncMock(side_effect=AssertionError("Brocardi must not be reached"))
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2007-12-29"))
        assert result["article_text"] == TEXT
        assert "brocardi_error" not in result
        assert not result.get("brocardi_info")


class TestAFutureDateIsRefusedBeforeAnyRequest:
    BODY = {"act_type": "legge", "act_number": "241", "date": "1990-08-07", "article": "3",
            "version": "vigente", "version_date": "2999-01-01"}

    @pytest.mark.parametrize("endpoint", ["/fetch_norma_data", "/fetch_brocardi_info"] + ARTICLE_ENDPOINTS)
    async def test_every_door_answers_400_and_says_why(self, controller, endpoint):
        scraper = normattiva_serving()
        with patch("app.normattiva_scraper", scraper), \
                patch("app.get_tree", AsyncMock(side_effect=AssertionError("no request may be made"))), \
                patch("app.complete_date_or_parse_async", AsyncMock(side_effect=AssertionError("no request may be made"))):
            response = await controller.app.test_client().post(endpoint, json=self.BODY)
        assert response.status_code == 400
        assert "futura" in (await response.get_json())["error"]
        scraper.get_document.assert_not_awaited()
```

- [ ] **Step 2: Run it to see it fail**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_validity_wire.py -q)`

Expected: `28 failed, 12 passed`. The failures are the right ones: `KeyError: 'validity'`, `Expected mock to not have been awaited` (Brocardi asked for a past text), and the future date answered with something other than 400.

- [ ] **Step 3: Wire the handlers**

Ten edits to `services/visualex/app.py`, in this order. The guard goes into `create_norma_visitata_from_data` because every handler that reads an article calls it first, before any network; Brocardi is skipped at its three call sites.

In `services/visualex/app.py`, replace:

```python
from visualex_api.services.akn_parser import normalize_article_key
```

with:

```python
from visualex_api.services.akn_parser import normalize_article_key
from visualex_api.services.normattiva_validity import (
    is_historical_request,
    read_validity,
    reject_future_version_date,
)
```

In `services/visualex/app.py`, replace:

```python
        if 'article' not in data or data.get('article') in (None, ''):
            raise ValidationError("Campo obbligatorio mancante: article")

```

with:

```python
        if 'article' not in data or data.get('article') in (None, ''):
            raise ValidationError("Campo obbligatorio mancante: article")

        # Normattiva answers a date after today with the current text and says
        # nothing. Refused here, before any network call, so that no door skips
        # it: every handler that reads an article starts from this method.
        reject_future_version_date(data.get('version_date'))

```

In `services/visualex/app.py`, replace:

```python
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return eurlex_scraper
        else:
            return normattiva_scraper
```

with:

```python
        if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
            return eurlex_scraper
        else:
            return normattiva_scraper

    @staticmethod
    async def _validity_for(scraper, nv, url):
        """The window Normattiva's page states for this text, or None.

        Read from the page `get_document` has just stored in the scraper's own
        persistent cache (the key is the URN it returned), so it costs no request
        and never touches the text. Only Normattiva pages carry the statement;
        EUR-Lex answers None. Never raises.
        """
        if not isinstance(scraper, NormattivaScraper):
            return None
        return await read_validity(
            getattr(scraper, 'cache', None), url,
            article=nv.numero_articolo, requested_date=nv.data_versione,
        )
```

In `services/visualex/app.py`, replace:

```python
                    tasks = [scraper.get_document(nv)]
                    if show_brocardi and isinstance(scraper, NormattivaScraper):
                        tasks.append(brocardi_scraper.get_info(nv))
```

with:

```python
                    tasks = [scraper.get_document(nv)]
                    # Brocardi is current doctrine with no date: never asked for a past text.
                    if (
                        show_brocardi
                        and isinstance(scraper, NormattivaScraper)
                        and not is_historical_request(nv.versione, nv.data_versione)
                    ):
                        tasks.append(brocardi_scraper.get_info(nv))
```

In `services/visualex/app.py`, replace:

```python
                        article_text, url = results[0]
                        result = {
                            'article_text': article_text,
                            'norma_data': nv.to_dict(),
                            'url': url
                        }

                        # Add Brocardi info if available
```

with:

```python
                        article_text, url = results[0]
                        result = {
                            'article_text': article_text,
                            'norma_data': nv.to_dict(),
                            'url': url
                        }
                        validity = await self._validity_for(scraper, nv, url)
                        if validity:
                            result['validity'] = validity

                        # Add Brocardi info if available
```

In `services/visualex/app.py`, replace:

```python
                    log.info("Document fetched successfully", article_text=article_text, url=url)
                    return {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
```

with:

```python
                    log.info("Document fetched successfully", article_text=article_text, url=url)
                    result = {
                        'article_text': article_text,
                        'norma_data': nv.to_dict(),
                        'url': url
                    }
                    validity = await self._validity_for(scraper, nv, url)
                    if validity:
                        result['validity'] = validity
                    return result
```

In `services/visualex/app.py`, replace:

```python
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': nv.to_dict(), 'brocardi_info': None}
```

with:

```python
                if act_type_normalized in ['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']:
                    return {'norma_data': nv.to_dict(), 'brocardi_info': None}
                # Brocardi is current doctrine with no date: never asked for a past text.
                if is_historical_request(nv.versione, nv.data_versione):
                    return {'norma_data': nv.to_dict(), 'brocardi_info': None}
```

In `services/visualex/app.py`, replace:

```python
                    article_text, url = await scraper.get_document(nv)
                    brocardi_info = None
                    if scraper == normattiva_scraper:
```

with:

```python
                    article_text, url = await scraper.get_document(nv)
                    validity = await self._validity_for(scraper, nv, url)
                    brocardi_info = None
                    if scraper == normattiva_scraper:
```

In `services/visualex/app.py`, replace:

```python
                        should_fetch_brocardi = True
                        if explicit_dispositivo and nv.allegato is None:
```

with:

```python
                        # Brocardi is current doctrine with no date: never asked for a past text.
                        should_fetch_brocardi = not is_historical_request(nv.versione, nv.data_versione)
                        if should_fetch_brocardi and explicit_dispositivo and nv.allegato is None:
```

In `services/visualex/app.py`, replace:

```python
                    return {
                        'article_text': article_text,
                        'url': url,
                        'norma_data': nv.to_dict(),
                        'brocardi_info': brocardi_info
                    }
```

with:

```python
                    result = {
                        'article_text': article_text,
                        'url': url,
                        'norma_data': nv.to_dict(),
                        'brocardi_info': brocardi_info
                    }
                    if validity:
                        result['validity'] = validity
                    return result
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_validity_wire.py -q)`

Expected: `40 passed`.

- [ ] **Step 5: Document it**

In `services/visualex/CLAUDE.md`, replace:

```markdown
    `normalize_article_key` in `akn_parser.py` is the pure canonicaliser for
    article numbers and needs no network.
```

with:

```markdown
    `normalize_article_key` in `akn_parser.py` is the pure canonicaliser for
    article numbers and needs no network.
  - `normattiva_validity.py` — what a Normattiva article page says about its own
    validity: the window ("Testo in vigore dal … al …"), the version number, the
    act's last update, and a state (`current`, `historical`, `not_yet`,
    `abrogated`). Read from the raw page the scraper already keeps in its
    persistent cache (the key is the URN `get_document` returns), so it costs no
    request and never touches `article_text` (gotcha 23). Best effort: a page it
    cannot read yields no `validity` key at all, never a guess. It also holds the
    two request guards, `reject_future_version_date` and `is_historical_request`.
```

In `services/visualex/CLAUDE.md`, replace:

```markdown
Root `app.py` maps failures through `_error_response`, so the status now carries
```

with:

```markdown
`validity` rides next to `article_text` in `/stream_article_text`,
`/fetch_article_text` and `/fetch_all_data` (Normattiva only; absent when the page
cannot be read): `{state, valid_from, valid_to, version_number, act_updated,
request_in_window}`, dates in ISO form. It is the source's own statement of which
version came back; `norma_data.data_versione` is only the date the caller sent. A
`version_date` after today (Europe/Rome) is a 400 — Normattiva would answer with the
current text and say nothing — and a request for a past text (`version: "originale"`
or a `version_date`) never asks Brocardi, whose commentary carries no date.

Root `app.py` maps failures through `_error_response`, so the status now carries
```

In `services/visualex/CLAUDE.md`, replace:

```markdown
    same kind of gate; `tests/test_pdf_cache_path.py` lists the attempts.
```

with:

```markdown
    same kind of gate; `tests/test_pdf_cache_path.py` lists the attempts.

31. **The window a page states is the only statement of which version came back.**
    `NormaVisitata.data_versione` is the date the caller *sent*, echoed. Normattiva
    answers a date after today with the current text and no sign (hence
    `reject_future_version_date`), and a date before an article existed with a page
    whose text reads "NON ANCORA ESISTENTE O VIGENTE". Read the window from the page
    (`normattiva_validity.py`), never from the request, and say nothing when the page
    cannot be read. The window says which text was in force, not which discipline
    governs a fact: transitional provisions and retroactive rules are not on the page.
    `tests/test_normattiva_validity_live.py` (`-m live`) re-checks the extraction
    against the portal.
```

- [ ] **Step 6: The text is frozen — prove it, and run everything**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_extraction.py -q)`

Expected: passes: the five frozen SHA-256 of the extractor's output are unchanged (this task never touches the scraper).

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/ -q)`

Expected: `954 passed, 12 deselected`.

- [ ] **Step 7: Commit (ask first)**

```bash
git add services/visualex/app.py services/visualex/tests/test_validity_wire.py services/visualex/CLAUDE.md
git commit -m "feat(visualex): serve the validity window; refuse a future date; no doctrine for a past text"
```

- [ ] **Step 8: A reviewer on the PR**

Dispatch the `code-reviewer` agent with the spec path and `git diff develop...HEAD`: it re-reads the diff against §5.1 and the Global Constraints, read-only. Fix every finding it confirms, or say why not; then open the PR (ask first).

### PR 1 description

> **Summary.** `/stream_article_text`, `/fetch_article_text` and `/fetch_all_data` add `validity` next to `article_text`: the window ("Testo in vigore dal … al …"), the version number and a state, read off the raw Normattiva page the scraper already caches (no request, `article_text` untouched). A `version_date` after today (Europe/Rome) is a 400; a request for a past text no longer asks Brocardi.
>
> **Why.** `norma_data.data_versione` is the date the caller typed, echoed; Normattiva answers a date in the future with the current text and no sign. The reader needs the source's own statement. Spec: `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`.
>
> **Checked.** Python suite 954 passed (823 before); the five frozen extractor hashes unchanged; 15 deliberate breakages of the new code and its wiring, each caught by a test; live test (`-m live`) 6 passed against the portal on <date>.
>
> **For the other developer.** Nothing on your list: not `normattiva_scraper.py`, auth, Prisma, `.github/`, `infra/`, the data scripts. `app.py` and the new module are flagged because they are the Python API's core.

## PR 2 — The reader says which version it shows

Branch `feat/testo-alla-data-reader`, from `develop` after PR 1 has merged. Without PR 1 nothing breaks (no `validity` means no chip, as on a page that cannot be read), but nothing shows either.

### Task 4: The pure foundations — types, dates, the display table, the citation

Everything the interface decides, with no DOM: what the chip says, when a banner appears, what a past text switches off, how a day is written, how a lawyer cites. **The owner reads the strings in `versionDisplay.test.ts` and the whole of `citationGolden.ts`** (the golden file is the specification of the citation; its first case is the measured art. 1284 c.c., the others show the form and make no claim about real versions).

**Files:**
- Modify: `apps/web/src/types/index.ts`, `apps/web/src/utils/dateUtils.ts`
- Create: `apps/web/src/utils/versionDisplay.ts`, `apps/web/src/utils/citation.ts`
- Create: `apps/web/src/utils/dateUtils.test.ts`, `apps/web/src/utils/versionDisplay.test.ts`, `apps/web/src/utils/citation.test.ts`, `apps/web/src/utils/__fixtures__/citationGolden.ts`

**Interfaces:**
- Consumes: `abbreviateActType`, `formatDateItalianLong`, `formatDateForDisplay` (`dateUtils.ts`); `formatCitation` (`normaMeta.ts`, unchanged).
- Produces:
  - Types: `ValidityState`, `ArticleValidity` (mirrors the wire of Task 3), `ArticleData.validity?`.
  - `dateUtils`: `formatDateDashed(isoDate: string): string`, `formatDateForCitation(isoDate: string): string`, `addDaysToIsoDate(isoDate: string, days: number): string`, `todayInRome(now?: Date): string`.
  - `versionDisplay`: `requestIsHistorical(request: VersionRequest | null | undefined): boolean`; `deriveVersionInfo(params: { version?; version_date? }): ArticleData['versionInfo'] | undefined`; `isEuropeanAct(tipoAtto): boolean`; `describeVersion(validity: ArticleValidity | undefined, request: VersionRequest | null | undefined): VersionDisplay` with `VersionDisplay = { chip: VersionChip | null; banner: VersionBanner | null; textVisible; readOnly; doctrineVisible; canCite; canCopyOrSave; updateNotesOpen }`; `buildTextAtDateParams(norma: NormaVisitata, choice: TextAtDateChoice): SearchParams`; `versionTabSuffix({ version?, versionDate? }): string`; `historicalItemLabel(request): string | null`; the constants `READ_ONLY_REASON` and `NOT_YET_REASON`; the types `VersionChip`, `VersionBanner`, `BannerAction` (`'go_current' | 'copy_citation' | 'open_next_day' | 'pick_date'`), `TextAtDateChoice` (`{ kind: 'date'; date } | { kind: 'original' }`).
  - `citation`: `formatNormCitation(context: CitationContext): NormCitation | null` (`NormCitation = { short; long }`; null when there is nothing honest to cite), `withCitation(text: string, citation: NormCitation | null, trailer: string): string`.

- [ ] **Step 1: Write the tests and the golden file**

`apps/web/src/utils/dateUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDaysToIsoDate, formatDateDashed, formatDateForCitation, todayInRome } from './dateUtils';

describe('formatDateDashed', () => {
  it('writes a day the way Normattiva does, padded', () => {
    expect(formatDateDashed('2007-12-29')).toBe('29-12-2007');
    expect(formatDateDashed('2003-02-01')).toBe('01-02-2003');
  });

  it('returns anything that is not an ISO day as it came', () => {
    expect(formatDateDashed('1990')).toBe('1990');
    expect(formatDateDashed('7 agosto 1990')).toBe('7 agosto 1990');
    expect(formatDateDashed('')).toBe('');
  });
});

describe('formatDateForCitation', () => {
  it('writes a day as a lawyer cites it', () => {
    expect(formatDateForCitation('2007-12-29')).toBe('29 dicembre 2007');
    expect(formatDateForCitation('2026-10-11')).toBe('11 ottobre 2026');
  });

  it('writes the first of the month with an ordinal', () => {
    expect(formatDateForCitation('2026-10-01')).toBe('1° ottobre 2026');
    expect(formatDateForCitation('2007-01-01')).toBe('1° gennaio 2007');
  });

  it('returns anything that is not an ISO day as it came', () => {
    expect(formatDateForCitation('2007')).toBe('2007');
    expect(formatDateForCitation('')).toBe('');
  });
});

describe('addDaysToIsoDate', () => {
  it('moves a day forward and back', () => {
    expect(addDaysToIsoDate('2014-09-12', 1)).toBe('2014-09-13');
    expect(addDaysToIsoDate('2007-12-30', -1)).toBe('2007-12-29');
  });

  it('crosses months, years and leap days', () => {
    expect(addDaysToIsoDate('2007-12-31', 1)).toBe('2008-01-01');
    expect(addDaysToIsoDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToIsoDate('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('returns what is not a real day unchanged', () => {
    expect(addDaysToIsoDate('2007-13-45', 1)).toBe('2007-13-45');
    expect(addDaysToIsoDate('2023-02-29', 1)).toBe('2023-02-29');
    expect(addDaysToIsoDate('ieri', 1)).toBe('ieri');
    expect(addDaysToIsoDate('', 1)).toBe('');
  });
});

describe('todayInRome', () => {
  it('is the day in Rome, which is ahead of UTC late in the evening', () => {
    expect(todayInRome(new Date('2026-10-01T10:00:00Z'))).toBe('2026-10-01');
    expect(todayInRome(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02'); // CEST, UTC+2
    expect(todayInRome(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16'); // CET, UTC+1
  });
});
```

`apps/web/src/utils/versionDisplay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ArticleValidity, NormaVisitata } from '../types';
import {
  buildTextAtDateParams,
  deriveVersionInfo,
  describeVersion,
  historicalItemLabel,
  isEuropeanAct,
  requestIsHistorical,
  versionTabSuffix,
} from './versionDisplay';

const validity = (over: Partial<ArticleValidity> = {}): ArticleValidity => ({
  state: 'current',
  valid_from: '2025-12-28',
  valid_to: null,
  version_number: 8,
  act_updated: '2026-08-11',
  request_in_window: null,
  ...over,
});

const MIDDLE = validity({
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, request_in_window: true,
});
const NOT_YET = validity({
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, request_in_window: true,
});
const ABROGATED = validity({ state: 'abrogated', valid_from: '2016-02-06', version_number: 2 });

describe('requestIsHistorical', () => {
  it.each([
    [{ versione: 'vigente', data_versione: '' }, false],
    [{ versione: 'vigente' }, false],
    [{ versione: 'vigente', data_versione: null }, false],
    [{ versione: 'vigente', data_versione: '   ' }, false],
    [{}, false],
    [{ versione: 'originale' }, true],
    [{ versione: 'ORIGINALE', data_versione: '' }, true],
    [{ versione: 'vigente', data_versione: '2007-12-29' }, true],
    [{ data_versione: '2007-12-29' }, true],
  ])('%j → %s', (request, expected) => {
    expect(requestIsHistorical(request)).toBe(expected);
  });

  it('is false when there is no request at all', () => {
    expect(requestIsHistorical(undefined)).toBe(false);
    expect(requestIsHistorical(null)).toBe(false);
  });
});

describe('deriveVersionInfo', () => {
  it('records a date as asked for', () => {
    expect(deriveVersionInfo({ version: 'vigente', version_date: '2007-12-29' }))
      .toEqual({ isHistorical: true, requestedDate: '2007-12-29' });
  });

  it('makes the original text historical too, which it was not before', () => {
    expect(deriveVersionInfo({ version: 'originale' })).toEqual({ isHistorical: true });
  });

  it('says nothing for the text in force', () => {
    expect(deriveVersionInfo({ version: 'vigente' })).toBeUndefined();
    expect(deriveVersionInfo({ version: 'vigente', version_date: '' })).toBeUndefined();
  });

  it('carries no echo of the date as an effective one', () => {
    expect(deriveVersionInfo({ version: 'vigente', version_date: '2007-12-29' })).not.toHaveProperty('effectiveDate');
  });
});

describe('isEuropeanAct', () => {
  it.each(['TUE', 'tfue', 'CDFUE', 'Regolamento UE', 'regolamento ue', ' Direttiva UE '])('%s', (act) => {
    expect(isEuropeanAct(act)).toBe(true);
  });

  it.each(['legge', 'codice civile', 'decreto legislativo', '', undefined, null])('%s is not', (act) => {
    expect(isEuropeanAct(act)).toBe(false);
  });
});

describe('describeVersion — the text in force', () => {
  it('shows since when it has been in force, with the source and the version in the tooltip', () => {
    const shown = describeVersion(validity(), { versione: 'vigente' });
    expect(shown.chip).toEqual({
      tone: 'current',
      label: 'In vigore dal 28-12-2025',
      title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale. Versione n. 8.',
    });
    expect(shown.banner).toBeNull();
    expect(shown).toMatchObject({ textVisible: true, readOnly: false, doctrineVisible: true, canCite: true, canCopyOrSave: true });
  });

  it('says nothing about the version when the page names none', () => {
    expect(describeVersion(validity({ version_number: null }), {}).chip?.title)
      .toBe('Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.');
  });

  it('says the requested date falls in the text in force, and keeps the doctrine off', () => {
    const shown = describeVersion(validity({ request_in_window: true }), { versione: 'vigente', data_versione: '2026-03-01' });
    expect(shown.banner).toEqual({ kind: 'current_in_window', body: 'La data richiesta cade nel testo attuale.', actions: [] });
    expect(shown.readOnly).toBe(false); // it is the text in force: a note on it is a note on the right words
    expect(shown.doctrineVisible).toBe(false); // but it was fetched without doctrine
  });
});

describe('describeVersion — a past text', () => {
  const shown = describeVersion(MIDDLE, { versione: 'vigente', data_versione: '2005-06-01' });

  it('shows the window the source stated, not the date that was typed', () => {
    expect(shown.chip).toMatchObject({ tone: 'historical', label: 'Testo storico · dal 25-12-2003 al 29-12-2007' });
    expect(shown.chip?.title).toContain('Versione n. 7.');
  });

  it('explains what the text is and what it does not say', () => {
    expect(shown.banner).toEqual({
      kind: 'historical',
      title: 'Testo storico',
      body: 'In vigore dal 25 dicembre 2003 al 29 dicembre 2007, secondo il testo consolidato di Normattiva (a fini informativi). '
        + 'Non è il testo attuale. Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono '
        + 'contare disposizioni transitorie, efficacia retroattiva o norme più favorevoli.',
      note: 'Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico.',
      actions: ['go_current', 'copy_citation'],
    });
  });

  it('is a reading: nothing is anchored to it and no doctrine rides along', () => {
    expect(shown).toMatchObject({ readOnly: true, doctrineVisible: false, textVisible: true, canCite: true });
  });

  it('opens the update notes, where a delegated rate or a date is often to be found', () => {
    expect(shown.updateNotesOpen).toBe(true);
    expect(describeVersion(validity(), { versione: 'vigente' }).updateNotesOpen).toBe(false);
  });

  it('is read-only even when the request names no date (the page decides)', () => {
    expect(describeVersion(MIDDLE, { versione: 'vigente' }).readOnly).toBe(true);
  });
});

describe('describeVersion — an article that did not exist yet', () => {
  const shown = describeVersion(NOT_YET, { versione: 'vigente', data_versione: '2010-01-01' });

  it('does not draw the served notice as an article', () => {
    expect(shown.textVisible).toBe(false);
    expect(shown.chip).toMatchObject({ tone: 'not_yet', label: 'Non ancora esistente' });
  });

  it('says when it came into being and offers the way forward', () => {
    expect(shown.banner).toEqual({
      kind: 'not_yet',
      title: 'Articolo non ancora esistente',
      body: 'Questo articolo non esisteva al 1 gennaio 2010. È in vigore dal 13 settembre 2014.',
      actions: ['open_next_day', 'pick_date'],
      nextDay: '2014-09-13',
    });
  });

  it('turns off the actions that need an article', () => {
    expect(shown).toMatchObject({ readOnly: true, canCite: false, canCopyOrSave: false });
  });

  it('falls back to the last day without the article when no date was typed (the original text)', () => {
    expect(describeVersion(NOT_YET, { versione: 'originale' }).banner?.body)
      .toBe('Questo articolo non esisteva al 12 settembre 2014. È in vigore dal 13 settembre 2014.');
  });
});

describe('describeVersion — a repealed article', () => {
  it('says since when, and shows the notice as the text', () => {
    const shown = describeVersion(ABROGATED, { versione: 'vigente' });
    expect(shown.chip).toMatchObject({ tone: 'abrogated', label: 'Abrogato dal 06-02-2016' });
    expect(shown.banner).toBeNull();
    expect(shown).toMatchObject({ textVisible: true, readOnly: false });
  });

  it('is read-only when it was reached through a date', () => {
    expect(describeVersion(ABROGATED, { versione: 'vigente', data_versione: '2020-01-01' }).readOnly).toBe(true);
  });
});

describe('describeVersion — the source could not be read', () => {
  it('claims nothing for the text in force: no chip, and no "Vigente" by default', () => {
    expect(describeVersion(undefined, { versione: 'vigente' })).toEqual({
      chip: null, banner: null, textVisible: true, readOnly: false, doctrineVisible: true, canCite: true,
      canCopyOrSave: true, updateNotesOpen: false,
    });
  });

  it('still keeps the annotation tools and the doctrine off a text that was asked for by date', () => {
    expect(describeVersion(undefined, { versione: 'vigente', data_versione: '2007-12-29' }))
      .toMatchObject({ chip: null, banner: null, readOnly: true, doctrineVisible: false });
    expect(describeVersion(undefined, { versione: 'originale' })).toMatchObject({ readOnly: true, doctrineVisible: false });
  });
});

describe('describeVersion — a version that does not contain the requested day', () => {
  const shown = describeVersion({ ...MIDDLE, request_in_window: false }, { versione: 'vigente', data_versione: '2010-01-01' });

  it('warns, and offers no citation', () => {
    expect(shown.banner).toEqual({
      kind: 'unreliable',
      title: 'Versione non attendibile',
      body: 'Normattiva ha restituito una versione che non comprende la data richiesta: non va considerata attendibile.',
      actions: ['pick_date', 'go_current'],
    });
    expect(shown.canCite).toBe(false);
  });

  it('keeps even a text in force read-only', () => {
    const current = describeVersion(validity({ request_in_window: false }), { versione: 'vigente', data_versione: '2000-01-01' });
    expect(current.readOnly).toBe(true);
    expect(current.banner?.kind).toBe('unreliable');
  });
});

describe('buildTextAtDateParams', () => {
  const norma: NormaVisitata = {
    tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  };

  it('asks for the text in force on a day, without doctrine, keeping the annex', () => {
    expect(buildTextAtDateParams(norma, { kind: 'date', date: '2007-12-29' })).toEqual({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false, annex: '2',
    });
  });

  it('asks for the original text with no date', () => {
    const params = buildTextAtDateParams({ ...norma, allegato: undefined }, { kind: 'original' });
    expect(params).toEqual({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'originale', show_brocardi_info: false,
    });
    expect(params).not.toHaveProperty('version_date');
    expect(params).not.toHaveProperty('annex');
  });
});

describe('versionTabSuffix', () => {
  it('names the day that was asked for, in Italian order', () => {
    expect(versionTabSuffix({ versionDate: '2007-12-29' })).toBe(' — testo al 29/12/2007');
  });

  it('names the original text', () => {
    expect(versionTabSuffix({ version: 'originale' })).toBe(' — testo originale');
  });

  it('is empty for the text in force', () => {
    expect(versionTabSuffix({ version: 'vigente' })).toBe('');
    expect(versionTabSuffix({ version: 'vigente', versionDate: '' })).toBe('');
  });
});

describe('historicalItemLabel', () => {
  it('labels an item that holds a past text', () => {
    expect(historicalItemLabel({ versione: 'vigente', data_versione: '2007-12-29' })).toBe('Testo al 29/12/2007');
    expect(historicalItemLabel({ versione: 'originale' })).toBe('Testo originale');
  });

  it('labels nothing that holds the text in force, or a legacy item with no version fields', () => {
    expect(historicalItemLabel({ versione: 'vigente' })).toBeNull();
    expect(historicalItemLabel({})).toBeNull();
    expect(historicalItemLabel(undefined)).toBeNull();
  });
});

describe('a day written the way a shared link may carry it ("12 ottobre 2007")', () => {
  it('is a past text', () => {
    expect(requestIsHistorical({ versione: 'vigente', data_versione: '12 ottobre 2007' })).toBe(true);
  });

  it('names the tab with the day as it came', () => {
    expect(versionTabSuffix({ versionDate: '12 ottobre 2007' })).toBe(' — testo al 12 ottobre 2007');
  });

  it('is still told in the banner of an article that did not exist yet', () => {
    expect(describeVersion(NOT_YET, { versione: 'vigente', data_versione: '12 ottobre 2007' }).banner?.body)
      .toBe('Questo articolo non esisteva al 12 ottobre 2007. È in vigore dal 13 settembre 2014.');
  });
});
```

`apps/web/src/utils/__fixtures__/citationGolden.ts`:

```ts
import type { CitationContext } from '../citation';

/**
 * The wording of a citation "nel testo in vigore al …", case by case.
 *
 * This file is the specification and the owner reads it: each entry is what a
 * reader chose (the act, the article, the day) and the two lines the app writes
 * for it. `citation.test.ts` fails when the code and this file disagree. The
 * style is the owner's: "art. 2, l. 7 agosto 1990, n. 241" for an act cited by
 * type, date and number; "art. 1284 c.c." for a code and the Constitution, with
 * no comma. The windows are the source's own where they were measured (art.
 * 1284 c.c.); the others are there to show the form and are not claims about
 * real versions.
 */
export interface CitationCase {
  name: string;
  context: CitationContext;
  /** null: nothing is cited. */
  expected: { short: string; long: string } | null;
}

const CONSULTED = '2026-10-01';

export const CITATION_GOLDEN: CitationCase[] = [
  {
    name: 'a code, a middle version (art. 1284 c.c. at 29 December 2007 — window measured on the portal)',
    context: {
      norma: { tipo_atto: 'codice civile', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true },
      requestedDate: '2007-12-29',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a day inside the window, not at its end (the short form states the day asked for)',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true },
      requestedDate: '2005-06-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 1° giugno 2005',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the other codes and the Constitution are cited by their abbreviation, with no comma',
    context: {
      norma: { tipo_atto: 'Costituzione', numero_articolo: '81' },
      validity: { state: 'historical', valid_from: '1948-01-01', valid_to: '2012-05-07', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 81 Cost., nel testo in vigore al 1° gennaio 2010',
      long: 'art. 81 Cost., nel testo in vigore dal 1° gennaio 1948 al 7 maggio 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an article with a suffix, in a procedure code',
    context: {
      norma: { tipo_atto: 'codice di procedura civile', numero_articolo: '183-bis', allegato: '1' },
      validity: { state: 'historical', valid_from: '2014-09-13', valid_to: '2015-08-20', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2015-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 183-bis c.p.c., nel testo in vigore al 1° gennaio 2015',
      long: 'art. 183-bis c.p.c., nel testo in vigore dal 13 settembre 2014 al 20 agosto 2015 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an act that is not a code: by type, date and number, after a comma (the owner’s model)',
    context: {
      norma: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2' },
      validity: { state: 'historical', valid_from: '2012-01-01', valid_to: '2016-12-31', version_number: 5, act_updated: null, request_in_window: true },
      requestedDate: '2014-03-15',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore al 15 marzo 2014',
      long: 'art. 2, l. 7 agosto 1990, n. 241, nel testo in vigore dal 1° gennaio 2012 al 31 dicembre 2016 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an aliased act is cited by the act it is, not by its nickname',
    context: {
      norma: { tipo_atto: 'codice in materia di protezione dei dati personali', tipo_atto_reale: 'decreto legislativo', numero_atto: '196', data: '2003-06-30', numero_articolo: '7' },
      validity: { state: 'historical', valid_from: '2004-01-01', valid_to: '2018-09-18', version_number: 3, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 7, d.lgs. 30 giugno 2003, n. 196, nel testo in vigore al 1° gennaio 2010',
      long: 'art. 7, d.lgs. 30 giugno 2003, n. 196, nel testo in vigore dal 1° gennaio 2004 al 18 settembre 2018 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'an annex of an act that is not a code is named',
    context: {
      norma: { tipo_atto: 'decreto legislativo', numero_atto: '81', data: '2008-04-09', numero_articolo: '1', allegato: 'A' },
      validity: { state: 'historical', valid_from: '2010-01-01', valid_to: '2012-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2011-02-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A), nel testo in vigore al 1° febbraio 2011',
      long: 'art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A), nel testo in vigore dal 1° gennaio 2010 al 31 dicembre 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a regio decreto that is not a code',
    context: {
      norma: { tipo_atto: 'regio decreto', numero_atto: '773', data: '1931-06-18', numero_articolo: '86' },
      validity: { state: 'historical', valid_from: '2000-01-01', valid_to: '2009-12-31', version_number: 4, act_updated: null, request_in_window: true },
      requestedDate: '2005-05-05',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 86, r.d. 18 giugno 1931, n. 773, nel testo in vigore al 5 maggio 2005',
      long: 'art. 86, r.d. 18 giugno 1931, n. 773, nel testo in vigore dal 1° gennaio 2000 al 31 dicembre 2009 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the preleggi are cited by their own name: they share the decree of the codice civile, whose own articles are other ones',
    context: {
      norma: { tipo_atto: 'preleggi', tipo_atto_reale: 'regio decreto', numero_atto: '262', data: '1942-03-16', numero_articolo: '12' },
      validity: { state: 'historical', valid_from: '1942-04-21', valid_to: '2008-12-31', version_number: 1, act_updated: null, request_in_window: true },
      requestedDate: '2000-01-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 12 preleggi, nel testo in vigore al 1° gennaio 2000',
      long: 'art. 12 preleggi, nel testo in vigore dal 21 aprile 1942 al 31 dicembre 2008 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the disposizioni per l’attuazione, in the palette’s own spelling',
    context: {
      norma: {
        tipo_atto: "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
        tipo_atto_reale: 'regio decreto', numero_atto: '318', data: '1942-03-30', numero_articolo: '3',
      },
      validity: { state: 'historical', valid_from: '1942-04-21', valid_to: '2015-12-31', version_number: 2, act_updated: null, request_in_window: true },
      requestedDate: '2010-06-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 3 disp. att. c.c., nel testo in vigore al 1° giugno 2010',
      long: 'art. 3 disp. att. c.c., nel testo in vigore dal 21 aprile 1942 al 31 dicembre 2015 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'a day in the window of a text that is still in force: the window has no end',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: null, request_in_window: true },
      requestedDate: '2026-03-01',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 1° marzo 2026',
      long: 'art. 1284 c.c., nel testo in vigore dal 28 dicembre 2025 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the original text',
    context: {
      norma: { tipo_atto: 'legge', numero_atto: '300', data: '1970-05-20', numero_articolo: '18' },
      validity: { state: 'historical', valid_from: '1970-06-12', valid_to: '2012-07-17', version_number: 1, act_updated: null, request_in_window: null },
      original: true,
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 18, l. 20 maggio 1970, n. 300, nel testo originale',
      long: 'art. 18, l. 20 maggio 1970, n. 300, nel testo originale, in vigore dal 12 giugno 1970 al 17 luglio 2012 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'the source could not be read: only the day that was asked for, never a window',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      requestedDate: '2007-12-29',
      consultedAt: CONSULTED,
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il 1° ottobre 2026)',
    },
  },
  {
    name: 'no consultation day: the source clause has no date',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true },
      requestedDate: '2007-12-29',
    },
    expected: {
      short: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007',
      long: 'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato)',
    },
  },
  {
    name: 'the article did not exist on that day: nothing is cited',
    context: {
      norma: { tipo_atto: 'codice di procedura civile', numero_articolo: '183-bis', allegato: '1' },
      validity: { state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: null,
  },
  {
    name: 'the version returned does not contain the day: nothing is cited',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: false },
      requestedDate: '2010-01-01',
      consultedAt: CONSULTED,
    },
    expected: null,
  },
  {
    name: 'the text in force, with no day asked for: the plain citation stays as it is (the owner decided: not in this feature)',
    context: {
      norma: { tipo_atto: 'codice civile', numero_articolo: '1284', allegato: '2' },
      validity: { state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: null, request_in_window: null },
      consultedAt: CONSULTED,
    },
    expected: null,
  },
];
```

`apps/web/src/utils/citation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCitation } from './normaMeta';
import { formatNormCitation, withCitation } from './citation';
import { CITATION_GOLDEN } from './__fixtures__/citationGolden';

describe('formatNormCitation — the golden file', () => {
  it.each(CITATION_GOLDEN.map((c) => [c.name, c] as const))('%s', (_name, golden) => {
    expect(formatNormCitation(golden.context)).toEqual(golden.expected);
  });

  it('has a case for every way the function answers', () => {
    const answers = CITATION_GOLDEN.map((c) => c.expected === null);
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    expect(CITATION_GOLDEN.length).toBeGreaterThanOrEqual(10);
  });
});

describe('formatNormCitation — the details the golden file does not spell out', () => {
  const norma = { tipo_atto: 'Codice Civile', numero_articolo: '2043', allegato: '2' };

  it('recognises a code however the vocabulary spells it', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.short)
      .toBe('art. 2043 c.c., nel testo in vigore al 5 maggio 2000');
  });

  it('never prints the default annex of a code', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.long).not.toContain('Allegato');
  });

  it('never states a window it was not given', () => {
    expect(formatNormCitation({ norma, requestedDate: '2000-05-05' })?.long).not.toMatch(/ dal /);
  });
});

describe('withCitation', () => {
  const citation = { short: 'S', long: 'art. 1284 c.c., nel testo in vigore al 29 dicembre 2007 (Normattiva)' };

  it('puts the citation of a past text first, so the quotation cannot travel without its version', () => {
    expect(withCitation('Il testo.', citation, '\n\n---\nTratto da: x')).toBe(`${citation.long}\n\nIl testo.`);
  });

  it('keeps the trailer the text in force always had, byte for byte', () => {
    const norma = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2' };
    expect(withCitation('Il testo.', null, `\n\n---\nTratto da: ${formatCitation(norma)}`))
      .toBe('Il testo.\n\n---\nTratto da: codice civile n. 262 del 1942-03-16, Art. 2043 (Allegato 2)');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/web run test -- --run src/utils/dateUtils.test.ts src/utils/versionDisplay.test.ts src/utils/citation.test.ts`

Expected: `Test Files  3 failed (3)`. `dateUtils.test.ts`: `Tests  9 failed` (`formatDateDashed is not a function`, …); the other two: `Failed to resolve import "./versionDisplay"` and `"./citation"`.

- [ ] **Step 3: The types and the date helpers**

`effectiveDate` stays in `versionInfo` for now: the search panel still sets it, and every task's commit must type-check. Task 7 retires it.

In `apps/web/src/types/index.ts`, replace:

```ts
    queue_position?: number;
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
        effectiveDate?: string;
    };
}
```

with:

```ts
    queue_position?: number;
    /** What the source's own page says about the text it served; absent when it cannot be read. */
    validity?: ArticleValidity;
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
        effectiveDate?: string;
    };
}

export type ValidityState = 'current' | 'historical' | 'not_yet' | 'abrogated';

/**
 * The window of days a Normattiva page states for the text it served (dates in
 * ISO form). The source's own statement of which version came back — never an
 * echo of the date the reader typed. It says which text was in force, not which
 * discipline governs a fact.
 */
export interface ArticleValidity {
    state: ValidityState;
    /** First day in force; null for an article that did not exist yet. */
    valid_from: string | null;
    /** Last day in force; null while the text is still in force. */
    valid_to: string | null;
    version_number: number | null;
    /** The day the act's consolidated text was last updated. */
    act_updated: string | null;
    /** Whether the window contains the requested day; null when no day was requested. */
    request_in_window: boolean | null;
}
```

In `apps/web/src/utils/dateUtils.ts`, replace:

```ts
  return ACT_TYPE_ABBREVIATIONS[lower] || actType;
}
```

with:

```ts
  return ACT_TYPE_ABBREVIATIONS[lower] || actType;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDay(year: number, month: number, day: number): boolean {
  const moved = new Date(Date.UTC(year, month - 1, day));
  return moved.getUTCFullYear() === year && moved.getUTCMonth() === month - 1 && moved.getUTCDate() === day;
}

/**
 * A day the way Normattiva writes it, padded: "2007-12-29" → "29-12-2007". Used
 * on chips, where `7 agosto 1990` is too long. Anything else comes back as it
 * came.
 */
export function formatDateDashed(isoDate: string): string {
  const match = ISO_DAY.exec(isoDate || '');
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (isoDate || '');
}

/**
 * A day as a lawyer cites it: "29 dicembre 2007", and "1° ottobre 2026" for the
 * first of the month. `formatDateItalianLong` stays as it is (the rest of the
 * interface prints "1 ottobre"); a citation is the one place the ordinal is
 * expected.
 */
export function formatDateForCitation(isoDate: string): string {
  const match = ISO_DAY.exec(isoDate || '');
  if (!match) return isoDate || '';
  const long = formatDateItalianLong(isoDate);
  return match[3] === '01' ? long.replace(/^1 /, '1° ') : long;
}

/** The ISO day `days` after `isoDate` (negative for before); the input unchanged when it is not a real day. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const match = ISO_DAY.exec(isoDate || '');
  if (!match) return isoDate;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isRealDay(year, month, day)) return isoDate;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Today's ISO day in Rome, which is the day the server compares a
 * `version_date` with (a date after it is refused). The browser's own day can
 * differ for a reader in another time zone.
 */
export function todayInRome(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
```

- [ ] **Step 4: The display table**

`apps/web/src/utils/versionDisplay.ts`:

```ts
import type { ArticleData, ArticleValidity, NormaVisitata, SearchParams, ValidityState } from '../types';
import { addDaysToIsoDate, formatDateDashed, formatDateForDisplay, formatDateItalianLong } from './dateUtils';

/**
 * What a reader is told about the version of the text on screen.
 *
 * Two different things arrive here and must not be mixed up. The REQUEST says
 * what was asked for (`versione`, `data_versione` of the norma: the original, or
 * a date); the VALIDITY says what came back (the window the source's page
 * states, read by the server). "Vigente" used to be a default painted on every
 * text that was not asked to be historical: now a status is shown only when the
 * source states it, and silence is a possible answer.
 *
 * Everything here is pure, so the whole table is tested without a DOM.
 */

/** The two fields of a request that say whether it asked for a past text. */
export interface VersionRequest {
  versione?: string | null;
  data_versione?: string | null;
}

export const READ_ONLY_REASON = 'Non disponibile su un testo storico';
export const NOT_YET_REASON = 'Non disponibile: l’articolo non esisteva a quella data';

const SOURCE_NOTE = 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.';

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asksForOriginal(version: unknown): boolean {
  return textOf(version)?.toLowerCase() === 'originale';
}

/**
 * Whether the request asked for a past text: the original, or a date. It is the
 * request, not the page, and mirrors `is_historical_request` on the server —
 * the two decide the same thing, one to keep Brocardi out, one to switch the
 * annotation tools off.
 */
export function requestIsHistorical(request: VersionRequest | null | undefined): boolean {
  if (!request) return false;
  return asksForOriginal(request.versione) || textOf(request.data_versione) !== undefined;
}

/** `ArticleData.versionInfo` for a search: what was asked for, or nothing when the text in force was. */
export function deriveVersionInfo(
  params: { version?: SearchParams['version']; version_date?: string },
): ArticleData['versionInfo'] | undefined {
  const requestedDate = textOf(params.version_date);
  if (!requestIsHistorical({ versione: params.version, data_versione: params.version_date })) return undefined;
  return { isHistorical: true, ...(requestedDate ? { requestedDate } : {}) };
}

const EUROPEAN_ACTS = new Set(['tue', 'tfue', 'cdfue', 'regolamento ue', 'direttiva ue']);

/**
 * EUR-Lex acts, which have no text "as at a date": the server builds their URI
 * before it appends the version, so a date is ignored. Mirrors
 * `NormaController.get_scraper_for_norma`; compared case-insensitively because
 * the palette spells them `Regolamento UE` and the resolver `regolamento ue`
 * (gotcha 28).
 */
export function isEuropeanAct(tipoAtto: string | null | undefined): boolean {
  return EUROPEAN_ACTS.has((tipoAtto || '').trim().toLowerCase());
}

export interface VersionChip {
  tone: ValidityState;
  label: string;
  title: string;
}

export type BannerAction = 'go_current' | 'copy_citation' | 'open_next_day' | 'pick_date';
export type BannerKind = 'historical' | 'not_yet' | 'unreliable' | 'current_in_window';

export interface VersionBanner {
  kind: BannerKind;
  title?: string;
  body: string;
  note?: string;
  actions: BannerAction[];
  /** The ISO day `open_next_day` opens: the first day the article existed. */
  nextDay?: string;
}

export interface VersionDisplay {
  chip: VersionChip | null;
  banner: VersionBanner | null;
  /** False for an article that did not exist yet: the served text is a notice, not drawn as an article. */
  textVisible: boolean;
  /**
   * No notes, highlights, discussions, quick-norm or Study Mode: they are keyed
   * by article and not by version, so on a past text they would attach to the
   * wrong words.
   */
  readOnly: boolean;
  /** Brocardi's commentary and massime carry no date: shown only with the text in force. */
  doctrineVisible: boolean;
  /** Whether a "nel testo in vigore al …" citation may be made. */
  canCite: boolean;
  /** Whether the text may be copied, exported or added to a dossier. */
  canCopyOrSave: boolean;
  /**
   * A past text opens its update notes: the rule that applies (a delegated
   * rate, a date) is often in them, not in the words of the article.
   */
  updateNotesOpen: boolean;
}

function chipFor(validity: ArticleValidity): VersionChip {
  const from = validity.valid_from ? formatDateDashed(validity.valid_from) : '';
  const to = validity.valid_to ? formatDateDashed(validity.valid_to) : '';
  const version = validity.version_number ? ` Versione n. ${validity.version_number}.` : '';
  const title = `${SOURCE_NOTE}${version}`;
  switch (validity.state) {
    case 'current':
      return { tone: 'current', label: from ? `In vigore dal ${from}` : 'In vigore', title };
    case 'historical':
      return {
        tone: 'historical',
        label: `Testo storico${from || to ? ' ·' : ''}${from ? ` dal ${from}` : ''}${to ? ` al ${to}` : ''}`,
        title,
      };
    case 'abrogated':
      return { tone: 'abrogated', label: from ? `Abrogato dal ${from}` : 'Abrogato', title };
    case 'not_yet':
      return { tone: 'not_yet', label: 'Non ancora esistente', title };
  }
}

function bannerFor(
  validity: ArticleValidity,
  requestedDay: string | undefined,
  canCite: boolean,
): VersionBanner | null {
  if (validity.request_in_window === false) {
    return {
      kind: 'unreliable',
      title: 'Versione non attendibile',
      body: 'Normattiva ha restituito una versione che non comprende la data richiesta: non va considerata attendibile.',
      actions: ['pick_date', 'go_current'],
    };
  }
  if (validity.state === 'not_yet') {
    const firstDay = validity.valid_to ? addDaysToIsoDate(validity.valid_to, 1) : undefined;
    const asOf = requestedDay ?? validity.valid_to ?? undefined;
    return {
      kind: 'not_yet',
      title: 'Articolo non ancora esistente',
      body: `Questo articolo non esisteva${asOf ? ` al ${formatDateItalianLong(asOf)}` : ''}.`
        + (firstDay ? ` È in vigore dal ${formatDateItalianLong(firstDay)}.` : ''),
      actions: firstDay ? ['open_next_day', 'pick_date'] : ['pick_date'],
      ...(firstDay ? { nextDay: firstDay } : {}),
    };
  }
  if (validity.state === 'historical') {
    const window = validity.valid_from && validity.valid_to
      ? `In vigore dal ${formatDateItalianLong(validity.valid_from)} al ${formatDateItalianLong(validity.valid_to)}`
      : 'Testo di una versione passata';
    return {
      kind: 'historical',
      title: 'Testo storico',
      body: `${window}, secondo il testo consolidato di Normattiva (a fini informativi). Non è il testo attuale. `
        + 'Il testo in vigore a una data non dice quale disciplina si applichi al fatto: possono contare '
        + 'disposizioni transitorie, efficacia retroattiva o norme più favorevoli.',
      note: 'Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico.',
      actions: canCite ? ['go_current', 'copy_citation'] : ['go_current'],
    };
  }
  if (validity.state === 'current' && requestedDay) {
    return { kind: 'current_in_window', body: 'La data richiesta cade nel testo attuale.', actions: [] };
  }
  return null;
}

/**
 * What to show for a text: the chip, the banner, and what is switched off.
 *
 * `validity` is what the source said about the text that came back (absent when
 * its page could not be read); `request` is what was asked for. With no
 * validity nothing is claimed and nothing is shown, but a request for a past
 * text still keeps the annotation tools off — the text may well be a past one.
 */
export function describeVersion(
  validity: ArticleValidity | undefined,
  request: VersionRequest | null | undefined,
): VersionDisplay {
  const asked = requestIsHistorical(request);
  const requestedDay = textOf(request?.data_versione);
  const unreliable = validity?.request_in_window === false;

  let readOnly: boolean;
  switch (validity?.state) {
    case 'historical':
    case 'not_yet':
      readOnly = true;
      break;
    case 'current':
      readOnly = false;
      break;
    default: // 'abrogated', or no validity: what was asked is all there is to go on
      readOnly = asked;
  }
  if (unreliable) readOnly = true;

  const notYet = validity?.state === 'not_yet';
  const canCite = !notYet && !unreliable;

  return {
    chip: validity ? chipFor(validity) : null,
    banner: validity ? bannerFor(validity, requestedDay, canCite) : null,
    textVisible: !notYet,
    readOnly,
    doctrineVisible: !asked && !readOnly,
    canCite,
    canCopyOrSave: !notYet,
    updateNotesOpen: validity?.state === 'historical',
  };
}

export type TextAtDateChoice = { kind: 'date'; date: string } | { kind: 'original' };

/**
 * The search the "Testo alla data" dialog sends. Doctrine is not requested (the
 * server would refuse it anyway), and the annex is kept: the old modal dropped it.
 */
export function buildTextAtDateParams(norma: NormaVisitata, choice: TextAtDateChoice): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo,
    version: choice.kind === 'original' ? 'originale' : 'vigente',
    ...(choice.kind === 'date' ? { version_date: choice.date } : {}),
    show_brocardi_info: false,
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

/** The tab suffix of a past text: " — testo al 29/12/2007", " — testo originale", or nothing. */
export function versionTabSuffix(request: { version?: string | null; versionDate?: string | null }): string {
  const date = textOf(request.versionDate);
  if (date) return ` — testo al ${formatDateForDisplay(date)}`;
  return asksForOriginal(request.version) ? ' — testo originale' : '';
}

/** The label a dossier shows on an item that holds a past text, or null for the text in force. */
export function historicalItemLabel(request: VersionRequest | null | undefined): string | null {
  const date = textOf(request?.data_versione);
  if (date) return `Testo al ${formatDateForDisplay(date)}`;
  return asksForOriginal(request?.versione) ? 'Testo originale' : null;
}
```

- [ ] **Step 5: The citation**

`apps/web/src/utils/citation.ts`:

```ts
import type { ArticleValidity, NormaVisitata } from '../types';
import { abbreviateActType, formatDateForCitation, formatDateItalianLong } from './dateUtils';

/**
 * How a lawyer cites a norm "in the text in force at …".
 *
 * One pure function builds the wording, so the toolbar, the banner, the
 * dossier and the copy actions cannot drift apart. The golden file
 * (`__fixtures__/citationGolden.ts`) is the specification: the wording is a
 * legal call, and the owner reads those lines, not this code. The style is the
 * owner's: "art. 2, l. 7 agosto 1990, n. 241" for an act cited by type, date
 * and number; "art. 1284 c.c." for a code and the Constitution, with no comma.
 *
 * It states which TEXT was in force, never which discipline governs a fact:
 * the window of days says the first and cannot say the second.
 */

export interface NormCitation {
  /** "art. 1284 c.c., nel testo in vigore al 29 dicembre 2007" */
  short: string;
  /** The short form with the window and the source: for the top of a copied text. */
  long: string;
}

type CitedNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_articolo'>
  & Partial<Pick<NormaVisitata, 'tipo_atto_reale' | 'numero_atto' | 'data' | 'allegato'>>;

export interface CitationContext {
  norma: CitedNorma;
  /** What the source's page stated; absent when it could not be read. */
  validity?: ArticleValidity;
  /** The ISO day the reader asked for. */
  requestedDate?: string;
  /** The original text was asked for (no day). */
  original?: boolean;
  /** The ISO day of the consultation (today, in Rome). */
  consultedAt?: string;
}

// The codes and the Constitution are cited by their abbreviation, with no number
// and no date; any other act by its type, date and number. Keys are lower case:
// the palette spells `Codice Civile`, the resolver `codice civile` (gotcha 28).
const ACT_ABBREVIATIONS: Record<string, string> = {
  'codice civile': 'c.c.',
  'codice penale': 'c.p.',
  'codice di procedura civile': 'c.p.c.',
  'codice di procedura penale': 'c.p.p.',
  'costituzione': 'Cost.',
  // Part of R.D. 262/1942 and cited by their own name: "art. 12 preleggi" is not
  // "art. 12, r.d. 16 marzo 1942, n. 262", which would name an article of the decree.
  'preleggi': 'preleggi',
  "disposizioni per l'attuazione del codice civile e disposizioni transitorie": 'disp. att. c.c.',
  "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": 'disp. att. c.p.c.',
};

function actDesignation(norma: CitedNorma): { text: string; isCode: boolean } {
  const abbreviation = ACT_ABBREVIATIONS[(norma.tipo_atto || '').trim().toLowerCase()];
  if (abbreviation) return { text: abbreviation, isCode: true };
  // An aliased act ("codice in materia di protezione dei dati personali") is
  // cited by the act it is: "d.lgs. 30 giugno 2003, n. 196".
  const type = abbreviateActType(norma.tipo_atto_reale || norma.tipo_atto).toLowerCase();
  const date = norma.data ? ` ${formatDateItalianLong(norma.data)}` : '';
  const number = norma.numero_atto ? `, n. ${norma.numero_atto}` : '';
  return { text: `${type}${date}${number}`, isCode: false };
}

function articleHead(norma: CitedNorma): string {
  const act = actDesignation(norma);
  // A code's default annex is how Normattiva files its text, not part of how it is cited.
  const annex = !act.isCode && norma.allegato ? ` (Allegato ${norma.allegato})` : '';
  return act.isCode
    ? `art. ${norma.numero_articolo} ${act.text}`
    : `art. ${norma.numero_articolo}, ${act.text}${annex}`;
}

/**
 * The citation of a past text, or null when there is nothing honest to cite:
 * the text in force (the plain citation stays as it is), an article that did
 * not exist on the day, or a version whose window does not contain the day.
 */
export function formatNormCitation(context: CitationContext): NormCitation | null {
  const { norma, validity, requestedDate, original, consultedAt } = context;
  if (validity?.state === 'not_yet' || validity?.request_in_window === false) return null;
  if (!requestedDate && !original) return null;

  const head = articleHead(norma);
  const asked = requestedDate ? formatDateForCitation(requestedDate) : undefined;
  const short = `${head}, ${asked ? `nel testo in vigore al ${asked}` : 'nel testo originale'}`;

  const from = validity?.valid_from ? formatDateForCitation(validity.valid_from) : undefined;
  const to = validity?.valid_to ? formatDateForCitation(validity.valid_to) : undefined;
  const window = from || to ? `in vigore${from ? ` dal ${from}` : ''}${to ? ` al ${to}` : ''}` : undefined;
  const clause = original
    ? `nel testo originale${window ? `, ${window}` : ''}`
    : window
      ? `nel testo ${window}`
      : `nel testo in vigore al ${asked}`;
  const source = `Normattiva, testo consolidato${consultedAt ? `, consultato il ${formatDateForCitation(consultedAt)}` : ''}`;

  return { short, long: `${head}, ${clause} (${source})` };
}

/**
 * The text a copy action puts on the clipboard. A past text starts with its
 * citation, so the quotation cannot travel without the version it quotes; the
 * text in force keeps the trailer it always had.
 */
export function withCitation(text: string, citation: NormCitation | null, trailer: string): string {
  return citation ? `${citation.long}\n\n${text}` : `${text}${trailer}`;
}
```

- [ ] **Step 6: Run them to see them pass, then type-check**

Run: `npm --prefix apps/web run test -- --run src/utils/dateUtils.test.ts src/utils/versionDisplay.test.ts src/utils/citation.test.ts`

Expected: `Test Files  3 passed (3)`, `Tests  86 passed (86)`.

Run: `npm --prefix apps/web run build`. Expected: clean.

- [ ] **Step 7: Commit (ask first)**

```bash
git add apps/web/src/types/index.ts apps/web/src/utils/
git commit -m "feat(web): the display table, the date helpers and the citation of a past text"
```

### Task 5: The chip, the banner and the dialog

Three small components that only show what Task 4 decided. The banner also stands in for the text when an article did not exist yet (`variant="state"`).

**Files:**
- Create: `apps/web/src/components/features/search/VersionStatusChip.tsx`, `VersionBanner.tsx`, `TextAtDateDialog.tsx`
- Create: `apps/web/src/components/features/search/VersionStatusChip.test.tsx`, `VersionBanner.test.tsx`, `TextAtDateDialog.test.tsx`

**Interfaces:**
- Consumes: `VersionChip`, `VersionBanner` (imported as `BannerData`), `BannerAction`, `TextAtDateChoice` (Task 4); `Modal`, `Button` (`components/ui`); `formatDateItalianLong`.
- Produces:
  - `VersionStatusChip({ chip: VersionChip; onClick: () => void })`: a button; its accessible name is the chip's label.
  - `VersionBanner({ banner; onAction?: (action: BannerAction) => void; variant?: 'banner' | 'state' })`: `role="alert"` for the warning, `role="status"` for the rest; buttons only when `onAction` is given.
  - `TextAtDateDialog({ isOpen; onClose; onConfirm: (choice: TextAtDateChoice) => void; euAct: boolean; today: string; initialDate?: string })`: a date field with `max={today}`, a "Testo originale" checkbox, the refusals for a future day and for EUR-Lex acts, one line on what the date does not say. The form is mounted only while the dialog is open, so every opening starts clean.

- [ ] **Step 1: Write the tests**

`VersionStatusChip.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionStatusChip } from './VersionStatusChip';
import type { VersionChip } from '../../../utils/versionDisplay';

const chip = (over: Partial<VersionChip> = {}): VersionChip => ({
    tone: 'historical',
    label: 'Testo storico · dal 25-12-2003 al 29-12-2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale. Versione n. 7.',
    ...over,
});

describe('VersionStatusChip', () => {
    it('states the window and carries the source note as its tooltip', () => {
        render(<VersionStatusChip chip={chip()} onClick={() => {}} />);
        const button = screen.getByRole('button', { name: 'Testo storico · dal 25-12-2003 al 29-12-2007' });
        expect(button).toHaveAttribute('title', expect.stringContaining('fa fede la Gazzetta Ufficiale'));
        expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('opens the date dialog when pressed', () => {
        const onClick = vi.fn();
        render(<VersionStatusChip chip={chip({ tone: 'current', label: 'In vigore dal 28-12-2025' })} onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' }));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['current', 'emerald'],
        ['historical', 'amber'],
        ['abrogated', 'rose'],
        ['not_yet', 'slate'],
    ] as const)('colours the %s state apart from the others (%s)', (tone, colour) => {
        render(<VersionStatusChip chip={chip({ tone, label: tone })} onClick={() => {}} />);
        expect(screen.getByRole('button', { name: tone }).className).toContain(colour);
    });
});
```

`VersionBanner.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionBanner } from './VersionBanner';
import { describeVersion } from '../../../utils/versionDisplay';
import type { ArticleValidity } from '../../../types';

const MIDDLE: ArticleValidity = {
    state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true,
};
const NOT_YET: ArticleValidity = {
    state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};

function bannerOf(validity: ArticleValidity, data_versione = '2005-06-01') {
    const banner = describeVersion(validity, { versione: 'vigente', data_versione }).banner;
    if (!banner) throw new Error('expected a banner');
    return banner;
}

describe('VersionBanner — a past text', () => {
    it('says which window, that it is not the current text, and what the window does not say', () => {
        render(<VersionBanner banner={bannerOf(MIDDLE)} onAction={() => {}} />);
        expect(screen.getByRole('status')).toHaveTextContent('Testo storico');
        expect(screen.getByText(/In vigore dal 25 dicembre 2003 al 29 dicembre 2007/)).toBeInTheDocument();
        expect(screen.getByText(/Non è il testo attuale/)).toBeInTheDocument();
        expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
        expect(screen.getByText('Dottrina, massime, note ed evidenziazioni non sono mostrate su un testo storico.')).toBeInTheDocument();
    });

    it('offers the way back to the text in force and the citation', () => {
        const onAction = vi.fn();
        render(<VersionBanner banner={bannerOf(MIDDLE)} onAction={onAction} />);
        fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' }));
        fireEvent.click(screen.getByRole('button', { name: 'Copia citazione' }));
        expect(onAction.mock.calls).toEqual([['go_current'], ['copy_citation']]);
    });

    it('only informs when nothing handles the actions (the dossier reader)', () => {
        render(<VersionBanner banner={bannerOf(MIDDLE)} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('VersionBanner — an article that did not exist yet', () => {
    it('stands where the text would be, with the way forward', () => {
        const onAction = vi.fn();
        render(<VersionBanner banner={bannerOf(NOT_YET, '2010-01-01')} onAction={onAction} variant="state" />);
        expect(screen.getByText('Questo articolo non esisteva al 1 gennaio 2010. È in vigore dal 13 settembre 2014.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scegli un’altra data' }));
        expect(onAction.mock.calls).toEqual([['open_next_day'], ['pick_date']]);
    });
});

describe('VersionBanner — a version that does not contain the day', () => {
    it('warns as an alert and offers no citation', () => {
        const banner = bannerOf({ ...MIDDLE, request_in_window: false }, '2010-01-01');
        render(<VersionBanner banner={banner} onAction={() => {}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('non va considerata attendibile');
        expect(screen.queryByRole('button', { name: 'Copia citazione' })).not.toBeInTheDocument();
    });
});

describe('VersionBanner — a date inside the text in force', () => {
    it('says so, without actions', () => {
        const banner = bannerOf({ ...MIDDLE, state: 'current', valid_to: null }, '2026-03-01');
        render(<VersionBanner banner={banner} onAction={() => {}} />);
        expect(screen.getByRole('status')).toHaveTextContent('La data richiesta cade nel testo attuale.');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
```

`TextAtDateDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextAtDateDialog, type TextAtDateDialogProps } from './TextAtDateDialog';

function setup(over: Partial<TextAtDateDialogProps> = {}) {
    const props: TextAtDateDialogProps = {
        isOpen: true, onClose: vi.fn(), onConfirm: vi.fn(), euAct: false, today: '2026-10-01', ...over,
    };
    render(<TextAtDateDialog {...props} />);
    return props;
}

const dateField = () => screen.getByLabelText('Data') as HTMLInputElement;
const confirm = () => screen.getByRole('button', { name: /Mostra il testo/ });
const type = (value: string) => fireEvent.change(dateField(), { target: { value } });

describe('TextAtDateDialog', () => {
    it('renders nothing while closed', () => {
        setup({ isOpen: false });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says what the date means and what it does not', () => {
        setup();
        expect(screen.getByRole('dialog', { name: 'Testo alla data' })).toBeInTheDocument();
        expect(screen.getByText('Normattiva mostra il testo in vigore in quel giorno.')).toBeInTheDocument();
        expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
    });

    it('asks for the text in force on the day chosen', () => {
        const { onConfirm } = setup();
        expect(confirm()).toBeDisabled();
        type('2007-12-29');
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2007-12-29' });
    });

    it('can be submitted with the keyboard', () => {
        const { onConfirm } = setup();
        type('2007-12-29');
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2007-12-29' });
    });

    it('starts from the day it is given', () => {
        setup({ initialDate: '2005-06-01' });
        expect(dateField().value).toBe('2005-06-01');
    });

    it('asks for the original text instead of a day', () => {
        const { onConfirm } = setup();
        type('2007-12-29');
        fireEvent.click(screen.getByLabelText('Testo originale'));
        expect(dateField()).toBeDisabled();
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'original' });
    });

    it('does not let a future day be chosen, and says why', () => {
        const { onConfirm } = setup();
        expect(dateField()).toHaveAttribute('max', '2026-10-01');
        type('2026-10-02');
        expect(screen.getByRole('alert')).toHaveTextContent('La data non può essere futura: Normattiva mostrerebbe il testo attuale.');
        expect(confirm()).toBeDisabled();
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('accepts today', () => {
        const { onConfirm } = setup();
        type('2026-10-01');
        fireEvent.click(confirm());
        expect(onConfirm).toHaveBeenCalledWith({ kind: 'date', date: '2026-10-01' });
    });

    it('refuses an EUR-Lex act with the reason and sends nothing', () => {
        const { onConfirm } = setup({ euAct: true });
        expect(screen.getByRole('alert')).toHaveTextContent('Atti dell’Unione europea: il testo a una data non è disponibile.');
        expect(dateField()).toBeDisabled();
        expect(screen.getByLabelText('Testo originale')).toBeDisabled();
        expect(confirm()).toBeDisabled();
        fireEvent.submit(dateField().closest('form')!);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('closes on cancel', () => {
        const { onClose } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
        expect(onClose).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/web run test -- --run src/components/features/search/VersionStatusChip.test.tsx src/components/features/search/VersionBanner.test.tsx src/components/features/search/TextAtDateDialog.test.tsx`

Expected: `Test Files  3 failed (3)`, each `Failed to resolve import` of its component.

- [ ] **Step 3: Write the components**

`VersionStatusChip.tsx`:

```tsx
import { Clock } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { VersionChip } from '../../../utils/versionDisplay';

const TONE: Record<VersionChip['tone'], string> = {
    current: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    historical: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    abrogated: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    not_yet: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

interface VersionStatusChipProps {
    chip: VersionChip;
    /** Opens the "Testo alla data" dialog. */
    onClick: () => void;
}

/**
 * The status of the text on screen, as the source states it ("In vigore dal …",
 * "Testo storico · dal … al …"). It replaces the "Vigente" badge, which was a
 * default and not a status, and the "Aggiornato al" echo of the typed date.
 */
export function VersionStatusChip({ chip, onClick }: VersionStatusChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={chip.title}
            aria-haspopup="dialog"
            className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                'min-h-[44px] md:min-h-0 hover:brightness-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                TONE[chip.tone],
            )}
        >
            <Clock size={12} aria-hidden="true" />
            {chip.label}
        </button>
    );
}
```

`VersionBanner.tsx`:

```tsx
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import type { BannerAction, VersionBanner as BannerData } from '../../../utils/versionDisplay';

const TONE: Record<BannerData['kind'], string> = {
    historical: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200',
    unreliable: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200',
    not_yet: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
    current_in_window: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200',
};

function labelOf(action: BannerAction, banner: BannerData): string {
    switch (action) {
        case 'go_current': return 'Vai al testo attuale';
        case 'copy_citation': return 'Copia citazione';
        case 'pick_date': return 'Scegli un’altra data';
        case 'open_next_day':
            return banner.nextDay ? `Vai al testo del ${formatDateItalianLong(banner.nextDay)}` : 'Vai al testo successivo';
    }
}

interface VersionBannerProps {
    banner: BannerData;
    /** Absent: the banner only informs (the dossier reader). */
    onAction?: (action: BannerAction) => void;
    /** `state`: it stands where the text would be (an article that did not exist yet). */
    variant?: 'banner' | 'state';
}

/**
 * Says which version of the text is on screen and what that does and does not
 * mean. It sits beside the text, never inside it: the text root holds nothing
 * but `article_text` (root CLAUDE.md, rule 23).
 */
export function VersionBanner({ banner, onAction, variant = 'banner' }: VersionBannerProps) {
    const Icon = banner.kind === 'unreliable' ? AlertTriangle : Info;
    return (
        <div
            role={banner.kind === 'unreliable' ? 'alert' : 'status'}
            className={cn(
                'mb-4 flex gap-3 rounded-lg border p-3 text-sm',
                variant === 'state' && 'py-8 justify-center text-center',
                TONE[banner.kind],
            )}
        >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-1.5">
                {banner.title && <p className="font-semibold">{banner.title}</p>}
                <p className="leading-relaxed">{banner.body}</p>
                {banner.note && <p className="text-xs opacity-80">{banner.note}</p>}
                {onAction && banner.actions.length > 0 && (
                    <div className={cn('flex flex-wrap gap-2 pt-1', variant === 'state' && 'justify-center')}>
                        {banner.actions.map((action) => (
                            <Button key={action} variant="secondary" size="sm" onClick={() => onAction(action)}>
                                {labelOf(action, banner)}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
```

`TextAtDateDialog.tsx`:

```tsx
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import type { TextAtDateChoice } from '../../../utils/versionDisplay';

const FUTURE_MESSAGE = 'La data non può essere futura: Normattiva mostrerebbe il testo attuale.';
const EU_MESSAGE = 'Atti dell’Unione europea: il testo a una data non è disponibile.';

export interface TextAtDateDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (choice: TextAtDateChoice) => void;
    /** EUR-Lex acts have no text as at a date: the dialog says so and sends nothing. */
    euAct: boolean;
    /** Today in Rome (ISO): the latest day that can be asked for. */
    today: string;
    /** A day to start from, when there is one worth proposing. */
    initialDate?: string;
}

interface FormProps extends Omit<TextAtDateDialogProps, 'isOpen'> {
    inputRef: RefObject<HTMLInputElement | null>;
}

// Mounted only while the dialog is open, so every opening starts clean.
function TextAtDateForm({ onClose, onConfirm, euAct, today, initialDate, inputRef }: FormProps) {
    const [date, setDate] = useState(initialDate ?? '');
    const [original, setOriginal] = useState(false);

    const future = !original && date !== '' && date > today;
    const error = euAct ? EU_MESSAGE : future ? FUTURE_MESSAGE : null;
    const canSubmit = !euAct && (original || (date !== '' && !future));

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        onConfirm(original ? { kind: 'original' } : { kind: 'date', date });
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <div>
                <label htmlFor="text-at-date" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Data
                </label>
                <input
                    id="text-at-date"
                    ref={inputRef}
                    type="date"
                    value={date}
                    max={today}
                    disabled={euAct || original}
                    aria-invalid={future || undefined}
                    aria-describedby={error ? 'text-at-date-error' : undefined}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all disabled:opacity-50"
                />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                    type="checkbox"
                    checked={original}
                    disabled={euAct}
                    onChange={(event) => setOriginal(event.target.checked)}
                />
                Testo originale
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                La data non dice quale disciplina si applichi al fatto: possono contare disposizioni transitorie o efficacia retroattiva.
            </p>
            {error && (
                <p id="text-at-date-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {error}
                </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                    Annulla
                </Button>
                <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
                    <Clock size={16} />
                    Mostra il testo
                </Button>
            </div>
        </form>
    );
}

/**
 * "Testo alla data": asks for the text of the article in force on a day, or for
 * its original text. It validates before it sends — a future day is not sent —
 * and refuses EUR-Lex acts with the reason. What comes back opens in a tab of
 * its own, labelled with the day asked for; the toolbar shows the window the
 * source states.
 */
export function TextAtDateDialog({ isOpen, onClose, ...form }: TextAtDateDialogProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Testo alla data"
            description="Normattiva mostra il testo in vigore in quel giorno."
            size="sm"
            variant="info"
            icon={<Clock size={20} />}
            initialFocusRef={inputRef}
        >
            <TextAtDateForm {...form} onClose={onClose} inputRef={inputRef} />
        </Modal>
    );
}
```

- [ ] **Step 4: Run them to see them pass, then type-check**

Run the command of Step 2. Expected: `Test Files  3 passed (3)`, `Tests  22 passed (22)`.

Run: `npm --prefix apps/web run build`. Expected: clean.

- [ ] **Step 5: Commit (ask first)**

```bash
git add apps/web/src/components/features/search/VersionStatusChip.tsx apps/web/src/components/features/search/VersionStatusChip.test.tsx apps/web/src/components/features/search/VersionBanner.tsx apps/web/src/components/features/search/VersionBanner.test.tsx apps/web/src/components/features/search/TextAtDateDialog.tsx apps/web/src/components/features/search/TextAtDateDialog.test.tsx
git commit -m "feat(web): the version chip, the banner and the \"Testo alla data\" dialog"
```

### Task 6: The reading surface

The toolbar shows the chip instead of "Vigente"; on a past text the tools keyed by article are off; the page draws none of the reader's marks, no doctrine and no assistant question; the selection popup offers only "Copia"; a copy starts with the citation; the banner, the not-yet state and the dialog appear. This is the task that touches the 1,234-line `ArticleTabContent`: thirty small edits, each anchored on text that occurs once.

**Files:**
- Modify: `apps/web/src/components/features/search/SelectionPopup.tsx`, `ArticleBody.tsx`, `ReadingToolbar.tsx`, `ArticleTabContent.tsx`
- Modify (tests): `apps/web/src/components/features/search/__tests__/SelectionPopup.test.tsx`
- Create (tests): `apps/web/src/components/features/search/ReadingToolbar.test.tsx`, `apps/web/src/components/features/search/__tests__/ArticleTabContent.pastText.test.tsx`

**Interfaces:**
- Consumes: everything of Tasks 4 and 5; `PluginSlot` (the `article_content_after` slot receives the new props; the Massimario round's panel will read them).
- Produces:
  - `SelectionPopup` and `ArticleBody`: `copyOnly?: boolean` — only "Copia" is offered and the `H` / `N` shortcuts are off.
  - `ReadingToolbar` props: `versionChip: VersionChip | null` **replaces** `versionInfo`; `lockedReason?: string` (quick-norm, notes, highlights, discussions and Study Mode disabled, the reason appended to each tooltip); `copyLockedReason?: string` (copy and "Aggiungi a dossier" disabled). The "…" menu item reads "Testo alla data...".
  - `ArticleTabContent`: the plug-in slot `article_content_after` receives `validity` and `isHistorical` next to `articleUrn` and `containerRef`.

- [ ] **Step 1: Write the tests**

The toolbar test and the article-page test are new files; the popup test gains four cases, with its harness opened to `copyOnly` and to the handlers it checks.

`ReadingToolbar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReadingToolbar, type ReadingToolbarProps } from './ReadingToolbar';
import { READ_ONLY_REASON } from '../../../utils/versionDisplay';

function setup(over: Partial<ReadingToolbarProps> = {}) {
    const props: ReadingToolbarProps = {
        normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1284' },
        versionChip: null,
        articleText: 'testo',
        isNotesPeekOpen: false,
        notesCount: 0,
        isHighlightsPeekOpen: false,
        highlightsCount: 0,
        isDiscussionOpen: false,
        showMoreMenu: false,
        isPinnedQuick: false,
        onToggleNotes: vi.fn(),
        onToggleHighlightsPeek: vi.fn(),
        onToggleDiscussion: vi.fn(),
        onToggleMoreMenu: vi.fn(),
        onToggleQuickNorm: vi.fn(),
        onMobileCopy: vi.fn(),
        onOpenStudyMode: vi.fn(),
        onOpenCopyModal: vi.fn(),
        onOpenDossier: vi.fn(),
        onShareLink: vi.fn(),
        onOpenAdvancedExport: vi.fn(),
        onOpenVersionInput: vi.fn(),
        onCompare: vi.fn(),
        ...over,
    };
    const { container } = render(<ReadingToolbar {...props} />);
    return { ...props, container };
}

const HISTORICAL_CHIP = {
    tone: 'historical' as const,
    label: 'Testo storico · dal 25-12-2003 al 29-12-2007',
    title: 'Testo consolidato di Normattiva, a fini informativi: fa fede la Gazzetta Ufficiale.',
};

describe('ReadingToolbar — the status', () => {
    it('shows the window the source stated and opens the date dialog from it', () => {
        const props = setup({ versionChip: HISTORICAL_CHIP });
        fireEvent.click(screen.getByRole('button', { name: HISTORICAL_CHIP.label }));
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
    });

    it('claims nothing when the source stated nothing: no "Vigente" by default', () => {
        setup();
        expect(screen.queryByText(/Vigente|Storica|Aggiornato al/)).not.toBeInTheDocument();
    });

    it('does not echo the date that was typed as if the source had given it', () => {
        setup({ normaData: { tipo_atto: 'codice civile', data: '1942-03-16', numero_articolo: '1284', data_versione: '2005-06-01' } });
        expect(screen.queryByText(/2005-06-01/)).not.toBeInTheDocument();
    });

    it('keeps the annex badge, with no stray separator when there is no chip', () => {
        const { container } = setup({
            normaData: { tipo_atto: 'legge', data: '1990-08-07', numero_articolo: '1', allegato: 'A' },
        });
        expect(screen.getByText('Allegato A')).toBeInTheDocument();
        expect(container.textContent).not.toContain('|');
    });
});

describe('ReadingToolbar — a past text is a reading', () => {
    it('switches off the tools keyed by article, and says why in each tooltip', () => {
        setup({ lockedReason: READ_ONLY_REASON });
        for (const name of ['Aggiungi a norme rapide', 'Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo']) {
            const buttons = screen.getAllByTitle(`${name} — ${READ_ONLY_REASON}`);
            expect(buttons.length).toBeGreaterThan(0);
            buttons.forEach((button) => expect(button).toBeDisabled());
        }
        screen.getAllByTitle(`Modalità studio — ${READ_ONLY_REASON}`).forEach((button) => expect(button).toBeDisabled());
    });

    it('leaves the reading tools alone', () => {
        setup({ lockedReason: READ_ONLY_REASON });
        for (const title of ['Copia', 'Copia testo', 'Altre azioni']) {
            screen.getAllByTitle(title).forEach((button) => expect(button).toBeEnabled());
        }
        screen.getAllByLabelText('Aggiungi a dossier').forEach((button) => expect(button).toBeEnabled());
    });

    it('does not fire a switched-off tool', () => {
        const props = setup({ lockedReason: READ_ONLY_REASON });
        screen.getAllByTitle(`Apri note — ${READ_ONLY_REASON}`).forEach((button) => fireEvent.click(button));
        expect(props.onToggleNotes).not.toHaveBeenCalled();
    });

    it('has every tool on for the text in force', () => {
        setup();
        for (const title of ['Aggiungi a norme rapide', 'Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo', 'Copia']) {
            screen.getAllByTitle(title).forEach((button) => expect(button).toBeEnabled());
        }
    });
});

describe('ReadingToolbar — there is no article to copy or save', () => {
    it('switches off copying and the dossier', () => {
        setup({ copyLockedReason: 'Non disponibile: l’articolo non esisteva a quella data' });
        for (const name of ['Copia', 'Copia testo', 'Aggiungi a dossier']) {
            screen.getAllByTitle(`${name} — Non disponibile: l’articolo non esisteva a quella data`)
                .forEach((button) => expect(button).toBeDisabled());
        }
    });
});

describe('ReadingToolbar — the menu', () => {
    it('names the version action for what it does', () => {
        setup({ showMoreMenu: true });
        expect(screen.getByRole('button', { name: 'Testo alla data...' })).toBeInTheDocument();
        expect(screen.queryByText('Cerca versione...')).not.toBeInTheDocument();
    });

    it('opens the date dialog from it', () => {
        const props = setup({ showMoreMenu: true });
        fireEvent.click(screen.getByRole('button', { name: 'Testo alla data...' }));
        expect(props.onOpenVersionInput).toHaveBeenCalledTimes(1);
        expect(props.onToggleMoreMenu).toHaveBeenCalledWith(false);
    });
});
```

`__tests__/ArticleTabContent.pastText.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ArticleData, ArticleValidity, Highlight, NormaVisitata, SearchParams } from '../../../../types';

const { listPassages, listDiscussions, checkNorma, slotCalls } = vi.hoisted(() => ({
  listPassages: vi.fn(),
  listDiscussions: vi.fn(),
  checkNorma: vi.fn(),
  slotCalls: [] as Array<{ slot: string; props: Record<string, unknown> }>,
}));

vi.mock('../../../../services/articleDiscussionService', () => ({
  articleDiscussionService: {
    list: listDiscussions,
    listPassages,
    create: vi.fn(),
    comment: vi.fn(),
    report: vi.fn(),
    voteThread: vi.fn(),
    voteComment: vi.fn(),
  },
}));
vi.mock('../../../../services/authService', () => ({ isAuthenticated: () => true }));
vi.mock('../../../../services/notificationService', () => ({ notificationService: { checkNorma } }));
vi.mock('../../../../features/merlt/useMerltFeatures', () => ({
  useMerltFeatures: () => ({ canContribute: false, qaAskable: true, consentLevel: 'basic', merltEnabled: true }),
}));
vi.mock('../../../../plugins/PluginSlot', () => ({
  PluginSlot: ({ slot, props }: { slot: string; props: Record<string, unknown> }) => {
    slotCalls.push({ slot, props });
    return null;
  },
}));
vi.mock('../BrocardiDisplay', () => ({ BrocardiDisplay: () => <div data-testid="brocardi" /> }));

import { ArticleTabContent } from '../ArticleTabContent';
import { appStore } from '../../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../../utils/normaKeys';
import { fixtureText } from '../../../../utils/__fixtures__/articleTexts';

const TEXT = fixtureText('nrm-cc-1284');
const NORMA: NormaVisitata = {
  tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1284', allegato: '2',
  urn: 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284',
};
const BROCARDI = { position: null, link: null, Brocardi: ['Nemo iudex'], Ratio: null, Spiegazione: null, Massime: null };

const CURRENT: ArticleValidity = {
  state: 'current', valid_from: '2025-12-28', valid_to: null, version_number: 8, act_updated: '2026-08-11', request_in_window: null,
};
const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: '2026-08-11', request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};
const PAST = { versione: 'vigente', data_versione: '2005-06-01' };

function article(validity?: ArticleValidity, norma: Partial<NormaVisitata> = {}, over: Partial<ArticleData> = {}): ArticleData {
  return { article_text: TEXT, norma_data: { ...NORMA, ...norma }, brocardi_info: BROCARDI, validity, ...over };
}

function show(data: ArticleData) {
  return render(
    <MemoryRouter>
      <ArticleTabContent data={data} />
    </MemoryRouter>,
  );
}

const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(NORMA),
  articleId: uniqueArticleIdFromNorma(NORMA),
  rangeSerialized: '',
  text: 'saggio degli interessi legali',
  color: 'yellow',
  startOffset: TEXT.replace(/\n/g, '').indexOf('saggio degli interessi legali'),
};

let triggerSearch: Mock<(params: SearchParams) => void>;
let writeText: Mock<(text: string) => Promise<void>>;

beforeEach(() => {
  vi.clearAllMocks();
  slotCalls.length = 0;
  listDiscussions.mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
  listPassages.mockResolvedValue([]);
  checkNorma.mockResolvedValue({ changed: false });
  triggerSearch = vi.fn<(params: SearchParams) => void>();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  appStore.setState({
    loadAnnotationsForArticle: vi.fn(),
    loadHighlightsForArticle: vi.fn(),
    triggerSearch,
    highlights: [highlight],
    annotations: [],
    bookmarks: [],
  });
});

describe('ArticleTabContent — the text in force', () => {
  it('states since when the source says it has been in force, and keeps every tool', () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    expect(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' })).toBeInTheDocument();
    expect(screen.queryByText('Testo storico')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note')[0]).toBeEnabled();
    expect(screen.getByTestId('brocardi')).toBeInTheDocument();
    expect(screen.getByText('Chiedi su questo articolo')).toBeInTheDocument();
  });

  it('shows the reader’s highlight on the words it was made on (the control for the past text)', () => {
    const { container } = show(article(CURRENT, { versione: 'vigente' }));
    expect(container.querySelector('mark')).not.toBeNull();
  });

  it('claims nothing when the source stated nothing', () => {
    show(article(undefined, { versione: 'vigente' }));
    expect(screen.queryByText(/In vigore dal|Testo storico|Vigente/)).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note')[0]).toBeEnabled();
  });

  it('hands the plug-in slot the window and whether the text is a past one', () => {
    show(article(CURRENT, { versione: 'vigente' }));
    const call = slotCalls.find((c) => c.slot === 'article_content_after');
    expect(call?.props).toMatchObject({ articleUrn: NORMA.urn, validity: CURRENT, isHistorical: false });
  });
});

describe('ArticleTabContent — a past text is a reading', () => {
  it('says which window came back and what it does not say', () => {
    show(article(MIDDLE, PAST));
    expect(screen.getByRole('button', { name: 'Testo storico · dal 25-12-2003 al 29-12-2007' })).toBeInTheDocument();
    expect(screen.getByText('Testo storico')).toBeInTheDocument();
    expect(screen.getByText(/non dice quale disciplina si applichi al fatto/)).toBeInTheDocument();
  });

  it('shows the text itself, with the update notes open', () => {
    const { container } = show(article(MIDDLE, PAST));
    const root = container.querySelector('.vlx-art');
    expect(root?.textContent).toContain('Il saggio degli interessi legali');
    expect(root).toHaveClass('vlx-updates-open');
  });

  it('draws none of the reader’s marks on it: they would sit on the wrong words', () => {
    const { container } = show(article(MIDDLE, PAST));
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('.vlx-sign')).toBeNull();
  });

  it('switches off the tools keyed by article, with the reason in the tooltip', () => {
    show(article(MIDDLE, PAST));
    for (const name of ['Apri note', 'Gestisci evidenziazioni', 'Discussioni sull’articolo', 'Aggiungi a norme rapide']) {
      screen.getAllByTitle(`${name} — Non disponibile su un testo storico`).forEach((b) => expect(b).toBeDisabled());
    }
  });

  it('keeps Brocardi out, even when an older answer carried it', () => {
    show(article(MIDDLE, PAST));
    expect(screen.queryByTestId('brocardi')).not.toBeInTheDocument();
  });

  it('does not ask the discussions of the passages of a text it will not mark', () => {
    show(article(MIDDLE, PAST));
    expect(listPassages).not.toHaveBeenCalled();
  });

  it('does not offer the question to the assistant, which would answer about the current text', () => {
    show(article(MIDDLE, PAST));
    expect(screen.queryByText('Chiedi su questo articolo')).not.toBeInTheDocument();
  });

  it('tells the plug-in slot it is a past text', () => {
    show(article(MIDDLE, PAST));
    const call = slotCalls.find((c) => c.slot === 'article_content_after');
    expect(call?.props).toMatchObject({ validity: MIDDLE, isHistorical: true });
  });

  it('keeps even a text that was asked for by a date read-only when the source says it is not current', () => {
    show(article(MIDDLE, { versione: 'vigente', data_versione: '' }));
    expect(screen.getAllByTitle('Apri note — Non disponibile su un testo storico')[0]).toBeDisabled();
  });

  it('is read-only too when the source could not be read but a date was asked for', () => {
    show(article(undefined, PAST));
    expect(screen.queryByTestId('brocardi')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Apri note — Non disponibile su un testo storico')[0]).toBeDisabled();
  });

  it('does not register a past text of a saved norm as the saved text', async () => {
    const bookmarked = { id: 'b1', normaKey: buildItemKey(NORMA), normaData: NORMA, addedAt: '2026-01-01', tags: [] };
    appStore.setState({ bookmarks: [bookmarked] });
    show(article(MIDDLE, { versione: 'vigente', data_versione: '' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(checkNorma).not.toHaveBeenCalled();
  });

  it('still watches the text in force of a saved norm (the control)', async () => {
    const bookmarked = { id: 'b1', normaKey: buildItemKey(NORMA), normaData: NORMA, addedAt: '2026-01-01', tags: [] };
    appStore.setState({ bookmarks: [bookmarked] });
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    await waitFor(() => expect(checkNorma).toHaveBeenCalledTimes(1));
  });
});

describe('ArticleTabContent — the way back and the way on', () => {
  it('goes to the text in force without a date and with its doctrine', () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo attuale' }));
    const params = triggerSearch.mock.calls[0][0];
    expect(params).toMatchObject({ act_type: 'codice civile', article: '1284', version: 'vigente', show_brocardi_info: true });
    expect(params.version_date).toBeUndefined();
  });

  it('opens the dialog from the chip and asks for a text on a day, without doctrine and keeping the annex', async () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'In vigore dal 28-12-2025' }));
    const dialog = screen.getByRole('dialog', { name: 'Testo alla data' });
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: '2007-12-29' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Mostra il testo/ }));
    expect(triggerSearch).toHaveBeenCalledWith({
      act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '1284',
      version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false, annex: '2',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // it fades out
  });

  it('refuses an act of the Union in the dialog', () => {
    show(article(undefined, { tipo_atto: 'regolamento ue', allegato: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Altre azioni' }));
    fireEvent.click(screen.getByRole('button', { name: 'Testo alla data...' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Atti dell’Unione europea');
  });
});

describe('ArticleTabContent — an article that did not exist yet', () => {
  const notYet = () => article(NOT_YET, { versione: 'vigente', data_versione: '2010-01-01' }, {
    article_text: 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE',
  });

  it('does not draw the served notice as an article, and says when it came into being', () => {
    const { container } = show(notYet());
    expect(container.querySelector('.vlx-art')).toBeNull();
    expect(screen.queryByText(/NON ANCORA ESISTENTE/)).not.toBeInTheDocument();
    expect(screen.getByText('Questo articolo non esisteva al 1 gennaio 2010. È in vigore dal 13 settembre 2014.')).toBeInTheDocument();
  });

  it('opens the text of the first day it existed', () => {
    show(notYet());
    fireEvent.click(screen.getByRole('button', { name: 'Vai al testo del 13 settembre 2014' }));
    expect(triggerSearch).toHaveBeenCalledWith(expect.objectContaining({
      version: 'vigente', version_date: '2014-09-13', show_brocardi_info: false,
    }));
  });

  it('offers to pick another date', () => {
    show(notYet());
    fireEvent.click(screen.getByRole('button', { name: 'Scegli un’altra data' }));
    expect(screen.getByRole('dialog', { name: 'Testo alla data' })).toBeInTheDocument();
  });

  it('switches off copying and the dossier', () => {
    show(notYet());
    const reason = 'Non disponibile: l’articolo non esisteva a quella data';
    screen.getAllByTitle(`Copia testo — ${reason}`).forEach((b) => expect(b).toBeDisabled());
    screen.getAllByTitle(`Aggiungi a dossier — ${reason}`).forEach((b) => expect(b).toBeDisabled());
  });
});

describe('ArticleTabContent — copying a past text', () => {
  const copyButton = () => screen.getAllByTitle('Copia testo')[0];

  it('starts with the citation of the version, so the quotation cannot travel without it', async () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied: string = writeText.mock.calls[0][0];
    expect(copied.startsWith(
      'art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il ',
    )).toBe(true);
    expect(copied).toContain('Il saggio degli interessi legali');
    expect(copied).not.toContain('Tratto da');
  });

  it('keeps the trailer the text in force always had', async () => {
    show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    fireEvent.click(copyButton());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied: string = writeText.mock.calls[0][0];
    expect(copied.endsWith('\n\n---\ncodice civile n. 262 del 1942-03-16, Art. 1284 (Allegato 2)')).toBe(true);
  });

  it('copies the citation alone from the banner', async () => {
    show(article(MIDDLE, PAST));
    fireEvent.click(screen.getByRole('button', { name: 'Copia citazione' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1284 c\.c\., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 \(Normattiva/);
  });

  it('offers no citation for a version that does not contain the day', () => {
    show(article({ ...MIDDLE, request_in_window: false }, { versione: 'vigente', data_versione: '2010-01-01' }));
    expect(screen.getByRole('alert')).toHaveTextContent('non va considerata attendibile');
    expect(screen.queryByRole('button', { name: 'Copia citazione' })).not.toBeInTheDocument();
  });
});

describe('ArticleTabContent — selecting words of the text', () => {
  const RECT = { x: 40, y: 120, width: 90, height: 18 };
  const original = Range.prototype.getBoundingClientRect;

  beforeEach(() => {
    // jsdom has no layout: give the range a rect so the popup can position.
    Range.prototype.getBoundingClientRect = () =>
      ({ ...RECT, top: RECT.y, left: RECT.x, right: RECT.x + RECT.width, bottom: RECT.y + RECT.height, toJSON: () => ({}) }) as DOMRect;
  });
  afterEach(() => {
    Range.prototype.getBoundingClientRect = original;
    window.getSelection()?.removeAllRanges();
  });

  function select(container: HTMLElement, needle: string) {
    const root = container.querySelector('.vlx-art');
    if (!root) throw new Error('no text on screen');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = node.data.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.mouseUp(root);
      return;
    }
    throw new Error(`"${needle}" is not in the text`);
  }

  const WORDS = 'Gli interessi superiori alla misura legale';

  it('offers only "Copia" on a past text: nothing may be anchored to it', async () => {
    const { container } = show(article(MIDDLE, PAST));
    select(container, WORDS);
    await waitFor(() => expect(screen.getByTitle(/^Copia \(/)).toBeInTheDocument());
    expect(screen.queryByTitle(/^Evidenzia \(H\)/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Aggiungi nota \(N\)/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
  });

  it('offers highlight, note and discussion on the text in force (the control)', async () => {
    const { container } = show(article(CURRENT, { versione: 'vigente', data_versione: '' }));
    select(container, WORDS);
    await waitFor(() => expect(screen.getByTitle(/^Aggiungi nota \(N\)/)).toBeInTheDocument());
    expect(screen.getByTitle(/^Evidenzia \(H\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /discuti con i colleghi/i })).toBeInTheDocument();
  });
});
```

The popup test's edits:

In `apps/web/src/components/features/search/__tests__/SelectionPopup.test.tsx`, replace:

```tsx
function Harness({ onReportCitation, onDiscuss }: { onReportCitation?: ReportFn; onDiscuss?: DiscussFn }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="container">
      <SelectionPopup
        containerRef={ref}
        onHighlight={vi.fn()}
        onAddNote={vi.fn()}
        onCopy={vi.fn()}
        onReportCitation={onReportCitation}
        onDiscuss={onDiscuss}
      />
```

with:

```tsx
interface HarnessProps {
  onReportCitation?: ReportFn;
  onDiscuss?: DiscussFn;
  copyOnly?: boolean;
  onHighlight?: () => void;
  onAddNote?: () => void;
  onCopy?: (text: string) => void;
}

function Harness({ onReportCitation, onDiscuss, copyOnly, onHighlight, onAddNote, onCopy }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="container">
      <SelectionPopup
        containerRef={ref}
        onHighlight={onHighlight ?? vi.fn()}
        onAddNote={onAddNote ?? vi.fn()}
        onCopy={onCopy ?? vi.fn()}
        onReportCitation={onReportCitation}
        onDiscuss={onDiscuss}
        copyOnly={copyOnly}
      />
```

In `apps/web/src/components/features/search/__tests__/SelectionPopup.test.tsx`, replace:

```tsx
async function selectText(needle: string) {
```

with:

```tsx
async function selectText(needle: string, popupMarker: RegExp = /aggiungi nota/i) {
```

In `apps/web/src/components/features/search/__tests__/SelectionPopup.test.tsx`, replace:

```tsx
  await waitFor(() => expect(screen.getByTitle(/aggiungi nota/i)).toBeInTheDocument());
```

with:

```tsx
  await waitFor(() => expect(screen.getByTitle(popupMarker)).toBeInTheDocument());
```

In `apps/web/src/components/features/search/__tests__/SelectionPopup.test.tsx`, replace:

```tsx
    // The popup closes and the selection is cleared
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('');
  });
});
```

with:

```tsx
    // The popup closes and the selection is cleared
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('');
  });
});

describe('SelectionPopup: a past text (copyOnly)', () => {
  it('offers only "Copia": no highlight, no note, no discussion, no citation report', async () => {
    render(<Harness copyOnly onDiscuss={vi.fn<DiscussFn>()} onReportCitation={vi.fn<ReportFn>()} />);
    await selectText('art. 2043 c.c.', /^copia/i);

    expect(screen.getByTitle(/^copia/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/evidenzia/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/aggiungi nota/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discuti con i colleghi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /segnala come citazione/i })).not.toBeInTheDocument();
  });

  it('still copies the selection', async () => {
    const onCopy = vi.fn();
    render(<Harness copyOnly onCopy={onCopy} />);
    await selectText('art. 2043 c.c.', /^copia/i);
    fireEvent.click(screen.getByTitle(/^copia/i));
    expect(onCopy).toHaveBeenCalledWith('art. 2043 c.c.');
  });

  it('does not highlight or annotate from the keyboard either', async () => {
    const onHighlight = vi.fn();
    const onAddNote = vi.fn();
    render(<Harness copyOnly onHighlight={onHighlight} onAddNote={onAddNote} />);
    await selectText('art. 2043 c.c.', /^copia/i);
    fireEvent.keyDown(window, { key: 'h' });
    fireEvent.keyDown(window, { key: 'n' });
    expect(onHighlight).not.toHaveBeenCalled();
    expect(onAddNote).not.toHaveBeenCalled();
  });

  it('keeps the shortcuts for a text in force (the control for the test above)', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await selectText('art. 2043 c.c.');
    fireEvent.keyDown(window, { key: 'h' });
    expect(onHighlight).toHaveBeenCalledWith('art. 2043 c.c.', 'yellow', TEXT.indexOf('art. 2043'));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/web run test -- --run src/components/features/search/ReadingToolbar.test.tsx src/components/features/search/__tests__/SelectionPopup.test.tsx src/components/features/search/__tests__/ArticleTabContent.pastText.test.tsx`

Expected: `Test Files  3 failed (3)`, `Tests  36 failed | 12 passed (48)`. The 12 that pass are the controls (the text in force keeps every tool); the failures are `Unable to find an accessible element with the role "button" and name "Testo storico · dal 25-12-2003 al 29-12-2007"` and its kind.

- [ ] **Step 3: The popup, the body, the toolbar**

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
  // Optional "Discuti" action: rendered only when the host passes it.
  // Starts a discussion on the selected passage.
  onDiscuss?: (text: string, startOffset: number) => void;
}
```

with:

```tsx
  // Optional "Discuti" action: rendered only when the host passes it.
  // Starts a discussion on the selected passage.
  onDiscuss?: (text: string, startOffset: number) => void;
  // A past text takes no highlight, note or discussion (they are keyed by
  // article, not by version): only "Copia" is offered, and the shortcuts of the
  // others are off too.
  copyOnly?: boolean;
}
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
  onReportCitation,
  onDiscuss,
}: SelectionPopupProps) {
```

with:

```tsx
  onReportCitation,
  onDiscuss,
  copyOnly = false,
}: SelectionPopupProps) {
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
      } else if (e.key === 'h' && !e.metaKey && !e.ctrlKey) {
```

with:

```tsx
      } else if (e.key === 'h' && !copyOnly && !e.metaKey && !e.ctrlKey) {
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
      } else if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
```

with:

```tsx
      } else if (e.key === 'n' && !copyOnly && !e.metaKey && !e.ctrlKey) {
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
  }, [popup.visible, popup.text, popup.startOffset, popup.x, popup.y, onHighlight, onAddNote, hidePopup]);
```

with:

```tsx
  }, [popup.visible, popup.text, popup.startOffset, popup.x, popup.y, onHighlight, onAddNote, copyOnly, hidePopup]);
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
          <div className="flex items-center">
            <button
              onClick={() => handleAction('highlight')}
              className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Evidenzia (H)"
            >
              <Highlighter size={16} className="text-yellow-400" />
            </button>
            <div className="w-px h-5 bg-slate-700" />
            <button
              onClick={() => handleAction('note')}
              className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
              title="Aggiungi nota (N)"
            >
              <StickyNote size={16} className="text-blue-400" />
            </button>
            {onDiscuss && (
              <>
                <div className="w-px h-5 bg-slate-700" />
                <button
                  onClick={() => handleAction('discuss')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Discuti con i colleghi"
                  aria-label="Discuti con i colleghi"
                >
                  <MessageCircle size={16} className="text-sky-400" />
                </button>
              </>
            )}
            <div className="w-px h-5 bg-slate-700" />
            <button
              onClick={() => handleAction('copy')}
```

with:

```tsx
          <div className="flex items-center">
            {!copyOnly && (
              <>
                <button
                  onClick={() => handleAction('highlight')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Evidenzia (H)"
                >
                  <Highlighter size={16} className="text-yellow-400" />
                </button>
                <div className="w-px h-5 bg-slate-700" />
                <button
                  onClick={() => handleAction('note')}
                  className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                  title="Aggiungi nota (N)"
                >
                  <StickyNote size={16} className="text-blue-400" />
                </button>
                {onDiscuss && (
                  <>
                    <div className="w-px h-5 bg-slate-700" />
                    <button
                      onClick={() => handleAction('discuss')}
                      className="p-2.5 hover:bg-slate-700 transition-colors flex items-center gap-1.5 text-sm"
                      title="Discuti con i colleghi"
                      aria-label="Discuti con i colleghi"
                    >
                      <MessageCircle size={16} className="text-sky-400" />
                    </button>
                  </>
                )}
                <div className="w-px h-5 bg-slate-700" />
              </>
            )}
            <button
              onClick={() => handleAction('copy')}
```

In `apps/web/src/components/features/search/SelectionPopup.tsx`, replace:

```tsx
            {onReportCitation && (
```

with:

```tsx
            {onReportCitation && !copyOnly && (
```

In `apps/web/src/components/features/search/ArticleBody.tsx`, replace:

```tsx
    /** Unfolds the AGGIORNAMENTO notes at the bottom of the text (useArticleTextInteractions). */
    updatesOpen?: boolean;
}
```

with:

```tsx
    /** Unfolds the AGGIORNAMENTO notes at the bottom of the text (useArticleTextInteractions). */
    updatesOpen?: boolean;
    /** A past text: the selection popup offers only "Copia" (see SelectionPopup). */
    copyOnly?: boolean;
}
```

In `apps/web/src/components/features/search/ArticleBody.tsx`, replace:

```tsx
    updatesOpen = false,
}: ArticleBodyProps) {
```

with:

```tsx
    updatesOpen = false,
    copyOnly = false,
}: ArticleBodyProps) {
```

In `apps/web/src/components/features/search/ArticleBody.tsx`, replace:

```tsx
                onDiscuss={onPopupDiscuss}
                onReportCitation={onPopupReportCitation}
            />
```

with:

```tsx
                onDiscuss={onPopupDiscuss}
                onReportCitation={onPopupReportCitation}
                copyOnly={copyOnly}
            />
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';

export interface ReadingToolbarProps {
    normaData: ArticleData['norma_data'];
    versionInfo: ArticleData['versionInfo'];
```

with:

```tsx
import { cn } from '../../../lib/utils';
import { Z_INDEX } from '../../../constants/zIndex';
import type { VersionChip } from '../../../utils/versionDisplay';
import { VersionStatusChip } from './VersionStatusChip';

export interface ReadingToolbarProps {
    normaData: ArticleData['norma_data'];
    /** What the source says about the version on screen; null shows nothing (no "Vigente" by default). */
    versionChip: VersionChip | null;
    /**
     * Set on a past text: quick-norm, notes, highlights, discussions and Study Mode are
     * switched off, with this as the reason.
     */
    lockedReason?: string;
    /** Set when there is no article to copy or save (it did not exist on the day). */
    copyLockedReason?: string;
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
export function ReadingToolbar({
    normaData,
    versionInfo,
    url,
```

with:

```tsx
export function ReadingToolbar({
    normaData,
    versionChip,
    lockedReason,
    copyLockedReason,
    url,
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
}: ReadingToolbarProps) {
    return (
```

with:

```tsx
}: ReadingToolbarProps) {
    // A switched-off tool keeps its name and gains the reason in its tooltip.
    const tip = (name: string, reason?: string) => (reason ? `${name} — ${reason}` : name);
    const lock = (reason?: string) => (reason ? { disabled: true } : {});
    return (
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                {versionInfo?.isHistorical ? (
                    <span className={cn("px-2 py-1 rounded-md",
                        versionInfo.isHistorical ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300")}>
                        {versionInfo.isHistorical ? "Storica" : "Vigente"}
                    </span>
                ) : (
                    <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Vigente
                    </span>
                )}
                {normaData.data_versione && (
                    <>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <span>Aggiornato al: {normaData.data_versione}</span>
                    </>
                )}
                {/* Annex Source Badge */}
                {normaData.allegato && (
                    <>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
```

with:

```tsx
                {versionChip && <VersionStatusChip chip={versionChip} onClick={onOpenVersionInput} />}
                {/* Annex Source Badge */}
                {normaData.allegato && (
                    <>
                        {versionChip && <span className="text-slate-300 dark:text-slate-700">|</span>}
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
            <div className="flex md:hidden items-center gap-1">
```

with:

```tsx
            <div className="flex md:hidden items-center gap-1 [&_button:disabled]:opacity-40 [&_button:disabled]:cursor-not-allowed">
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide"}
                >
                    <Zap size={20} className={cn(isPinnedQuick && "fill-amber-500")} />
```

with:

```tsx
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={tip(isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <Zap size={20} className={cn(isPinnedQuick && "fill-amber-500")} />
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className={cn("p-2 lg:p-2.5 rounded-lg transition-colors relative", isDiscussionOpen ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary-500")}
                    title="Discussioni sull’articolo"
                >
```

with:

```tsx
                    className={cn("p-2 lg:p-2.5 rounded-lg transition-colors relative", isDiscussionOpen ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary-500")}
                    title={tip("Discussioni sull’articolo", lockedReason)}
                    {...lock(lockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title="Copia testo"
                >
```

with:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title={tip("Copia testo", copyLockedReason)}
                    {...lock(copyLockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title="Aggiungi a dossier"
                    aria-label="Aggiungi a dossier"
                >
                    <FolderPlus size={20} />
```

with:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title={tip("Aggiungi a dossier", copyLockedReason)}
                    aria-label="Aggiungi a dossier"
                    {...lock(copyLockedReason)}
                >
                    <FolderPlus size={20} />
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-purple-500 transition-colors"
                    title="Modalità studio"
                >
```

with:

```tsx
                    className="p-2 lg:p-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-purple-500 transition-colors"
                    title={tip("Modalità studio", lockedReason)}
                    {...lock(lockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
            <div className="hidden md:flex items-center gap-1">
```

with:

```tsx
            <div className="hidden md:flex items-center gap-1 [&_button:disabled]:opacity-40 [&_button:disabled]:cursor-not-allowed">
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide"}
                >
                    <Zap size={16} className={cn(isPinnedQuick && "fill-amber-500")} />
```

with:

```tsx
                            : "text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500"
                    )}
                    title={tip(isPinnedQuick ? "Rimuovi dalle norme rapide" : "Aggiungi a norme rapide", lockedReason)}
                    {...lock(lockedReason)}
                >
                    <Zap size={16} className={cn(isPinnedQuick && "fill-amber-500")} />
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    title={isNotesPeekOpen ? "Chiudi note" : "Apri note"}
                >
```

with:

```tsx
                    title={tip(isNotesPeekOpen ? "Chiudi note" : "Apri note", lockedReason)}
                    {...lock(lockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    title={isHighlightsPeekOpen ? "Chiudi evidenziazioni" : "Gestisci evidenziazioni"}
                >
```

with:

```tsx
                    title={tip(isHighlightsPeekOpen ? "Chiudi evidenziazioni" : "Gestisci evidenziazioni", lockedReason)}
                    {...lock(lockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className={cn("p-1.5 rounded-md transition-colors relative", isDiscussionOpen ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500")}
                    title="Discussioni sull’articolo"
                >
```

with:

```tsx
                    className={cn("p-1.5 rounded-md transition-colors relative", isDiscussionOpen ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary-500")}
                    title={tip("Discussioni sull’articolo", lockedReason)}
                    {...lock(lockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title="Copia"
                >
```

with:

```tsx
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition-colors"
                    title={tip("Copia", copyLockedReason)}
                    {...lock(copyLockedReason)}
                >
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title="Aggiungi a dossier"
                    aria-label="Aggiungi a dossier"
                >
                    <FolderPlus size={16} />
```

with:

```tsx
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-500 transition-colors"
                    title={tip("Aggiungi a dossier", copyLockedReason)}
                    aria-label="Aggiungi a dossier"
                    {...lock(copyLockedReason)}
                >
                    <FolderPlus size={16} />
```

In `apps/web/src/components/features/search/ReadingToolbar.tsx`, replace:

```tsx
                                    <Clock size={14} className="text-slate-400" />
                                    Cerca versione...
```

with:

```tsx
                                    <Clock size={14} className="text-slate-400" />
                                    Testo alla data...
```

Run: `npm --prefix apps/web run test -- --run src/components/features/search/ReadingToolbar.test.tsx src/components/features/search/__tests__/SelectionPopup.test.tsx`

Expected: `Tests  19 passed (19)`. The type-check is red until Step 4: `ArticleTabContent` still passes the toolbar its old `versionInfo` prop.

- [ ] **Step 4: The article page**

Thirty edits to `ArticleTabContent.tsx`, in this order. They: drop the old modal and its state; derive `display` once from `validity` and the request; give `useArticleMarkers` empty lists and no signs on a past text; hide Brocardi and the assistant question; build the citation for the three copy actions; add `handleTextAtDate` and `handleBannerAction`; draw the banner (and nothing in place of the text when the article did not exist yet); replace the modal with `TextAtDateDialog`.

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
import { ExternalLink, Clock } from 'lucide-react';
```

with:

```tsx
import { ExternalLink } from 'lucide-react';
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
import { AdvancedExportModal } from '../../ui/AdvancedExportModal';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
```

with:

```tsx
import { AdvancedExportModal } from '../../ui/AdvancedExportModal';
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
import type { Annotation, ThreadPassage } from '../../../types';
```

with:

```tsx
import type { Annotation, Highlight, ThreadPassage } from '../../../types';
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
import { revealAnnotation } from '../../../utils/revealAnnotation';

interface ArticleTabContentProps {
```

with:

```tsx
import { revealAnnotation } from '../../../utils/revealAnnotation';
import { VersionBanner } from './VersionBanner';
import { TextAtDateDialog } from './TextAtDateDialog';
import { formatNormCitation, withCitation } from '../../../utils/citation';
import { formatDateForDisplay, todayInRome } from '../../../utils/dateUtils';
import {
    NOT_YET_REASON,
    READ_ONLY_REASON,
    buildTextAtDateParams,
    describeVersion,
    isEuropeanAct,
    requestIsHistorical,
    type BannerAction,
    type TextAtDateChoice,
} from '../../../utils/versionDisplay';

// What a past text is shown with in place of the reader's marks (stable, so the
// memoised rendering does not run again for a fresh empty array).
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
const NO_THREADS: LocatedThread[] = [];

interface ArticleTabContentProps {
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const [showVersionInput, setShowVersionInput] = useState(false);
    const [versionDate, setVersionDate] = useState('');
```

with:

```tsx
    const [showVersionInput, setShowVersionInput] = useState(false);
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const versionDateInputRef = useRef<HTMLInputElement>(null);

    // Citation preview hook - destructure to get stable function references
```

with:

```tsx
    // Citation preview hook - destructure to get stable function references
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma_data), [norma_data]);
    const discussionAnchor = useMemo(() => ({
```

with:

```tsx
    const uniqueArticleId = useMemo(() => uniqueArticleIdFromNorma(norma_data), [norma_data]);

    // What the source says about the text that came back, and what that switches
    // off. A past text is a reading: notes, highlights and discussions are keyed
    // by article, not by version, so they would attach to the wrong words, and
    // Brocardi's commentary carries no date.
    const display = useMemo(() => describeVersion(data.validity, norma_data), [data.validity, norma_data]);
    const readOnly = display.readOnly;
    const requestedDate = norma_data.data_versione?.trim() || undefined;
    const initialDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : undefined;
    // "art. 1284 c.c., nel testo in vigore …" for a past text; null for the text in force.
    const citationNow = () => (display.canCite
        ? formatNormCitation({
            norma: norma_data,
            validity: data.validity,
            requestedDate,
            original: !requestedDate && norma_data.versione === 'originale',
            consultedAt: todayInRome(),
        })
        : null);

    const discussionAnchor = useMemo(() => ({
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    } = useArticlePassageThreads(discussionAnchor.normaKey, discussionAnchor.articleId, Boolean(article_text));
```

with:

```tsx
    } = useArticlePassageThreads(discussionAnchor.normaKey, discussionAnchor.articleId, Boolean(article_text) && !readOnly);
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const isCurrentText = !versionInfo?.isHistorical
        && (norma_data.versione ?? 'vigente') === 'vigente'
```

with:

```tsx
    const isCurrentText = !versionInfo?.isHistorical
        && !readOnly
        && (norma_data.versione ?? 'vigente') === 'vigente'
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const handleToggleQuickNorm = () => {
        if (isPinnedQuick) {
```

with:

```tsx
    const handleToggleQuickNorm = () => {
        if (readOnly) return;
        if (isPinnedQuick) {
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            if (options.includeCitation) {
                const citation = `\n\n---\nTratto da: ${formatCitation(norma_data)}`;
                textToCopy += citation;
            }

            if (options.includeNotes && allPanelAnnotations.length > 0) {
                textToCopy += `\n\nNote personali:\n${allPanelAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
            }

            if (options.includeHighlights && allPanelHighlights.length > 0) {
```

with:

```tsx
            if (options.includeCitation) {
                // A past text starts with its citation; the text in force keeps its trailer.
                textToCopy = withCitation(textToCopy, citationNow(), `\n\n---\nTratto da: ${formatCitation(norma_data)}`);
            }

            if (options.includeNotes && !readOnly && allPanelAnnotations.length > 0) {
                textToCopy += `\n\nNote personali:\n${allPanelAnnotations.map((n, i) => `${i + 1}. ${n.text}`).join('\n')}`;
            }

            if (options.includeHighlights && !readOnly && allPanelHighlights.length > 0) {
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            const citation = `\n\n---\n${formatCitation(norma_data)}`;
            await navigator.clipboard.writeText(plainText + citation);
```

with:

```tsx
            await navigator.clipboard.writeText(withCitation(plainText, citationNow(), `\n\n---\n${formatCitation(norma_data)}`));
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                version_date: norma_data.data_versione || '',
                show_brocardi_info: true
            };
```

with:

```tsx
                version_date: norma_data.data_versione || '',
                show_brocardi_info: !requestIsHistorical(norma_data)
            };
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
        const alreadyHighlighted
```

with:

```tsx
    const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
        if (readOnly) return;
        const alreadyHighlighted
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const handlePopupAddNote = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
        publishMerltEvent({
```

with:

```tsx
    const handlePopupAddNote = (text: string, startOffset: number, rect: { x: number; y: number; width: number; height: number }) => {
        if (readOnly) return;
        publishMerltEvent({
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            const citation = `\n\n---\nTratto da: ${formatCitation(norma_data)}`;
            await navigator.clipboard.writeText(text + citation);
```

with:

```tsx
            await navigator.clipboard.writeText(withCitation(text, citationNow(), `\n\n---\nTratto da: ${formatCitation(norma_data)}`));
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const handlePopupDiscuss = (text: string, startOffset: number) => {
        const passage
```

with:

```tsx
    const handlePopupDiscuss = (text: string, startOffset: number) => {
        if (readOnly) return;
        const passage
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    // The structure (heading, rubric, commi, items, Normattiva's modifications
```

with:

```tsx
    const handleTextAtDate = (choice: TextAtDateChoice) => {
        setShowVersionInput(false);
        showToast(
            choice.kind === 'original' ? 'Ricerca del testo originale' : `Ricerca del testo al ${formatDateForDisplay(choice.date)}`,
            'info',
        );
        triggerSearch(buildTextAtDateParams(norma_data, choice));
    };

    const handleBannerAction = async (action: BannerAction) => {
        switch (action) {
            case 'go_current':
                triggerSearch(quickNormParams);
                break;
            case 'pick_date':
                setShowVersionInput(true);
                break;
            case 'open_next_day':
                if (display.banner?.nextDay) {
                    triggerSearch(buildTextAtDateParams(norma_data, { kind: 'date', date: display.banner.nextDay }));
                }
                break;
            case 'copy_citation': {
                const citation = citationNow();
                if (!citation) return;
                try {
                    await navigator.clipboard.writeText(citation.long);
                    showToast('Citazione copiata', 'success');
                } catch {
                    showToast('Errore durante la copia', 'error');
                }
                break;
            }
        }
    };

    // The structure (heading, rubric, commi, items, Normattiva's modifications
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const markedHtml = useArticleMarkers({
        rawText: article_text || '',
        highlights: articleHighlights,
        annotations: itemAnnotations,
        structure,
        signs: true,
        threads: locatedThreads,
        focusedThreadId,
    });
```

with:

```tsx
    // A past text carries none of the reader's marks (see `display`).
    const shownHighlights = readOnly ? NO_HIGHLIGHTS : articleHighlights;
    const shownAnnotations = readOnly ? NO_ANNOTATIONS : itemAnnotations;
    const shownThreads = readOnly ? NO_THREADS : locatedThreads;
    const markedHtml = useArticleMarkers({
        rawText: article_text || '',
        highlights: shownHighlights,
        annotations: shownAnnotations,
        structure,
        signs: !readOnly,
        threads: shownThreads,
        focusedThreadId: readOnly ? null : focusedThreadId,
    });
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const blockGroups = useMemo(
        () => groupAnnotationsByBlock(article_text || '', structure, articleHighlights, itemAnnotations, locatedThreads),
        [article_text, structure, articleHighlights, itemAnnotations, locatedThreads],
    );
```

with:

```tsx
    const blockGroups = useMemo(
        () => groupAnnotationsByBlock(article_text || '', structure, shownHighlights, shownAnnotations, shownThreads),
        [article_text, structure, shownHighlights, shownAnnotations, shownThreads],
    );
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
    const looseHighlights = useMemo(
        () => highlightsWithoutSign(allPanelHighlights, blockGroups),
        [allPanelHighlights, blockGroups],
    );
```

with:

```tsx
    const looseHighlights = useMemo(
        () => (readOnly ? NO_HIGHLIGHTS : highlightsWithoutSign(allPanelHighlights, blockGroups)),
        [readOnly, allPanelHighlights, blockGroups],
    );
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                normaData={norma_data}
                versionInfo={versionInfo}
                url={url}
                articleText={article_text || ''}
                isNotesPeekOpen={isPeekOpen}
                notesButtonRef={setNotesButtonEl}
                notesCount={allPanelAnnotations.length}
                isHighlightsPeekOpen={isHighlightsPeekOpen}
                highlightsButtonRef={setHighlightsButtonEl}
                highlightsCount={allPanelHighlights.length}
```

with:

```tsx
                normaData={norma_data}
                versionChip={display.chip}
                lockedReason={readOnly ? READ_ONLY_REASON : undefined}
                copyLockedReason={display.canCopyOrSave ? undefined : NOT_YET_REASON}
                url={url}
                articleText={article_text || ''}
                isNotesPeekOpen={isPeekOpen}
                notesButtonRef={setNotesButtonEl}
                notesCount={readOnly ? 0 : allPanelAnnotations.length}
                isHighlightsPeekOpen={isHighlightsPeekOpen}
                highlightsButtonRef={setHighlightsButtonEl}
                highlightsCount={readOnly ? 0 : allPanelHighlights.length}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                onOpenStudyMode={onOpenStudyMode}
                onExportTxt={handleExportNotesTxt}
```

with:

```tsx
                onOpenStudyMode={readOnly ? undefined : onOpenStudyMode}
                onExportTxt={handleExportNotesTxt}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            <ArticleBody
                contentRef={contentRef}
                itemKey={itemKey}
                processedContent={processedContent}
                onPopupHighlight={handlePopupHighlight}
                onPopupAddNote={handlePopupAddNote}
                onPopupCopy={handlePopupCopy}
                onPopupDiscuss={handlePopupDiscuss}
                onPopupReportCitation={canContribute ? handlePopupReportCitation : undefined}
                updatesOpen={updatesOpen}
            />
```

with:

```tsx
            {display.banner && (
                <VersionBanner
                    banner={display.banner}
                    onAction={handleBannerAction}
                    variant={display.textVisible ? 'banner' : 'state'}
                />
            )}

            {display.textVisible && (
                <ArticleBody
                    contentRef={contentRef}
                    itemKey={itemKey}
                    processedContent={processedContent}
                    onPopupHighlight={handlePopupHighlight}
                    onPopupAddNote={handlePopupAddNote}
                    onPopupCopy={handlePopupCopy}
                    onPopupDiscuss={readOnly ? undefined : handlePopupDiscuss}
                    onPopupReportCitation={canContribute && !readOnly ? handlePopupReportCitation : undefined}
                    updatesOpen={updatesOpen || display.updateNotesOpen}
                    copyOnly={readOnly}
                />
            )}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            <AskMerltEntry
                merltEnabled={merltEnabled}
                qaAskable={qaAskable}
                consentNone={consentLevel === 'none'}
                articleUrn={norma_data.urn}
                articleNumber={norma_data.numero_articolo}
                actType={norma_data.tipo_atto}
                actNumber={norma_data.numero_atto}
                annex={norma_data.allegato}
            />
```

with:

```tsx
            {/* It asks about the article by its URN: on a past text the answer would describe the current one. */}
            {!readOnly && (
                <AskMerltEntry
                    merltEnabled={merltEnabled}
                    qaAskable={qaAskable}
                    consentNone={consentLevel === 'none'}
                    articleUrn={norma_data.urn}
                    articleNumber={norma_data.numero_articolo}
                    actType={norma_data.tipo_atto}
                    actNumber={norma_data.numero_atto}
                    annex={norma_data.allegato}
                />
            )}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                props={{
                    articleUrn: data.norma_data.urn,
                    containerRef: contentRef,
                }}
```

with:

```tsx
                props={{
                    articleUrn: data.norma_data.urn,
                    containerRef: contentRef,
                    validity: data.validity,
                    isHistorical: readOnly,
                }}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            {brocardi_info !== undefined && (
```

with:

```tsx
            {brocardi_info !== undefined && display.doctrineVisible && (
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                hasNotes={allPanelAnnotations.length > 0}
                hasHighlights={allPanelHighlights.length > 0}
```

with:

```tsx
                hasNotes={!readOnly && allPanelAnnotations.length > 0}
                hasHighlights={!readOnly && allPanelHighlights.length > 0}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
                articleData={data}
                annotations={allPanelAnnotations}
                highlights={allPanelHighlights}
```

with:

```tsx
                articleData={data}
                annotations={readOnly ? NO_ANNOTATIONS : allPanelAnnotations}
                highlights={readOnly ? NO_HIGHLIGHTS : allPanelHighlights}
```

In `apps/web/src/components/features/search/ArticleTabContent.tsx`, replace:

```tsx
            <Modal
                isOpen={showVersionInput}
                onClose={() => {
                    setShowVersionInput(false);
                    setVersionDate('');
                }}
                title="Cerca Versione Storica"
                description="Inserisci una data per visualizzare la versione dell'articolo vigente in quel momento."
                size="sm"
                variant="info"
                icon={<Clock size={20} />}
                initialFocusRef={versionDateInputRef}
                footer={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setShowVersionInput(false);
                                setVersionDate('');
                            }}
                        >
                            Annulla
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!versionDate}
                            onClick={() => {
                                if (!versionDate) {
                                    showToast('Seleziona una data', 'error');
                                    return;
                                }
                                const searchParams: SearchParams = {
                                    act_type: norma_data.tipo_atto,
                                    act_number: norma_data.numero_atto || '',
                                    date: norma_data.data || '',
                                    article: norma_data.numero_articolo,
                                    version: 'vigente',
                                    version_date: versionDate,
                                    show_brocardi_info: true,
                                };
                                showToast(`Ricerca versione del ${versionDate}`, 'info');
                                setShowVersionInput(false);
                                setVersionDate('');
                                triggerSearch(searchParams);
                            }}
                        >
                            <Clock size={16} />
                            Cerca versione
                        </Button>
                    </>
                }
            >
                <input
                    ref={versionDateInputRef}
                    type="date"
                    value={versionDate}
                    onChange={(e) => setVersionDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                />
            </Modal>
```

with:

```tsx
            <TextAtDateDialog
                isOpen={showVersionInput}
                onClose={() => setShowVersionInput(false)}
                onConfirm={handleTextAtDate}
                euAct={isEuropeanAct(norma_data.tipo_atto)}
                today={todayInRome()}
                initialDate={initialDate}
            />
```

- [ ] **Step 5: Run them to see them pass, then type-check and run the web suite**

Run the command of Step 2. Expected: `Test Files  3 passed (3)`, `Tests  48 passed (48)`.

Run: `npm --prefix apps/web run build`. Expected: clean.

Run: `npm --prefix apps/web run test -- --run`. Expected: all green, including `articleRender.test.ts` (rule 23: the rendered text nodes still spell `article_text` on its 27 real texts).

- [ ] **Step 6: Commit (ask first)**

```bash
git add apps/web/src/components/features/search/
git commit -m "feat(web): a past text is a reading — the chip, the banner, no marks, no doctrine, a cited copy"
```

### Task 7: The search panel and the norm header

`versionInfo` becomes what was asked for (a date, or the original text), the tab says which day, a cross-reference inside a past text stops asking for doctrine, and "Studio" is off on a past text.

**Files:**
- Modify: `apps/web/src/types/index.ts` (retire `effectiveDate`), `apps/web/src/components/features/search/SearchPanel.tsx`, `apps/web/src/components/features/workspace/NormaBlockComponent.tsx`

**Interfaces:**
- Consumes: `deriveVersionInfo`, `versionTabSuffix`, `requestIsHistorical`, `describeVersion`, `READ_ONLY_REASON` (Task 4).
- Produces: `ArticleData.versionInfo = { isHistorical: boolean; requestedDate?: string }` — `isHistorical` is true for a date **and for the original text**, which used to look like the text in force; the tab of a past text reads `{atto} — testo al {dd/mm/yyyy}` or `{atto} — testo originale`.

There is no new test: the decisions are pure functions already tested in Task 4 (`deriveVersionInfo`, `versionTabSuffix`, `describeVersion`), and `processResult` and the norm header cannot be rendered on their own. The type-check and the browser pass of Task 10 cover the wiring.

- [ ] **Step 1: Apply the edits**

In `apps/web/src/types/index.ts`, replace:

```ts
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
        effectiveDate?: string;
    };
}
```

with:

```ts
    /**
     * What was ASKED for, not what came back: `isHistorical` is true for a date or for the
     * original text, even when the answer turns out to be the text in force. What came back is
     * `validity`.
     */
    versionInfo?: {
        isHistorical: boolean;
        requestedDate?: string;
    };
}
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
import { matchesSearchFilters } from '../../../utils/searchFilters';
```

with:

```tsx
import { matchesSearchFilters } from '../../../utils/searchFilters';
import { deriveVersionInfo, requestIsHistorical, versionTabSuffix } from '../../../utils/versionDisplay';
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false, tabLabel?: string, targetTabId?: string, filters?: SearchParams['filters']) => {
```

with:

```tsx
  const processResult = useCallback((result: ArticleData, versionDate?: string, isStreaming = false, tabLabel?: string, targetTabId?: string, filters?: SearchParams['filters'], version?: SearchParams['version']) => {
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
    // Mark as historical if version_date was provided
    if (versionDate) {
      result.versionInfo = {
        isHistorical: true,
        requestedDate: versionDate,
        effectiveDate: normaData.data_versione || normaData.data
      };
    }
```

with:

```tsx
    // What was ASKED for: a date, or the original text. What came back is
    // `result.validity`, the window the source states; never an echo of the date.
    result.versionInfo = deriveVersionInfo({ version, version_date: versionDate });
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
          const versionSuffix = isHistorical && versionDate ? ` - Ver. ${versionDate}` : '';
```

with:

```tsx
          const versionSuffix = isHistorical ? versionTabSuffix({ version, versionDate }) : '';
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
              const result = JSON.parse(line);
              processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters);
```

with:

```tsx
              const result = JSON.parse(line);
              processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters, params.version);
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
          const result = JSON.parse(buffer);
          processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters);
```

with:

```tsx
          const result = JSON.parse(buffer);
          processResult(result, params.version_date, true, params.tabLabel, params.targetTabId, params.filters, params.version);
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
          const versionDate = group.versionDate ? ` - Ver. ${group.versionDate}` : ' - Storico';
          const label = isCustomForThisGroup
            ? customTabLabel!
            : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}${versionDate}`;
```

with:

```tsx
          const versionSuffix = versionTabSuffix({
            version: group.articles[0]?.norma_data.versione,
            versionDate: group.versionDate,
          }) || ' — testo storico';
          const label = isCustomForThisGroup
            ? customTabLabel!
            : `${group.norma.tipo_atto}${group.norma.numero_atto ? ` ${group.norma.numero_atto}` : ''}${versionSuffix}`;
```

In `apps/web/src/components/features/search/SearchPanel.tsx`, replace:

```tsx
      version_date: normaData.data_versione || '',
      show_brocardi_info: true,
      annex: normaData.allegato || undefined  // Preserve annex when navigating via cross-reference
```

with:

```tsx
      version_date: normaData.data_versione || '',
      show_brocardi_info: !requestIsHistorical(normaData),
      annex: normaData.allegato || undefined  // Preserve annex when navigating via cross-reference
```

In `apps/web/src/components/features/workspace/NormaBlockComponent.tsx`, replace:

```tsx
import { formatNormaMeta } from '../../../utils/normaMeta';
```

with:

```tsx
import { formatNormaMeta } from '../../../utils/normaMeta';
import { READ_ONLY_REASON, describeVersion } from '../../../utils/versionDisplay';
```

In `apps/web/src/components/features/workspace/NormaBlockComponent.tsx`, replace:

```tsx
  const activeArticle = resolvedActive ?? normaBlock.articles[0];
```

with:

```tsx
  const activeArticle = resolvedActive ?? normaBlock.articles[0];
  // Study Mode's tools create notes keyed by the article, not by the version:
  // on a past text they would land on the wrong words.
  const studyLocked = activeArticle
    ? describeVersion(activeArticle.validity, activeArticle.norma_data).readOnly
    : false;
```

In `apps/web/src/components/features/workspace/NormaBlockComponent.tsx`, replace:

```tsx
            <button
              className="flex norma-study-mode-btn px-2 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 active:bg-purple-200 dark:text-purple-400 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-lg transition-colors items-center gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setStudyModeOpen(true);
              }}
              title="Modalità studio"
              aria-label="Modalità studio"
            >
```

with:

```tsx
            <button
              className="flex norma-study-mode-btn px-2 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 active:bg-purple-200 dark:text-purple-400 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-lg transition-colors items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={(e) => {
                e.stopPropagation();
                setStudyModeOpen(true);
              }}
              disabled={studyLocked}
              title={studyLocked ? `Modalità studio — ${READ_ONLY_REASON}` : 'Modalità studio'}
              aria-label="Modalità studio"
            >
```

- [ ] **Step 2: Type-check and run the web suite**

Run: `npm --prefix apps/web run build`. Expected: clean (the first edit removes the last reader of `effectiveDate`; a leftover would show here).

Run: `npm --prefix apps/web run test -- --run`. Expected: all green.

- [ ] **Step 3: Commit (ask first)**

```bash
git add apps/web/src/types/index.ts apps/web/src/components/features/search/SearchPanel.tsx apps/web/src/components/features/workspace/NormaBlockComponent.tsx
git commit -m "feat(web): versionInfo is what was asked for; the tab names the day; no Study Mode on a past text"
```

- [ ] **Step 4: A reviewer on the PR**

Dispatch the `code-reviewer` agent with the spec path and `git diff develop...HEAD`: it re-reads the diff against §5.2, §5.3 and the Global Constraints, read-only. Fix every finding it confirms, or say why not; then open the PR (ask first).

### PR 2 description

> **Summary.** The toolbar's "Vigente" and "Aggiornato al" give way to a status the source states ("In vigore dal 28-12-2025", "Testo storico · dal 25-12-2003 al 29-12-2007", "Abrogato dal …", "Non ancora esistente"), and nothing at all when the source could not be read. "Cerca versione" becomes the "Testo alla data" dialog (a day, or the original text; a future day and EUR-Lex acts are refused with the reason). A past text is a reading: no notes, highlights, discussions, quick-norm, Study Mode, saved-norm check or Brocardi; the update notes open; a banner says which window it is and what the window does not say; a copy starts with the citation. An article that did not exist yet draws no text, only the way forward.
>
> **Why.** "Vigente" was a default painted on every text, "Aggiornato al" an echo of the typed date, and notes keyed by article attached to the wrong words of an older text. Spec: `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`.
>
> **Checked.** Web suite 1,674 tests in 145 files (1,522 in 137 before), `articleRender.test.ts` included: rule 23 holds; the real build and lint clean; 16 deliberate breakages of the code each caught by a test. Browser pass: see PR 3.
>
> **For the owner.** The wording to read: `utils/__fixtures__/citationGolden.ts` and the strings of `utils/versionDisplay.test.ts`. Decisions beyond the spec are listed in the plan under "Decisions taken while planning".

## PR 3 — The dossier keeps the version, and the feature is checked as a whole

Branch `feat/testo-alla-data-dossier`, from `develop` after PR 2 has merged.

### Task 8: The dossier tells versions apart

Every door stores the version (the window header's "Aggiungi a dossier" used to drop it, so a past text was saved under the label of the current one); two versions of one article can sit in one dossier; a reopened past item is read without doctrine; a row says "Testo al …"; and the in-place reader is read-only on a past text, as the tab is.

**Files:**
- Modify: `apps/web/src/components/features/dossier/dossierUtils.ts`, `SortableDossierItem.tsx`, `DossierItemReader.tsx`; `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx`
- Modify (tests): `apps/web/src/components/features/dossier/dossierUtils.test.ts`
- Create (tests): `apps/web/src/components/features/dossier/DossierItemReader.pastText.test.tsx`, `SortableDossierItem.pastText.test.tsx`

**Interfaces:**
- Consumes: `requestIsHistorical`, `historicalItemLabel`, `describeVersion` (Task 4); `formatNormCitation`, `withCitation` (Task 4); `VersionBanner` (Task 5).
- Produces:
  - `normaForDossier(norma: Norma, article: ArticleData): NormaVisitata` — the item the window header stores: the same fields as before plus `versione` and `data_versione` when the article has them.
  - `dossierContainsArticle(dossier, norma)` — also compares `versione` (a missing one is `vigente`) and `data_versione` (a missing one is empty): an item saved before versions were kept is the text in force.
  - `searchParamsFromNorma(norma)` — `show_brocardi_info` is `false` for a past item.

- [ ] **Step 1: Write the tests**

The dossier utility test changes in three places (the expectation that a past item asks for doctrine is reversed on purpose; two versions and legacy items are new; `normaForDossier` is new).

In `apps/web/src/components/features/dossier/dossierUtils.test.ts`, replace:

```ts
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle,
} from './dossierUtils';
import type { Dossier, DossierItem, NormaVisitata } from '../../../types';
```

with:

```ts
import {
  searchParamsFromNorma, packItemContent, unpackItemContent,
  computeItemCounts, dossierRecency, dossierContainsArticle, normaForDossier,
} from './dossierUtils';
import type { ArticleData, Dossier, DossierItem, NormaVisitata } from '../../../types';
```

In `apps/web/src/components/features/dossier/dossierUtils.test.ts`, replace:

```ts
  it('maps NormaVisitata to SearchParams honoring stored version', () => {
    expect(searchParamsFromNorma({ ...norma, versione: 'originale', data_versione: '1990-01-01', allegato: '2' }))
      .toEqual({
        act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043',
        version: 'originale', version_date: '1990-01-01', show_brocardi_info: true, annex: '2',
      });
  });
  it('defaults to vigente and empty version_date', () => {
    const p = searchParamsFromNorma(norma);
    expect(p.version).toBe('vigente');
    expect(p.version_date).toBe('');
    expect(p).not.toHaveProperty('annex');
  });
```

with:

```ts
  it('maps NormaVisitata to SearchParams honoring stored version, without doctrine for a past text', () => {
    expect(searchParamsFromNorma({ ...norma, versione: 'originale', data_versione: '1990-01-01', allegato: '2' }))
      .toEqual({
        act_type: 'codice civile', act_number: '262', date: '1942-03-16', article: '2043',
        version: 'originale', version_date: '1990-01-01', show_brocardi_info: false, annex: '2',
      });
  });
  it('defaults to vigente and empty version_date, and asks for the doctrine of the text in force', () => {
    const p = searchParamsFromNorma(norma);
    expect(p.version).toBe('vigente');
    expect(p.version_date).toBe('');
    expect(p.show_brocardi_info).toBe(true);
    expect(p).not.toHaveProperty('annex');
  });
  it.each([
    [{ versione: 'originale' }],
    [{ versione: 'vigente', data_versione: '2007-12-29' }],
  ])('keeps the doctrine out of a reopened past text %j', (version) => {
    expect(searchParamsFromNorma({ ...norma, ...version }).show_brocardi_info).toBe(false);
  });
```

In `apps/web/src/components/features/dossier/dossierUtils.test.ts`, replace:

```ts
  it('rejects different act or article', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, numero_articolo: '2059' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, tipo_atto: 'codice penale' })).toBe(false);
  });
});
```

with:

```ts
  it('rejects different act or article', () => {
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, numero_articolo: '2059' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, tipo_atto: 'codice penale' })).toBe(false);
  });
  it('tells two versions of one article apart, so both can sit in one dossier', () => {
    const stored = dossier([item({ data: { ...norma, versione: 'vigente', data_versione: '2007-12-29' } })]);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(true);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente', data_versione: '2015-01-01' })).toBe(false);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'vigente' })).toBe(false);
    expect(dossierContainsArticle(stored, { ...norma, versione: 'originale' })).toBe(false);
  });
  it('treats an item saved before versions were kept as the text in force', () => {
    const legacy = dossier([item({})]); // no version fields at all
    expect(dossierContainsArticle(legacy, { ...norma, versione: 'vigente', data_versione: '' })).toBe(true);
    expect(dossierContainsArticle(legacy, { ...norma })).toBe(true);
    expect(dossierContainsArticle(legacy, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(false);
  });
  it('does not take the text in force for the original text, nor the reverse', () => {
    const original = dossier([item({ data: { ...norma, versione: 'originale' } })]);
    expect(dossierContainsArticle(original, { ...norma, versione: 'vigente' })).toBe(false);
    expect(dossierContainsArticle(dossier([item({})]), { ...norma, versione: 'originale' })).toBe(false);
  });
  it('treats the nulls a server payload may carry as absent', () => {
    const fromServer = dossier([item({ data: { ...norma, versione: null, data_versione: null } as unknown as NormaVisitata })]);
    expect(dossierContainsArticle(fromServer, { ...norma })).toBe(true);
    expect(dossierContainsArticle(fromServer, { ...norma, versione: 'vigente', data_versione: '2007-12-29' })).toBe(false);
  });
});

describe('normaForDossier', () => {
  const block = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', urn: 'urn:x' };
  const article = (over: Partial<NormaVisitata> = {}): ArticleData => ({
    article_text: 'testo',
    norma_data: { ...norma, numero_articolo: '1284', ...over },
  });

  it('keeps the version of a past text, which the window header used to drop', () => {
    expect(normaForDossier(block, article({ versione: 'vigente', data_versione: '2007-12-29' }))).toEqual({
      tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', urn: 'urn:x',
      versione: 'vigente', data_versione: '2007-12-29',
    });
  });

  it('keeps the original text', () => {
    expect(normaForDossier(block, article({ versione: 'originale' }))).toMatchObject({ versione: 'originale' });
    expect(normaForDossier(block, article({ versione: 'originale' }))).not.toHaveProperty('data_versione');
  });

  it('stores no date for the text in force', () => {
    expect(normaForDossier(block, article({ versione: 'vigente', data_versione: '' })))
      .not.toHaveProperty('data_versione');
  });

  it('reopens the same version it stored', () => {
    const stored = normaForDossier(block, article({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(searchParamsFromNorma(stored)).toMatchObject({
      article: '1284', version: 'vigente', version_date: '2007-12-29', show_brocardi_info: false,
    });
  });
});
```

`DossierItemReader.pastText.test.tsx`:

```tsx
import { beforeEach, describe, it, expect, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: vi.fn() }));

import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { DossierItemReader } from './DossierItemReader';
import { appStore } from '../../../store/useAppStore';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { fixtureText } from '../../../utils/__fixtures__/articleTexts';
import type { ArticleValidity, Highlight, NormaVisitata } from '../../../types';

const RAW = fixtureText('nrm-cc-1284');
const CURRENT_ITEM: NormaVisitata = {
  tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', allegato: '2',
};
const PAST_ITEM: NormaVisitata = { ...CURRENT_ITEM, versione: 'vigente', data_versione: '2005-06-01' };

const MIDDLE: ArticleValidity = {
  state: 'historical', valid_from: '2003-12-25', valid_to: '2007-12-29', version_number: 7, act_updated: null, request_in_window: true,
};
const NOT_YET: ArticleValidity = {
  state: 'not_yet', valid_from: null, valid_to: '2014-09-12', version_number: null, act_updated: null, request_in_window: true,
};

// A highlight made on the text in force of the same article: the key carries no version.
const highlight: Highlight = {
  id: 'h1',
  normaKey: buildItemKey(CURRENT_ITEM),
  articleId: uniqueArticleIdFromNorma(CURRENT_ITEM),
  rangeSerialized: '',
  text: 'saggio degli interessi legali',
  color: 'green',
  startOffset: RAW.replace(/\n/g, '').indexOf('saggio degli interessi legali'),
};

let writeText: Mock<(text: string) => Promise<void>>;

function read(norma: NormaVisitata, validity?: ArticleValidity, text = RAW) {
  vi.mocked(fetchArticleForNorma).mockResolvedValue({ article_text: text, norma_data: norma, validity });
  return render(<DossierItemReader norma={norma} onOpenOnDashboard={() => {}} showToast={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  appStore.setState({ highlights: [highlight], annotations: [] });
});

describe('DossierItemReader — a past text', () => {
  it('shows the highlight made on the text in force (the control)', async () => {
    const { container } = read(CURRENT_ITEM);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).not.toBeNull();
  });

  it('draws none of those marks on a past text: they would sit on the wrong words', async () => {
    const { container } = read(PAST_ITEM, MIDDLE);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('.vlx-sign')).toBeNull();
  });

  it('says which window it is, and only informs', async () => {
    read(PAST_ITEM, MIDDLE);
    expect(await screen.findByText('Testo storico')).toBeInTheDocument();
    expect(screen.getByText(/In vigore dal 25 dicembre 2003 al 29 dicembre 2007/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vai al testo attuale' })).not.toBeInTheDocument();
  });

  it('opens the update notes', async () => {
    const { container } = read(PAST_ITEM, MIDDLE);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('.vlx-art')).toHaveClass('vlx-updates-open');
  });

  it('says the day that was asked for when the source could not be read, and no more', async () => {
    read(PAST_ITEM, undefined);
    expect(await screen.findByText('Testo al 01/06/2005')).toBeInTheDocument();
  });

  it('leaves the label to the banner when the source stated the window', async () => {
    read(PAST_ITEM, MIDDLE);
    await screen.findByText('Testo storico');
    expect(screen.queryByText('Testo al 01/06/2005')).not.toBeInTheDocument();
  });

  it('is read-only even when the source could not be read', async () => {
    const { container } = read(PAST_ITEM, undefined);
    await waitFor(() => expect(container.querySelector('.vlx-art')).not.toBeNull());
    expect(container.querySelector('mark')).toBeNull();
  });
});

describe('DossierItemReader — the citation', () => {
  it('copies the citation of the version a past item holds', async () => {
    read(PAST_ITEM, MIDDLE);
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(
      /^art\. 1284 c\.c\., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 \(Normattiva, testo consolidato, consultato il /,
    );
  });

  it('copies the day that was asked for when the source could not be read', async () => {
    read(PAST_ITEM, undefined);
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/^art\. 1284 c\.c\., nel testo in vigore al 1° giugno 2005 \(Normattiva/);
  });

  it('keeps the citation a text in force always had, byte for byte', async () => {
    read(CURRENT_ITEM, { ...MIDDLE, state: 'current', valid_to: null });
    fireEvent.click(await screen.findByRole('button', { name: /Copia citazione/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('codice civile n. 262 del 1942-03-16, Art. 1284 (Allegato 2)');
  });
});

describe('DossierItemReader — an article that did not exist yet', () => {
  it('says so instead of drawing the notice as an article, and copies no citation', async () => {
    const { container } = read(
      { ...PAST_ITEM, data_versione: '2010-01-01' }, NOT_YET, 'Art. 183-bis\n\nARTICOLO NON ANCORA ESISTENTE O VIGENTE',
    );
    expect(await screen.findByText(/Questo articolo non esisteva al 1 gennaio 2010/)).toBeInTheDocument();
    expect(container.querySelector('.vlx-art')).toBeNull();
    expect(screen.getByRole('button', { name: /Copia citazione/ })).toBeDisabled();
  });
});
```

`SortableDossierItem.pastText.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableDossierItem } from './SortableDossierItem';
import type { DossierItem } from '../../../types';

const item = (data: Partial<Extract<DossierItem, { type: 'norma' }>['data']> = {}): DossierItem => ({
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', ...data },
});

function renderRow(row: DossierItem) {
  return render(
    <DndContext>
      <SortableContext items={[row.id]} strategy={verticalListSortingStrategy}>
        <SortableDossierItem
          item={row} isSelected={false} showCheckbox={false}
          onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
          isExpanded={false} onToggleExpand={() => {}}
          onOpenOnDashboard={() => {}} showToast={() => {}}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe('SortableDossierItem — a past text', () => {
  it('says which day an item that holds a past text was asked for', () => {
    renderRow(item({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(screen.getByText('Testo al 29/12/2007')).toBeInTheDocument();
  });

  it('says it holds the original text', () => {
    renderRow(item({ versione: 'originale' }));
    expect(screen.getByText('Testo originale')).toBeInTheDocument();
  });

  it.each([
    ['an item saved before versions were kept', {}],
    ['the text in force', { versione: 'vigente', data_versione: '' }],
  ])('says nothing on %s', (_name, data) => {
    renderRow(item(data));
    expect(screen.queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
  });

  it('says nothing on a note', () => {
    renderRow({ id: 'n1', type: 'note', data: 'appunto', addedAt: '2026-08-01' });
    expect(screen.queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/web run test -- --run src/components/features/dossier`

Expected: `Test Files  3 failed | 3 passed (6)`, `Tests  22 failed | 30 passed (52)`: for example `expected <mark …(3)></mark> to be null` (the reader still draws the highlight on a past text) and `Unable to find an element with the text: Testo storico`.

- [ ] **Step 3: The utilities, the window header and the row**

In `apps/web/src/components/features/dossier/dossierUtils.ts`, replace:

```ts
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import type { Dossier, DossierItem, NormaVisitata, SearchParams } from '../../../types';
```

with:

```ts
import { uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { requestIsHistorical } from '../../../utils/versionDisplay';
import type { ArticleData, Dossier, DossierItem, Norma, NormaVisitata, SearchParams } from '../../../types';
```

In `apps/web/src/components/features/dossier/dossierUtils.ts`, replace:

```ts
    version_date: norma.data_versione || '',
    show_brocardi_info: true,
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}
```

with:

```ts
    version_date: norma.data_versione || '',
    // Brocardi's commentary carries no date: a past text is read without it.
    show_brocardi_info: !requestIsHistorical(norma),
    ...(norma.allegato ? { annex: norma.allegato } : {}),
  };
}

// What the window header's "Aggiungi a dossier" stores for one article of a tab.
// It rebuilds the item from the block's norma and the article, and used to drop
// the version: a historical text was saved under the same label as the current
// one and reopened as the text in force.
export function normaForDossier(norma: Norma, article: ArticleData): NormaVisitata {
  const { versione, data_versione } = article.norma_data;
  return {
    tipo_atto: norma.tipo_atto,
    numero_atto: norma.numero_atto,
    data: norma.data,
    numero_articolo: article.norma_data.numero_articolo,
    urn: norma.urn,
    ...(versione ? { versione } : {}),
    ...(data_versione ? { data_versione } : {}),
  };
}
```

In `apps/web/src/components/features/dossier/dossierUtils.ts`, replace:

```ts
// Whether a dossier already holds the given article, matching on act
// (tipo_atto + numero_atto + data) and normalized article id so "1-bis" /
// "1 bis" formatting differences between the tree API and the scraper don't
// produce false negatives (see findArticleByNormalizedId in articleIds.ts
// for the same tolerance applied to article lookups).
export function dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  const target = normalizeArticleId(uniqueArticleIdFromNorma(norma));
  return dossier.items.some((i) => {
    if (i.type !== 'norma') return false;
    const d = i.data as NormaVisitata;
    return d.tipo_atto === norma.tipo_atto
      && (d.numero_atto || '') === (norma.numero_atto || '')
      && (d.data || '') === (norma.data || '')
      && normalizeArticleId(uniqueArticleIdFromNorma(d)) === target;
  });
}
```

with:

```ts
// The text two items hold is the same text only when the version agrees too.
// An item saved before versions were kept has no version fields and is the text
// in force, as is one that says "vigente" with no date.
function sameVersion(a: NormaVisitata, b: NormaVisitata): boolean {
  return (a.versione || 'vigente') === (b.versione || 'vigente')
    && (a.data_versione || '') === (b.data_versione || '');
}

// Whether a dossier already holds the given article, matching on act
// (tipo_atto + numero_atto + data), normalized article id and version, so
// "1-bis" / "1 bis" formatting differences between the tree API and the
// scraper don't produce false negatives (see findArticleByNormalizedId in
// articleIds.ts for the same tolerance applied to article lookups) and two
// versions of one article can sit side by side.
export function dossierContainsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  const target = normalizeArticleId(uniqueArticleIdFromNorma(norma));
  return dossier.items.some((i) => {
    if (i.type !== 'norma') return false;
    const d = i.data as NormaVisitata;
    return d.tipo_atto === norma.tipo_atto
      && (d.numero_atto || '') === (norma.numero_atto || '')
      && (d.data || '') === (norma.data || '')
      && normalizeArticleId(uniqueArticleIdFromNorma(d)) === target
      && sameVersion(d, norma);
  });
}
```

In `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx`, replace:

```tsx
import { Z_INDEX_VALUES } from '../../../constants/zIndex';
```

with:

```tsx
import { Z_INDEX_VALUES } from '../../../constants/zIndex';
import { normaForDossier } from '../dossier/dossierUtils';
```

In `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx`, replace:

```tsx
        item.articles.forEach(article => {
          const normaData = {
            tipo_atto: item.norma.tipo_atto,
            numero_atto: item.norma.numero_atto,
            data: item.norma.data,
            numero_articolo: article.norma_data.numero_articolo,
            urn: item.norma.urn
          };
          addToDossier(dossierId, normaData, 'norma');
        });
      } else if (item.type === 'loose-article') {
        const normaData = {
          tipo_atto: item.sourceNorma.tipo_atto,
          numero_atto: item.sourceNorma.numero_atto,
          data: item.sourceNorma.data,
          numero_articolo: item.article.norma_data.numero_articolo,
          urn: item.sourceNorma.urn
        };
        addToDossier(dossierId, normaData, 'norma');
      } else if (item.type === 'collection') {
        // Add each article from the collection
        item.articles.forEach(({ article, sourceNorma }) => {
          const normaData = {
            tipo_atto: sourceNorma.tipo_atto,
            numero_atto: sourceNorma.numero_atto,
            data: sourceNorma.data,
            numero_articolo: article.norma_data.numero_articolo,
            urn: sourceNorma.urn
          };
          addToDossier(dossierId, normaData, 'norma');
        });
```

with:

```tsx
        item.articles.forEach(article => {
          addToDossier(dossierId, normaForDossier(item.norma, article), 'norma');
        });
      } else if (item.type === 'loose-article') {
        addToDossier(dossierId, normaForDossier(item.sourceNorma, item.article), 'norma');
      } else if (item.type === 'collection') {
        // Add each article from the collection
        item.articles.forEach(({ article, sourceNorma }) => {
          addToDossier(dossierId, normaForDossier(sourceNorma, article), 'norma');
        });
```

In `apps/web/src/components/features/dossier/SortableDossierItem.tsx`, replace:

```tsx
import { formatTimestampLong } from './dossierUtils';
```

with:

```tsx
import { formatTimestampLong } from './dossierUtils';
import { historicalItemLabel } from '../../../utils/versionDisplay';
```

In `apps/web/src/components/features/dossier/SortableDossierItem.tsx`, replace:

```tsx
  const regionId = `dossier-item-content-${item.id}`;
```

with:

```tsx
  const regionId = `dossier-item-content-${item.id}`;
  // "Testo al 29/12/2007": a row that holds a past text says so.
  const historicalLabel = item.type === 'norma' ? historicalItemLabel(item.data) : null;
```

In `apps/web/src/components/features/dossier/SortableDossierItem.tsx`, replace:

```tsx
                <p className="text-xs md:text-sm text-slate-500 truncate">Art. {item.data.numero_articolo} • {formatDateItalianLong(item.data.data || '')}</p>
```

with:

```tsx
                <p className="text-xs md:text-sm text-slate-500 truncate">Art. {item.data.numero_articolo} • {formatDateItalianLong(item.data.data || '')}</p>
                {historicalLabel && (
                  <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {historicalLabel}
                  </span>
                )}
```

- [ ] **Step 4: The reader**

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
import { formatCitation } from '../../../utils/normaMeta';
```

with:

```tsx
import { formatCitation } from '../../../utils/normaMeta';
import { formatNormCitation, withCitation } from '../../../utils/citation';
import { todayInRome } from '../../../utils/dateUtils';
import { describeVersion, requestIsHistorical } from '../../../utils/versionDisplay';
import { VersionBanner } from '../search/VersionBanner';
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
import type { Annotation, ArticleData, NormaVisitata } from '../../../types';
```

with:

```tsx
import type { Annotation, ArticleData, Highlight, NormaVisitata } from '../../../types';
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
type FetchResult = { key: string; state: Exclude<FetchState, { phase: 'loading' }> };
```

with:

```tsx
type FetchResult = { key: string; state: Exclude<FetchState, { phase: 'loading' }> };

// What a past text is shown with in place of the reader's marks (stable, so the
// memoised rendering does not run again for a fresh empty array).
const NO_HIGHLIGHTS: Highlight[] = [];
const NO_ANNOTATIONS: Annotation[] = [];
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
  const isReady = state.phase === 'ready';
```

with:

```tsx
  const isReady = state.phase === 'ready';

  // A past text is a reading here too: the keys of notes and highlights carry no
  // version, so whatever was made on it would appear on the text in force.
  const article = state.phase === 'ready' ? state.article : undefined;
  const display = article ? describeVersion(article.validity, norma) : null;
  const readOnly = display?.readOnly ?? false;
  const historical = requestIsHistorical(norma);
  const citeLocked = historical && !display?.canCite;
  const citationNow = () => (display?.canCite
    ? formatNormCitation({
      norma,
      validity: article?.validity,
      requestedDate: norma.data_versione?.trim() || undefined,
      original: !norma.data_versione?.trim() && norma.versione === 'originale',
      consultedAt: todayInRome(),
    })
    : null);
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
  const markedHtml = useArticleMarkers({ rawText, highlights: articleHighlights, annotations: itemAnnotations, structure, signs: true });
```

with:

```tsx
  const shownHighlights = readOnly ? NO_HIGHLIGHTS : articleHighlights;
  const shownAnnotations = readOnly ? NO_ANNOTATIONS : itemAnnotations;
  const markedHtml = useArticleMarkers({ rawText, highlights: shownHighlights, annotations: shownAnnotations, structure, signs: !readOnly });
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
    () => groupAnnotationsByBlock(rawText, structure, articleHighlights, itemAnnotations),
    [rawText, structure, articleHighlights, itemAnnotations],
```

with:

```tsx
    () => groupAnnotationsByBlock(rawText, structure, shownHighlights, shownAnnotations),
    [rawText, structure, shownHighlights, shownAnnotations],
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
  const looseHighlights = useMemo(() => highlightsWithoutSign(articleHighlights, blockGroups), [articleHighlights, blockGroups]);
```

with:

```tsx
  const looseHighlights = useMemo(
    () => (readOnly ? NO_HIGHLIGHTS : highlightsWithoutSign(articleHighlights, blockGroups)),
    [readOnly, articleHighlights, blockGroups],
  );
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    const alreadyHighlighted
```

with:

```tsx
  const handlePopupHighlight = (text: string, color: 'yellow' | 'green' | 'red' | 'blue', startOffset: number) => {
    if (readOnly) return;
    const alreadyHighlighted
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
      await navigator.clipboard.writeText(`${text}\n\n---\nTratto da: ${formatCitation(norma)}`);
```

with:

```tsx
      await navigator.clipboard.writeText(withCitation(text, citationNow(), `\n\n---\nTratto da: ${formatCitation(norma)}`));
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
      await navigator.clipboard.writeText(formatCitation(norma));
```

with:

```tsx
      // A past text is cited as the version it is; with no honest citation, none is copied.
      const citation = citationNow();
      if (historical && !citation) return;
      await navigator.clipboard.writeText(citation ? citation.long : formatCitation(norma));
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
      <ArticleBody
        contentRef={contentRef}
        itemKey={itemKey}
        processedContent={markedHtml}
        onPopupHighlight={handlePopupHighlight}
        onPopupAddNote={(text, startOffset, rect) => {
          setComposer({ rect, anchorText: text, startOffset });
        }}
        onPopupCopy={handlePopupCopy}
        updatesOpen={updatesOpen}
      />
```

with:

```tsx
      {display?.banner && <VersionBanner banner={display.banner} variant={display.textVisible ? 'banner' : 'state'} />}
      {(display?.textVisible ?? true) && (
        <ArticleBody
          contentRef={contentRef}
          itemKey={itemKey}
          processedContent={markedHtml}
          onPopupHighlight={handlePopupHighlight}
          onPopupAddNote={(text, startOffset, rect) => {
            if (readOnly) return;
            setComposer({ rect, anchorText: text, startOffset });
          }}
          onPopupCopy={handlePopupCopy}
          updatesOpen={updatesOpen || Boolean(display?.updateNotesOpen)}
          copyOnly={readOnly}
        />
      )}
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
          onClick={handleCopyCitation}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
```

with:

```tsx
          onClick={handleCopyCitation}
          disabled={citeLocked}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
import { describeVersion, requestIsHistorical } from '../../../utils/versionDisplay';
```

with:

```tsx
import { describeVersion, historicalItemLabel, requestIsHistorical } from '../../../utils/versionDisplay';
```

In `apps/web/src/components/features/dossier/DossierItemReader.tsx`, replace:

```tsx
      {display?.banner && <VersionBanner banner={display.banner} variant={display.textVisible ? 'banner' : 'state'} />}
```

with:

```tsx
      {display?.banner && <VersionBanner banner={display.banner} variant={display.textVisible ? 'banner' : 'state'} />}
      {/* The source could not be read, so the banner has nothing to say: the day asked for is all there is. */}
      {historical && !display?.banner && (
        <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">{historicalItemLabel(norma)}</p>
      )}
```

- [ ] **Step 5: Run them to see them pass, then type-check**

Run the command of Step 2. Expected: `Test Files  6 passed (6)`, `Tests  52 passed (52)`.

Run: `npm --prefix apps/web run build`. Expected: clean.

- [ ] **Step 6: Commit (ask first)**

```bash
git add apps/web/src/components/features/dossier/ apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx
git commit -m "feat(web): the dossier keeps the version and reads a past text without marks or doctrine"
```

### Task 9: Documentation

**Files:**
- Modify: `apps/web/CLAUDE.md`, `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`

- [ ] **Step 1: The web area's `CLAUDE.md`**

The behaviour, the dossier's versions, the three utilities, and gotcha 32 ("Vigente" is never a default, and a past text is read-only).

In `apps/web/CLAUDE.md`, replace:

```markdown
never hidden or deleted. Supported on the article tab for now.
```

with:

```markdown
never hidden or deleted. Supported on the article tab for now.

**A past text is a reading** (round "Testo alla data", spec
`docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`). The server
states, next to `article_text`, the window the source's own page gives
(`ArticleData.validity`: `state`, `valid_from`, `valid_to`, …).
`utils/versionDisplay.ts` is the one table that turns it into what is shown —
the status chip (`VersionStatusChip`: "In vigore dal …", "Testo storico · dal …
al …"), the `VersionBanner`, and what is switched off — and it is tested without
a DOM. `versionInfo.isHistorical` is what was ASKED for (a date, or the original
text), never what came back. On a past text the tab, the dossier reader and
Study Mode take no notes, highlights, discussions or quick-norm (the selection
popup offers only "Copia"), Brocardi is not shown, and the update notes open;
an article that did not exist yet draws no text, only the way forward. The
"Testo alla data" dialog (`TextAtDateDialog`) replaces the old "Cerca versione"
modal; the result opens in a tab of its own, labelled with the day asked for.
`utils/citation.ts` writes how a lawyer cites it, in the owner's style ("art. 1284
c.c., nel testo in vigore al 29 dicembre 2007"; "art. 2, l. 7 agosto 1990, n. 241,
nel testo in vigore al …"; the golden file is `utils/__fixtures__/citationGolden.ts`),
and a copy of a past text starts with it.
```

In `apps/web/CLAUDE.md`, replace:

```markdown
  sub-div, never wrapping the reader or the action buttons (see gotcha 22); the
  star keeps a 44px touch target.
```

with:

```markdown
  sub-div, never wrapping the reader or the action buttons (see gotcha 22); the
  star keeps a 44px touch target.
- **Versions**: an item keeps the version it was added with (`versione`,
  `data_versione`), whichever button added it (`normaForDossier` for the window
  header's), and `dossierContainsArticle` tells two versions of one article apart,
  so both can sit in one dossier. A row shows "Testo al 29/12/2007" for a past
  text; the reader is read-only on it (gotcha 32) and reopens it without Brocardi.
```

In `apps/web/CLAUDE.md`, replace:

```markdown
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`,
  `expandTwoDigitYear` (the one two-digit-year pivot, same as the backend's
  `_expand_year`: "90" → 1990, "23" → 2023).
```

with:

```markdown
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`,
  `expandTwoDigitYear` (the one two-digit-year pivot, same as the backend's
  `_expand_year`: "90" → 1990, "23" → 2023), `formatDateDashed` ("29-12-2007",
  the way Normattiva writes a day), `formatDateForCitation` ("1° ottobre 2026"),
  `addDaysToIsoDate`, and `todayInRome` (the day the server compares a
  `version_date` with; the browser's own day can differ).
- `utils/versionDisplay.ts` — `describeVersion(validity, request)` (chip, banner,
  what is shown and what is off), `requestIsHistorical` (mirrors the server's
  `is_historical_request`), `deriveVersionInfo`, `isEuropeanAct` (mirrors
  `get_scraper_for_norma`), `buildTextAtDateParams`, `versionTabSuffix`,
  `historicalItemLabel`. Every surface that renders article text goes through
  it (gotcha 32).
- `utils/citation.ts` — `formatNormCitation` (null when there is nothing honest
  to cite) and `withCitation`; the wording is the golden file's.
```

In `apps/web/CLAUDE.md`, replace:

```markdown
  `dossierContainsArticle`, `computeNormaGroups`, `formatTimestampLong`.
```

with:

```markdown
  `dossierContainsArticle`, `normaForDossier`, `computeNormaGroups`,
  `formatTimestampLong`.
```

In `apps/web/CLAUDE.md`, replace:

```markdown
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.
```

with:

```markdown
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.

32. **"Vigente" is never a default, and a past text is read-only.** The status of
    a text comes from `ArticleData.validity` (what the source's page says) and
    from nothing else: `versionInfo` and `norma_data.data_versione` are what was
    ASKED for, an echo, and must never be shown as a fact ("Aggiornato al" once
    printed the typed date as if Normattiva had said it). With no `validity` the
    toolbar shows no status. A text the source says is past, or one asked for by
    date or as the original whose page could not be read, takes no notes,
    highlights or discussions: `buildItemKey` has no version segment, so anything
    made on it would appear on the text in force, on the wrong words. A new
    surface that renders article text passes it through `describeVersion` and
    honours `readOnly`, `doctrineVisible` and `textVisible` the way
    `ArticleTabContent` and `DossierItemReader` do; the banner and the chip sit
    beside the text, never in it (root rule 23).
```

- [ ] **Step 2: The spec records what planning checked**

In `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`, replace:

```markdown
- When the text comes from the AKN fallback (accents transliterated), nothing marks it
  (`normattiva_scraper.py:57-67`); the plan checks whether it is distinguishable.
```

with:

```markdown
- When the text comes from the AKN fallback (accents transliterated), nothing marks it
  (`normattiva_scraper.py:57-67`). Checked while planning: `get_document` returns the same
  `(text, urn)` pair whichever path produced the text, so it is not distinguishable without a
  change to the scraper, which the other developer approves.
```

- [ ] **Step 3: Commit (ask first)**

```bash
git add apps/web/CLAUDE.md docs/superpowers/specs/2026-10-01-testo-alla-data-design.md
git commit -m "docs: the text as at a date — the reading surface, the utilities, gotcha 32"
```

### Task 10: The feature, checked as a whole

What the suites cannot say: that the tour does not point at a replaced badge, how much faster a past read is, and how it looks and behaves in a real browser against the real portal.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md` (§2: the measured latency)

- [ ] **Step 1: Every suite, and the real build**

```bash
(cd services/visualex && .venv/bin/python -m pytest tests/ -q)
npm --prefix apps/web run test -- --run
npm --prefix apps/web run build
npm --prefix apps/web run lint
```

Expected: `954 passed, 12 deselected`; `Test Files  147 passed (147)`, `Tests  1700 passed (1700)`; the build and the lint clean. The frozen extractor hashes are among the 954; `articleRender.test.ts` (27 real texts, signs on) is among the 1,700.

- [ ] **Step 2: The tour and the shortcuts point at nothing the chip replaced (§7)**

```bash
grep -rniE "Cerca versione|Aggiornato al|Vigente|Storica" apps/web/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
```

Expected: one line, `config/tourConfig.ts:107`, the description of the step on `#tour-version-select` — the search form's own "Versione" select, which stays. No tour step and no entry of `KeyboardShortcutsModal` anchors on the toolbar's old badges, so `TOUR_VERSION` does not change. Any other line is a leftover string or an anchor to fix.

- [ ] **Step 3: The latency of a past read (§7)**

Start the development stack (`./start.sh`, leave it running) and, from another terminal at the repository root, time five **cold** requests for each case (a different date or article each time, so the cache never answers). The Python API listens on port 5000 in development.

```bash
t() { curl -s -o /dev/null -w '%{time_total}\n' -X POST http://localhost:5000/stream_article_text \
        -H 'Content-Type: application/json' -d "$1"; }
# the text in force, with Brocardi (the stream waits for both sources)
for a in 1284 1283 1282 1281 1280; do t '{"act_type":"codice civile","article":"'$a'","version":"vigente","show_brocardi_info":true}'; done
# the text in force, without Brocardi
for a in 1279 1278 1277 1276 1275; do t '{"act_type":"codice civile","article":"'$a'","version":"vigente","show_brocardi_info":false}'; done
# a past text, Brocardi asked for and not fetched
for d in 2007-12-29 2008-01-15 2009-02-10 2010-03-05 2011-04-20; do t '{"act_type":"codice civile","article":"1284","version":"vigente","version_date":"'$d'","show_brocardi_info":true}'; done
```

The very first request of the first row also builds the act's article tree (cached afterwards): discard it if it is far above the rest. Take the median of each row. Expected: the third is close to the second, and both well below the first. Record them in the spec: replace the sentence "Not yet measured per component; the plan measures it." of §2 with `Measured on <date> in the development stack, five cold requests each, median: the text in force with Brocardi <a> s; without it <b> s; a past text, Brocardi asked for and not fetched, <c> s.` If the third is **not** close to the second, stop: the guard is not holding on this route.

- [ ] **Step 4: The browser pass (§7)**

On `http://localhost:5173`, signed in, at desktop width unless said, check each line and note what you saw. The portal is third-party: if a page answers otherwise than the plan says, say so and do not bend the check.

| # | Do | Expect |
|---|---|---|
| 1 | Open art. 1284 c.c. at 2007-12-29 through "Testo alla data…" | A new tab labelled `codice civile — testo al 29/12/2007`. The chip reads `Testo storico · dal 25-12-2003 al 29-12-2007`; the banner names the window, says it is not the current text and that the window does not say which discipline applies. The update notes are open. No Brocardi block. Notes, highlights, discussions, quick-norm and "Studio" are disabled, each tooltip ending "Non disponibile su un testo storico". Select a sentence: the popup offers only "Copia". Copy the text: it starts with `art. 1284 c.c., nel testo in vigore dal 25 dicembre 2003 al 29 dicembre 2007 (Normattiva, testo consolidato, consultato il …)`. |
| 2 | Open art. 594 c.p. (current) | The chip reads `Abrogato dal …` and nothing anywhere says "Vigente". |
| 3 | Open art. 183-bis c.p.c. at 2010-01-01 | No article is drawn; the page says it did not exist on 1 gennaio 2010 and is in force from 13 settembre 2014; "Vai al testo del 13 settembre 2014" opens that text; copy and "Aggiungi a dossier" are disabled. |
| 4 | In the dialog, type tomorrow's date; then send `{"act_type":"legge","act_number":"241","date":"1990-08-07","article":"3","version_date":"2999-01-01"}` to `/fetch_article_text` with `curl` | The dialog shows the refusal and sends nothing; `curl` answers `400` with a message containing "futura". |
| 5 | Ask for the original text of art. 18 of L. 300/1970 | A tab `… — testo originale`; a historical chip; the same read-only behaviour. |
| 6 | In a dossier: add art. 1284 at 2007-12-29 from the toolbar, then another past article from the **window header's** button; reopen each from the dossier | Each reopens on the version it was saved with; the row says `Testo al 29/12/2007`; expanding it shows the banner and no marks. Add the current text of art. 1284 and the past one to the same dossier: both are accepted. |
| 7 | Make a highlight on the **current** text of art. 1284, then open the 2007 text, then the current one again | The highlight is on the current text and only there, on the same words as before (rule 23). |
| 8 | The same flows at 375 px | The chip, the banner and the dialog are usable; targets are at least 44 px. |
| 9 | Ask for a range at one date: article `1284-1285` at 2007-12-29 | Each article carries its own chip. |
| 10 | Review Focus 3: ask for art. 1284 c.c. at 1900-01-01 | Record what Normattiva answers. **Fail the task if the chip says "In vigore".** A not-yet state, the warning, or no chip are all acceptable. |

- [ ] **Step 5: A reviewer on the whole feature**

Dispatch the `code-reviewer` agent with the spec path and the diff of all three PRs (`git diff <the commit of develop before PR 1>..HEAD`): it re-reads the diff against the spec and the Global Constraints, read-only. Fix every finding it confirms, or say why not.

- [ ] **Step 6: Commit the measurement, then open PR 3 (ask first)**

```bash
git add docs/superpowers/specs/2026-10-01-testo-alla-data-design.md
git commit -m "docs: the measured latency of a past read"
```

### PR 3 description

> **Summary.** The dossier keeps the version from every door (the window header's "Aggiungi a dossier" used to drop it), tells two versions of one article apart, reopens a past item without doctrine, shows `Testo al …` on its row, and reads a past text without marks, as the tab does. Documentation: the behaviour, the utilities, gotcha 32.
>
> **Why.** A past text saved through the window header reopened as the text in force, and the duplicate check refused a second version. Spec: `docs/superpowers/specs/2026-10-01-testo-alla-data-design.md`.
>
> **Checked.** Python 954 passed; web 1,700 tests in 147 files; the real build and lint clean; 5 deliberate breakages of the dossier code each caught by a test. Tour and shortcuts checked for anchors the chip replaces: none. Measured latency of a past read: <a>, <b>, <c> s (spec §2). Browser pass: items 1–10 of Task 10, with what was seen.
>
> **Known gap.** The window header's "Aggiungi a dossier" also drops `allegato`; left as it is (plan, "Decisions taken while planning", item 10).

## Coverage of the spec

| Spec | Where |
|---|---|
| §1 faults: 1 (an echo shown as a fact), 2 ("Vigente" a default) | 3 (the window on the wire), 4 (`describeVersion`), 6 (the chip replaces both badges) |
| §1 fault 3 (doctrine requested for a past text; the stream waits for it) | 3 (the server never asks), 6 (not shown), 8 (a reopened item asks for none) |
| §1 fault 4 (a future date; a date the answer does not contain) | 3 (400), 5 (the dialog), 4 + 6 (`request_in_window`, the warning) |
| §1 fault 5 (annotations are version-blind) | 6 (the tab), 8 (the reader) |
| §1 fault 6 (the dossier's two gaps) | 8 |
| §2 measured | 1 (recapture), 2 (tests), 10 (latency) |
| §3 goals | 3–8 |
| T1 the window is the source's | 2, 3 |
| T2 four states and no default | 2, 4 |
| T3 a past text is a reading | 4, 6, 8 |
| T4 the server enforces, the client mirrors | 3 (server), 4–8 (client) |
| T5 the past text stays in its own tab | 7 |
| T6 no claim about the amending act | not built, by design |
| T7 the dossier tells versions apart | 8 |
| T8 one citation function, a golden file | 4 |
| T9 `article_text` untouched, no second request | 2, 3 (the cache read), 6 (rule 23 suite) |
| §5.1 server | 2, 3 |
| §5.2 client | 4–8 |
| §5.3 copy | 4 (strings), 5; decisions beyond the table are listed |
| §5.4 cost | 3 (no new route) |
| §6 security | 2 (bounded parse, validated dates, nothing injected as HTML), 3 (no new egress), constraints |
| §7 verification | 1–3 (extraction, wire, guards), 4–8 (web), 10 (tour, latency, browser) |
| §9 Massimario panel | 6 supplies the host's props (`validity`, `isHistorical`); the panel is that round's |

If the owner later changes an answer recorded in §10 of the spec, the change is local: (1) the citation wording — `citationGolden.ts` and `citation.ts`; (2) the banner text — `versionDisplay.ts` and its test; (3) update notes open — the single flag `updateNotesOpen` of `describeVersion`; (4) a separate tab — the suffix in `SearchPanel` (Task 7); (5) "Testo originale" — the checkbox of `TextAtDateDialog` and one branch of `buildTextAtDateParams`.

## Not in this plan

- The amendments of an article, the in-page switch of versions, the comparison of two versions, annotations on a past text (spec §8, v1.1–v3). The first needs a route behind the login gate and an ingress list under `infra/`: the other developer's.
- The Massimario panel itself (its own round); only the props it will read.
- Naming the act that produced a version (T6).
- Marking a text that came from the AKN fallback (the scraper's, the other developer's; checked in Task 9).
- The lawyer's wording for the text in force (decision 7), and the `allegato` the window header drops (decision 10).
- Re-using a known window for a second date (spec §5.4), and the calendar check of the Italian long date form (`31 febbraio 2019` still passes the existing parser).
