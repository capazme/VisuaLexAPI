# Norms and decisions in one search space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search space where a lawyer finds a norm or a decision from the same box, opens a decision in a tab of its own beside the article it applies, follows links both ways, annotates decisions, and finds them again in the Cronologia.

**Architecture:** The Cassazione's text is read from the court's original PDF (the archive's text field is cut short in about a third of the records), cleaned of page furniture, with a declared fallback. One new Python route (`/search_decisions`) asks Italgiure for the decisions that cite an article (through the Cassazione's index of cited norms) or mention it or a topic (in the text), politely and cached; another (`/fetch_decision_pdf`) serves the court's own PDF. On the web, a decision becomes a kind of workspace tab (`WorkspaceTab.view`), the `/sentenze/…` address opens that tab inside the search space, the article gains a «Giurisprudenza» section, and the decision's text is rendered as escaped HTML by a renderer held to the same contract as `article_text` (root rule 23), which makes notes, highlights and norm links possible. The history gains a nullable `decision_key`.

**Tech Stack:** Python 3 / Quart / aiohttp / pytest (services/visualex); React 19 / TypeScript / Zustand + Immer / Vitest / Testing Library (apps/web); Express / Prisma / PostgreSQL / Vitest (apps/server).

**Spec:** `docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md`

## Global Constraints

- UI copy in Italian; code, comments, commits and docs in English.
- Labels of decisions come only from `apps/web/src/utils/decisionLinks.ts` (spec N13); the short form is the golden file's `labels.short` (`conventions/sources/golden.json`).
- A decision's text, minus `\n`, is never changed by a reader from PR 1 on (spec N10, §8.5). Renderers wrap characters; they never add, drop or change one.
- Every scraping route goes through `legalFetch` on the client, the Vite proxy list and the ingress `@legal` path list (ADR-001, gotcha 30).
- Italgiure: the decision reader's own `decisions_http_client`, honest User-Agent, verified TLS, one Solr request per page, 24 h cache, at most 10 pages per query, nothing fetched without a user's gesture (spec §5.3).
- Text from Italgiure is never rendered as HTML on the client (spec §5.1, Security).
- An original PDF is untrusted input: at most 5 MB and 200 pages, `%PDF-` checked, parsed in a worker thread under a time limit; any failure falls back to the text field with the notice `testo_da_archivio` (spec §11, Security).
- New Python dependency: `pdfminer.six` (MIT), pinned; nothing else.
- Each row of a decision list says how it was found: «norma citata (indice della Cassazione)» or «menzionato nel testo» (spec N5). Fragments are shown as the source gives them (only `<em>` becomes ranges).
- The decision PDF has no licence line, for the Corte costituzionale too (spec §12.1).
- Topic words: letters, digits, spaces, `'` and `-` only; at most 80 characters; sent as one quoted phrase (spec §5.4).
- Prisma: one hand-written migration dated after every migration on `develop` (today the last is `20261005120000_add_trash_entries`), announced to the orchestrator before it is written; never `prisma migrate dev` or `reset`.
- `npm --prefix apps/server test` only after the orchestrator's go (shared test database).
- Branches from `origin/develop` in a worktree, one per PR; never switch branches in the main checkout. Merge commit title `merge: <branch> — <what changes>`, at green CI.
- Nothing private in the repository (no vault text, no personal paths, no infrastructure addresses).
- Shared utilities first (`apps/web/CLAUDE.md`, «Shared utilities»): `resolveAnchors`, `getSelectionAnchor`, `wrapCitationsInHtml`, `ArticleBody`, `legalFetch`, `useIsDesktop`, `readingBackStack`.

## Owner answers after the spec

The owner approved the spec on 5 October 2026 and answered its four questions: «spec ok, 39=1, 40 ok, ma abbiamo già tutti i permessi, 41 nulla, 42 sì con la cautela» (spec, «Questions for the owner — answered»). Reading 1 (Tasks 12, 13); the glossary as written (Task 17); nothing more on excerpts (Task 20); annotations on decisions travel, except those whose words are no longer in the decision's current text (Task 21, spec §8.6).

Afternoon additions (5 October): «Facciamo in modo che la ricerca delle sentenze ritorni testo pulito, e la possibilità di scaricarle in PDF»; answers «43. 1a + 1d» and «44. 2a + 2b» (spec, «Additions of 5 October»). They add Tasks 2, 3, 4 and 8 to PR 1, change Tasks 5–7 and 9, and add Task 22 to PR 4; every later task was renumbered (old 6–17 → 10–21, old 18–20 → 23–25). The Cassazione reader is the Sentenze session's area: PR 1 says so, and the orchestrator routes it to that session.

Sequencing (orchestrator, 5 October): PR 1 goes now. PR 2 onward touch the palette, `ArticleTabContent` and `SearchPanel`, which the convention's PR 1a also touches: ask the orchestrator before starting each. The test database and the PR 5 migration: ask first. The Sentenze session reviews spec §8.5 when it is back; PR 1 freezes the readers as they are on `develop`.

## Review Focus

1. **A decision whose text the source withdrew after the user annotated it** — the tab must show the notice and list every note and highlight in «Non ritrovate nel testo attuale», never an empty page. Test in Task 20.
2. **A topic typed with Solr syntax** (`ocr:*`, `kind:"snpen" OR x`, `{!lucene}`, `\`, `"`) — the route must search those words as words, or refuse, never run them. Test in Task 5.
3. **The same decision opened twice** (palette, then a chip, then a reload with the tab persisted) — one tab, focused, never two; a reload refetches by identity. Test in Task 12.
4. **A `/sentenze/…` link opened while logged out** — after the login the decision's tab opens; the address is not lost and the queue is drained once under StrictMode. Test in Task 14.
5. **A highlight dragged across two blocks or two paragraphs of a decision** — stored with the projection's offset, rendered back in both, and the HTML stays well-formed. Test in Task 18.
6. **An original PDF that is not what it should be** (an anti-bot page, a truncated file, a 5 MB file of zeros, a PDF whose text is shorter than the field's) — the decision still reads, from the text field, with the notice that says so; never an error page, never a hang. Tests in Tasks 3 and 4.

---

## PR 1 — `feat/decision-search-route` (services/visualex, infra, apps/web config)

Worktree: `git worktree add .claude/worktrees/decision-search-route -b feat/decision-search-route origin/develop`, then `cd` into it in its own command (the commit hook reads the shell's starting branch).

### Task 1: Measure how decisions write an article

A measurement, no product code. It fixes the phrasings Task 2 freezes and records the Solr answers Task 3's tests replay.

**Files:**
- Create: `services/visualex/tests/fixtures/decisions/italgiure_search_2043_cc.json`
- Create: `services/visualex/tests/fixtures/decisions/italgiure_search_topic_chance_2043.json`
- Create: `services/visualex/tests/fixtures/decisions/italgiure_search_empty.json`
- Modify: `services/visualex/tests/fixtures/decisions/README.md` (one line per new fixture: what it is, when recorded)
- Modify: this plan, section «Amendments during execution» at the end (the measured numbers)

**Interfaces:**
- Produces: the three fixtures (raw Solr JSON, `rows=3`, `fl=id,numdec,anno,datdep,szdec,tipoprov,kind`, highlighting on); the proximity value for numbered acts (default 8).

- [ ] **Step 1: Write a scratch probe outside the repository** in the session scratchpad (never under the repo). It reuses the reader's TLS context and headers, waits 2 s between requests, and makes at most 30 requests in all:

```python
# scratchpad/measure_phrases.py — run from services/visualex with its venv
import asyncio, json, sys, aiohttp
sys.path.insert(0, ".")
from visualex_api.tools.tls import italgiure_ssl_context
from visualex_api.services.decisions.http import http_headers

BASE = "https://www.italgiure.giustizia.it/sncass"
SELECT = f"{BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
QUERIES = {
    "cc_art": 'kind:"snciv" AND ocr:"art. 2043 c.c."',
    "cc_cod": 'kind:"snciv" AND ocr:"art. 2043 cod. civ."',
    "cc_del": 'kind:"snciv" AND ocr:"art. 2043 del codice civile"',
    "cpc_art": 'kind:"snciv" AND ocr:"art. 360 c.p.c."',
    "cp_art": 'kind:"snpen" AND ocr:"art. 640 c.p."',
    "cost_art": 'ocr:"art. 3 Cost."',
    "cost_della": 'ocr:"art. 3 della Costituzione"',
    "l241_prox6": 'kind:"snciv" AND ocr:"art 2 241 1990"~6',
    "l241_prox8": 'kind:"snciv" AND ocr:"art 2 241 1990"~8',
    "l241_prox12": 'kind:"snciv" AND ocr:"art 2 241 1990"~12',
    "bis": 'kind:"snciv" AND ocr:"art. 2051 bis c.c."',
}

async def main():
    ctx = italgiure_ssl_context()
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{BASE}/", ssl=ctx, headers=http_headers()) as r:
            print("home", r.status)
        for name, q in QUERIES.items():
            await asyncio.sleep(2)
            async with s.post(SELECT, ssl=ctx, data={"q": q, "rows": "0", "wt": "json"},
                              headers=http_headers({"Referer": f"{BASE}/", "X-Requested-With": "XMLHttpRequest"})) as r:
                body = json.loads(await r.text())
            print(name, body["response"]["numFound"])

asyncio.run(main())
```

- [ ] **Step 2: Run it and read ten results of each proximity value by hand.** Run with `rows=10&fl=numdec,anno` for `l241_prox6/8/12` (three more requests) and open three decisions of each in VisuaLex's own page (`/sentenze/cassazione-civile/<n>/<anno>`) to check whether they really mention art. 2 of l. 241/1990. Choose the largest proximity whose ten results are all right; default 8 if 6, 8 and 12 agree.

- [ ] **Step 3: Record the fixtures** with three requests (`rows=3`, `fl=id,numdec,anno,datdep,szdec,tipoprov,kind`, `sort=pd desc`, `hl=true`, `hl.fl=ocr`, `hl.snippets=1`, `hl.fragsize=200`, `wt=json`):
  - `italgiure_search_2043_cc.json`: `q=kind:"snciv" AND (ocr:"art. 2043 c.c." OR ocr:"art. 2043 cod. civ.")`
  - `italgiure_search_topic_chance_2043.json`: `q=kind:"snciv" AND ocr:"perdita di chance" AND ocr:"art. 2043 c.c."`
  - `italgiure_search_empty.json`: `q=kind:"snciv" AND ocr:"art. 99999 c.c."`

  Save the bodies exactly as received (`json.dumps(body, ensure_ascii=False, indent=1)`). They hold decision numbers and short fragments of public decisions, no personal data beyond what the archive publishes; check each fragment for a name of a private person and replace the record with another if one appears.

- [ ] **Step 4: Write the numbers into «Amendments during execution»** at the end of this plan: each query's count, the chosen proximity and why.

- [ ] **Step 5: Commit**

```bash
git add services/visualex/tests/fixtures/decisions/ docs/superpowers/plans/2026-10-05-norms-decisions-search.md
git commit -m "test(api): record Italgiure search answers for the decision search route"
```

### Task 2: Measure the original PDFs and the index of cited norms

A measurement, no product code. It fixes the thresholds of the PDF reader (Task 3), the fallback checks (Task 4), the index coordinates and their re-check (Task 5), and records the fixtures those tasks replay. Spec §11, §5.2.

**Files:**
- Create: `services/visualex/tests/fixtures/decisions/private/` (git-ignored: the repository is public) — four or five original PDFs (`<archive>_<numero>_<anno>.clean.pdf`) and, for each, the record as Solr gives it (`<archive>_<numero>_<anno>.json`, `fl=*`)
- Create: `services/visualex/tests/fixtures/decisions/italgiure_index_2043_cc.json` (an index query page with `rnc-*` fields)
- Modify: `services/visualex/tests/fixtures/decisions/README.md`
- Modify: this plan, «Amendments during execution»

**Interfaces:**
- Produces (in the amendment, as exact values Tasks 3–5 copy):
  - the PDF thresholds: `TOP_BAND`, `BOTTOM_BAND` (points), `INDENT` (points beyond the body's left edge), `GAP` (points between baselines that start a paragraph), the header patterns, the page-number patterns, the footer-repetition rule (on how many pages);
  - the fallback checks: the minimum ratio of the PDF text's length to the field's, and how many of the field's opening words must appear in the PDF text;
  - the index table: for c.c., c.p.c., c.p., c.p.p., Cost., preleggi, disp. att. c.c., l., d.lgs., d.l., d.P.R. — the `rnc-gen` and `rnc-sp` values, and how `rnc-art` writes an article with and without a suffix (`"2043 00"`, «-bis» → ?);
  - how `rnc-num` / `rnc-dat` align with `rnc-gen` / `rnc-art` (by position among the entries that carry a number? measured on at least 20 records);
  - the false-match rate of the two-field query per family (codes; numbered acts), measured on 100 records each;
  - whether `hl.q` gives a passage on an index query.

- [ ] **Step 1: Choose the sample.** Forty decisions: twenty civil, twenty penal, spread over 2021–2026, over sections (1–6, L, U), sentenze and ordinanze, short and long. Get them with a few Solr queries returning `fl=id,numdec,anno,kind,filename,ocr,ocrdis,rnc-gen,rnc-art,rnc-sp,rnc-num,rnc-dat` (rows up to 10 per query). Then fetch each PDF: `https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll?verbo=attach&db=<kind>&id=<filename with ".pdf" replaced by ".clean.pdf">`, in the same session as the Solr requests (GET the archive's homepage first). At least 2.5 s between requests; at most 60 requests in all. Probe script in the session scratchpad, never in the repository; PDFs downloaded to the scratchpad.

- [ ] **Step 2: Run the prototype over the forty.** The spec's §11 rules, as the controller's prototype implements them (this skeleton, with pdfminer.six installed in a scratch venv, never in the shared one):

```python
from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTTextContainer, LTTextLine

def visual_lines(path):
    out = []
    for pno, page in enumerate(extract_pages(path, laparams=LAParams())):
        rows = {}
        for el in page:
            if not isinstance(el, LTTextContainer):
                continue
            for ln in el:
                if not isinstance(ln, LTTextLine):
                    continue
                chars = [c for c in ln if isinstance(c, LTChar)]
                if not chars or not all(c.upright for c in chars):
                    continue  # the vertical «copia non ufficiale»
                rows.setdefault(round(ln.y0 / 3), []).append((ln.x0, ln.x1, ln.y0, ln.get_text().replace("\n", "")))
        for key in sorted(rows, reverse=True):
            parts = sorted(rows[key])
            text = " ".join(" ".join(p[3] for p in parts).split())
            if text:
                out.append({"page": pno, "x0": parts[0][0], "y": parts[0][2], "text": text, "height": page.height})
    return out
```

For each decision record: pages; whether the text was whole (its last paragraph against the PDF's last lines, read by hand on ten); which lines the furniture rules removed (list them all: no court text may be among them); paragraphs (read three per decision); the length of the PDF text against the field's; whether the field's first twenty words appear in order in the PDF text; anything left over (`(cid:`, letter-spaced signatures, stamps). Tune the thresholds until the forty pass; record every tuning and why.

- [ ] **Step 3: Measure the index.** With the records of Step 1 and a few `rows=0` queries (≤ 15 requests): the `rnc-gen` / `rnc-sp` values for each act family above (query a decision known to cite it, e.g. `rnc-art:"0360 00"` for c.p.c. art. 360); how «-bis» is written (`rnc-art:"2051 01"`? search a decision citing art. 2051-bis… or art. 360-bis c.p.c., which is cited often); the alignment of `rnc-num` / `rnc-dat`; the false-match rate of `rnc-gen:"CC" AND rnc-art:"2043 00"` and of a numbered act's query on 100 records each (count the records where no single aligned entry carries every coordinate); one query with `hl=true&hl.q=ocr:"art. 2043 c.c." OR ocr:"art. 2043 cod. civ."&hl.fl=ocr` to see whether index rows get a passage.

- [ ] **Step 4: Record the fixtures.** Pick four or five decisions for the PDF fixtures: both archives; one cut short in the field; one with a running footer; one whose first page has the «Oggetto» box; one short (≤ 4 pages). **Only decisions whose parties are not natural persons** (companies, public bodies) or whose text the court has anonymised — read each PDF's first page; the repository is public. Copy each PDF byte for byte and its record. Record one index page (`rows=5`, the `rnc-*` fields, `q=kind:"snciv" AND rnc-gen:"CC" AND rnc-art:"2043 00"`, `sort=pd desc`) as `italgiure_index_2043_cc.json`. README: one line per fixture (what, when recorded, why chosen).

- [ ] **Step 5: Write the amendment** with every value listed under «Produces», the forty decisions' outcome table (identity, pages, whole y/n, furniture lines removed, paragraphs, fallback check result), and the request count.

- [ ] **Step 6: Commit**

```bash
git add services/visualex/tests/fixtures/decisions/ docs/superpowers/plans/2026-10-05-norms-decisions-search.md
git commit -m "test(api): record original Cassazione PDFs and an index page; measure the PDF and index rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The Cassazione's text from its original PDF

The pure part of spec §11: bytes in, blocks out. No network.

**Files:**
- Create: `services/visualex/visualex_api/services/decisions/pdf_text.py`
- Modify: `services/visualex/requirements.txt` (`pdfminer.six==<the version Task 2 used>`)
- Test: `services/visualex/tests/test_decisions_pdf_text.py`

**Interfaces:**
- Consumes: Task 2's fixtures and values.
- Produces:
  - `class PdfRefused(ValueError)` — not a PDF, over the limits, unparsable.
  - `def text_from_pdf(data: bytes) -> dict[str, str]` — `{"motivazione": …, "dispositivo"?: …}`, paragraphs separated by `"\n\n"`; raises `PdfRefused`.
  - `MAX_BYTES = 5 * 1024 * 1024`, `MAX_PAGES = 200`.
  - `async def text_from_pdf_async(data: bytes, timeout: float = 20.0) -> dict[str, str]` — the same in a worker thread under a time limit (raises `PdfRefused` on timeout).

- [ ] **Step 1: Write the failing tests**

```python
"""The Cassazione's text from its original PDF (design 2026-10-05 §11)."""
import asyncio
import pathlib

import pytest

from visualex_api.services.decisions.pdf_text import (
    MAX_BYTES, PdfRefused, text_from_pdf, text_from_pdf_async)

PDF = pathlib.Path(__file__).parent / "fixtures" / "decisions" / "pdf"
FIXTURES = sorted(PDF.glob("*.clean.pdf"))


def _text(name: str) -> dict:
    return text_from_pdf((PDF / name).read_bytes())


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_no_page_furniture_is_left(path):
    out = text_from_pdf(path.read_bytes())
    whole = "\n".join(out.values())
    for furniture in ("copia non ufficiale", "Data pubblicazione:", "Relatore:", "(cid:", "Oggetto:"):
        assert furniture not in whole, furniture
    assert "  " not in whole.replace("\n\n", "")


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_the_text_is_whole_and_ends_in_the_dispositivo(path):
    out = text_from_pdf(path.read_bytes())
    assert out["motivazione"] and out.get("dispositivo", "").startswith("P.")
    assert "\n\n" in out["motivazione"]  # paragraphs


def test_a_line_ending_in_a_hyphen_joins_without_a_space():
    # the fixture whose text has «Emilia-Romagna» — a synthetic PDF, see tests/decisions_pdf_synth.py
    ...


def test_not_a_pdf_is_refused():
    with pytest.raises(PdfRefused):
        text_from_pdf(b"<html>Verifica di sicurezza</html>")


def test_a_pdf_over_the_size_limit_is_refused_before_parsing():
    with pytest.raises(PdfRefused):
        text_from_pdf(b"%PDF-1.4\n" + b"0" * MAX_BYTES)


def test_a_truncated_pdf_is_refused_not_crashed():
    data = FIXTURES[0].read_bytes()
    with pytest.raises(PdfRefused):
        text_from_pdf(data[: len(data) // 3])


async def test_the_async_form_runs_in_a_thread_with_a_time_limit():
    out = await text_from_pdf_async(FIXTURES[0].read_bytes())
    assert out["motivazione"]
```

Replace the `...` test with a concrete assertion on a fixture Task 2 recorded (a word joined across a line-ending hyphen, quoted from that PDF), and add one test per fixture that pins a paragraph start Task 2 read by hand (e.g. `assert "\n\nRILEVATO CHE\n\n" in out["motivazione"]` where the fixture has that heading).

- [ ] **Step 2: Run to see them fail**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_pdf_text.py -q)`
Expected: FAIL — module not found. (`pdfminer.six` must be installed in the interpreter that runs the tests: install it there with `<python> -m pip install pdfminer.six==<version>` — the shared venv is the main checkout's; installing one pinned package there is part of this task, say so in the report.)

- [ ] **Step 3: Implement** with Task 2's values in place of the defaults below:

```python
"""The Cassazione's text from the court's original PDF (design 2026-10-05 §11).

Italgiure's text field is cut short at the source in about a third of the records (measured on
2026-10-05), sometimes before the dispositivo; the court's PDF is whole. This module turns the
PDF's text layer into the blocks the page shows, dropping only page furniture: the rotated
«copia non ufficiale», the first page's header and «Oggetto» box, running headers and footers,
page numbers, unmapped glyphs. The output is frozen with every reader (design §8.5): change the
rules and every note anchored to a Cassazione text moves.
"""
from __future__ import annotations

import asyncio
import io
import re
import statistics

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTTextContainer, LTTextLine

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 200
TOP_BAND = 60      # points from the top edge (Task 2)
BOTTOM_BAND = 80   # points from the bottom edge (Task 2)
INDENT = 8         # points beyond the body's left edge that start a paragraph (Task 2)
GAP = 30           # points between two baselines that start a paragraph (Task 2)
REPEATED_ON = 2    # a band line on this many pages, digits ignored, is a running header/footer
OGGETTO_X = 0.6    # the «Oggetto» box starts beyond this share of the page width (measured x0 407 of 595)

_HEADER = re.compile(r"^(?:Civile|Penale)\b.*\bNum\.|^Presidente:|^Relatore:|^Data pubblicazione:")
_TITLE = re.compile(r"^(?:ORDINANZA|SENTENZA|DECRETO)(?:\s+INTERLOCUTORIA)?\s*$")
_PAGE_NUMBER = re.compile(r"^(?:-\s*\d{1,3}\s*-|\d{1,3}|Pag\.?\s*\d{1,3}(?:\s*(?:di|/)\s*\d{1,3})?)$", re.I)
_CID = re.compile(r"\(cid:\d+\)")
# running headers and footers whose shape is known even on a page where they appear once
# (measured on 2026-10-05: «Ric. 2021 n. 09083 sez. SU - ud. 14-12-2021», «r.g. n. 27512/2022»,
# «Cons. est. Paolo Fraulini»)
_RUNNING = re.compile(r"^(?:Ric\.\s*\d{4}\s+n\.\s*\d+\b.*\bsez\.|r\.\s?g\.\s*n\.\s*\d+/\d{4}$|Cons\.\s*est\.)", re.I)
_PQM = re.compile(r"^P\.\s?Q\.\s?M\.?$")


class PdfRefused(ValueError):
    """Not a PDF this reader will read: the caller falls back to the text field."""


def _lines(data: bytes) -> list[dict]:
    if not data.startswith(b"%PDF-"):
        raise PdfRefused("not a PDF")
    if len(data) > MAX_BYTES:
        raise PdfRefused("over the size limit")
    out: list[dict] = []
    try:
        for pno, page in enumerate(extract_pages(io.BytesIO(data), laparams=LAParams())):
            if pno >= MAX_PAGES:
                raise PdfRefused("over the page limit")
            rows: dict[int, list] = {}
            for element in page:
                if not isinstance(element, LTTextContainer):
                    continue
                for line in element:
                    if not isinstance(line, LTTextLine):
                        continue
                    chars = [c for c in line if isinstance(c, LTChar)]
                    if not chars or not all(c.upright for c in chars):
                        continue
                    rows.setdefault(round(line.y0 / 3), []).append(
                        (line.x0, line.y0, line.get_text().replace("\n", "")))
            for key in sorted(rows, reverse=True):
                parts = sorted(rows[key])
                text = " ".join(_CID.sub("", " ".join(p[2] for p in parts)).split())
                if text:
                    out.append({"page": pno, "x0": parts[0][0], "y": parts[0][1],
                                "text": text, "height": page.height, "width": page.width})
    except PdfRefused:
        raise
    except Exception as exc:  # noqa: BLE001 — untrusted input to a parser: any failure is a refusal
        # (measured: a PDF cut at a third raises pdfminer's PSEOF), and the caller falls back
        raise PdfRefused(f"unparsable: {type(exc).__name__}") from exc
    return out


def _furniture(lines: list[dict]) -> set[int]:
    drop: set[int] = set()
    in_band = [i for i, l in enumerate(lines)
               if l["y"] < BOTTOM_BAND or l["y"] > l["height"] - TOP_BAND]
    pages_of: dict[str, set[int]] = {}
    for i in in_band:
        pages_of.setdefault(re.sub(r"\d+", "#", lines[i]["text"]), set()).add(lines[i]["page"])
    for i in in_band:
        key = re.sub(r"\d+", "#", lines[i]["text"])
        if (_PAGE_NUMBER.match(lines[i]["text"]) or _RUNNING.match(lines[i]["text"])
                or len(pages_of[key]) >= REPEATED_ON):
            drop.add(i)
    title_y = next((l["y"] for l in lines if l["page"] == 0 and _TITLE.match(l["text"])), None)
    for i, l in enumerate(lines):
        if l["page"] != 0:
            continue
        if _HEADER.search(l["text"]):
            drop.add(i)
        elif title_y is not None and l["y"] > title_y + 1 and l["x0"] > l["width"] * OGGETTO_X:
            drop.add(i)  # the «Oggetto» box: right margin, above the title
    return drop


def _paragraphs(body: list[dict]) -> list[str]:
    left = statistics.mode(round(l["x0"]) for l in body)
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for i, line in enumerate(body):
        previous = body[i - 1] if i else None
        starts = (line["x0"] > left + INDENT
                  or (previous is not None and previous["page"] == line["page"]
                      and previous["y"] - line["y"] > GAP))
        if current and starts:
            paragraphs.append(current)
            current = []
        current.append(line["text"])
    if current:
        paragraphs.append(current)

    def join(lines: list[str]) -> str:
        text = lines[0]
        for nxt in lines[1:]:
            text = text + nxt if text.endswith("-") else f"{text} {nxt}"
        return text

    return [join(p) for p in paragraphs]


def text_from_pdf(data: bytes) -> dict[str, str]:
    lines = _lines(data)
    drop = _furniture(lines)
    body = [l for i, l in enumerate(lines) if i not in drop]
    if not body:
        raise PdfRefused("no text layer")
    paragraphs = _paragraphs(body)
    pqm = max((i for i, p in enumerate(paragraphs) if _PQM.match(p) or p.startswith("P.Q.M.")), default=None)
    if pqm is None or pqm == 0:
        return {"motivazione": "\n\n".join(paragraphs)}
    return {"motivazione": "\n\n".join(paragraphs[:pqm]), "dispositivo": "\n\n".join(paragraphs[pqm:])}


async def text_from_pdf_async(data: bytes, timeout: float = 20.0) -> dict[str, str]:
    try:
        return await asyncio.wait_for(asyncio.to_thread(text_from_pdf, data), timeout)
    except asyncio.TimeoutError as exc:
        raise PdfRefused("parsing took too long") from exc
```

The «Oggetto» box measured at x0 ≈ 407 on an A4 page of width 595, body lines at 85–103, and «- ricorrente -» at 424 *below* the title, which the `y > title_y` condition keeps. One detail to settle with Task 2's numbers, not by guesswork: whether a centred heading needs its own rule (a centred line has a large `x0`, so `INDENT` already starts a paragraph at it — and the next, left-aligned line, must start one too: add `or (previous is not None and previous["x0"] > left + INDENT and line["x0"] <= left + INDENT and previous_was_short)` only if Task 2 found headings glued to the next paragraph, with a test).

- [ ] **Step 4: Run the tests**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_pdf_text.py -q)`
Expected: pass. Then the hostile shapes, by hand, timed: a 5 MB file of `%PDF-` + zeros (refused fast), a PDF with 201 blank pages (generate it in the scratchpad with any tool; refused), a fixture cut at a third (refused). Each under one second; write the timings in the report.

- [ ] **Step 5: Commit**

```bash
git add services/visualex/visualex_api/services/decisions/pdf_text.py services/visualex/tests/test_decisions_pdf_text.py services/visualex/requirements.txt
git commit -m "feat(api): read a Cassazione decision's text from its original PDF, page furniture removed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The reader reads the PDF, and says when it could not

> **Amended 5 October (the Sentenze session's review; privacy).** The repository is public: fixtures hold only courts, magistrates, institutions and provisions, never a party's or a lawyer's name. Real PDFs and records live only in the git-ignored `services/visualex/tests/fixtures/decisions/private/` (see its README section); tests that need them go in a `*_local.py` module skipped when that folder is absent (as `test_decisions_pdf_text_local.py` does). CI tests use synthetic PDFs from `services/visualex/tests/decisions_pdf_synth.py` (`make_pdf`, `Text`) and synthetic Solr records. Wherever this task says `FIX / "pdf" / "<fixture>…"`, read: a synthetic record and PDF in CI, the private ones in the local module.
> Also amended: a decision read from the text field (`testo_origine == "archivio"`) is cached like a pending one — the resolver's `decisions_pending` namespace, 24 hours — never in `decisions_found` (30 days), so it is read again from its PDF soon; test it. The notice copy is the one below.

**Files:**
- Modify: `services/visualex/visualex_api/services/decisions/italgiure.py` (`FIELDS` gains `filename`; `lookup` fetches the PDF; `pdf_url`)
- Modify: `services/visualex/visualex_api/services/decisions/model.py` (`Decision.testo_origine`: `"pdf"` | `"archivio"` | None, in `_ATTRIBUTES`)
- Modify: `services/visualex/visualex_api/services/decisions/resolver.py` (the notice `testo_da_archivio`; key `italgiure:v3:`; the PDF bytes cached under `decisions_pdf`)
- Modify: `services/visualex/visualex_api/tools/cache_manager.py` (`"decisions_pdf"`, 30 days)
- Modify: `apps/web/src/types/decisions.ts` (`DecisionNotice` gains `{ tipo: 'testo_da_archivio' }`; `DecisionAttributes.testo_origine?`)
- Modify: `apps/web/src/utils/decisionLinks.ts` (`describeNotice` for it)
- Test: `services/visualex/tests/test_decisions_italgiure.py` (add), `test_decisions_resolver.py` (add), `apps/web/src/utils/__tests__/decisionLinks.test.ts` (add; find the existing file name first)

**Interfaces:**
- Consumes: Task 3 (`text_from_pdf_async`, `PdfRefused`); Task 2's fallback-check values.
- Produces:
  - `def pdf_url(doc: dict) -> str | None` — the `.clean.pdf` address of a record, or None.
  - `ItalgiureReader.lookup(...)` returns a `Decision` whose `testo` comes from the PDF (`testo_origine="pdf"`) or from the field (`"archivio"`); the PDF's bytes are available to the resolver as `ItalgiureReader.last_pdf(identity) -> bytes | None` **or**, simpler and stateless, `lookup` returns `(Decision, bytes | None)` through a new method `lookup_with_pdf` that `lookup` wraps. Use the second form.
  - Notice `{"tipo": "testo_da_archivio"}` when `testo_origine == "archivio"` and there is a text.
  - Web copy: «Testo dell'archivio della Cassazione, provvisorio: potrebbe essere incompleto, e le note potrebbero non ritrovarsi nel testo completo.»

- [ ] **Step 1: Failing tests (API).**

```python
async def test_the_text_comes_from_the_pdf_when_there_is_one(monkeypatch):
    record = json.loads((FIX / "pdf" / "<fixture>.json").read_text())   # Task 2's record, fl=*
    pdf = (FIX / "pdf" / "<fixture>.clean.pdf").read_bytes()
    calls = _serve_with_pdf(monkeypatch, solr=[json.dumps({"response": {"numFound": 1, "docs": [record]}})], pdf=pdf)
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", int(record["numdec"]), int(record["anno"]))
    assert decision.testo_origine == "pdf" and data == pdf
    assert decision.testo["motivazione"] == text_from_pdf(pdf)["motivazione"]
    assert calls[-1][1].endswith(".clean.pdf") and "verbo=attach" in calls[-1][1]


@pytest.mark.parametrize("pdf_answer", ["refused", "error", "missing_filename", "too_short"])
async def test_without_a_usable_pdf_the_field_is_used_and_said(monkeypatch, pdf_answer):
    # refused: the PDF bytes are «<html>…»; error: the PDF request raises NetworkError;
    # missing_filename: the record has no `filename` (no PDF request at all);
    # too_short: a PDF whose text is shorter than the field's by more than Task 2's ratio
    ...
    assert decision.testo_origine == "archivio" and decision.testo["motivazione"]


async def test_a_withheld_text_fetches_no_pdf(monkeypatch):
    calls = _serve_with_pdf(monkeypatch, solr=[_fixture("italgiure_snciv_10787_2024.json")], pdf=b"")
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 10787, 2024)
    assert decision.testo == {} and data is None
    assert not any("verbo=attach" in c[1] for c in calls)
```

Write `_serve_with_pdf` beside `_serve`: Solr POSTs answer from `solr`, a GET whose URL contains `verbo=attach` answers `HttpResult(text=pdf.decode("latin-1"), status=200, headers={"Content-Type": "application/pdf"})`, the homepage GET answers empty. Fill the four parametrised cases concretely. Resolver: a found decision from the field carries `avvisi == [{"tipo": "testo_da_archivio"}]`; one from the PDF carries none; the PDF bytes are stored under `decisions_pdf` keyed by the decision key; the text under `italgiure:v3:…`.

Web: `describeNotice({ tipo: 'testo_da_archivio' })` returns the copy above.

- [ ] **Step 2: Run to see them fail.** `(cd services/visualex && <python> -m pytest tests/test_decisions_italgiure.py tests/test_decisions_resolver.py -q)` and `npm --prefix apps/web run test -- --run src/utils/__tests__/` → FAIL.

- [ ] **Step 3: Implement.**

```python
FIELDS = "id,numdec,anno,datdep,szdec,materia,tipoprov,ocr,ocrdis,relatore,presidente,kind,filename"
ATTACH = "https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll"


def pdf_url(doc: dict) -> str | None:
    """The court's PDF of a record, in the form the archive serves within its session (the plain
    `.pdf` name answers 500, measured on 2026-10-05)."""
    name = _scalar(doc.get("filename")).strip()
    kind = _scalar(doc.get("kind")).strip()
    if not re.fullmatch(r"\./\d{8}/sn(?:civ|pen)@[\w@]+\.pdf", name) or kind not in KINDS.values():
        return None
    return f"{ATTACH}?verbo=attach&db={kind}&id={name[:-4]}.clean.pdf"
```

`lookup_with_pdf(archivio, numero, anno) -> tuple[Decision, bytes | None] | None`: the Solr query as `lookup` today; `decision = to_decision(doc, archivio)`; if `decision.testo` is empty (withheld or no text) return `(decision, None)`; else `url = pdf_url(doc)`; if url: `result = await decisions_http_client.request("GET", url, source="italgiure", ssl=ctx, headers=http_headers({"Referer": f"{BASE}/"}), text_encoding="latin-1")`, `data = result.text.encode("latin-1")`, `testo = await text_from_pdf_async(data)`; accept it only if it passes Task 2's checks against the field's text (`_plausible(testo, decision.testo)`: length ratio and the field's first words in order); then `decision.testo, decision.testo_origine = testo, "pdf"` and return `(decision, data)`. On `PdfRefused`, a network error on the PDF request, or a failed check: log a warning with the identity and the reason, set `testo_origine = "archivio"`, return `(decision, None)`. `lookup` returns `(await self.lookup_with_pdf(...))[0]` (or None). The request counts against the owner's ten per search: a cold lookup is homepage + Solr + PDF.

In the resolver, `_cass` calls `lookup_with_pdf`, stores the decision as today under `italgiure:v3:{archivio}:{numero}:{anno}` and, when bytes came back, `await self.pdfs.set(decision.identita.key(), base64.b64encode(data).decode())` (`self.pdfs = manager.get_persistent(PDF_NS)`, `PDF_NS = "decisions_pdf"`, in the sweep list). Update the comment above the key: v3 since the text comes from the original PDF (2026-10-05); the v2 entries hold the field's text and are not served again. `_withheld` becomes `_text_notices(decision)`: `[{"tipo": "testo_non_disponibile"}]` without a text, `[{"tipo": "testo_da_archivio"}]` with a text from the field, `[]` otherwise.

`describeNotice` gains the case (the `never` check forces it). Add `testo_origine` to `DecisionAttributes` (`'pdf' | 'archivio'`).

- [ ] **Step 4: Run the decision tests, the whole Python suite, and the web unit tests touched.** Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add services/visualex apps/web/src/types/decisions.ts apps/web/src/utils/decisionLinks.ts apps/web/src/utils/__tests__/
git commit -m "feat(api): a Cassazione decision reads from the court's PDF, and says when only the archive's text was had" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: How an article and a topic become a Solr query — by the index and in the text

**Files:**
- Create: `services/visualex/visualex_api/services/decisions/search.py`
- Test: `services/visualex/tests/test_decisions_search_query.py`

**Interfaces:**
- Consumes: Task 1's proximity (6) and Task 2's index table (amendment).
- Produces:
  - `class UnsupportedAct(ValueError)`
  - `def article_clause(norma: dict) -> tuple[str, str | None]` — the Solr clause for the article and the default archive (`"civile"`, `"penale"` or `None`); raises `UnsupportedAct`.
  - `def topic_clause(raw: str) -> str` — `ocr:"<words>"`; raises `ValueError` when nothing is left.
  - `def build_query(article: str | None, topic: str | None, archivio: str | None) -> str`
  - `PROXIMITY: int` (6, Task 1's measurement)

- [ ] **Step 1: Write the failing tests**

```python
"""How an article and a topic become one Solr query (design 2026-10-05 §5.2, §5.4)."""
import pytest

from visualex_api.services.decisions.search import (
    PROXIMITY, UnsupportedAct, article_clause, build_query, topic_clause)


def test_a_civil_code_article_is_phrased_every_way_and_searched_in_civil():
    clause, archivio = article_clause({"tipo_atto": "codice civile", "numero_articolo": "2043"})
    assert archivio == "civile"
    for phrase in ('"art. 2043 c.c."', '"art. 2043 cod. civ."', '"articolo 2043 c.c."',
                   '"art. 2043 del codice civile"', '"articolo 2043 del codice civile"'):
        assert f"ocr:{phrase}" in clause
    assert 'ocr:"art. 2043"' not in clause  # the bare form catches other acts


def test_the_penal_code_is_searched_in_penal():
    _, archivio = article_clause({"tipo_atto": "codice penale", "numero_articolo": "640"})
    assert archivio == "penale"


def test_the_constitution_is_searched_in_both():
    clause, archivio = article_clause({"tipo_atto": "costituzione", "numero_articolo": "3"})
    assert archivio is None and 'ocr:"art. 3 Cost."' in clause
    assert 'ocr:"art. 3 della Costituzione"' in clause


def test_an_ordinal_is_written_spaced():
    clause, _ = article_clause({"tipo_atto": "codice civile", "numero_articolo": "2051-bis"})
    assert 'ocr:"art. 2051 bis c.c."' in clause


def test_a_numbered_act_is_a_proximity_phrase():
    clause, archivio = article_clause({"tipo_atto": "legge", "numero_atto": "241",
                                       "data": "1990-08-07", "numero_articolo": "2"})
    assert clause == f'ocr:"art 2 241 1990"~{PROXIMITY}' and archivio is None


@pytest.mark.parametrize("norma", [
    {"tipo_atto": "regolamento ue", "numero_atto": "679", "data": "2016-04-27", "numero_articolo": "5"},
    {"tipo_atto": "legge", "numero_articolo": "2"},                      # no number
    {"tipo_atto": "codice civile"},                                       # no article
    {"tipo_atto": "codice civile", "numero_articolo": "2043; DROP"},     # not an article
])
def test_what_cannot_be_phrased_is_unsupported(norma):
    with pytest.raises(UnsupportedAct):
        article_clause(norma)


@pytest.mark.parametrize("raw, words", [
    ("perdita di chance", "perdita di chance"),
    ("  danno   ingiusto ", "danno ingiusto"),
    ("dell'avvocato", "dell'avvocato"),
    ("ocr:* OR kind:\"snpen\"", "ocr OR kind snpen"),
    ('{!lucene}x \\ "y"', "lucene x y"),
])
def test_a_topic_keeps_only_words(raw, words):
    assert topic_clause(raw) == f'ocr:"{words}"'


def test_a_topic_is_capped_at_80_characters():
    assert len(topic_clause("a" * 200)) == len('ocr:""') + 80


@pytest.mark.parametrize("raw", ["", "   ", "*:*", "{}[]"])
def test_a_topic_with_no_words_is_refused(raw):
    with pytest.raises(ValueError):
        topic_clause(raw)


def test_the_query_joins_what_it_has_and_filters_the_archive():
    assert build_query('ocr:"a"', 'ocr:"b"', "civile") == 'kind:"snciv" AND (ocr:"a") AND (ocr:"b")'
    assert build_query(None, 'ocr:"b"', None) == '(ocr:"b")'
    with pytest.raises(ValueError):
        build_query(None, None, None)
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd services/visualex && .venv/bin/python -m pytest tests/test_decisions_search_query.py -q)` — in a worktree with no venv, use the main checkout's interpreter, `"$(dirname "$(git rev-parse --git-common-dir)")/services/visualex/.venv/bin/python"` (written `<python>` in the rest of this plan).
Expected: FAIL — `ModuleNotFoundError: visualex_api.services.decisions.search`.

- [ ] **Step 3: Implement**

```python
"""How an article and a topic become one Solr query on Italgiure (design 2026-10-05 §5.2, §5.4).

The article is matched against the ways lawyers write it, never the bare «art. N», which also
catches every other act's article N (measured on 2026-10-05: 1,588 civil decisions for
"art. 2043" against 939 for "art. 2043 c.c."). A topic is user input: only words reach Solr,
as one quoted phrase, so no field, operator or local parameter can.
"""
from __future__ import annotations

import re

#: Solr proximity for an article of a numbered act: «art. 2 … l. … 241 … 1990» within this many
#: positions (measured by plan Task 1, 2026-10-05: 8 and 12 already let art. 21-octies in).
PROXIMITY = 6

KINDS = {"civile": "snciv", "penale": "snpen"}

# tipo_atto as norma_data writes it -> (abbreviations, spelled-out name or None, default archive)
_CODES: dict[str, tuple[tuple[str, ...], str | None, str | None]] = {
    "codice civile": (("c.c.", "cod. civ."), "codice civile", "civile"),
    "codice di procedura civile": (("c.p.c.", "cod. proc. civ."), "codice di procedura civile", "civile"),
    "codice penale": (("c.p.", "cod. pen."), "codice penale", "penale"),
    "codice di procedura penale": (("c.p.p.", "cod. proc. pen."), "codice di procedura penale", "penale"),
    "costituzione": (("Cost.",), "Costituzione", None),
    "preleggi": (("preleggi", "disp. prel."), None, None),
}
_ARTICLE = re.compile(r"^\d{1,5}(?:[- ][a-z]{2,15})?(?:\.\d{1,2})?$")
_TOPIC_KEEP = re.compile(r"[^\w' -]", re.UNICODE)
_TOPIC_MAX = 80


class UnsupportedAct(ValueError):
    """An act this search cannot phrase: the route answers `non_supportata`."""


def _article_number(raw: object) -> str:
    text = str(raw or "").strip().lower()
    if not _ARTICLE.match(text):
        raise UnsupportedAct(f"article {raw!r}")
    return text.replace("-", " ")


def _year(data: object) -> str | None:
    match = re.match(r"^(\d{4})", str(data or ""))
    return match.group(1) if match else None


def article_clause(norma: dict) -> tuple[str, str | None]:
    tipo = str(norma.get("tipo_atto") or "").strip().lower()
    numero = _article_number(norma.get("numero_articolo"))
    if tipo in _CODES:
        abbreviations, name, archivio = _CODES[tipo]
        phrases = [f"art. {numero} {a}" for a in abbreviations]
        phrases += [f"articolo {numero} {abbreviations[0]}"]
        if name:
            phrases += [f"art. {numero} del{'la' if name == 'Costituzione' else ''} {name}",
                        f"articolo {numero} del{'la' if name == 'Costituzione' else ''} {name}"]
        return " OR ".join(f'ocr:"{p}"' for p in phrases), archivio
    act_number = str(norma.get("numero_atto") or "").strip()
    year = _year(norma.get("data"))
    if tipo in ("legge", "decreto legislativo", "decreto-legge", "decreto legge",
                "decreto del presidente della repubblica") and act_number.isdigit() and year:
        return f'ocr:"art {numero} {act_number} {year}"~{PROXIMITY}', None
    raise UnsupportedAct(tipo or "no act type")


def topic_clause(raw: str) -> str:
    words = " ".join(_TOPIC_KEEP.sub(" ", raw or "").replace("_", " ").split())
    words = words[:_TOPIC_MAX].strip()
    if not any(ch.isalnum() for ch in words):
        raise ValueError("no words in the topic")
    return f'ocr:"{words}"'


def build_query(article: str | None, topic: str | None, archivio: str | None) -> str:
    parts = [f"({c})" for c in (article, topic) if c]
    if not parts:
        raise ValueError("an article or a topic is needed")
    if archivio:
        parts.insert(0, f'kind:"{KINDS[archivio]}"')
    return " AND ".join(parts)
```

The Costituzione phrase reads «art. 3 della Costituzione»; the codes «art. 2043 del codice civile». The numbered-act act types must match how `norma_data.tipo_atto` spells them: grep `services/visualex/visualex_api/tools/map.py` for the canonical names before running, and adjust the tuple to those exact strings.

- [ ] **Step 4: Run the tests to see them pass**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_search_query.py -q)`
Expected: all pass. If `test_a_topic_keeps_only_words` fails on `ocr:* OR kind:"snpen"`: the expected words are the input with every non-word character turned into a space and spaces collapsed; fix the regex, not the test.

- [ ] **Step 5: The index of cited norms (spec §5.2, N15).** Add to the same module, with tests first:

```python
@dataclass(frozen=True)
class IndexCoordinates:
    """One citation as the Cassazione's index writes it (`rnc-*` fields, measured by plan Task 2)."""
    gen: str               # code family: "CC", "PC", "LS" …
    art: str               # article as "2043 00": four digits, a space, the suffix code
    sp: str | None = None  # act type of a numbered act: "DLG", "DPR" …
    num: str | None = None # its number, four digits
    dat: str | None = None # its year
    # Amended 7 Oct: only `gen` and `art` exist; the index serves codes and the Constitution.


def index_clause(norma: dict) -> tuple[str, str | None, IndexCoordinates]:
    """The index query for an article, its default archive, and the coordinates the server
    re-checks on each record. UnsupportedAct for an act or a suffix Task 2 did not establish:
    the route then searches the text."""


def cites(doc: dict, c: IndexCoordinates) -> bool:
    """Whether one citation of the record carries every coordinate. The index's fields are
    parallel lists, so `rnc-gen:"CC" AND rnc-art:"2043 00"` can match a record citing art. 2043
    of another act and something else of the code."""
```

The table `_INDEX_CODES: dict[str, tuple[str, str | None]]` (tipo_atto → (`gen`, default archive)) and `_INDEX_ACTS: dict[str, str]` (tipo_atto of a numbered act → `sp`) hold exactly the values Task 2's amendment lists; measured already on 2026-10-05: `CC` for the codice civile (`rnc-art "1227 00"`), `PC` for the codice di procedura civile (`"0360 00"`), `LS` for numbered acts with `sp` `DLG` and `DPR` (d.lgs. 58/1998 and d.P.R. 115/2002 in one record). An act missing from the tables raises `UnsupportedAct`. The article: `f"{int(base):04d} {suffix_code}"` with `"00"` for no suffix and Task 2's codes for «-bis» and the others; a suffix Task 2 did not establish raises `UnsupportedAct`. The query: `rnc-gen:"<gen>" AND rnc-art:"<art>"`, plus `AND rnc-sp:"<sp>" AND rnc-num:"<num>" AND rnc-dat:"<dat>"` for a numbered act. `cites`: true when some position `i` has `rnc-gen[i] == gen and rnc-art[i] == art`, and for a numbered act the number and year aligned with `i` as Task 2 measured (write that alignment exactly as the amendment states it, with a comment quoting the measurement).

Tests: `index_clause({"tipo_atto": "codice civile", "numero_articolo": "2043"})` → `('rnc-gen:"CC" AND rnc-art:"2043 00"', "civile", IndexCoordinates("CC", "2043 00"))`; a numbered act's clause; an act not in the tables and an unestablished suffix → `UnsupportedAct`; `cites` true on the fixture `italgiure_index_2043_cc.json`'s records that cite it, false on a hand-made record `{"rnc-gen": ["CC", "LS"], "rnc-art": ["1227 00", "2043 00"], "rnc-sp": ["COD", "DLG"]}` (art. 2043 of a law, not of the code).

- [ ] **Step 6: Run the tests.** `(cd services/visualex && <python> -m pytest tests/test_decisions_search_query.py -q)` → pass.

- [ ] **Step 7: Commit**

```bash
git add services/visualex/visualex_api/services/decisions/search.py services/visualex/tests/test_decisions_search_query.py
git commit -m "feat(api): phrase an article for the Cassazione's index and for the text, and a topic as words only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The reader searches, once per session, re-checks index matches, and returns fragments as ranges

**Files:**
- Modify: `services/visualex/visualex_api/services/decisions/italgiure.py`
- Test: `services/visualex/tests/test_decisions_italgiure_search.py`

**Interfaces:**
- Consumes: Task 1's and Task 2's fixtures; `KINDS`, `IndexCoordinates`, `cites` from `search.py` (Task 5).
- Produces:
  - `@dataclass(frozen=True) class SearchHit: identita: Identity; attributi: dict; frammento: dict` (`{"testo": str, "evidenziati": list[list[int]]}`)
  - `@dataclass(frozen=True) class SearchPage: totale: int; decisioni: list[SearchHit]`
  - `async def ItalgiureReader.search(self, q: str, pagina: int, rows: int = 20, *, coords: IndexCoordinates | None = None, hl_query: str | None = None) -> SearchPage` — with `coords`, the page asks for the `rnc-*` fields and keeps only the records `cites(doc, coords)` accepts; `hl_query` is sent as `hl.q` (the text phrasing, so an index row can carry a passage); each `SearchHit` has `trovata: "indice" | "testo"`
  - `def fragment_ranges(snippet: str) -> dict`
  - The homepage GET runs once per reader instance and again only after a non-Solr answer.
  - *Amended 7 Oct:* no homepage request in the normal path (the first select sets the session cookie); one lock-guarded reopen of the session on an anti-bot answer. `coords` is `IndexCoordinates(gen, art)` only.

- [ ] **Step 1: Write the failing tests**

```python
"""Italgiure's search for the decision search route (design 2026-10-05 §5)."""
import json
import pathlib

import pytest

from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import ItalgiureReader, SourceAnswerError, fragment_ranges
from visualex_api.services.http_client import HttpResult

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"


def _serve(monkeypatch, answers):
    calls, bodies = [], iter(answers)

    async def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "GET":
            return HttpResult(text="", status=200, headers={})
        return HttpResult(text=next(bodies), status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    return calls


async def test_a_page_of_results_carries_identity_attributes_and_fragment(monkeypatch):
    _serve(monkeypatch, [(FIX / "italgiure_search_2043_cc.json").read_text()])
    page = await ItalgiureReader().search('kind:"snciv" AND (ocr:"art. 2043 c.c.")', pagina=1)
    assert page.totale > 3 and len(page.decisioni) == 3
    hit = page.decisioni[0]
    assert hit.identita.corte == "cassazione" and hit.identita.archivio == "civile"
    assert hit.attributi.get("data_deposito")
    assert "<" not in hit.frammento["testo"]
    assert hit.frammento["evidenziati"]


async def test_the_request_is_sorted_paged_and_highlighted(monkeypatch):
    calls = _serve(monkeypatch, [(FIX / "italgiure_search_empty.json").read_text()])
    await ItalgiureReader().search('kind:"snciv" AND (ocr:"x")', pagina=3)
    data = calls[-1][2]["data"]
    assert data["sort"] == "pd desc" and data["start"] == "40" and data["rows"] == "20"
    assert data["hl"] == "true" and data["hl.fl"] == "ocr"
    assert "ocr" not in data["fl"].split(",")  # never the whole text in a list


async def test_an_index_page_keeps_only_records_that_cite_the_article(monkeypatch):
    calls = _serve(monkeypatch, [(FIX / "italgiure_index_2043_cc.json").read_text()])
    coords = IndexCoordinates("CC", "2043 00")
    page = await ItalgiureReader().search('kind:"snciv" AND (rnc-gen:"CC" AND rnc-art:"2043 00")', pagina=1,
                                          coords=coords, hl_query='ocr:"art. 2043 c.c."')
    data = calls[-1][2]["data"]
    assert "rnc-art" in data["fl"] and data["hl.q"] == 'ocr:"art. 2043 c.c."'
    assert page.decisioni and all(h.trovata == "indice" for h in page.decisioni)


async def test_a_record_matching_two_different_citations_is_dropped(monkeypatch):
    doc = {"id": "x", "numdec": "1", "anno": "2025", "kind": "snciv", "datdep": ["20250101"],
           "rnc-gen": ["CC", "LS"], "rnc-art": ["1227 00", "2043 00"], "rnc-sp": ["COD", "DLG"]}
    _serve(monkeypatch, [json.dumps({"response": {"numFound": 1, "docs": [doc]}})])
    page = await ItalgiureReader().search("q", pagina=1, coords=IndexCoordinates("CC", "2043 00"))
    assert page.decisioni == [] and page.totale == 1


async def test_the_homepage_is_fetched_once_per_reader(monkeypatch):
    empty = (FIX / "italgiure_search_empty.json").read_text()
    calls = _serve(monkeypatch, [empty, empty])
    reader = ItalgiureReader()
    await reader.search('(ocr:"x")', pagina=1)
    await reader.search('(ocr:"y")', pagina=1)
    assert [c[0] for c in calls] == ["GET", "POST", "POST"]


async def test_a_non_solr_answer_reopens_the_session(monkeypatch):
    empty = (FIX / "italgiure_search_empty.json").read_text()
    calls = _serve(monkeypatch, ["<html>Verifica</html>", empty])
    reader = ItalgiureReader()
    with pytest.raises(SourceAnswerError):
        await reader.search('(ocr:"x")', pagina=1)
    await reader.search('(ocr:"x")', pagina=1)
    assert [c[0] for c in calls] == ["GET", "POST", "GET", "POST"]


def test_fragment_markers_become_ranges_and_the_text_stays_plain():
    out = fragment_ranges('danno ex <em>art</em>. <em>2043</em> c.c. & <b>x</b>')
    assert out["testo"] == "danno ex art. 2043 c.c. & <b>x</b>"
    assert out["evidenziati"] == [[9, 12], [14, 18]]
```

Note on the last test: only `<em>`/`</em>` are markers; any other markup the source might send stays as literal characters in `testo` (the client renders text, so it is harmless and visible).

- [ ] **Step 2: Run to see them fail**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_italgiure_search.py -q)`
Expected: FAIL — `ImportError: cannot import name 'fragment_ranges'`.

- [ ] **Step 3: Implement** in `italgiure.py`:

```python
from dataclasses import dataclass

SEARCH_FIELDS = "id,numdec,anno,datdep,szdec,tipoprov,kind"
_KIND_ARCHIVE = {"snciv": "civile", "snpen": "penale"}
_EM_SPLIT = re.compile(r"(</?em>)")


@dataclass(frozen=True)
class SearchHit:
    identita: Identity
    attributi: dict
    trovata: str          # "indice" | "testo" (design N5)
    frammento: dict | None


@dataclass(frozen=True)
class SearchPage:
    totale: int
    decisioni: list[SearchHit]


def fragment_ranges(snippet: str) -> dict:
    """Solr's highlighted fragment as plain text and the ranges to emphasise: the client never
    receives markup from the source (design 2026-10-05 §5.1)."""
    text, ranges, start, pos = [], [], None, 0
    for piece in _EM_SPLIT.split(snippet):
        if piece == "<em>":
            start = pos
        elif piece == "</em>":
            if start is not None:
                ranges.append([start, pos])
            start = None
        else:
            text.append(piece)
            pos += len(piece)
    return {"testo": "".join(text), "evidenziati": ranges}
```

In `ItalgiureReader`, add a session flag and the search:

```python
class ItalgiureReader:
    def __init__(self) -> None:
        self._session_open = False

    async def _open_session(self, ctx) -> None:
        # The endpoint refuses a cold session: the homepage sets the cookie the client keeps.
        await decisions_http_client.request("GET", f"{BASE}/", source="italgiure", ssl=ctx,
                                            headers=http_headers())
        self._session_open = True

    async def _select(self, params: dict[str, str]) -> dict:
        ctx = italgiure_ssl_context()
        if not self._session_open:
            await self._open_session(ctx)
        result = await decisions_http_client.request(
            "POST", SELECT, source="italgiure", ssl=ctx, data={**params, "wt": "json"},
            headers=http_headers({"Referer": f"{BASE}/", "X-Requested-With": "XMLHttpRequest"}))
        try:
            data = json.loads(result.text)
        except json.JSONDecodeError as exc:
            self._session_open = False  # an anti-bot page: the next call starts a new session
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati") from exc
        response = data.get("response") if isinstance(data, dict) else None
        docs = response.get("docs") if isinstance(response, dict) else None
        if not isinstance(docs, list) or not all(isinstance(doc, dict) for doc in docs):
            self._session_open = False
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati")
        return data

    async def search(self, q: str, pagina: int, rows: int = 20, *,
                     coords: IndexCoordinates | None = None, hl_query: str | None = None) -> SearchPage:
        params = {
            "q": q, "rows": str(rows), "start": str((pagina - 1) * rows),
            "fl": SEARCH_FIELDS + (",rnc-gen,rnc-art,rnc-sp,rnc-num,rnc-dat" if coords else ""),
            "sort": "pd desc", "hl": "true", "hl.fl": "ocr", "hl.snippets": "1",
            "hl.fragsize": "200"}
        if hl_query:
            params["hl.q"] = hl_query
        data = await self._select(params)
        highlights = data.get("highlighting") or {}
        hits = []
        for doc in data["response"]["docs"]:
            archivio = _KIND_ARCHIVE.get(_scalar(doc.get("kind")))
            if archivio is None:
                continue
            try:
                summary = to_decision({**doc, "ocr": "", "ocrdis": ""}, archivio)
            except ValueError:
                continue  # a record without a readable number or year is skipped, as a lookup refuses it
            if coords is not None and not cites(doc, coords):
                continue  # matched two different citations of the record (design §5.2)
            snippet = (highlights.get(_scalar(doc.get("id"))) or {}).get("ocr")
            hits.append(SearchHit(summary.identita, summary.attributes_dict(),
                                  "indice" if coords else "testo",
                                  fragment_ranges(snippet[0]) if snippet else None))
        return SearchPage(int(data["response"].get("numFound") or 0), hits)
```

Before writing `summary.attributes_dict()`, read `model.py`'s `Decision.to_dict()` and use the part of it that writes `attributi` (extract a method `attributes_dict()` there if none exists, covered by the existing `test_decisions_model.py`). Note that Task 4 already factored the record query into `record(...)` and gave the reader its session handling may differ: read the reader as Task 4 left it, and add the session flag to the one `_select`. `to_decision` with empty `ocr` returns a decision without text and logs «Italgiure record without text»: pass a flag or call a smaller helper that builds identity and attributes only, so the search does not log a warning per row. Name it `to_summary(doc, archivio) -> tuple[Identity, dict]` and use it here; `to_decision` calls it too, so both read the record the same way.

Existing tests of `lookup` and `archive_start` must stay green: the session flag changes the number of GETs per lookup from one per call to one per reader. `test_decisions_italgiure.py`'s `_serve` answers any GET, so the tests that count calls (`calls`) must be read: update only assertions that counted a GET per lookup, and say so in the commit.

- [ ] **Step 4: Run the decision tests**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_italgiure_search.py tests/test_decisions_italgiure.py tests/test_decisions_resolver.py tests/test_decisions_model.py -q)`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/visualex/visualex_api/services/decisions/ services/visualex/tests/
git commit -m "feat(api): search Italgiure by index or text, sorted by deposit, fragments as ranges, one session per reader" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The route `/search_decisions`, its cache and its gate

**Files:**
- Modify: `services/visualex/app.py` (route registration next to `/fetch_decision`, handler next to `fetch_decision`)
- Create: `services/visualex/visualex_api/services/decisions/search_route.py` (the handler's logic, testable without Quart)
- Modify: `services/visualex/visualex_api/tools/cache_manager.py` (namespace `decisions_search`, 24 h)
- Modify: `services/visualex/visualex_api/services/decisions/resolver.py` (the sweep covers the new namespace; expose the reader instance)
- Modify: `apps/web/vite.config.ts` (proxy `/search_decisions`)
- Modify: `infra/ingress/Caddyfile` (`/search_decisions*` in `@legal`)
- Modify: `docs/backend/python_api_reference.md` (the route)
- Test: `services/visualex/tests/test_search_decisions.py`

**Interfaces:**
- *Amended 7 Oct:* `IndexCoordinates(gen, art)` only, no homepage once per reader (see Task 6).
- Consumes: Task 5 (`article_clause`, `index_clause`, `topic_clause`, `build_query`, `UnsupportedAct`, `IndexCoordinates`), Task 6 (`ItalgiureReader.search`, `SearchPage`, `SearchHit.trovata`).
- Produces: `POST /search_decisions`, body `{norma?, tema?, archivio?, pagina?, modo?}` (`modo`: `"indice"`, the default with an article, or `"testo"`; a topic is always searched in the text), answers:
  - `{"esito": "risultati", "totale": int, "pagina": int, "modo": "indice"|"testo", "archivio": "civile"|"penale"|null, "archivio_dal": "YYYY-MM-DD"|null, "decisioni": [{"identita": {...}, "attributi": {...}, "trovata": "indice"|"testo", "frammento": {"testo": str, "evidenziati": [[int,int]]} | null}]}` 200. With `modo: "indice"` and an act the index cannot express, the route searches the text instead and answers `modo: "testo"` — the client shows what was actually done.
  - `{"esito": "non_supportata"}` 200
  - `{"esito": "richiesta_non_valida", "errori": {field: message}}` 400
  - `{"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}` 503
  - `{"esito": "errore_interno"}` 500

- [ ] **Step 1: Write the failing tests** (pattern of `test_fetch_decision.py`)

```python
"""POST /search_decisions (design 2026-10-05 §5)."""
import pytest

from app import NormaController
from visualex_api.services.decisions.italgiure import SearchHit, SearchPage
from visualex_api.services.decisions.model import Identity
from visualex_api.tools.exceptions import NetworkError

HIT = SearchHit(Identity("cassazione", 24908, 2026, "civile"),
                {"sezione": "L", "tipo": "ordinanza", "data_deposito": "2026-09-01"}, "indice",
                {"testo": "ex art. 2043 c.c.", "evidenziati": [[3, 17]]})


class FakeSearcher:
    def __init__(self, page=None, error=None):
        self.page, self.error, self.queries = page, error, []

    async def search(self, q, pagina, rows=20, *, coords=None, hl_query=None):
        self.queries.append((q, pagina, coords, hl_query))
        if self.error:
            raise self.error
        return self.page


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _use(monkeypatch, searcher, start=("2021-01-04")):
    monkeypatch.setattr("visualex_api.services.decisions.search_route.get_searcher", lambda: searcher)
    async def archive_start(archivio):
        return start
    monkeypatch.setattr("visualex_api.services.decisions.search_route.archive_start", archive_start)
    return searcher


async def test_an_article_gives_a_page(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(939, [HIT])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"}})
    assert resp.status_code == 200
    body = await resp.get_json()
    assert body["esito"] == "risultati" and body["totale"] == 939 and body["pagina"] == 1
    assert body["archivio"] == "civile" and body["archivio_dal"] == "2021-01-04"
    assert body["decisioni"][0]["identita"] == {"corte": "cassazione", "numero": 24908,
                                                "anno": 2026, "archivio": "civile"}
    assert s.queries[0][0] == 'kind:"snciv" AND (rnc-gen:"CC" AND rnc-art:"2043 00")'
    assert s.queries[0][2] is not None and 'art. 2043 c.c.' in s.queries[0][3]
    assert body["modo"] == "indice" and body["decisioni"][0]["trovata"] == "indice"


async def test_the_text_way_is_chosen_on_request(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(939, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"}, "modo": "testo"})
    body = await resp.get_json()
    assert body["modo"] == "testo" and s.queries[0][2] is None and 'ocr:"art. 2043 c.c."' in s.queries[0][0]


async def test_an_act_the_index_cannot_express_is_searched_in_the_text(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(5, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2051-bis"}})  # suffix not in Task 2's table
    assert (await resp.get_json())["modo"] == "testo" and s.queries[0][2] is None


async def test_an_act_that_cannot_be_phrased_is_unsupported(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "regolamento ue", "numero_atto": "679", "data": "2016", "numero_articolo": "5"}})
    assert resp.status_code == 200 and (await resp.get_json()) == {"esito": "non_supportata"}


@pytest.mark.parametrize("body, field", [
    ({}, "norma"),
    ({"tema": "   "}, "tema"),
    ({"tema": "x y", "pagina": 11}, "pagina"),
    ({"tema": "x y", "pagina": 0}, "pagina"),
    ({"tema": "x y", "archivio": "tributario"}, "archivio"),
    ([], "norma"),
])
async def test_a_bad_request_says_which_field(client, monkeypatch, body, field):
    _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json=body)
    assert resp.status_code == 400
    out = await resp.get_json()
    assert out["esito"] == "richiesta_non_valida" and field in out["errori"]


async def test_a_source_that_does_not_answer_is_503_never_empty(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(error=NetworkError("down")))
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}


async def test_the_same_page_is_served_from_the_cache(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    for _ in range(2):
        await client.post("/search_decisions", json={"tema": "perdita di chance", "pagina": 2})
    assert len(s.queries) == 1


async def test_a_bug_is_a_fixed_500(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(error=RuntimeError("boom")))
    resp = await client.post("/search_decisions", json={"tema": "x y"})
    assert resp.status_code == 500 and await resp.get_json() == {"esito": "errore_interno"}
```

The cache test needs a clean namespace per test: give `search_route` a module-level `get_cache()` returning `get_cache_manager().get_persistent("decisions_search")`, and monkeypatch it in `_use` with a dict-backed fake (`get`/`set` async). Add that to `_use`.

- [ ] **Step 2: Run to see them fail**

Run: `(cd services/visualex && <python> -m pytest tests/test_search_decisions.py -q)`
Expected: FAIL — 404 on `/search_decisions`.

- [ ] **Step 3: Implement `search_route.py`**

```python
"""POST /search_decisions: the decisions whose text mentions an article or a topic (design
2026-10-05 §5). Italgiure only, the last five years; a page is cached for a day."""
from __future__ import annotations

import hashlib
import json
from typing import Any

import structlog

from ...tools.cache_manager import get_cache_manager
from .resolver import _SOURCE_ERRORS, get_resolver
from .search import UnsupportedAct, article_clause, build_query, index_clause, topic_clause

log = structlog.get_logger()
MAX_PAGE = 10
NS = "decisions_search"


def get_searcher():
    return get_resolver().italgiure


def get_cache():
    return get_cache_manager().get_persistent(NS)


async def archive_start(archivio: str) -> str | None:
    start = await get_resolver().archive_start_of(archivio)
    return start[1] if start else None


def _errors(body: Any) -> tuple[dict, dict]:
    if not isinstance(body, dict):
        return {}, {"norma": "Serve un articolo o un tema"}
    errors: dict[str, str] = {}
    norma, tema = body.get("norma"), body.get("tema")
    if norma is None and tema is None:
        errors["norma"] = "Serve un articolo o un tema"
    if norma is not None and not isinstance(norma, dict):
        errors["norma"] = "L'articolo non è leggibile"
    if tema is not None and not isinstance(tema, str):
        errors["tema"] = "Il tema non è leggibile"
    pagina = body.get("pagina", 1)
    if not isinstance(pagina, int) or isinstance(pagina, bool) or not 1 <= pagina <= MAX_PAGE:
        errors["pagina"] = f"La pagina va da 1 a {MAX_PAGE}"
    archivio = body.get("archivio")
    if archivio not in (None, "civile", "penale"):
        errors["archivio"] = "Archivio non riconosciuto"
    if body.get("modo") not in (None, "indice", "testo"):
        errors["modo"] = "Modo non riconosciuto"
    return errors, body


async def search_decisions(body: Any) -> tuple[dict, int]:
    errors, body = _errors(body)
    if errors:
        return {"esito": "richiesta_non_valida", "errori": errors}, 400
    article, archivio_default, coords, hl_query = None, None, None, None
    modo = "testo"
    if body.get("norma") is not None:
        text_clause = None
        try:
            text_clause, archivio_default = article_clause(body["norma"])
        except UnsupportedAct:
            pass
        if body.get("modo", "indice") == "indice":
            try:
                article, archivio_default, coords = index_clause(body["norma"])
                modo, hl_query = "indice", text_clause
            except UnsupportedAct:
                pass  # the text way, said in the answer's `modo`
        if article is None:
            if text_clause is None:
                return {"esito": "non_supportata"}, 200
            article = text_clause
    topic = None
    if body.get("tema") is not None:
        try:
            topic = topic_clause(body["tema"])
        except ValueError:
            return {"esito": "richiesta_non_valida", "errori": {"tema": "Il tema non contiene parole"}}, 400
    archivio = body.get("archivio") or archivio_default
    pagina = body.get("pagina", 1)
    q = build_query(article, topic, archivio)
    key = hashlib.sha256(json.dumps([q, pagina, hl_query]).encode()).hexdigest()
    cache = get_cache()
    cached = await cache.get(key)
    if cached is not None:
        return cached, 200
    try:
        page = await get_searcher().search(q, pagina, coords=coords, hl_query=hl_query)
    except _SOURCE_ERRORS as exc:
        log.warning("Decision search failed", error=str(exc), error_type=type(exc).__name__)
        return {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}, 503
    answer = {
        "esito": "risultati", "totale": page.totale, "pagina": pagina, "modo": modo, "archivio": archivio,
        "archivio_dal": await archive_start(archivio or "civile"),
        "decisioni": [{"identita": h.identita.to_dict(), "attributi": h.attributi,
                       "trovata": h.trovata, "frammento": h.frammento} for h in page.decisioni],
    }
    await cache.set(key, answer)
    return answer, 200
```

The `count` of an index page is the archive's `numFound`; Task 2's amendment says for which families the false-match rate exceeds 5 %: for those, add `"totale_approssimato": true` to the answer (the client writes «circa N»), with a test. Add to `Resolver` a public `archive_start_of(archivio)` that returns `await self._start(archivio)` (the cached start) and make sure `get_resolver().italgiure` is the reader instance (read `get_resolver` and the constructor first; if the reader is stored under another name, use it). In `cache_manager.py` add `"decisions_search": _create_cache("decisions_search", ttl=24 * 3600),` beside the three decision namespaces, and add `"decisions_search"` to the sweep loop in `resolver.py` (`for namespace in (FOUND_NS, ABSENT_NS, PENDING_NS, SEARCH_NS)`, with `SEARCH_NS = "decisions_search"` defined next to the others and imported by `search_route.py` instead of the literal).

In `app.py`, register `self.app.add_url_rule('/search_decisions', view_func=self.search_decisions, methods=['POST'])` next to `/fetch_decision`, and:

```python
    async def search_decisions(self):
        """Decisions whose text mentions an article or a topic (design 2026-10-05 §5). JSON with
        `esito`: risultati and non_supportata 200, richiesta_non_valida 400,
        fonte_non_raggiungibile 503, errore_interno 500 (a bug: a fixed body)."""
        try:
            body = await request.get_json(silent=True)
        except (RecursionError, UnicodeDecodeError):
            body = None
        try:
            answer, status = await search_decisions_route(body)
        except Exception:
            log.exception("Decision search failed unexpectedly")
            return jsonify({'esito': 'errore_interno'}), 500
        return jsonify(answer), status
```

with `from visualex_api.services.decisions.search_route import search_decisions as search_decisions_route` among the imports. In the route test, `test_a_bug_is_a_fixed_500` raises `RuntimeError` from the searcher; `_SOURCE_ERRORS` does not include it, so it reaches the handler's `except Exception`.

- [ ] **Step 4: The gate.** Add `'/search_decisions': 'http://localhost:5000',` after `/fetch_decision` in `apps/web/vite.config.ts`, and `/search_decisions*` after `/fetch_decision*` in the `@legal` path of `infra/ingress/Caddyfile`. Then run the two guards that keep the lists in step:

Run: `node --test infra/ingress/paths.test.mjs && npm --prefix apps/web run test -- --run src/services/__tests__/legalFetch.guard.test.ts`
Expected: pass.

- [ ] **Step 5: Document the route** in `docs/backend/python_api_reference.md` next to `/fetch_decision`: body, the five answers, the cache (24 h per query and page), the bound (10 pages), «Italgiure only, last five years».

- [ ] **Step 6: Run the whole Python suite**

Run: `(cd services/visualex && <python> -m pytest tests/ -q)`
Expected: all pass (the count rises by the new tests; no other change).

- [ ] **Step 7: Commit**

```bash
git add services/visualex apps/web/vite.config.ts infra/ingress/Caddyfile docs/backend/python_api_reference.md
git commit -m "feat(api): POST /search_decisions — decisions citing or mentioning an article, or a topic, cached, behind the login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The court's original PDF, served behind the login

Spec §12.2.

**Files:**
- Create: `services/visualex/visualex_api/services/decisions/pdf_route.py`
- Modify: `services/visualex/app.py` (register `POST /fetch_decision_pdf`)
- Modify: `services/visualex/visualex_api/services/decisions/resolver.py` (`async def original_pdf(identity) -> bytes | None`)
- Modify: `apps/web/vite.config.ts`, `infra/ingress/Caddyfile` (`/fetch_decision_pdf`)
- Modify: `docs/backend/python_api_reference.md`
- Test: `services/visualex/tests/test_fetch_decision_pdf.py`

**Interfaces:**
- Consumes: Task 4 (`pdf_url`, the `decisions_pdf` cache, `ItalgiureReader`).
- Produces: `POST /fetch_decision_pdf` with an identity body (`{corte: "cassazione", archivio, numero, anno}`): `200 application/pdf` with `Content-Disposition: attachment; filename="Cass_<civ|pen>_n_<numero>_<anno>.pdf"`; JSON `{"esito": "non_disponibile"}` 404, `{"esito": "richiesta_non_valida", "errori": …}` 400 (the Corte costituzionale, a missing archive, a bad field), `{"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}` 503, `{"esito": "errore_interno"}` 500.

- [ ] **Step 1: Failing tests** (pattern of `test_fetch_decision.py`)

```python
"""POST /fetch_decision_pdf (design 2026-10-05 §12.2)."""
import pytest

from app import NormaController
from visualex_api.tools.exceptions import NetworkError

PDF = b"%PDF-1.4\n%fake but shaped\n"


class FakeResolver:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.asked = data, error, []

    async def original_pdf(self, identity):
        self.asked.append(identity)
        if self.error:
            raise self.error
        return self.data


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _use(monkeypatch, resolver):
    monkeypatch.setattr("visualex_api.services.decisions.pdf_route.get_resolver", lambda: resolver)
    return resolver


async def test_the_pdf_is_served_as_an_attachment(client, monkeypatch):
    _use(monkeypatch, FakeResolver(PDF))
    resp = await client.post("/fetch_decision_pdf", json={"corte": "cassazione", "archivio": "civile", "numero": 5625, "anno": 2022})
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/pdf"
    assert resp.headers["Content-Disposition"] == 'attachment; filename="Cass_civ_n_5625_2022.pdf"'
    assert await resp.get_data() == PDF


async def test_no_pdf_is_404(client, monkeypatch):
    _use(monkeypatch, FakeResolver(None))
    resp = await client.post("/fetch_decision_pdf", json={"corte": "cassazione", "archivio": "penale", "numero": 1, "anno": 2024})
    assert resp.status_code == 404 and await resp.get_json() == {"esito": "non_disponibile"}


@pytest.mark.parametrize("body", [
    {"corte": "corte_costituzionale", "numero": 71, "anno": 2020},
    {"corte": "cassazione", "numero": 1, "anno": 2024},            # no archive: not an identity
    {"corte": "cassazione", "archivio": "civile", "numero": 0, "anno": 2024},
    [],
])
async def test_only_a_cassazione_identity_is_accepted(client, monkeypatch, body):
    _use(monkeypatch, FakeResolver(PDF))
    resp = await client.post("/fetch_decision_pdf", json=body)
    assert resp.status_code == 400 and (await resp.get_json())["esito"] == "richiesta_non_valida"


async def test_bytes_that_are_not_a_pdf_are_never_served(client, monkeypatch):
    _use(monkeypatch, FakeResolver(b"<html>Verifica</html>"))
    resp = await client.post("/fetch_decision_pdf", json={"corte": "cassazione", "archivio": "civile", "numero": 1, "anno": 2024})
    assert resp.status_code == 404


async def test_a_source_that_does_not_answer_is_503(client, monkeypatch):
    _use(monkeypatch, FakeResolver(error=NetworkError("down")))
    resp = await client.post("/fetch_decision_pdf", json={"corte": "cassazione", "archivio": "civile", "numero": 1, "anno": 2024})
    assert resp.status_code == 503
```

Resolver tests (in `test_decisions_resolver.py`): `original_pdf` returns the cached bytes without a request when `decisions_pdf` holds the key; otherwise it reads the record (one Solr request), and when `pdf_url(doc)` is not None fetches it (one request), caches it and returns it; a withheld record or one without `filename` returns None and caches nothing.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `pdf_route.py`:

```python
"""POST /fetch_decision_pdf: the court's own PDF of a Cassazione decision (design 2026-10-05 §12.2)."""
from __future__ import annotations

from typing import Any

import structlog

from .model import MAX_NUMERO, FIRST_YEAR, Identity
from .resolver import _SOURCE_ERRORS, get_resolver

log = structlog.get_logger()


def _identity(body: Any, current_year: int) -> Identity | dict[str, str]:
    if not isinstance(body, dict):
        return {"body": "atteso un oggetto JSON"}
    errors: dict[str, str] = {}
    if body.get("corte") != "cassazione":
        errors["corte"] = "solo la Corte di cassazione ha il PDF originale"
    if body.get("archivio") not in ("civile", "penale"):
        errors["archivio"] = "atteso civile o penale"
    numero, anno = body.get("numero"), body.get("anno")
    if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= MAX_NUMERO:
        errors["numero"] = "atteso un numero da 1 a 999999"
    if not isinstance(anno, int) or isinstance(anno, bool) or not FIRST_YEAR["cassazione"] <= anno <= current_year:
        errors["anno"] = "anno non valido"
    return errors or Identity("cassazione", numero, anno, body["archivio"])


async def fetch_decision_pdf(body: Any, current_year: int) -> tuple[bytes | dict, int, dict[str, str]]:
    identity = _identity(body, current_year)
    if isinstance(identity, dict):
        return {"esito": "richiesta_non_valida", "errori": identity}, 400, {}
    try:
        data = await get_resolver().original_pdf(identity)
    except _SOURCE_ERRORS as exc:
        log.warning("Original PDF unreachable", key=identity.key(), error=str(exc))
        return {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}, 503, {}
    if not data or not data.startswith(b"%PDF-"):
        return {"esito": "non_disponibile"}, 404, {}
    short = "civ" if identity.archivio == "civile" else "pen"
    return data, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": f'attachment; filename="Cass_{short}_n_{identity.numero}_{identity.anno}.pdf"',
    }
```

In `app.py`, the handler reads the JSON body as `fetch_decision` does, calls `fetch_decision_pdf(body, date.today().year)` inside `try/except Exception` (→ fixed 500 `errore_interno`, logged), and returns `Response(data, status=status, headers=headers)` for bytes, `jsonify(answer), status` otherwise. Resolver `original_pdf(identity)`: the cache, then `self.italgiure.record(archivio, numero, anno)` (factor the Solr query of `lookup_with_pdf` into `record(...) -> dict | None`, which `lookup_with_pdf` also uses), then the PDF request through the reader's own client (`fetch_pdf(url) -> bytes`, also used by `lookup_with_pdf`), checking `%PDF-` and `MAX_BYTES` before caching.

- [ ] **Step 4: The gate**: proxy line and ingress path (`/fetch_decision_pdf*`), then `node --test infra/ingress/paths.test.mjs && npm --prefix apps/web run test -- --run src/services/__tests__/legalFetch.guard.test.ts`. Document the route in `docs/backend/python_api_reference.md`.

- [ ] **Step 5: Run the decision tests and the whole Python suite.** Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add services/visualex apps/web/vite.config.ts infra/ingress/Caddyfile docs/backend/python_api_reference.md
git commit -m "feat(api): POST /fetch_decision_pdf — the court's own PDF of a Cassazione decision, behind the login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: A decision's text is frozen

> **Amended 5 October (the Sentenze session's review; privacy).** The repository is public: fixtures hold only courts, magistrates, institutions and provisions, never a party's or a lawyer's name. Real PDFs and records live only in the git-ignored `services/visualex/tests/fixtures/decisions/private/` (see its README section); tests that need them go in a `*_local.py` module skipped when that folder is absent (as `test_decisions_pdf_text_local.py` does). CI tests use synthetic PDFs from `services/visualex/tests/decisions_pdf_synth.py` (`make_pdf`, `Text`) and synthetic Solr records. Wherever this task says `FIX / "pdf" / "<fixture>…"`, read: a synthetic record and PDF in CI, the private ones in the local module.
> Also amended: the projection is each block `strip()`ped at its edges, then concatenated, then every `\n` removed (spec §8.2): `"".join((testo.get(k) or "").strip(" \t\n\r\f\v") for k in ("epigrafe", "motivazione", "dispositivo")).replace("\n", "")` (the strip is of ASCII whitespace only, spec §8.2: Python's bare `strip()` and JavaScript's `trim()` also strip the no-break space and other Unicode spaces, and they do not agree). The golden file stores, per case, `{"sha256": <hex of the projection's UTF-8>, "length": <len>}` — never the text — in `frozen_projections.json`; the synthetic cases run in CI, the private ones in `test_decisions_text_frozen_local.py`. The freeze takes effect with PR 4 (spec §8.5): this task writes the test and the contract now so that every later change is caught.

**Files:**
- Create: `services/visualex/tests/test_decisions_text_frozen.py`
- Create: `services/visualex/tests/fixtures/decisions/frozen_projections.json`
- Modify: `services/visualex/visualex_api/services/decisions/resolver.py` (the two «raise the version» comments)
- Modify: `CLAUDE.md` (root rule 23), `services/visualex/CLAUDE.md` (the decisions section)

**Interfaces:**
- Consumes: Task 2's PDF fixtures and `text_from_pdf` (Task 3) — the Cassazione's text as it is read now; the existing fixtures `italgiure_snciv_10787_2024.json`, `italgiure_snpen_10787_2024.json` for the fallback path (`to_decision`); `corte_cost_2014_sample.json` and the Corte costituzionale reader's record → decision function (read `corte_cost.py` for its name).
- Produces: `projection(testo: dict) -> str` in the test module (blocks epigrafe, motivazione, dispositivo concatenated, `\n` removed) — the web's `decisionProjection` (Task 14) mirrors it.

- [ ] **Step 1: Write the test that records, then freezes**

```python
"""A decision's text is a data contract (design 2026-10-05 §8.5, root rule 23): anchors are
pinned by offset and text over the projection — the blocks in reading order, concatenated, with
every \n removed. A reader may add or move \n and move a boundary between blocks; it may never
add, drop or change another character. The golden projections were recorded when this round's
PR 1 merged: the Cassazione's text read from the original PDF (design §11), the fallback from the
text field, and the Corte costituzionale's open data."""
import json
import pathlib

import pytest

from visualex_api.services.decisions.corte_cost import record_to_decision  # read the module: use its real name
from visualex_api.services.decisions.italgiure import to_decision
from visualex_api.services.decisions.pdf_text import text_from_pdf

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"
GOLDEN = json.loads((FIX / "frozen_projections.json").read_text())


def projection(testo: dict) -> str:
    return "".join(testo.get(k) or "" for k in ("epigrafe", "motivazione", "dispositivo")).replace("\n", "")


def _italgiure(name: str, archivio: str) -> dict:
    doc = json.loads((FIX / name).read_text())["response"]["docs"][0]
    return to_decision(doc, archivio).testo


def _corte_cost_cases():
    records = json.loads((FIX / "corte_cost_2014_sample.json").read_text())
    # read the fixture's shape first (a list, or the bundle's root key) and iterate its records
    return [(f"corte_cost_{r['numero_pronuncia']}", r) for r in records["elenco_pronunce"]]


@pytest.mark.parametrize("path", sorted((FIX / "pdf").glob("*.clean.pdf")), ids=lambda p: p.name)
def test_the_cassazione_text_from_the_pdf_is_frozen(path):
    assert projection(text_from_pdf(path.read_bytes())) == GOLDEN[path.name]


@pytest.mark.parametrize("name, archivio", [
    ("italgiure_snciv_10787_2024.json", "civile"),
    ("italgiure_snpen_10787_2024.json", "penale"),
])
def test_the_fallback_from_the_text_field_is_frozen(name, archivio):
    assert projection(_italgiure(name, archivio)) == GOLDEN[name]


@pytest.mark.parametrize("key, record", _corte_cost_cases())
def test_corte_cost_text_is_frozen(key, record):
    assert projection(record_to_decision(record).testo) == GOLDEN[key]
```

- [ ] **Step 2: Record the golden file once**, from this branch as Tasks 3–4 left it (the PDF reader is the text this round freezes; the fallback and the Corte costituzionale reader are unchanged from `develop`). Before recording, prove the unchanged parts are unchanged: `git diff origin/develop -- services/visualex/visualex_api/services/decisions/corte_cost.py` is empty, and `to_decision`'s output on the two text-field fixtures equals what `origin/develop`'s `to_decision` gives (run both: export `services/visualex` of `origin/develop` with `git archive origin/develop services/visualex | tar -x -C <scratch>` and import from there in a scratch script; compare the projections; they must be equal). Write `frozen_projections.json` as `{fixture name: projection}` with a scratch script; never by hand.

- [ ] **Step 3: Run it**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_text_frozen.py -q)`
Expected: pass. Then prove it bites twice: temporarily change one character in `paragraphs` (insert `" "` instead of `"\n\n"`) and, separately, join a PDF paragraph's lines with `"  "` in `pdf_text.py`; each time run again, expect FAIL, revert.

- [ ] **Step 4: Write the contract down**
  - Root `CLAUDE.md`, rule 23: after the sentence about `articleRender.test.ts`, add: «Decision texts are held to the same contract since 2026-10-05 (notes and highlights on decisions): the readers in `services/visualex/visualex_api/services/decisions/` — the Cassazione's text from the court's PDF (`pdf_text.py`), its fallback from the text field, the Corte costituzionale's open data — may add or move `\n` and move a boundary between blocks, never change another character; `test_decisions_text_frozen.py` and `decisionRender.test.ts` check it, and an anchor that no longer matches is listed in the decision tab, never dropped.»
  - `services/visualex/CLAUDE.md`, decisions section: the same in two lines, naming the test.
  - `resolver.py`, both «Raise the version whenever the reader changes the shape of what it returns» comments: append «— the shape only (blocks, `\n`): a change of characters is refused by test_decisions_text_frozen.py (design 2026-10-05 §8.5)».

- [ ] **Step 5: Commit**

```bash
git add services/visualex/tests/ services/visualex/visualex_api/services/decisions/resolver.py CLAUDE.md services/visualex/CLAUDE.md
git commit -m "test(api): freeze decision texts — the projection anchors are pinned to" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 1:** push, open the PR into `develop` titled «feat: decisions read whole from the court's PDF, searched by cited norm or text, and frozen», body naming: the Cassazione reader's change (the Sentenze session's area, changed on the owner's answer 43 while that session was unreachable — the orchestrator routes it), the infra lines (`Caddyfile`, the other developer's area), the new dependency, Tasks 1–2's measurements, and the freeze (the readers as this PR leaves them). Merge at green CI: `merge: feat/decision-search-route — decisions whole from the court's PDF, search by cited norm or text, original PDF, texts frozen`.

---

## PR 2 — `feat/decision-tabs` (apps/web)

Worktree from `origin/develop` after PR 1 merged: `.claude/worktrees/decision-tabs`, branch `feat/decision-tabs`.

### Task 10: The short label and keys of a decision

**Files:**
- Modify: `apps/web/src/utils/decisionLinks.ts`
- Modify: `apps/web/src/utils/__tests__/sourcesGolden.test.ts`
- Test: `apps/web/src/utils/__tests__/decisionLinks.short.test.ts`

**Interfaces:**
- Produces:
  - `formatDecisionShort(ref: { corte: string; archivio?: string | null; numero: number; anno?: number | null }, attrs?: { sezione?: string }): string`
  - `identityFromKey(key: string): DecisionIdentity | null`
  - `isDecisionKey(key: string): boolean`

If convention PR 1c has already merged `formatDecisionShort`, skip writing it: keep only the tests that are not already there and `identityFromKey` / `isDecisionKey`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { formatDecisionShort, identityFromKey, isDecisionKey } from '../decisionLinks';

describe('formatDecisionShort', () => {
  it('writes court, archive, section, number/year', () => {
    expect(formatDecisionShort({ corte: 'cassazione', archivio: 'civile', numero: 31310, anno: 2024 }, { sezione: 'U' }))
      .toBe('Cass. civ., sez. un., n. 31310/2024');
    expect(formatDecisionShort({ corte: 'cassazione', archivio: 'penale', numero: 10787, anno: 2024 }, { sezione: '7' }))
      .toBe('Cass. pen., sez. VII, n. 10787/2024');
  });
  it('omits what it does not have', () => {
    expect(formatDecisionShort({ corte: 'cassazione', numero: 2633, anno: 1982 })).toBe('Cass., n. 2633/1982');
    expect(formatDecisionShort({ corte: 'cassazione', archivio: 'civile', numero: 2633, anno: null }, { sezione: '3' }))
      .toBe('Cass. civ., sez. III, n. 2633');
    expect(formatDecisionShort({ corte: 'corte_costituzionale', numero: 71, anno: 2020 })).toBe('Corte cost., n. 71/2020');
  });
});

describe('identityFromKey', () => {
  it('reads both key shapes and refuses anything else', () => {
    expect(identityFromKey('cassazione:civile:10787:2024')).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 });
    expect(identityFromKey('corte_costituzionale:71:2020')).toEqual({ corte: 'corte_costituzionale', numero: 71, anno: 2020 });
    for (const bad of ['codice-civile--2043', 'cassazione:tributario:1:2024', 'cassazione:civile:0:2024', 'corte_costituzionale:1:1900', '']) {
      expect(identityFromKey(bad), bad).toBeNull();
    }
    expect(isDecisionKey('cassazione:civile:10787:2024')).toBe(true);
    expect(isDecisionKey('codice-civile--2043')).toBe(false);
  });
});
```

And in `sourcesGolden.test.ts`, inside the decisions block, a loop asserting `formatDecisionShort(reference, attributes) === c.labels.short.value` for every case whose `labels.short.status === 'decided'` (import `formatDecisionShort`).

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix apps/web run test -- --run src/utils/__tests__/decisionLinks.short.test.ts src/utils/__tests__/sourcesGolden.test.ts`
Expected: FAIL — `formatDecisionShort is not a function`.

- [ ] **Step 3: Implement** in `decisionLinks.ts`, below `formatDecisionCitation`, reusing its private `citationSection`:

```ts
/** The short label (convention §4.2): court and archive, section, number/year — no type, no date.
 *  Chips, lists, tab and history labels. A reference without the year is written without it. */
export function formatDecisionShort(
  ref: { corte: string; archivio?: string | null; numero: number; anno?: number | null },
  attrs: { sezione?: string } = {},
): string {
  const numero = ref.anno ? `n. ${ref.numero}/${ref.anno}` : `n. ${ref.numero}`;
  if (ref.corte === 'corte_costituzionale') return `Corte cost., ${numero}`;
  const head = ref.archivio === 'penale' ? 'Cass. pen.' : ref.archivio === 'civile' ? 'Cass. civ.' : 'Cass.';
  return [head, attrs.sezione ? citationSection(attrs.sezione) : null, numero].filter(Boolean).join(', ');
}

const KEY = /^(?:cassazione:(civile|penale):(\d{1,6}):(\d{4})|corte_costituzionale:(\d{1,6}):(\d{4}))$/;

/** A decision's key (`decisionKey`) read back, or null for anything else — a norm's key has no colon. */
export function identityFromKey(key: string, now: Date = new Date()): DecisionIdentity | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const corte: DecisionCourt = m[1] ? 'cassazione' : 'corte_costituzionale';
  const numero = Number(m[2] ?? m[4]);
  const anno = Number(m[3] ?? m[5]);
  if (numero < 1 || numero > MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  return corte === 'cassazione' ? { corte, archivio: m[1] as DecisionArchive, numero, anno } : { corte, numero, anno };
}

export function isDecisionKey(key: string): boolean {
  return identityFromKey(key) !== null;
}
```

Move `citationSection`'s definition above `formatDecisionShort` if needed (it is a function declaration, hoisted: no move needed).

- [ ] **Step 4: Run the tests**

Run: `npm --prefix apps/web run test -- --run src/utils/__tests__/`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/decisionLinks.ts apps/web/src/utils/__tests__/
git commit -m "feat(web): the short label of a decision and its key read back"
```

### Task 11: The palette reads decision citations

**Files:**
- Create: `apps/web/src/utils/decisionCitationParser.ts`
- Test: `apps/web/src/utils/__tests__/decisionCitationParser.test.ts`

**Interfaces:**
- Consumes: `expandTwoDigitYear`, `parseItalianDate` (`utils/dateUtils.ts`); `MAX_NUMERO`, `FIRST_YEAR` (`decisionLinks.ts`).
- Produces: `parseDecisionCitation(input: string, options?: { aliasTriggers?: string[]; now?: Date }): DecisionReference | null`

- [ ] **Step 1: Write the failing test — a golden table**

```ts
import { describe, expect, it } from 'vitest';
import { parseDecisionCitation } from '../decisionCitationParser';

const NOW = new Date('2026-10-05T12:00:00Z');
const CASES: Array<[string, Record<string, unknown> | null]> = [
  ['Cass. 10787/2024', { corte: 'cassazione', numero: 10787, anno: 2024 }],
  ['Cassazione n. 10787 del 2024', { corte: 'cassazione', numero: 10787, anno: 2024 }],
  ['Cass. civ. 10787/2024', { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }],
  ['Cass. civ., sez. III, n. 10787/2024', { corte: 'cassazione', archivio: 'civile', sezione: 'III', numero: 10787, anno: 2024 }],
  ['Cass. pen., sez. VII, 10787/2024', { corte: 'cassazione', archivio: 'penale', sezione: 'VII', numero: 10787, anno: 2024 }],
  ['Cass. SU 31310/2024', { corte: 'cassazione', sezione: 'U', numero: 31310, anno: 2024 }],
  ['Cass. civ., sez. un., n. 31310/2024', { corte: 'cassazione', archivio: 'civile', sezione: 'U', numero: 31310, anno: 2024 }],
  ['S.U. 31310/2024', { corte: 'cassazione', sezione: 'U', numero: 31310, anno: 2024 }],
  ['Cass. civ., sez. lav., 21 aprile 2022, n. 12789', { corte: 'cassazione', archivio: 'civile', sezione: 'L', numero: 12789, anno: 2022 }],
  ['Cass. pen., sez. VII, 10 gennaio 2024 (dep. 14 marzo 2024), n. 10787', { corte: 'cassazione', archivio: 'penale', sezione: 'VII', numero: 10787, anno: 2024 }],
  ['Cass. civ. 1234/99', { corte: 'cassazione', archivio: 'civile', numero: 1234, anno: 1999 }],
  ['Corte cost. 71/2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['C. cost. n. 71 del 2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['Corte costituzionale, sentenza n. 71/2020', { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  ['art 2043 cc', null],
  ['Cass. civ.', null],                      // no number
  ['Cass. 10787', null],                     // no year
  ['Cass. 0/2024', null],
  ['Cass. 10787/2030', null],                // the future
  ['Corte cost. 1/1950', null],              // before the court
];

describe('parseDecisionCitation', () => {
  for (const [input, expected] of CASES) {
    it(input, () => expect(parseDecisionCitation(input, { now: NOW })).toEqual(expected));
  }
  it("leaves the input to the user's alias that starts it", () => {
    expect(parseDecisionCitation('cass 10787/2024', { aliasTriggers: ['cass'], now: NOW })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm --prefix apps/web run test -- --run src/utils/__tests__/decisionCitationParser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * A court decision as lawyers type or paste it in the palette (design 2026-10-05 §1). It reads
 * only an input that starts with a court, so it never takes a norm away from the norm parser;
 * what it cannot read whole is null. The section is kept as written in short form ("III", "U",
 * "L"): the route resolves it, as it does for the page's address.
 */
import type { DecisionReference } from '../types/decisions';
import { FIRST_YEAR, MAX_NUMERO } from './decisionLinks';
import { expandTwoDigitYear } from './dateUtils';

const COURT = /^\s*(?:(corte\s+cost(?:ituzionale)?\.?|c\.\s*cost\.?)|(cass(?:azione)?\.?)|(s\.?\s*u\.?|sez(?:ioni)?\.?\s*un(?:ite)?\.?))(?=[\s,]|$)/i;
const ARCHIVE = /\b(civ(?:ile)?|pen(?:ale)?)\b\.?/i;
const SECTION = /\bsez(?:ione)?\.?\s*(un(?:ite)?\.?|lav(?:oro)?\.?|fer(?:iale)?\.?|[IVX]{1,4}|[1-7])(?=[\s,.]|$)|\b(SU|S\.U\.)\b/i;
const NUMBER_YEAR = /\bn(?:\.|um(?:ero)?)?\s*(\d{1,6})\s*(?:\/|del\s+)(\d{4}|\d{2})\b|\b(\d{1,6})\s*\/\s*(\d{4}|\d{2})\b/i;
const NUMBER_ONLY = /\bn\.?\s*(\d{1,6})\b/i;
const DEPOSIT_YEAR = /\bdep(?:\.|osit[ao])?\s*(?:il\s+)?\d{1,2}[°º]?\s+\p{L}+\s+(\d{4})/iu;
const DATE_YEAR = /\b\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i;

function sectionCode(raw: string): string {
  const s = raw.replace(/\./g, '').toLowerCase();
  if (s.startsWith('un') || s === 'su' || s === 's u') return 'U';
  if (s.startsWith('lav')) return 'L';
  if (s.startsWith('fer')) return 'F';
  return raw.replace(/\./g, '').toUpperCase();
}

export function parseDecisionCitation(
  input: string,
  options: { aliasTriggers?: string[]; now?: Date } = {},
): DecisionReference | null {
  const now = options.now ?? new Date();
  const text = input.trim();
  const first = text.split(/[\s.,]+/)[0]?.toLowerCase() ?? '';
  if (options.aliasTriggers?.some((t) => t.toLowerCase() === first)) return null;
  const court = COURT.exec(text);
  if (!court) return null;
  const corte = court[1] ? 'corte_costituzionale' : 'cassazione';
  const rest = text.slice(court[0].length);

  let numero: number | undefined;
  let anno: number | undefined;
  const ny = NUMBER_YEAR.exec(rest);
  if (ny) {
    numero = Number(ny[1] ?? ny[3]);
    const y = ny[2] ?? ny[4];
    anno = y.length === 2 ? expandTwoDigitYear(y) : Number(y);
  } else {
    const n = NUMBER_ONLY.exec(rest);
    const y = DEPOSIT_YEAR.exec(rest) ?? DATE_YEAR.exec(rest);
    if (n && y) { numero = Number(n[1]); anno = Number(y[1]); }
  }
  const dep = DEPOSIT_YEAR.exec(rest);
  if (dep && corte === 'cassazione') anno = Number(dep[1]);
  if (numero === undefined || anno === undefined) return null;
  if (numero < 1 || numero > MAX_NUMERO || anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;

  const ref: DecisionReference = { corte, numero, anno };
  if (corte === 'cassazione') {
    const archive = ARCHIVE.exec(rest);
    if (archive) ref.archivio = archive[1].toLowerCase().startsWith('civ') ? 'civile' : 'penale';
    if (court[3]) ref.sezione = 'U';
    const section = SECTION.exec(rest);
    if (section) ref.sezione = section[2] ? 'U' : sectionCode(section[1]);
  }
  return ref;
}
```

Check `expandTwoDigitYear`'s signature in `dateUtils.ts` (string or number) and adapt the call. Iterate on the regexes until the table is green; the table is the contract, the regexes are not.

- [ ] **Step 4: Run the test**

Run: `npm --prefix apps/web run test -- --run src/utils/__tests__/decisionCitationParser.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/decisionCitationParser.ts apps/web/src/utils/__tests__/decisionCitationParser.test.ts
git commit -m "feat(web): read a decision citation typed or pasted in the palette"
```

### Task 12: Decision tabs in the store

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts` (types `TabView`, `WorkspaceTab.view`, `pendingDecision`; actions below; `partialize` keeps `view`, drops `pendingDecision`)
- Create: `apps/web/src/utils/decisionFetchCache.ts`
- Test: `apps/web/src/store/__tests__/decisionTabs.test.ts`
- Test: `apps/web/src/utils/__tests__/decisionFetchCache.test.ts`

**Interfaces:**
- Consumes: `decisionPath`, `formatDecisionShort`, `identityOf` (`decisionLinks.ts`); `fetchDecision` (`services/decisionService.ts`).
- Produces (store):
  - `type TabView = { kind: 'decision'; reference: DecisionReference } | { kind: 'decision-search'; query: DecisionSearchQuery }` (`DecisionSearchQuery` from Task 15's types — declare it in `types/decisions.ts` now: `{ norma?: DecisionSearchNorma; normaLabel?: string; tema?: string; archivio?: DecisionArchive }`, with `DecisionSearchNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>`)
  - `openDecisionTab(reference: DecisionReference, options?: { besideTabId?: string }): string`
  - `openDecisionSearchTab(query: DecisionSearchQuery, label: string, options?: { besideTabId?: string }): string`
  - `setDecisionTabIdentity(tabId: string, identity: DecisionIdentity, label: string): void`
  - `placeTabsSideBySide(leftTabId: string, rightTabId: string): void`
  - `requestOpenDecision(reference: DecisionReference): void`
  - `drainPendingDecision(): string | null` (the tab id opened, or null)
- Produces (cache): `fetchDecisionCached(ref: DecisionReference): Promise<FetchDecisionAnswer>`, `forgetDecision(ref: DecisionReference): void`

- [ ] **Step 1: Write the failing store tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../useAppStore';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };

beforeEach(() => useAppStore.setState({ workspaceTabs: [], pendingDecision: null }));

describe('decision tabs', () => {
  it('opens one tab per decision and focuses it the second time', () => {
    const s = useAppStore.getState();
    const a = s.openDecisionTab(REF);
    const z = useAppStore.getState().workspaceTabs[0].zIndex;
    const b = useAppStore.getState().openDecisionTab({ ...REF, sezione: 'III' });
    const tabs = useAppStore.getState().workspaceTabs;
    expect(b).toBe(a);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].view).toEqual({ kind: 'decision', reference: REF });
    expect(tabs[0].content).toEqual([]);
    expect(tabs[0].label).toBe('Cass. civ., n. 10787/2024');
    expect(tabs[0].zIndex).toBeGreaterThan(z - 1);
  });

  it('places the decision on the right half beside the article tab', () => {
    const article = useAppStore.getState().addWorkspaceTab('art. 2043 c.c.');
    const decision = useAppStore.getState().openDecisionTab(REF, { besideTabId: article });
    const tabOf = (id: string) => useAppStore.getState().workspaceTabs.find((t) => t.id === id)!;
    const left = tabOf(article);
    const right = tabOf(decision);
    expect(left.position.x).toBeLessThan(right.position.x);
    expect(left.position.x + left.size.width).toBeLessThanOrEqual(right.position.x);
    expect(left.size.height).toBe(right.size.height);
  });

  it('keeps the identity once found, so a reload asks for exactly it', () => {
    const id = useAppStore.getState().openDecisionTab({ corte: 'cassazione', numero: 10787, anno: 2024, sezione: 'III' });
    useAppStore.getState().setDecisionTabIdentity(id, REF, 'Cass. civ., sez. III, n. 10787/2024');
    const tab = useAppStore.getState().workspaceTabs[0];
    expect(tab.view).toEqual({ kind: 'decision', reference: REF });
    expect(tab.label).toBe('Cass. civ., sez. III, n. 10787/2024');
  });

  it('drains a queued decision once, even when called twice (StrictMode)', () => {
    useAppStore.getState().requestOpenDecision(REF);
    const first = useAppStore.getState().drainPendingDecision();
    const second = useAppStore.getState().drainPendingDecision();
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(useAppStore.getState().workspaceTabs).toHaveLength(1);
  });

  it('persists the view and never the pending request', () => {
    useAppStore.getState().openDecisionTab(REF);
    useAppStore.getState().requestOpenDecision(REF);
    const persisted = (useAppStore as unknown as { persist: { getOptions: () => { partialize: (s: unknown) => Record<string, unknown> } } })
      .persist.getOptions().partialize(useAppStore.getState());
    expect((persisted.workspaceTabs as Array<{ view?: unknown }>)[0].view).toEqual({ kind: 'decision', reference: REF });
    expect(persisted).not.toHaveProperty('pendingDecision');
  });
});
```

Read how other store tests reset state (`apps/web/src/store/__tests__/`) and follow their setup; adjust `beforeEach` to it.

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix apps/web run test -- --run src/store/__tests__/decisionTabs.test.ts`
Expected: FAIL — `openDecisionTab is not a function`.

- [ ] **Step 3: Implement in the store.** Beside `WorkspaceTab`:

```ts
/** A tab that shows one thing rather than a list of norms (design 2026-10-05 §2.1): a decision,
 *  or a list of decisions. A field of the tab, not a TabContent: 27 places switch over
 *  TabContent, several with an `else` that would draw an unknown item as a loose article. */
export type TabView =
    | { kind: 'decision'; reference: DecisionReference }
    | { kind: 'decision-search'; query: DecisionSearchQuery };
```

and `view?: TabView;` on `WorkspaceTab`; `pendingDecision: DecisionReference | null` in the state (initial `null`). Actions:

```ts
            openDecisionTab: (reference, options) => {
                let tabId = '';
                set((state) => {
                    const existing = state.workspaceTabs.find(t =>
                        t.view?.kind === 'decision' && sameDecision(t.view.reference, reference));
                    const tab = existing ?? newViewTab(state, formatDecisionShort(reference), { kind: 'decision', reference: stripSection(reference) });
                    tab.isHidden = false;
                    tab.isMinimized = false;
                    tab.zIndex = ++state.highestZIndex;
                    if (options?.besideTabId) placeSideBySide(state, options.besideTabId, tab.id);
                    tabId = tab.id;
                });
                return tabId;
            },
```

with module-level helpers in the store file:

```ts
/** One decision whatever the citation said: same court, number and year, and the same archive
 *  unless one side does not know it yet (a reference the route has not resolved). */
function sameDecision(a: DecisionReference, b: DecisionReference): boolean {
    return a.corte === b.corte && a.numero === b.numero && a.anno === b.anno &&
        (a.archivio === undefined || b.archivio === undefined || a.archivio === b.archivio);
}

/** A reference keeps its section only until the route has resolved it; a tab is keyed by court,
 *  archive, number and year, so two citations of one decision share a tab. */
function stripSection(ref: DecisionReference): DecisionReference {
    const { sezione: _sezione, ...rest } = ref;
    void _sezione;
    return rest;
}

function newViewTab(state: AppState, label: string, view: TabView): WorkspaceTab {
    const cascade = (state.workspaceTabs.length % 5) * 40;
    const tab: WorkspaceTab = {
        id: uuidv4(), label, position: { x: 100 + cascade, y: 100 + cascade }, size: { width: 800, height: 650 },
        zIndex: ++state.highestZIndex, isMinimized: false, isHidden: false, content: [], labelIsCustom: true, view,
    };
    state.workspaceTabs.push(tab);
    return state.workspaceTabs[state.workspaceTabs.length - 1];
}

/** The left tab on the left half of the workspace, the right one on the right half, both as tall
 *  as the workspace (design 2026-10-05 §2.2, reading 1). */
function placeSideBySide(state: AppState, leftId: string, rightId: string) {
    const left = state.workspaceTabs.find(t => t.id === leftId);
    const right = state.workspaceTabs.find(t => t.id === rightId);
    if (!left || !right || left.id === right.id) return;
    const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const h = typeof window === 'undefined' ? 800 : window.innerHeight;
    const margin = 16, top = 16, dock = 72;
    const half = Math.floor((w - margin * 3) / 2);
    const height = Math.max(400, h - top - dock);
    Object.assign(left, { position: { x: margin, y: top }, size: { width: half, height }, isHidden: false, isMinimized: false });
    Object.assign(right, { position: { x: margin * 2 + half, y: top }, size: { width: half, height }, isHidden: false, isMinimized: false });
}
```

The workspace area may not start at x = 0 (the sidebar): read how `WorkspaceTabPanel` computes `dragConstraints` and `addWorkspaceTab`'s defaults, and use the same origin; the test asserts only order, non-overlap and equal height. `labelIsCustom: true` keeps a norm search from merging into a decision tab (R3 of streaming-ux, see the field's comment). `openDecisionSearchTab(query, label, options)` follows the same pattern with `{ kind: 'decision-search', query }`, focusing an existing tab whose query is deep-equal (`JSON.stringify` of the query with sorted keys). `setDecisionTabIdentity(tabId, identity, label)` sets `view.reference = identityOf(identity)` and `label`. `placeTabsSideBySide(l, r)` wraps `placeSideBySide` in `set`. `requestOpenDecision(ref)` sets `pendingDecision`; `drainPendingDecision()`:

```ts
            drainPendingDecision: () => {
                const pending = get().pendingDecision;
                if (!pending) return null;
                set((state) => { state.pendingDecision = null; });
                return get().openDecisionTab(pending);
            },
```

Gotcha 14 asks for one atomic action: here the precondition (`pendingDecision`) is cleared before the tab opens, and the second StrictMode call finds it null; the test pins it. `partialize`: workspace tabs already persist; make sure `pendingDecision` is not listed.

- [ ] **Step 4: Write `decisionFetchCache.ts` and its test**

```ts
/** A decision's answer for the session, by its path: one request per decision however many
 *  tabs, lists or reloads of a component ask; a failure is not kept, so «Riprova» asks again. */
import { fetchDecision } from '../services/decisionService';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';
import { decisionPath } from './decisionLinks';

const answers = new Map<string, Promise<FetchDecisionAnswer>>();
const KEPT: ReadonlySet<FetchDecisionAnswer['esito']> = new Set(['trovata', 'ambigua', 'non_trovata']);

export function fetchDecisionCached(ref: DecisionReference): Promise<FetchDecisionAnswer> {
  const key = decisionPath(ref);
  const held = answers.get(key);
  if (held) return held;
  const pending = fetchDecision(ref).then(
    (answer) => {
      if (!KEPT.has(answer.esito)) answers.delete(key);
      return answer;
    },
    (error: unknown) => {
      answers.delete(key);
      throw error;
    },
  );
  answers.set(key, pending);
  return pending;
}

export function forgetDecision(ref: DecisionReference): void {
  answers.delete(decisionPath(ref));
}
```

Test with `vi.mock('../../services/decisionService')`: two calls → one fetch; a `fonte_non_raggiungibile` answer → the next call fetches again; a rejection → the next call fetches again.

- [ ] **Step 5: Run the tests, the build and lint**

Run: `npm --prefix apps/web run test -- --run src/store src/utils && npm --prefix apps/web run build && npm --prefix apps/web run lint`
Expected: pass. The build catches every `switch` over `WorkspaceTab` that must now consider `view` — there should be none; if the compiler flags one, handle `view` there.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store apps/web/src/utils/decisionFetchCache.ts apps/web/src/utils/__tests__/decisionFetchCache.test.ts apps/web/src/types/decisions.ts
git commit -m "feat(web): decision tabs in the workspace — one per decision, beside the article, persisted by identity"
```

### Task 13: The decision in its tab, on desktop and on a phone

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionView.tsx` (the page's body: identity line, notices, actions, text, source, every outcome)
- Create: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (fetches with `fetchDecisionCached`, records the identity, renders `DecisionView`)
- Modify: `apps/web/src/components/features/decisions/DecisionPage.tsx` (deleted at Task 14; until then a thin wrapper over `DecisionView` so its tests keep passing)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` (a tab with `view` renders `DecisionTabView`; header hides the content actions)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (the phone view draws a tab with `view`; opening a decision shows its tab)
- Test: `apps/web/src/components/features/decisions/DecisionView.test.tsx` (moved from `DecisionPage.test.tsx`, every outcome kept)
- Test: `apps/web/src/components/features/decisions/DecisionTabView.test.tsx`

**Interfaces:**
- Consumes: Task 12's store actions and `fetchDecisionCached`.
- Produces:
  - `DecisionView({ answer, reference, onRetry, onChooseCandidate, onOpenPalette, actions? }: DecisionViewProps)` — `answer: FetchDecisionAnswer | null` (null = loading), `onChooseCandidate(identity)`, `actions?: React.ReactNode` (extra buttons, e.g. PR C's «Aggiungi al dossier»), `textSlot?: React.ReactNode` (Task 19 replaces the plain text with the reading surface).
  - `DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference })`

- [ ] **Step 1: Move the tests.** `git mv DecisionPage.test.tsx DecisionView.test.tsx`, then rewrite each test to render `<DecisionView answer={…} reference={…} onRetry={vi.fn()} onChooseCandidate={vi.fn()} onOpenPalette={vi.fn()} />` with the answer it used to get from a mocked `fetchDecision`. Keep every assertion on copy and roles: the copy is the Sentenze design's and must not change. Tests that were about the page's URL rewrite move to Task 14. Add:

```tsx
it('opens a candidate in the same tab', async () => {
  const onChooseCandidate = vi.fn();
  render(<DecisionView answer={AMBIGUOUS} reference={REF} onRetry={vi.fn()} onChooseCandidate={onChooseCandidate} onOpenPalette={vi.fn()} />);
  await userEvent.click(screen.getAllByRole('link')[0]);
  expect(onChooseCandidate).toHaveBeenCalledWith(AMBIGUOUS.candidati[0].identita);
});
```

(`AMBIGUOUS`, `REF` as defined in the moved file.) `git mv` leaves the rename staged: commit it with this task's files only (memory gotcha: the next commit includes a staged rename).

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix apps/web run test -- --run src/components/features/decisions/`
Expected: FAIL — `DecisionView` not found.

- [ ] **Step 3: Implement `DecisionView`** by moving `FoundView`, `Alert`, `unreachableMessage` and the outcome switch out of `DecisionPage.tsx` unchanged, with three differences: candidates call `onChooseCandidate(c.identita)` (rendered as `<a href={decisionPath(c.identita)} onClick={e => { e.preventDefault(); onChooseCandidate(c.identita); }}>` so the address still shows and middle-click works); the invalid-address branch shows the alert and a button «Cerca nella barra di ricerca» calling `onOpenPalette`; `DecisionLookupForm` is no longer rendered (it goes in Task 14) — the not-found branch keeps the reason and the penal suggestion (as a `DecisionLink`-like anchor calling `onChooseCandidate(answer.suggerimento)`). «Copia collegamento» joins «Copia citazione»: it copies `window.location.origin + decisionPath(identity)`.

`DecisionTabView`:

```tsx
export function DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference }) {
  const setIdentity = useAppStore((s) => s.setDecisionTabIdentity);
  const openPalette = useAppStore((s) => s.openCommandPalette);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  const [current, setCurrent] = useState(reference);
  const key = `${decisionPath(current)}#${attempt}`;

  useEffect(() => {
    let cancelled = false;
    fetchDecisionCached(current).then(
      (answer) => { if (!cancelled) setResult({ key, answer }); },
      (error: unknown) => {
        console.error('fetch_decision failed', { reference: current, error });
        if (!cancelled) setResult({ key, answer: { esito: 'fonte_non_raggiungibile', fonte: 'rete' } });
      },
    );
    return () => { cancelled = true; };
  }, [current, key]);

  const answer = result?.key === key ? result.answer : null;
  useEffect(() => {
    if (answer?.esito === 'trovata') {
      setIdentity(tabId, answer.identita, formatDecisionShort(answer.identita, answer.attributi));
    }
  }, [answer, setIdentity, tabId]);

  return (
    <DecisionView
      answer={answer}
      reference={current}
      onRetry={() => { forgetDecision(current); setAttempt((a) => a + 1); }}
      onChooseCandidate={(identity) => setCurrent(identity)}
      onOpenPalette={openPalette}
    />
  );
}
```

In `WorkspaceTabPanel.tsx`, where the content list renders (around the `item.type === 'norma'` map), branch first: `tab.view?.kind === 'decision' ? <DecisionTabView tabId={tab.id} reference={tab.view.reference} /> : tab.view?.kind === 'decision-search' ? null /* Task 17 */ : (existing list)`. In the header, render «Aggiungi al dossier», the collection button and the rename only when `!tab.view`. Leave a typed exhaustive check so Task 17 cannot forget its branch:

```tsx
function assertNever(x: never): never { throw new Error(`unhandled tab view ${JSON.stringify(x)}`); }
```

In `SearchPanel.tsx`, the phone view (the `.filter(item.type === 'norma')` block): render `DecisionTabView` when the active tab has `view.kind === 'decision'`. And make an opened decision the visible tab on a phone: an effect on `workspaceTabs` that, when the tab with the highest `zIndex` has a `view` and differs from the last one seen, sets `mobileActiveTabIndex` to its index (a ref holds the last id; gotcha 11: this syncs local state with the store, keep the justification on the disable line).

- [ ] **Step 4: `DecisionTabView` test**: with `fetchDecisionCached` mocked to return a found decision with a section, the tab label becomes the short form with the section and the store's reference loses the section; choosing a candidate fetches the candidate in the same tab; «Riprova» after `fonte_non_raggiungibile` calls `forgetDecision` and fetches again.

- [ ] **Step 5: Run tests, build, lint**

Run: `npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/features/decisions apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx apps/web/src/components/features/search/SearchPanel.tsx
git commit -m "feat(web): a decision reads in its own tab, every outcome kept, and on a phone"
```

### Task 14: The address, the links, the sidebar and the palette

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionAddress.tsx` (the route element)
- Create: `apps/web/src/components/features/decisions/DecisionLink.tsx`
- Modify: `apps/web/src/App.tsx` (both `/sentenze` routes render `DecisionAddress`)
- Delete: `apps/web/src/components/features/decisions/DecisionPage.tsx`, `DecisionLookupForm.tsx`, `DecisionLookupForm.test.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` («Sentenze» opens the palette)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (drain the pending decision; read `?palette=sentenze`)
- Modify: `apps/web/src/components/features/search/CommandPalette.tsx` (the decision line; Enter opens it)
- Modify: `apps/web/src/features/merlt/rassegne/DecisionChip.tsx` (uses `DecisionLink`)
- Test: `apps/web/src/components/features/decisions/DecisionAddress.test.tsx`, `DecisionLink.test.tsx`
- Test: `apps/web/src/components/features/search/CommandPalette.test.tsx` (add cases)

**Interfaces:**
- Consumes: Tasks 10–13.
- Produces: `DecisionLink({ to: LooseDecisionRef; besideTabId?: string; className?: string; title?: string; children })` — renders `<a href={linkableDecisionPath(to)}>`; a plain left click on the search page calls `openDecisionTab(ref, { besideTabId })` and prevents navigation; otherwise it navigates (react-router `useNavigate`). Renders children in a `<span>` when `linkableDecisionPath` is null.

- [ ] **Step 1: Write the failing tests**

`DecisionAddress.test.tsx` (MemoryRouter with routes `/` → a stub reading the store, `/sentenze/:corte/:numero/:anno` and `/sentenze` → `DecisionAddress`, under `<React.StrictMode>`):

```tsx
it('queues the decision and lands on the search page, once', async () => {
  renderAt('/sentenze/cassazione-civile/10787/2024');
  await screen.findByTestId('search-page');
  expect(useAppStore.getState().pendingDecision).toEqual({ corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 });
});
it('keeps the section of a reference without the archive', async () => {
  renderAt('/sentenze/cassazione/10787/2024?sezione=III');
  await screen.findByTestId('search-page');
  expect(useAppStore.getState().pendingDecision).toMatchObject({ corte: 'cassazione', sezione: 'III' });
});
it('opens the palette for /sentenze and for an address that does not parse', async () => {
  renderAt('/sentenze/tar-lazio/1/2024');
  await screen.findByTestId('search-page');
  expect(useAppStore.getState().commandPaletteOpen).toBe(true);
  expect(useAppStore.getState().pendingDecision).toBeNull();
});
```

`DecisionLink.test.tsx`: on the search page a click calls `openDecisionTab` with `besideTabId` and does not navigate; outside it navigates to the path; a modified click (ctrl/meta/middle) is left to the browser; a ref with no year renders a `<span>` with no `href`.

`CommandPalette.test.tsx`: typing «Cass. civ. 10787/2024» shows «Sentenza → Cass. civ., n. 10787/2024» and Enter calls `openDecisionTab` and closes the palette; typing «art 2043 cc» shows the norm preview as before; with a custom alias `cass`, «cass 10787/2024» is not read as a decision.

- [ ] **Step 2: Run to see them fail**

Run: `npm --prefix apps/web run test -- --run src/components/features/decisions src/components/features/search/CommandPalette.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`DecisionAddress.tsx`:

```tsx
/** `/sentenze/…` opens the search space with the decision's tab (design 2026-10-05 §3): the
 *  address stays the contract LibreLex and the Massimario's links build, the page is the tab. */
export function DecisionAddress() {
  const params = useParams<{ corte?: string; numero?: string; anno?: string }>();
  const [search] = useSearchParams();
  const requestOpenDecision = useAppStore((s) => s.requestOpenDecision);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);
  const parsed = params.corte ? parseDecisionPath(params, search) : null;
  useEffect(() => {
    if (parsed?.ok) requestOpenDecision(parsed.reference);
    else openCommandPalette();
    // the address is read once, as the route mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Navigate to="/" replace />;
}
```

`Navigate` is a child, so its effect (the navigation) runs before this component's effect (the store write), and `/` may mount before `pendingDecision` is set. That is fine because `SearchPanel` drains on every change of `pendingDecision` (below), not only on mount. The StrictMode test pins it.

`SearchPanel.tsx`: `const pendingDecision = useAppStore(s => s.pendingDecision); const drainPendingDecision = useAppStore(s => s.drainPendingDecision); useEffect(() => { if (pendingDecision) drainPendingDecision(); }, [pendingDecision, drainPendingDecision]);`.

`App.tsx`: replace both `DecisionPage` routes' elements with `<DecisionAddress />` (no `Suspense` needed: it is tiny; import it directly) and remove the lazy `DecisionPage` import.

`Sidebar.tsx`: «Sentenze» becomes a button-like `NavItem` that calls `openCommandPalette()` and `navigate('/')` (read `NavItem` to see whether it accepts `onClick` without `to`; if not, render a `button` with the same classes). Gotcha 27: the palette lives in `SearchPanel`, hence the navigation.

`CommandPalette.tsx`: compute `const decisionRef = useMemo(() => inputValue.length >= 4 ? parseDecisionCitation(inputValue, { aliasTriggers: customAliases.map(a => a.trigger) }) : null, [inputValue, customAliases]);`. When `decisionRef` is set: the indicator line shows a gavel icon and «Sentenza → {formatDecisionShort(decisionRef, { sezione: decisionRef.sezione })}» with «Invio apre»; Enter calls `openDecisionTab(decisionRef)` then `onClose()`; the norm parser's indicator and the server fallback are skipped (`localCitation`/`serverResult` effect guarded by `!decisionRef`). The placeholder becomes «Es. 'art 2043 cc' o 'Cass. civ. 10787/2024'».

`DecisionLink.tsx`:

```tsx
export function DecisionLink({ to, besideTabId, className, title, children }: DecisionLinkProps) {
  const path = linkableDecisionPath(to);
  const navigate = useNavigate();
  const onSearchPage = useLocation().pathname === '/';
  const openDecisionTab = useAppStore((s) => s.openDecisionTab);
  if (!path) return <span className={className} title={title}>{children}</span>;
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!onSearchPage) { navigate(path); return; }
    const parsed = parseDecisionPath(pathParams(path), new URL(path, window.location.origin).searchParams);
    if (parsed.ok) openDecisionTab(parsed.reference, { besideTabId });
  };
  return <a href={path} onClick={onClick} className={className} title={title}>{children}</a>;
}
```

with `pathParams(path)` splitting `/sentenze/<corte>/<numero>/<anno>` (a four-line helper beside it, tested through the component). `DecisionChip.tsx` renders `<DecisionLink to={pronuncia} className={`${CHIP} hover:underline`} title={pronuncia.label}>{pronuncia.label}</DecisionLink>`; the plain-span branch is `DecisionLink`'s own.

- [ ] **Step 4: Run tests, build, lint**

Run: `npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint`
Expected: pass. `DecisionChip`'s tests (`features/merlt/rassegne/__tests__`) need a router and may need the store; adapt their render helper, not their assertions.

- [ ] **Step 5: Update `apps/web/CLAUDE.md`**: the `App.tsx` bullet (`/sentenze…` redirect into the search space), the `decisions` folder bullet (`DecisionView`, `DecisionTabView`, `DecisionAddress`, `DecisionLink`), a «Decisions in the workspace» paragraph under «Reading surface» (tab `view`, one tab per decision, beside, persisted by identity, `fetchDecisionCached`), and `decisionCitationParser.ts` and `decisionFetchCache.ts` in «Shared utilities».

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src apps/web/CLAUDE.md
git commit -m "feat(web): /sentenze opens the search space, one box for norms and decisions, links that open beside"
```

**PR 2:** title «feat: decisions open in the search space, in a tab of their own beside the article»; body: what the Sentenze page became, screenshots from a browser pass (Task 25's checklist for this PR's part: palette, `/sentenze/…` cold and after login, a Massimario chip, a phone width). Merge: `merge: feat/decision-tabs — decisions in the search space, from the palette, the address and the links`.

---

## PR 3 — `feat/article-case-law` (apps/web)

### Task 15: The search service and the result list

**Files:**
- Modify: `apps/web/src/types/decisions.ts` (`DecisionSearchHit`, `SearchDecisionsAnswer`)
- Create: `apps/web/src/services/decisionSearchService.ts`
- Create: `apps/web/src/components/features/decisions/DecisionResultList.tsx`
- Test: `apps/web/src/services/__tests__/decisionSearchService.test.ts`, `apps/web/src/components/features/decisions/DecisionResultList.test.tsx`

**Interfaces:**
- Produces:
  - `interface DecisionSearchHit { identita: DecisionIdentity; attributi: DecisionAttributes; trovata: 'indice' | 'testo'; frammento: { testo: string; evidenziati: Array<[number, number]> } | null }`
  - `type SearchDecisionsAnswer = { esito: 'risultati'; totale: number; totale_approssimato?: boolean; pagina: number; modo: 'indice' | 'testo'; archivio: DecisionArchive | null; archivio_dal: string | null; decisioni: DecisionSearchHit[] } | { esito: 'non_supportata' } | { esito: 'richiesta_non_valida'; errori: Record<string, string> } | { esito: 'fonte_non_raggiungibile'; fonte: string } | { esito: 'errore_interno' }`
  - `searchDecisions(query: DecisionSearchQuery, pagina: number, modo?: 'indice' | 'testo'): Promise<SearchDecisionsAnswer>` (same handling of 429 and non-answers as `fetchDecision`)
  - `DecisionResultList({ query, besideTabId, onArchiveChange? })` — loads page 1 on mount, «Altri risultati» appends the next page (up to 10), shows the count line, the archive switch (Civile / Penale / Entrambi), and, when the query has an article, the switch «Indice della Cassazione» / «Nel testo» (`aria-pressed`, default the index; it shows the `modo` the answer reports, so an act searched in the text because the index cannot express it shows «Nel testo» pressed and the index button disabled with the title «L'indice della Cassazione non esprime questo atto»), per-state messages. Each row's kind is the label of its `trovata`: «norma citata (indice della Cassazione)» or «menzionato nel testo»; a row without a fragment shows none. With `totale_approssimato` the count reads «circa N».

- [ ] **Step 1: Failing tests.** Service: posts to `/search_decisions` through `legalFetch` with `{ norma, tema, archivio, pagina }` (no `normaLabel`); 429 → `fonte_non_raggiungibile` `quota`; a body without a known `esito` → `fonte_non_raggiungibile` `risposta <status>`. List:

```tsx
it('labels each row by how it was found', async () => {
  mockSearch({ esito: 'risultati', totale: 3904, pagina: 1, modo: 'indice', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [{ ...HIT, trovata: 'indice', frammento: null }] });
  render(<Wrapper><DecisionResultList query={{ norma: NORMA, normaLabel: 'art. 2043 c.c.' }} /></Wrapper>);
  expect(await screen.findByText('norma citata (indice della Cassazione)')).toBeInTheDocument();
  expect(screen.getByText('3.904 decisioni nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Indice della Cassazione' })).toHaveAttribute('aria-pressed', 'true');
});
it('switches to the text and says so', async () => {
  mockSearch(PAGE_INDEX); mockSearch({ ...PAGE_TEXT, modo: 'testo' });
  render(<Wrapper><DecisionResultList query={{ norma: NORMA, normaLabel: 'art. 2043 c.c.' }} /></Wrapper>);
  await userEvent.click(await screen.findByRole('button', { name: 'Nel testo' }));
  expect(searchMock).toHaveBeenLastCalledWith(expect.anything(), 1, 'testo');
  expect(await screen.findByText('menzionato nel testo')).toBeInTheDocument();
});
it('shows the count, the coverage and each row as «menzionato nel testo»', async () => {
  mockSearch({ esito: 'risultati', totale: 312, pagina: 1, modo: 'testo', archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [{ ...HIT, trovata: 'testo' }] });
  render(<Wrapper><DecisionResultList query={{ norma: NORMA, normaLabel: 'art. 2043 c.c.' }} /></Wrapper>);
  expect(await screen.findByText('312 decisioni nell’archivio pubblico della Cassazione (dal 4 gennaio 2021)')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Cass\. civ\., sez\. lav\., n\. 24908\/2026/ })).toHaveAttribute('href', '/sentenze/cassazione-civile/24908/2026');
  expect(screen.getByText('menzionato nel testo')).toBeInTheDocument();
});
it('emphasises the matched words as text, never as HTML', async () => {
  mockSearch({ ...PAGE, decisioni: [{ ...HIT, frammento: { testo: 'ex art. 2043 c.c. <img src=x onerror=alert(1)>', evidenziati: [[3, 17]] } }] });
  const { container } = render(<Wrapper><DecisionResultList query={{ tema: 'x y' }} /></Wrapper>);
  await screen.findByText('art. 2043 c.c.', { selector: 'mark' });
  expect(container.querySelector('img')).toBeNull();
});
it('says the act is not supported, and a source that is down, with «Riprova»', async () => { /* non_supportata → «La ricerca nelle sentenze non è disponibile per questo atto.»; fonte_non_raggiungibile → «L'archivio della Cassazione non risponde in questo momento.» + Riprova */ });
it('appends the next page and stops at the tenth', async () => { /* totale 400: «Altri risultati» until pagina 10, then absent, with «Mostrate le prime 200: restringi la ricerca con un tema.» */ });
```

Write the two elided tests in full, in the same style, before running. At the top of the file define the shared values these tests use: `NORMA` (`{ tipo_atto: 'codice civile', numero_articolo: '2043' }`), `HIT` (a `DecisionSearchHit` for n. 24908/2026 civile, sez. L, ordinanza deposited 2026-09-01, `trovata: 'indice'`, a fragment `{ testo: 'ex art. 2043 c.c.', evidenziati: [[3, 17]] }`), `PAGE`, `PAGE_INDEX` and `PAGE_TEXT` (risultati pages with `modo` 'indice' and 'testo'), `searchMock = vi.mocked(searchDecisions)` after `vi.mock('../../../../services/decisionSearchService')`, and `mockSearch(answer)` = `searchMock.mockResolvedValueOnce(answer)`; `Wrapper` = a `MemoryRouter`.

- [ ] **Step 2: Run to see them fail.** `npm --prefix apps/web run test -- --run src/services/__tests__/decisionSearchService.test.ts src/components/features/decisions/DecisionResultList.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** The service mirrors `decisionService.ts` (copy its `isAnswer` pattern with the five `esito` values). The list: rows as `<li>` with a `DecisionLink` (label `formatDecisionShort(identita, attributi)`), then «{tipo} depositata il {formatDateItalianLong(data_deposito)}» via `withPreposition`, then the fragment:

```tsx
function Fragment({ testo, evidenziati }: DecisionSearchHit['frammento']) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of [...evidenziati].sort((a, b) => a[0] - b[0])) {
    if (s < at || e > testo.length || s >= e) continue; // overlapping or out of range: skipped, never thrown
    if (s > at) parts.push(testo.slice(at, s));
    parts.push(<mark key={s} className="bg-amber-100 dark:bg-amber-900/40">{testo.slice(s, e)}</mark>);
    at = e;
  }
  parts.push(testo.slice(at));
  return <p className="text-sm text-slate-600 dark:text-slate-300">…{parts}…</p>;
}
```

and the chip with the row's kind (`text-xs` slate pill: «norma citata (indice della Cassazione)» or «menzionato nel testo»). The count line: `${totale.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} decisioni nell’archivio pubblico della Cassazione` + ` (${withPreposition('dal', formatDateItalianLong(archivio_dal))})` when known (memory gotcha: `Intl` it-IT groups 4 digits only with `useGrouping: 'always'`). Zero results: «Nessuna decisione negli ultimi cinque anni dell’archivio pubblico della Cassazione.» — never «nessuna decisione». The archive switch is a three-button segmented control (`aria-pressed`), defaulting to the answer's `archivio`.

- [ ] **Step 4: Run tests, build, lint.** Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/decisions.ts apps/web/src/services apps/web/src/components/features/decisions
git commit -m "feat(web): the list of decisions that mention an article or a topic"
```

### Task 16: «Giurisprudenza» under the article

**Files:**
- Create: `apps/web/src/components/features/search/CaseLawSection.tsx`
- Modify: `apps/web/src/components/features/search/MassimeSection.tsx` (court and number as `DecisionLink`; short label)
- Modify: `apps/web/src/components/features/search/BrocardiDisplay.tsx` (the massime leave it; it keeps everything else)
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (renders `CaseLawSection` after the text, before `BrocardiDisplay`; the Massimario panel's slot moves inside it)
- Modify: `apps/web/src/plugins/registry.tsx` (the rassegne panel registers in a slot `article_case_law` that `CaseLawSection` hosts)
- Test: `apps/web/src/components/features/search/CaseLawSection.test.tsx`, `MassimeSection.test.tsx` (new)

**Interfaces:**
- Consumes: Task 14 `DecisionLink`, Task 15 `DecisionResultList`, `linkableDecisionPath`, `formatDecisionShort`.
- Produces: `CaseLawSection({ norma, massime, articleUrn, tabId, isHistorical })`; `massimaDecisionRef(m: MassimaStructured): LooseDecisionRef | null` (exported from `MassimeSection.tsx`'s sibling `massimaRef.ts` for testing).

- [ ] **Step 1: Failing tests.**

```ts
// massimaRef.test.ts
it.each([
  [{ autorita: 'Cass. civ.', numero: '10787', anno: '2024' }, { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }],
  [{ autorita: 'Cass. pen.', numero: '5', anno: '2023' }, { corte: 'cassazione', archivio: 'penale', numero: 5, anno: 2023 }],
  [{ autorita: 'Cassazione', numero: '2633', anno: '1982' }, { corte: 'cassazione', numero: 2633, anno: 1982 }],
  [{ autorita: 'Corte cost.', numero: '71', anno: '2020' }, { corte: 'corte_costituzionale', numero: 71, anno: 2020 }],
  [{ autorita: 'Cons. Stato', numero: '1', anno: '2020' }, null],
  [{ autorita: 'Cass. civ.', numero: null, anno: '2020' }, null],
])('%o', (m, ref) => expect(massimaDecisionRef({ massima: 'x', ...m })).toEqual(ref));
```

`CaseLawSection.test.tsx`: closed by default with the heading «Giurisprudenza»; opened, it shows «Massime (Brocardi)» with «Fonte: Brocardi.it» and a link per linkable massima, the Massimario slot, and «Cassazione — menzionano l’articolo» with the button «Cerca nell’archivio della Cassazione»; **no request to `/search_decisions` before the button is pressed** (assert the mocked service was not called), one after; on a past text (`isHistorical`) the section is shown too.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `massimaRef.ts`:

```ts
const COURTS: Array<[RegExp, Omit<LooseDecisionRef, 'numero' | 'anno'>]> = [
  [/^cass(?:azione)?\.?\s*civ/i, { corte: 'cassazione', archivio: 'civile' }],
  [/^cass(?:azione)?\.?\s*pen/i, { corte: 'cassazione', archivio: 'penale' }],
  [/^cass(?:azione)?\.?$/i, { corte: 'cassazione' }],
  [/^(?:corte\s+cost|c\.\s*cost)/i, { corte: 'corte_costituzionale' }],
];

/** The decision a Brocardi massima names, when its court is one VisuaLex reads (convention §4.4). */
export function massimaDecisionRef(m: MassimaStructured): LooseDecisionRef | null {
  const autorita = m.autorita?.trim() ?? '';
  const numero = Number(m.numero);
  const anno = Number(m.anno);
  if (!Number.isInteger(numero) || !Number.isInteger(anno) || numero < 1) return null;
  const court = COURTS.find(([re]) => re.test(autorita));
  return court ? { ...court[1], numero, anno } : null;
}
```

In `MassimeSection`, replace the `autorita` pill and the `n. X/Y` span by one `DecisionLink` (label `formatDecisionShort(ref)`, the pill's colour classes kept) when `massimaDecisionRef(m)` is not null, else the existing pill and span. `CaseLawSection`: a `DossierActBlock`-style accordion (`<h3>` with the toggle inside, `aria-expanded`), its open state in a `useState` initialised from `sessionStorage` per `tabId` (wrapped in try/catch), three `<section>`s each with an `<h4>`. The third holds the button, then `<DecisionResultList query={{ norma: pick(norma), normaLabel }} besideTabId={tabId} />` once pressed. `normaLabel` is `formatNormCitation`'s short form if available in `utils/sources`, else `formatCitation(norma)` from `normaMeta.ts` (use whichever the convention's PR 1a has made canonical by then; say which in the commit). Move the `article_content_after` rassegne registration to a new slot `article_case_law` hosted by `CaseLawSection` (`<PluginSlot slot="article_case_law" props={{ articleUrn, isHistorical }} />`), and check `plugins/` types for the slot union.

- [ ] **Step 4: Run tests, build, lint.** Expected: pass. Existing `BrocardiDisplay.test.tsx` cases about massime move to `MassimeSection.test.tsx`/`CaseLawSection.test.tsx`; none is deleted.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): «Giurisprudenza» under the article — massime as links, the Massimario, the Cassazione on request"
```

### Task 17: A topic, from the glossary or the palette

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionSearchTabView.tsx`
- Modify: `apps/web/src/components/features/search/BrocardiDisplay.tsx` (`GlossarioSection`: «Sentenze su questo tema» per term)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx`, `SearchPanel.tsx` (the `decision-search` branch)
- Modify: `apps/web/src/components/features/search/CommandPalette.tsx` («Cerca "<parole>" nelle sentenze della Cassazione»)
- Test: `DecisionSearchTabView.test.tsx`; `BrocardiDisplay.test.tsx` (add); `CommandPalette.test.tsx` (add)

**Interfaces:**
- Consumes: Task 12 `openDecisionSearchTab`, Task 15 `DecisionResultList`.
- Produces: `DecisionSearchTabView({ tabId, query })` — heading «Tema: {tema}», the article named when the query has one («… e art. 2043 c.c.»), the switch «Solo il tema» (`aria-pressed`) that re-runs the list without `norma`, the limits line «Solo la Cassazione, ultimi cinque anni; le parole come sono scritte.», and `DecisionResultList`.

- [ ] **Step 1: Failing tests.** Glossary: each term shows a link to Brocardi (unchanged) and a button «Sentenze su questo tema» that calls `openDecisionSearchTab({ tema: 'danno ingiusto', norma, normaLabel }, 'Tema: danno ingiusto', { besideTabId })`. Tab view: renders the heading and the article; pressing «Solo il tema» re-queries without `norma` (assert the service's second call). Palette: «perdita di chance» (no norm, no decision) shows the line «Cerca "perdita di chance" nelle sentenze della Cassazione»; Enter on it opens a search tab with `{ tema: 'perdita di chance' }`; «art 2043 cc» never shows that line.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `BrocardiDisplay` needs the article and the tab: pass `currentNorma` (it already gets the act; add `numero_articolo` and `tabId` props from `ArticleTabContent`). In the palette, the topic line is a `Command.Item` rendered when `inputValue.trim().length >= 3 && !parsedCitation && !decisionRef && !resolvingRemotely`, value `cerca-sentenze ${inputValue}`, `onSelect` → `openDecisionSearchTab({ tema: inputValue.trim() }, `Tema: ${inputValue.trim()}`)` then `onClose()`. Replace Task 13's `null` branch with `<DecisionSearchTabView tabId={tab.id} query={tab.view.query} />` in both the window and the phone view.

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): a topic from Brocardi's glossary or the palette finds the decisions that use it"
```

**PR 3:** title «feat: the case law of an article, and topics through the glossary»; merge: `merge: feat/article-case-law — massime as links, the Cassazione's decisions mentioning an article, topics`.

---

## PR 4 — `feat/decision-annotations` (apps/web)

### Task 18: The decision renderer and its contract

> **Amended 5 October (the Sentenze session's review; privacy).** `decisionTexts.ts` holds synthetic decision texts that exercise every shape (blocks with edge whitespace, single `\n` line wraps, `\n\n` paragraphs, an epigrafe without a motivazione) and, if wanted, Corte costituzionale texts checked to name no private person — never a Cassazione text read from a real record. `decisionProjection` strips each block's edges before concatenating (spec §8.2), and the renderer renders each block's stripped text, so the rendered text nodes still spell the projection; add a test with a block whose edges carry spaces.

**Files:**
- Create: `apps/web/src/utils/decisionRender.ts`
- Create: `apps/web/src/utils/__fixtures__/decisionTexts.ts` (the texts Task 9 freezes — the Cassazione PDF fixtures read by `text_from_pdf`, the two text-field fallbacks, the Corte costituzionale sample — as `DecisionText` objects: copy them from the readers' outputs, recorded by a scratch run of the Python readers, byte for byte — compare SHA-256 of each string between the Python output and the TS fixture before committing, memory `subagent_byte_fidelity`)
- Test: `apps/web/src/utils/__tests__/decisionRender.test.ts`

**Interfaces:**
- Consumes: `resolveAnchors` (`articleAnnotations.ts`), `decisionParagraphs` (`decisionText.ts`), `Highlight`, `Annotation` types.
- Produces:
  - `decisionProjection(testo: DecisionText): string`
  - `renderDecisionHtml(input: { testo: DecisionText; highlights: readonly Highlight[]; annotations: readonly Annotation[]; hiddenHighlights?: boolean }): string`
  - `unmatchedAnchors(testo, highlights, annotations): { highlights: Highlight[]; annotations: Annotation[] }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { decisionProjection, renderDecisionHtml, unmatchedAnchors } from '../decisionRender';
import { DECISION_TEXTS } from '../__fixtures__/decisionTexts';

function textNodes(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n.nodeValue ?? '');
  return out.join('');
}

const hl = (startOffset: number, text: string, id = `h${startOffset}`) =>
  ({ id, text, startOffset, color: 'yellow', normaKey: 'k', articleId: '', range: '', createdAt: '' }) as never;

describe('renderDecisionHtml', () => {
  for (const [name, testo] of Object.entries(DECISION_TEXTS)) {
    it(`${name}: the text nodes spell the projection, with marks on`, () => {
      const plain = decisionProjection(testo);
      const marks = [hl(10, plain.slice(10, 40)), hl(plain.length - 30, plain.slice(-30))];
      expect(textNodes(renderDecisionHtml({ testo, highlights: marks, annotations: [] }))).toBe(plain);
    });
  }

  it('a highlight across two blocks renders in both, and the HTML stays well-formed', () => {
    const testo = { motivazione: 'Primo paragrafo.\n\nSecondo.', dispositivo: 'P.Q.M. rigetta.' };
    const plain = decisionProjection(testo);
    const start = plain.indexOf('Secondo');
    const html = renderDecisionHtml({ testo, highlights: [hl(start, plain.slice(start, start + 14))], annotations: [] });
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.innerHTML).toBe(html); // the browser kept it as written: nothing to repair
    expect(root.querySelectorAll('mark').length).toBe(2);
    expect([...root.querySelectorAll('mark')].map((m) => m.textContent).join('')).toBe('Secondo.P.Q.M.');
  });

  it('escapes the text', () => {
    const html = renderDecisionHtml({ testo: { motivazione: '<img src=x onerror=alert(1)> & "q"' }, highlights: [], annotations: [] });
    expect(html).not.toContain('<img');
    expect(textNodes(html)).toBe('<img src=x onerror=alert(1)> & "q"');
  });

  it('lists what does not land, never drops it', () => {
    const testo = { motivazione: 'Il ricorso è fondato.' };
    const gone = hl(3, 'testo cambiato');
    const out = unmatchedAnchors(testo, [gone, hl(3, 'ricorso')], []);
    expect(out.highlights).toEqual([gone]);
  });

  it('a decision without its text lists every anchor', () => {
    const all = [hl(0, 'x')];
    expect(unmatchedAnchors({}, all, []).highlights).toEqual(all);
  });
});
```

- [ ] **Step 2: Run to see it fail.**

- [ ] **Step 3: Implement.** The structure is `DecisionTextView`'s, as HTML; marks and notes are cut at every line edge with a stack, as `renderArticleHtml` does (read it first and reuse its helpers if they are exported; if not, write the cutting here — a mark open at a line's end is closed and reopened at the next line's start):

```ts
/**
 * A decision's text as HTML, with the reader's marks (design 2026-10-05 §8.3). The projection —
 * the blocks in reading order, concatenated, minus every \n — is what anchors count in, as
 * article_text is for articles (root rule 23): the rendered text nodes spell it exactly; labels,
 * the space between lines and paragraphs are CSS. Every text node is escaped.
 */
const BLOCKS: Array<[keyof DecisionText, string]> = [['epigrafe', 'Epigrafe'], ['motivazione', 'Motivazione'], ['dispositivo', 'Dispositivo']];

export function decisionProjection(testo: DecisionText): string {
  // each block stripped of ASCII whitespace at its edges (spec §8.2), as the API's freeze test
  // computes it: never `.trim()`, which also strips the no-break space and other Unicode spaces
  return BLOCKS.map(([k]) => (testo[k] ?? '').replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')).join('').replace(/\n/g, '');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Span { start: number; end: number; open: string; close: string }

function marksFor(plain: string, highlights: readonly Highlight[], annotations: readonly Annotation[], hidden: boolean): Span[] {
  return resolveAnchors(plain, highlights, annotations).flatMap((a): Span[] => {
    if (a.kind === 'highlight') {
      if (hidden) return [];
      return [{ start: a.start, end: a.end, open: `<mark class="vlx-hl" data-highlight-id="${esc(a.highlight.id)}" style="background-color:hsl(var(--hl-${esc(a.highlight.color)}-bg))">`, close: '</mark>' }];
    }
    if (a.kind === 'note') return [{ start: a.start, end: a.end, open: `<span class="vlx-note-anchor" data-annotation-id="${esc(a.note.id)}">`, close: '</span>' }];
    return [];
  });
}

export function renderDecisionHtml({ testo, highlights, annotations, hiddenHighlights = false }: RenderDecisionInput): string {
  const plain = decisionProjection(testo);
  const spans = marksFor(plain, highlights, annotations, hiddenHighlights);
  let offset = 0;
  const line = (text: string): string => {
    const from = offset, to = offset + text.length;
    offset = to;
    const cuts = new Set([from, to]);
    for (const s of spans) for (const p of [s.start, s.end]) if (p > from && p < to) cuts.add(p);
    const points = [...cuts].sort((a, b) => a - b);
    let html = '';
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const covering = spans.filter((s) => s.start <= a && s.end >= b);
      html += covering.map((s) => s.open).join('') + esc(plain.slice(a, b)) + covering.map((s) => s.close).reverse().join('');
    }
    return `<span class="vlx-dec-line">${html}</span>`;
  };
  return BLOCKS.map(([key, name]) => {
    const text = testo[key];
    if (!text) return '';
    const label = key === 'epigrafe' && !testo.motivazione ? 'Testo' : name;
    const paras = decisionParagraphs(text).map((lines) => `<p class="vlx-dec-para">${lines.map(line).join('')}</p>`).join('');
    return `<section class="vlx-dec-block" data-label="${label}" aria-label="${label}">${paras}</section>`;
  }).join('');
}

export function unmatchedAnchors(testo: DecisionText, highlights: readonly Highlight[], annotations: readonly Annotation[]) {
  const plain = decisionProjection(testo);
  const landed = resolveAnchors(plain, highlights, annotations);
  const hl = new Set(landed.flatMap((a) => (a.kind === 'highlight' ? [a.highlight.id] : [])));
  const nt = new Set(landed.flatMap((a) => (a.kind === 'note' ? [a.note.id] : [])));
  return { highlights: highlights.filter((h) => !hl.has(h.id)), annotations: annotations.filter((a) => !nt.has(a.id)) };
}
```

Read `renderArticleHtml`'s mark markup (class names, the `style` with the CSS variable, the note anchor's class and data attribute) and use exactly the same strings, so the existing CSS and click handlers (`InlineNotePopover`, highlight removal) work on decisions unchanged. A highlight that covers a whole line yields one segment per line: each segment is self-contained, which is what keeps the HTML well-formed (the cross-block test). `decisionParagraphs` drops `\n` and keeps every other character, so `offset` advances by exactly the projection's characters; the first test proves it on real texts.

- [ ] **Step 4: Run tests.** `npm --prefix apps/web run test -- --run src/utils/__tests__/decisionRender.test.ts` → pass. Prove it bites: render with a deliberately dropped space and see the first test fail; revert.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/decisionRender.ts apps/web/src/utils/__fixtures__/decisionTexts.ts apps/web/src/utils/__tests__/decisionRender.test.ts
git commit -m "feat(web): render a decision's text with marks, under the same contract as article_text"
```

### Task 19: The decision's reading surface and its links to norms

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionReadingSurface.tsx`
- Create: `apps/web/src/hooks/useCitationLinks.ts` (the click/hover handlers of `ArticleTabContent`'s citation effect, extracted)
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (uses `useCitationLinks`)
- Modify: `apps/web/src/components/features/search/ArticleBody.tsx` (`className` prop for the text root, default `'vlx-art'`)
- Modify: `apps/web/src/components/features/decisions/DecisionView.tsx` (`textSlot`)
- Modify: `apps/web/src/types/index.ts` (`SearchParams.besideTabId?: string`), `apps/web/src/components/features/search/SearchPanel.tsx` (a result tab created for a search with `besideTabId` is placed with `placeTabsSideBySide`)
- Test: `DecisionReadingSurface.test.tsx`, `apps/web/src/hooks/__tests__/useCitationLinks.test.tsx`

**Interfaces:**
- Consumes: Task 18; `ArticleBody`; `wrapCitationsInHtml`; `CitationPreviewPopup` + `useCitationPreview`; `pushReadingBack`.
- Produces: `DecisionReadingSurface({ tabId, identity, testo })`; `useCitationLinks(containerRef, { onOpen(parsed): void, origin?: ReadingBackEntry })`.

- [ ] **Step 1: Failing tests.** Surface: «art. 2043 c.c.» in a decision's text renders as `.citation-hover`; clicking it calls `triggerSearch` with `{ act_type: 'codice civile', article: '2043', besideTabId: tabId }` and pushes a back entry labelled with the decision's short form; the text nodes of the rendered surface spell `decisionProjection(testo)` (the citation spans wrap, never add); `useCitationLinks` keeps the article tab's behaviour (its existing tests in `ArticleTabContent` stay green).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** Extract the `useEffect` at «Handle citation hover and click events» of `ArticleTabContent` into `useCitationLinks(containerRef, { onOpen, origin, showPreview, hidePreview, isHoveringPopupRef })`, the article tab passing its own `onOpen` (same-act jump or `triggerSearch`, as now). The surface:

```tsx
const html = useMemo(() => wrapCitationsInHtml(renderDecisionHtml({ testo, highlights, annotations, hiddenHighlights })), [testo, highlights, annotations, hiddenHighlights]);
// …
<ArticleBody contentRef={contentRef} itemKey={decisionKey(identity)} processedContent={html}
  className="vlx-art vlx-decision"
  onPopupHighlight={…} onPopupAddNote={…} onPopupCopy={copySelectionAsRead} />
```

`wrapCitationsInHtml(html)` with no `defaultNorma`: a bare «art. 5» with no act stays text. `copySelectionAsRead` reads `window.getSelection()` and returns `decisionClipboardText(range.cloneContents())` (the existing `DecisionTextView` copy rule). Back entry: `{ tabId, blockId: tabId, articleId: '', label: formatDecisionShort(identity, attrs) }` — read `ReadingBackEntry` and `popReadingBack`/`findLiveBackIndex`: a decision tab has no block; if the back-stack requires a live block, extend `findLiveBackIndex` to accept a tab whose `view` is a decision when `blockId === tabId`, with a test. In `SearchPanel`, where a search's destination tab is created (`processResult` / the `targetTabId` logic around «workspaceTabs[workspaceTabs.length - 1].id»), once the tab exists and the params carry `besideTabId`, call `placeTabsSideBySide(params.besideTabId, newTabId)`: the decision the reader came from goes to the left half, the article to the right. Add a `SearchPanel` test for it if the file has a test harness; otherwise test `placeTabsSideBySide` in the store test and check the placement in the browser pass.

`DecisionView` renders `textSlot ?? <DecisionTextView testo={…} />`; `DecisionTabView` passes `<DecisionReadingSurface …/>` (Task 20 adds the marks; this task passes empty arrays).

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): a decision's text links the norms it cites, and they open beside it"
```

### Task 20: Notes and highlights on a decision, never lost

> **Amended 2026-10-07 (the owner: «gli stessi tool di note, evidenziazioni e commenti»; spec §8.3).** The tools are the article's, not a version of them: `SelectionPopup` (same colours), `InlineNoteComposer`/`InlineNotePopover`, `NotesPeekPanel`, the highlight toggle and `HighlightsActionsPicker` in the same `ReadingToolbar` places, **and the round-B signs**: `renderDecisionHtml` takes `signs: true` and ends each annotated `p.vlx-dec-para` with the empty `span.vlx-sign`, `useArticleTextInteractions` opens `BlockAnnotationsPopover` on it (`describeBlock` names a paragraph by its opening words). Where a component needs something only an article has (`versionInfo`, Brocardi, the saved-norm watcher) the decision passes nothing and the feature is off; a component that would need a decision branch inside it is a finding, not a fix. Add to the tests: the sign appears on an annotated paragraph, its popover lists the paragraph's notes and highlights, the rendered text nodes still spell the projection with the signs on (Task 18's contract test, `signs: true`).

**Files:**
- Modify: `apps/web/src/components/features/decisions/DecisionReadingSurface.tsx`
- Create: `apps/web/src/components/features/decisions/UnmatchedAnchors.tsx`
- Modify: `apps/web/src/components/features/decisions/DecisionView.tsx` (a decision without its text still hosts the box)
- Test: `DecisionReadingSurface.test.tsx` (add), `UnmatchedAnchors.test.tsx`

**Interfaces:**
- Consumes: the store's `loadHighlightsForArticle(normaKey, articleId)`, `loadAnnotationsForArticle`, `addHighlight(normaKey, articleId, text, range, color, startOffset)`, `addAnnotation(normaKey, articleId, text, anchor)`, their delete actions; `InlineNoteComposer`, `InlineNotePopover`, `NotesPeekPanel`, `HighlightsActionsPicker` (read their props in `ArticleTabContent`).
- Produces: `UnmatchedAnchors({ highlights, annotations, reason: 'changed' | 'no_text', onRemoveHighlight, onRemoveAnnotation })`.

- [ ] **Step 1: Failing tests.**

```tsx
it('loads, renders and creates highlights under the decision key', async () => {
  // store mocked: loadHighlightsForArticle resolves; highlights for 'cassazione:civile:10787:2024' / ''
  render(<Surface identity={ID} testo={{ motivazione: 'Il ricorso è fondato.' }} />);
  expect(loadHighlights).toHaveBeenCalledWith('cassazione:civile:10787:2024', '');
  selectText('ricorso'); await userEvent.click(screen.getByRole('button', { name: /Evidenzia/ }));
  expect(addHighlight).toHaveBeenCalledWith('cassazione:civile:10787:2024', '', 'ricorso', expect.any(String), 'yellow', 3);
});
it('lists a highlight whose words are gone, with its text, and removes it on request', async () => {
  seedHighlights([{ ...H, startOffset: 3, text: 'parole sparite' }]);
  render(<Surface identity={ID} testo={{ motivazione: 'Il ricorso è fondato.' }} />);
  const box = await screen.findByRole('region', { name: 'Non ritrovate nel testo attuale (1)' });
  expect(within(box).getByText('«parole sparite»')).toBeInTheDocument();
  expect(within(box).getByText('Il testo della fonte è cambiato dopo che le hai create.')).toBeInTheDocument();
  await userEvent.click(within(box).getByRole('button', { name: 'Rimuovi evidenziazione «parole sparite»' }));
  expect(removeHighlight).toHaveBeenCalledWith(H.id);
});
it('a decision found without its text lists every note and highlight under the notice', async () => {
  seedHighlights([H]); seedAnnotations([N]);
  render(<DecisionTabViewWith answer={{ ...FOUND, testo: {}, avvisi: [{ tipo: 'testo_non_disponibile' }], attributi: { testo_assente: 'oscuramento' } }} />);
  expect(await screen.findByRole('region', { name: 'Non ritrovate nel testo attuale (2)' })).toBeInTheDocument();
  expect(screen.getByText(/in fase di oscuramento/)).toBeInTheDocument();
});
it('takes no notes without an identity (an ambiguous reference)', () => { /* no selection popup actions but «Copia» */ });
```

Write `selectText`, `seedHighlights`, `seedAnnotations` helpers in the test file following `DossierItemReader.test.tsx`'s way of selecting text and seeding the store (read it first).

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** In the surface: `const key = decisionKey(identity)`; load on mount (`loadHighlightsForArticle(key, '')`, `loadAnnotationsForArticle(key, '')`), select from the store with `h.normaKey === key && h.articleId === ''`; the popup handlers call the store as `ArticleTabContent`'s do with `(key, '')` (copy their bodies: the selection rect captured eagerly, gotcha 16); the toolbar row above the text holds «Note» (opens `NotesPeekPanel` for `(key, '')`) and the highlights picker (visibility toggle → `hiddenHighlights`). Below the text, `UnmatchedAnchors` with `unmatchedAnchors(testo, highlights, annotations)` when either list is non-empty. `UnmatchedAnchors` is a `<section aria-label="Non ritrovate nel testo attuale (n)">` with the explanation for `changed` («Il testo della fonte è cambiato dopo che le hai create.») or `no_text` («La fonte non mostra più il testo di questa decisione: le tue note ed evidenziazioni restano qui.»), one row per anchor with its quote, colour stripe (4 px, UI conventions «Colour markers»), note content, and a remove button with an explicit name. Removing a highlight or a note uses the store's delete actions (with their undo as elsewhere; no `window.confirm`).

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): notes and highlights on decisions — anchored like an article's, and listed when the text changes"
```

### Task 21: Annotations on decisions travel, but never words a court withdrew

**Files:**
- Create: `apps/web/src/utils/decisionAnchorsTravel.ts`
- Create: `apps/web/src/components/features/environments/annotationLabels.ts`
- Modify: every place where the user's annotations and highlights leave the account — find them all first with `git grep -n "annotations\|highlights" -- apps/web/src/components/features/environments apps/web/src/components/features/bulletin apps/web/src/store/useAppStore.ts` and list them in the commit message. Known today: `store/useAppStore.ts` `createEnvironment` (`fromCurrent` copies the slices), `environments/CreateEnvironmentModal.tsx` (the selection given to `onCreate`), the environment export to a file if one exists, `bulletin/EditSharedEnvironmentModal.tsx` (publishing to the Forum), `bulletin/AddItemsDialog.tsx` (items offered as suggestions).
- Modify: `apps/web/src/components/features/environments/EnvironmentContentViewer.tsx` and `bulletin/SuggestionItemCard.tsx` if it labels an annotation's `normaKey` (labels)
- Test: `apps/web/src/utils/__tests__/decisionAnchorsTravel.test.ts`, `apps/web/src/components/features/environments/__tests__/annotationLabels.test.ts`, and one test per dialog showing the «non incluse» line

**Interfaces:**
- Consumes: `isDecisionKey`, `identityFromKey`, `formatDecisionShort` (Task 10); `fetchDecisionCached` (Task 12); `resolveAnchors` via `decisionProjection` (Task 18).
- Produces:
  - `travellingAnchors(input: { annotations: Annotation[]; highlights: Highlight[] }): Promise<{ annotations: Annotation[]; highlights: Highlight[]; leftOut: { annotations: number; highlights: number } }>`
  - `leftOutMessage(leftOut): string | null`
  - `annotationTargetLabel(normaKey: string): string`

- [ ] **Step 1: Failing tests** (spec §8.6: «VisuaLex never spreads words a court has withdrawn»)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leftOutMessage, travellingAnchors } from '../decisionAnchorsTravel';
import { fetchDecisionCached } from '../decisionFetchCache';

vi.mock('../decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));
const fetchMock = vi.mocked(fetchDecisionCached);

const KEY = 'cassazione:civile:10787:2024';
const found = (motivazione: string) => ({ esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 }, attributi: {}, testo: { motivazione }, fonte: { nome: 'f' }, avvisi: [] }) as never;
const hl = (normaKey: string, startOffset: number, text: string) => ({ id: `${normaKey}${startOffset}`, normaKey, articleId: '', text, startOffset, color: 'yellow' }) as never;
const note = (normaKey: string, startOffset: number, anchorText: string) => ({ id: `n${startOffset}`, normaKey, articleId: '', text: 'nota', startOffset, anchorText }) as never;

beforeEach(() => fetchMock.mockReset());

describe('travellingAnchors', () => {
  it('lets an anchor travel when its words are still in the current text', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const out = await travellingAnchors({ annotations: [note(KEY, 3, 'ricorso')], highlights: [hl(KEY, 3, 'ricorso')] });
    expect(out.highlights).toHaveLength(1);
    expect(out.annotations).toHaveLength(1);
    expect(out.leftOut).toEqual({ annotations: 0, highlights: 0 });
  });
  it('leaves out an anchor on a decision now without its text (obscured)', async () => {
    fetchMock.mockResolvedValue({ ...found(''), testo: {}, avvisi: [{ tipo: 'testo_non_disponibile' }], attributi: { testo_assente: 'oscuramento' } } as never);
    const out = await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'Mario Rossi')] });
    expect(out.highlights).toEqual([]);
    expect(out.leftOut.highlights).toBe(1);
  });
  it('leaves out an anchor whose words changed (anonymised)', async () => {
    fetchMock.mockResolvedValue(found('Il sig. omissis ricorre.'));
    const out = await travellingAnchors({ annotations: [note(KEY, 8, 'Mario Rossi')], highlights: [] });
    expect(out.annotations).toEqual([]);
    expect(out.leftOut.annotations).toBe(1);
  });
  it('sends nothing on trust when the decision cannot be fetched now', async () => {
    fetchMock.mockResolvedValue({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
    const out = await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'ricorso')] });
    expect(out.leftOut.highlights).toBe(1);
    fetchMock.mockRejectedValue(new Error('network'));
    expect((await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'ricorso')] })).leftOut.highlights).toBe(1);
  });
  it('never touches an article\'s anchors and fetches each decision once', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const article = hl('codice-civile--2043', 0, 'Qualunque');
    const out = await travellingAnchors({ annotations: [], highlights: [article, hl(KEY, 3, 'ricorso'), hl(KEY, 13, 'fondato')] });
    expect(out.highlights).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('says how many were left out and why', () => {
    expect(leftOutMessage({ annotations: 0, highlights: 0 })).toBeNull();
    expect(leftOutMessage({ annotations: 1, highlights: 2 }))
      .toBe('1 nota e 2 evidenziazioni su sentenze non incluse: il loro testo non è più presente nella fonte, o la fonte non risponde.');
  });
});
```

`annotationLabels.test.ts`: `annotationTargetLabel('cassazione:civile:10787:2024')` → `'Cass. civ., n. 10787/2024'`; `annotationTargetLabel('codice-civile--2043')` → `'codice civile 2043'` (today's rendering).

- [ ] **Step 2: Run to see them fail.**

Run: `npm --prefix apps/web run test -- --run src/utils/__tests__/decisionAnchorsTravel.test.ts src/components/features/environments/__tests__/annotationLabels.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Which notes and highlights may leave the user's account (an environment, the Forum). On a
 * decision, only those whose words are still in its current text: VisuaLex never spreads words a
 * court has withdrawn (design 2026-10-05 §8.6, the owner's caution). A decision that cannot be
 * fetched now sends nothing on trust. An article's anchors are not this function's business.
 */
import type { Annotation, Highlight } from '../types';
import { resolveAnchors } from './articleAnnotations';
import { fetchDecisionCached } from './decisionFetchCache';
import { identityFromKey, isDecisionKey } from './decisionLinks';
import { decisionProjection } from './decisionRender';

async function currentText(key: string): Promise<string | null> {
  const identity = identityFromKey(key);
  if (!identity) return null;
  try {
    const answer = await fetchDecisionCached(identity);
    return answer.esito === 'trovata' ? decisionProjection(answer.testo) : null;
  } catch (error) {
    console.error('travellingAnchors: the decision could not be fetched', { key, error });
    return null;
  }
}

export async function travellingAnchors(input: { annotations: Annotation[]; highlights: Highlight[] }) {
  const keys = new Set([...input.annotations, ...input.highlights].map((a) => a.normaKey).filter(isDecisionKey));
  const texts = new Map(await Promise.all([...keys].map(async (k) => [k, await currentText(k)] as const)));
  const lands = (key: string, h: Highlight[], a: Annotation[]) => {
    const plain = texts.get(key);
    if (!plain) return { h: new Set<string>(), a: new Set<string>() };
    const landed = resolveAnchors(plain, h, a);
    return {
      h: new Set(landed.flatMap((x) => (x.kind === 'highlight' ? [x.highlight.id] : []))),
      a: new Set(landed.flatMap((x) => (x.kind === 'note' ? [x.note.id] : []))),
    };
  };
  const keep = new Map([...keys].map((k) => [k, lands(k, input.highlights.filter((h) => h.normaKey === k), input.annotations.filter((a) => a.normaKey === k))]));
  const highlights = input.highlights.filter((h) => !isDecisionKey(h.normaKey) || keep.get(h.normaKey)!.h.has(h.id));
  const annotations = input.annotations.filter((a) => !isDecisionKey(a.normaKey) || keep.get(a.normaKey)!.a.has(a.id));
  return {
    annotations, highlights,
    leftOut: { annotations: input.annotations.length - annotations.length, highlights: input.highlights.length - highlights.length },
  };
}

export function leftOutMessage(leftOut: { annotations: number; highlights: number }): string | null {
  const parts = [
    leftOut.annotations ? `${leftOut.annotations} ${leftOut.annotations === 1 ? 'nota' : 'note'}` : null,
    leftOut.highlights ? `${leftOut.highlights} ${leftOut.highlights === 1 ? 'evidenziazione' : 'evidenziazioni'}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `${parts.join(' e ')} su sentenze non incluse: il loro testo non è più presente nella fonte, o la fonte non risponde.`;
}
```

A highlight saved without an offset (legacy) never exists on a decision (decisions' anchors always carry one), so `resolveAnchors`'s every-occurrence fallback does not apply. Then, at every exit point found in «Files»: run `travellingAnchors` on the annotations and highlights about to leave, before the request is sent (the dialogs already await their submit; the store's `createEnvironment` awaits it before its POST), send only what it returns, and show `leftOutMessage` in the dialog (or as a toast for the store path) when it is not null. One test per dialog: with one anchor on an obscured decision selected, the request body lacks it and the line is shown. `annotationTargetLabel(key)` = `identityFromKey(key) ? formatDecisionShort(identityFromKey(key)!) : key.replace(/--/g, ' ').replace(/-/g, ' ')`, used at the viewer's two `byNorm.map` sites and wherever a suggestion card labels a `normaKey`.

- [ ] **Step 4: Run tests, build, lint.**

Run: `npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): notes and highlights on decisions travel, never words a court withdrew"
```

### Task 22: «Scarica PDF» and «PDF originale della Corte»

Spec §12. In the decision tab's actions.

**Files:**
- Create: `apps/web/src/components/features/decisions/decisionPdf.ts` (pure: what the PDF holds)
- Create: `apps/web/src/components/features/decisions/DecisionDownloads.tsx` (the two buttons and the option)
- Create: `apps/web/src/services/decisionPdfService.ts` (`fetchOriginalPdf(identity): Promise<Blob | { esito: string }>`)
- Modify: `apps/web/src/components/features/decisions/DecisionView.tsx` (renders `DecisionDownloads` among the actions for a found decision)
- Test: `apps/web/src/components/features/decisions/__tests__/decisionPdf.test.ts`, `DecisionDownloads.test.tsx`, `apps/web/src/services/__tests__/decisionPdfService.test.ts`

**Interfaces:**
- Consumes: `formatDecisionCitation`, `formatDecisionHeading`, `formatDecisionShort`, `describeNotice` (`decisionLinks.ts`); `decisionParagraphs` (`decisionText.ts`); `decisionProjection`, `unmatchedAnchors` (Task 18); `resolveAnchors`; `todayInRome`, `formatDateItalianLong`, `withPreposition` (`dateUtils.ts`); jsPDF as `DossierDetailView` uses it (`new jsPDF({ unit: 'pt', format: 'a4' })`, Times, margins — read its PDF code and reuse its layout helpers if they are exported; if they are not, extract the paragraph writer into `utils/pdfWriter.ts` and use it from both, with the dossier's PDF test still green).
- Produces:
  - `decisionPdfModel(answer: FoundDecision, options: { annotations?: { highlights: Highlight[]; notes: Annotation[] }; consultedOn: string }): DecisionPdfModel` — `{ heading: string; subheading: string; notices: string[]; blocks: Array<{ label: string; paragraphs: Array<{ text: string; marks: Array<[number, number]>; notes: string[] }> }>; unmatched: string[]; footer: string; fileName: string }`
  - `writeDecisionPdf(model): jsPDF`
  - `DecisionDownloads({ answer, identity })`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { decisionPdfModel } from '../decisionPdf';

const FOUND = {
  esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 10787, anno: 2024 },
  attributi: { sezione: '3', tipo: 'ordinanza', data_deposito: '2024-04-22', testo_origine: 'pdf' },
  testo: { motivazione: 'Primo paragrafo.\n\nSecondo paragrafo.', dispositivo: 'P.Q.M.\n\nRigetta.' },
  fonte: { nome: 'Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)' }, avvisi: [],
} as const;

describe('decisionPdfModel', () => {
  it('heads with the citation, keeps blocks and paragraphs, and names the source and the day', () => {
    const m = decisionPdfModel(FOUND as never, { consultedOn: '2026-10-05' });
    expect(m.heading).toBe('Cass. civ., sez. III, ord. 22 aprile 2024, n. 10787');
    expect(m.blocks.map((b) => b.label)).toEqual(['Motivazione', 'Dispositivo']);
    expect(m.blocks[0].paragraphs.map((p) => p.text)).toEqual(['Primo paragrafo.', 'Secondo paragrafo.']);
    expect(m.footer).toBe('Fonte: Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure) · consultata il 5 ottobre 2026');
    expect(m.fileName).toBe('Cass_civ_sez_III_n_10787_2024.pdf');
  });
  it('never writes a licence line, for the Corte costituzionale too', () => {
    const cc = { ...FOUND, identita: { corte: 'corte_costituzionale', numero: 71, anno: 2020 }, fonte: { nome: 'Corte costituzionale — dati aperti', licenza: 'CC BY-SA 3.0' } };
    const m = decisionPdfModel(cc as never, { consultedOn: '2026-10-05' });
    expect(JSON.stringify(m)).not.toMatch(/CC BY|licenz/i);
  });
  it('prints the notices, the archive fallback included', () => {
    const m = decisionPdfModel({ ...FOUND, avvisi: [{ tipo: 'testo_da_archivio' }] } as never, { consultedOn: '2026-10-05' });
    expect(m.notices[0]).toMatch(/^Testo dell'archivio della Cassazione/);
  });
  it('with annotations: marks in their paragraph, notes after it, the unmatched listed at the end', () => {
    const plainStart = 'Primo paragrafo.'.length; // «Secondo» starts here in the projection
    const m = decisionPdfModel(FOUND as never, {
      consultedOn: '2026-10-05',
      annotations: {
        highlights: [{ id: 'h', text: 'Secondo', startOffset: plainStart, color: 'yellow' } as never,
                     { id: 'g', text: 'parole sparite', startOffset: 3, color: 'yellow' } as never],
        notes: [{ id: 'n', text: 'Vedi anche Cass. 2019', anchorText: 'Rigetta', startOffset: 'Primo paragrafo.Secondo paragrafo.P.Q.M.'.length } as never],
      },
    });
    expect(m.blocks[0].paragraphs[1].marks).toEqual([[0, 7]]);
    expect(m.blocks[1].paragraphs[1].notes).toEqual(['Vedi anche Cass. 2019']);
    expect(m.unmatched).toEqual(['«parole sparite»']);
  });
});
```

`DecisionDownloads.test.tsx`: «Scarica PDF» saves a file named by the model (spy on `jsPDF.prototype.save`); the checkbox «Con le mie evidenziazioni e note» passes the decision's anchors (from the store, keyed by `decisionKey`, `articleId ''`); «PDF originale della Corte» appears only for the Cassazione, calls the service and triggers a download of the blob (an object URL and a click on a temporary anchor, revoked after); a `non_disponibile` answer shows «Il PDF originale non è disponibile per questa decisione.»; a failure shows «Download non riuscito: riprova.». `decisionPdfService.test.ts`: posts the identity to `/fetch_decision_pdf` through `legalFetch`; a `200 application/pdf` gives a `Blob`; a JSON body gives `{ esito }`; a 429 gives `{ esito: 'fonte_non_raggiungibile' }`.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** The model walks the blocks as `renderDecisionHtml` does (Task 18): a running offset over the projection (`\n` not counted), so each highlight lands in its paragraph as a range local to it and each note after the paragraph its anchor ends in; anchors that do not land go to `unmatched` as their quoted text (notes: «nota: <content> — su «<passage>»»). The writer: heading bold 13 pt, subheading 10 pt, notices italic, block labels small caps, paragraphs 11 pt Times justified left with a 1.5 line height, marks drawn as a light rectangle behind the marked words (measure the words with `doc.getTextWidth` on the wrapped line), notes indented in grey after their paragraph, the unmatched under the heading «Non ritrovate nel testo attuale» at the end, the footer at the bottom of the last page. File name: `formatDecisionShort(identity, attributi)` with every run of non-alphanumerics replaced by `_`, plus `.pdf`.

- [ ] **Step 4: Run tests, build, lint.** Then open the PDF of a long decision (60 pages) in the browser pass (Task 25) and check it does not freeze the tab for more than a few seconds; if it does, write the PDF in chunks with `await new Promise(r => setTimeout(r))` between blocks.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): download a decision as a PDF of ours, or the court's own" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**PR 4:** title «feat: read, annotate and follow the norms of a decision»; body names the contract (root rule 23 now covers decisions) and the dossier PR 3 follow-up (adopt `renderDecisionHtml`). Merge: `merge: feat/decision-annotations — notes, highlights and norm links on decisions, never lost`.

---

## PR 4b — `feat/decision-discussions` (apps/server, apps/web)

Added 2026-10-07 (the owner: «… e commenti»; spec §8.7). After PR 4: it needs the decision's reading surface, its projection and `SelectionPopup` on it. The owner's answers of 7 October (spec, «Questions for the owner — answered (7 October)»): discussions on decisions have columns of their own (a migration), a withdrawn quotation is hidden by the panel and an admin can put it back in the clear, signs per paragraph. The migration is announced in the register (`_registro`, an «avvio» entry naming it) before Task 26's code; the server tests need the test database: ask the orchestrator first.

### Task 26: The server takes a discussion on a decision

**Files:**
- Create: `apps/server/prisma/migrations/<timestamp>_article_threads_decision_target/migration.sql` (hand-written: `target_kind` text NOT NULL DEFAULT 'article', `decision_key` text NULL, `passage_released_at` timestamptz NULL, `passage_released_by` text NULL referencing `users(id)` ON DELETE SET NULL; CHECK `target_kind IN ('article','decision')`; CHECK `(target_kind = 'article' AND decision_key IS NULL) OR (target_kind = 'decision' AND decision_key IS NOT NULL AND norma_key = decision_key AND article_id = '' AND version IS NULL AND article_urn IS NULL)`; CHECK that the release columns are both set or both null; existing rows stay `article` by the default)
- Modify: `apps/server/prisma/schema.prisma` (`ArticleThread`: the four fields; the relation for `passage_released_by`; no `prisma format`)
- Create: `apps/server/src/norms/decisionKey.ts` (`readDecisionKey(key): { corte, archivio?, numero, anno } | null`, the server twin of the web's `identityFromKey`: same shapes, same bounds — `[1-9]\d{0,5}`, a year from the court's first to the current one)
- Modify: `apps/server/src/controllers/articleDiscussionController.ts` (create: a body with `target: { kind: 'decision', key }` stores `target_kind`/`decision_key`/`normaKey = key`/`articleId = ''`; a malformed key, a version or an URN on a decision is a 400 in Italian; lists unchanged; the thread's answer carries `target` and `passageReleased`; moderation: `PATCH /admin/article-discussions/:id` also takes `{ passageReleased: boolean }`, setting or clearing the two columns with the admin's id)
- Modify: `apps/server/CLAUDE.md` («Article discussions»: decisions, the columns, the release)
- Test: `apps/server/tests/articleDiscussions.decision.test.ts`

- [ ] **Step 0: Announce the migration in the register** (an «avvio» entry: the table, the four columns, the branch) and tell the orchestrator.
- [ ] **Step 1: Failing tests.** Create, list, list passages, comment, vote, report and moderate a thread on `cassazione:civile:10787:2024`; the stored row has `target_kind = 'decision'` and `decision_key`; a norm thread is `article` with no key; `cassazione:civile:007:2024`, a future year, `corte_costituzionale:civile:1:2020`, a decision with a version → 400; the CHECKs refuse a direct insert that breaks them (one `prisma.$executeRaw` per CHECK); a decision thread never appears in an article's list and the reverse; an admin sets and clears `passageReleased` and a non-admin cannot; the user's export includes the thread with its target; account deletion removes it and an admin's deletion leaves `passage_released_by` null.
- [ ] **Step 2: Run to see them fail** (test DB, after the orchestrator's go).
- [ ] **Step 3: Implement**, then `npx prisma migrate deploy` on the test database through the suite's setup (never `migrate dev`), `npx prisma generate`.
- [ ] **Step 4: Run the touched tests, then the whole server suite once.** The dev stack's database gets the migration after the merge, by the orchestrator.
- [ ] **Step 5: Commit** — «feat(server): a discussion may be anchored on a court decision, in columns of its own».

### Task 27: One discussion panel for an article and a decision

**Files:**
- Modify: `apps/web/src/services/articleDiscussionService.ts` (the anchor type: `{ normaKey, articleId, version? }` documented for both)
- Modify: `apps/web/src/components/features/search/ArticleDiscussionPanel.tsx` (takes `anchor`, `label` and an optional `projectionHash` from its caller; nothing in it reads an article)
- Modify: `apps/web/src/hooks/useArticlePassageThreads.ts` (takes the anchor and the plain text to locate against)
- Test: their existing tests stay green; add a decision-anchored case to each

- [ ] **Step 1: Failing tests** for the decision anchor (the panel lists, creates and replies; the hook locates a passage on a projection).
- [ ] **Step 3: Implement** by lifting what the panel and the hook read from the article into props; `ArticleTabContent` passes what it passes today.
- [ ] **Step 4: Web tests, build, lint. Step 5: Commit** — «refactor(web): the discussion panel and the passage hook take their anchor from the caller».

### Task 28: Discussions on the decision's tab

**Files:**
- Modify: `apps/web/src/components/features/decisions/DecisionReadingSurface.tsx` (the toolbar's discussion button; «Discuti» in `SelectionPopup`; the signs count the paragraph's discussions, `data-threads`, as on an article)
- Modify: `apps/web/src/utils/decisionRender.ts` (the thread focus class `.vlx-thread-focus`, as the article renderer nests it)
- Test: `DecisionReadingSurface.test.tsx` (add); the contract test with threads on (text nodes still spell the projection)

- [ ] **Step 1: Failing tests**: the button opens the panel anchored on the decision key; «Discuti» opens the composer with the passage (start/prefix/suffix on the projection, `textHash` = SHA-256 of the projection); a paragraph's sign shows its count; an open discussion lights its words.
- [ ] **Step 3: Implement** with Task 27's props. Only a found identity shows the button (spec §8.1).
- [ ] **Step 4–5:** web tests, build, lint; commit — «feat(web): discussions on a decision, with the article's panel and signs».

### Task 29: A withdrawn passage is not quoted to others

**Files:**
- Modify: `apps/web/src/components/features/search/ArticleDiscussionPanel.tsx` (a decision thread whose passage is `detached` shows «Il passo citato non è più nel testo della decisione» instead of the quotation, except to its author and to admins)
- Modify: `ArticleDiscussionPanel.tsx` (admin only: on a decision thread whose passage is withdrawn, «Mostra a tutti» / «Nascondi di nuovo» through the moderation route's `passageReleased`, Task 26; while released, every reader sees the quotation). The rule is the panel's: the API still returns the stored quotation (spec §8.7, the limit), and a comment says so.
- Test: the panel cases (author, admin, other reader; released and not; the admin's two buttons).

- [ ] Steps as above; commit — «feat(web): a decision's withdrawn words are not quoted to other readers».

**PR 4b:** title «feat: discussions on court decisions»; body names the migration (announced in the register), the quotation rule and the owner's answers of 7 October. Browser pass: open a discussion on a decision and on a passage, reply, vote, report as a second test account, moderate as admin; the sign counts; a detached passage seen by its author and by another account. Merge: `merge: feat/decision-discussions — discussions on decisions, the article's panel and rules`.

## PR 5 — `feat/decision-history` (apps/server, apps/web)

Announce the migration to the orchestrator before Step 3 of Task 23, and ask its go before any `npm --prefix apps/server test`.

### Task 23: Decisions in `search_history`

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (`SearchHistory.actType String?`, `decisionKey String? @map("decision_key")`)
- Create: `apps/server/prisma/migrations/<YYYYMMDDHHMMSS>_search_history_decisions/migration.sql` (timestamp after the latest migration on `develop` at the time)
- Modify: `apps/server/src/controllers/historyController.ts`
- Create: `apps/server/src/utils/decisionKey.ts` (`isDecisionKey`, mirroring the web's)
- Test: `apps/server/src/__tests__/history.decisions.test.ts` (follow the existing history test's setup; find it with `grep -rl "/history" apps/server/src/__tests__`)

**Interfaces:**
- Produces: `POST /history` accepts `{ decision_key }` or the norm fields (not both); `GET /history` returns `decision_key: string | null`, `act_type: string | null`.

- [ ] **Step 1: Failing tests**

```ts
it('records a decision and lists it with the norms', async () => {
  const add = await agent.post('/api/history').send({ decision_key: 'cassazione:civile:10787:2024' }).expect(200);
  expect(add.body).toMatchObject({ decision_key: 'cassazione:civile:10787:2024', act_type: null });
  const list = await agent.get('/api/history').expect(200);
  expect(list.body[0]).toMatchObject({ decision_key: 'cassazione:civile:10787:2024', act_type: null });
});
it('refuses both kinds at once, neither, and a malformed key', async () => {
  await agent.post('/api/history').send({ decision_key: 'cassazione:civile:1:2024', act_type: 'legge' }).expect(400);
  await agent.post('/api/history').send({}).expect(400);
  await agent.post('/api/history').send({ decision_key: 'cassazione:tributario:1:2024' }).expect(400);
});
it('de-duplicates a decision opened again within five minutes', async () => {
  const a = await agent.post('/api/history').send({ decision_key: 'corte_costituzionale:71:2020' });
  const b = await agent.post('/api/history').send({ decision_key: 'corte_costituzionale:71:2020' });
  expect(b.body.id).toBe(a.body.id);
});
it('the database refuses a row with neither kind', async () => {
  await expect(prisma.searchHistory.create({ data: { userId: user.id } })).rejects.toThrow();
});
```

- [ ] **Step 2: Run to see them fail** — only after the orchestrator's go: `npm --prefix apps/server test -- history.decisions`. Expected: FAIL.

- [ ] **Step 3: The migration, by hand** (never `prisma migrate dev`):

```sql
-- Decisions in the history (design 2026-10-05 §9): a row is a norm (act_type) or a decision
-- (decision_key), never both, never neither.
ALTER TABLE "search_history" ADD COLUMN "decision_key" TEXT;
ALTER TABLE "search_history" ALTER COLUMN "act_type" DROP NOT NULL;
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_one_kind"
  CHECK (("act_type" IS NULL) <> ("decision_key" IS NULL));
```

Schema: `actType String? @map("act_type")`, `decisionKey String? @map("decision_key")`. Run `npx prisma generate` (via the package script) and `npm --prefix apps/server run build`.

- [ ] **Step 4: The controller**

```ts
const normFields = z.object({
  act_type: z.string().min(1),
  act_number: z.string().optional(),
  article: z.string().optional(),
  date: z.string().optional(),
  version: z.string().optional().default('vigente'),
}).strict();
const decisionFields = z.object({ decision_key: z.string().refine(isDecisionKey, 'Not a decision key') }).strict();
const addHistorySchema = z.union([normFields, decisionFields]);
```

`.strict()` makes `{ decision_key, act_type }` fail both branches (400 through the error handler, as other zod failures do — check `errorHandler` maps `ZodError` to 400). In `addHistory`, branch on `'decision_key' in data`: the duplicate check uses `{ userId, decisionKey }` within five minutes; the create writes `decisionKey` only. The response mapper adds `decision_key: item.decisionKey`. `isDecisionKey` in `apps/server/src/utils/decisionKey.ts` is the web's regex and range check, with a comment naming the web twin (`apps/web/src/utils/decisionLinks.ts identityFromKey`): change both together.

- [ ] **Step 5: Run the server suite** (orchestrator's go): `npm --prefix apps/server test` → pass; `npm --prefix apps/server run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): decisions in the search history — decision_key, one kind per row"
```

### Task 24: The Cronologia shows and reopens decisions

**Files:**
- Modify: `apps/web/src/services/historyService.ts` (types; `addDecisionToHistory(decisionKey)`)
- Modify: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (records a found decision once per opening)
- Modify: `apps/web/src/components/features/history/HistoryView.tsx` (decision rows)
- Test: `HistoryView` decision rows test; `DecisionTabView.test.tsx` (records once)

**Interfaces:**
- Consumes: Task 23; `identityFromKey`, `formatDecisionShort`; `openDecisionTab`.
- Produces: `SearchHistoryItem.act_type: string | null; decision_key: string | null`.

- [ ] **Step 1: Failing tests.** A history item `{ decision_key: 'cassazione:civile:10787:2024', act_type: null }` renders «Cass. civ., n. 10787/2024» with a gavel icon; clicking it calls `openDecisionTab(identity)` and navigates to `/`; a norm item renders as before; an item with an unreadable key renders «Sentenza» and is not clickable (logged with context, gotcha 18). `DecisionTabView` calls `addDecisionToHistory` once when the answer is `trovata`, not again on re-render, again after the tab is closed and reopened.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** In `HistoryView`, the functions that build a norm from an item (`item.act_type || ''`, lines ~52–96) run only for items with `act_type`; decision items take a separate row component. Filters by act type and the stripe colour skip decision items (their stripe is a fixed slate). In `DecisionTabView`, a `useRef<string | null>` holds the key last recorded by this mount; record when `answer.esito === 'trovata'` and the key differs; failures are logged and ignored (the history is a convenience, the reading must not fail for it).

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): the Cronologia lists the decisions opened and reopens them"
```

**PR 5:** title «feat: decisions in the Cronologia»; body names the Prisma migration (the other developer's area, approved by the owner's standing rule) and the constraint. Merge: `merge: feat/decision-history — decisions in the Cronologia`.

---

## Task 25: Close the round

**Files:**
- Modify: `apps/web/CLAUDE.md` (Reading surface: «A decision is read like an article»; Shared utilities: `decisionRender.ts`, `useCitationLinks.ts`, `decisionSearchService.ts`, `massimaRef.ts`; Gotchas: a decision's anchors are keyed by `decisionKey` with `articleId ''`)
- Modify: `docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md` (a «Built» note at the top with the PR numbers)
- Modify: this plan («Amendments during execution»)

- [ ] **Step 1: Browser pass** on the merged `develop`, the branch's web on its own port against the shared backend (never restart the shared stack), with a test account the orchestrator activates and that is deleted at the end (`DELETE /api/auth/account`). Check, with screenshots or, when the pane is hidden, DOM reads:
  1. art. 2043 c.c. → «Giurisprudenza» → a Brocardi massima → the decision on the right half;
  2. «Cerca nell’archivio della Cassazione» → count and coverage → a row → beside; «Altri risultati»; the archive switch;
  3. a glossary term → «Tema: …» → «Solo il tema»;
  4. the palette: «Cass. civ. 10787/2024», «Corte cost. 71/2020», «perdita di chance»;
  5. `/sentenze/cassazione-civile/10787/2024` opened cold, then logged out and logged in again;
  6. in the decision, «art. 360 c.p.c.» → the article beside → «‹ Torna a Cass. civ., …»;
  7. a highlight across two paragraphs and a note; reload; still there;
  8. a forged unmatched highlight (created through the API on the test account with a wrong offset) listed in «Non ritrovate nel testo attuale»;
  9. the Cronologia: the decision listed, reopened;
  10. a phone width (390 px): the decision tab full width, the back control;
  11. a Cassazione decision whose archive text is cut short (n. 5625/2022 civile) reads to «Roma, 14.12.2021», with no «copia non ufficiale», header or footer in it;
  12. «Scarica PDF» with and without «Con le mie evidenziazioni e note»; «PDF originale della Corte» downloads the court's file; a Corte costituzionale decision has no original button and no licence line.
- [ ] **Step 2: All suites** — `npm --prefix apps/web run test -- --run`, `run build`, `run lint`; `(cd services/visualex && <python> -m pytest tests/ -q)`; `node --test infra/ingress/paths.test.mjs`; the server suite with the orchestrator's go.
- [ ] **Step 3: Docs** as listed above; commit on a `docs/norms-decisions-search-closing` branch, PR, merge `merge: docs/norms-decisions-search-closing — the round's notes`.
- [ ] **Step 4: Handoff** to the orchestrator: done, left, the owner's decisions verbatim, the PRs, the test account deleted.

## Amendments during execution

**Task 1, 2026-10-05 — measured on Italgiure's public `sn.solr` endpoint (20 live requests: 1
session GET, 19 POSTs, each ≥2 s apart).**

Counts for how a decision writes an article (`rows=0`, counting only):
- `kind:"snciv" AND ocr:"art. 2043 c.c."` — 939
- `kind:"snciv" AND ocr:"art. 2043 cod. civ."` — 583
- `kind:"snciv" AND ocr:"art. 2043 del codice civile"` — 7
- `kind:"snciv" AND ocr:"art. 360 c.p.c."` — 6,373
- `kind:"snpen" AND ocr:"art. 640 c.p."` — 72
- `ocr:"art. 3 Cost."` — 2,338
- `ocr:"art. 3 della Costituzione"` — 313
- `kind:"snciv" AND ocr:"art. 2051 bis c.c."` — 0 (the ordinal spacing is exercised correctly by
  the regex; there is simply no such article, which is why the test for it checks phrasing, not
  a result count)
- `sort=pd desc` — 200 OK; `sort=datdep desc` — 400 Bad Request (confirms the known behaviour;
  `search.py`/`italgiure.py` must sort by `pd`, never `datdep`).

Proximity for a numbered act's article (`kind:"snciv" AND ocr:"art 2 241 1990"~N`, `rows=10`,
`hl.fl=ocr`, ten fragments read by hand per N, per Step 2):
- `~6` — 173 hits; all ten fragments genuinely cite art. 2 of l. 241/1990 (durata del
  procedimento, termine di conclusione, diritto di accesso).
- `~8` — 251 hits; nine of ten are right, but one fragment highlights «dell'art. 13, comma 2,
  t.u.imm., e dell'art. 21 octies l. 241/1990» — the decision cites art. 21-octies of l.
  241/1990, not art. 2; the "2" that matched is "comma 2" of a different article. Wrong hit.
- `~12` — 354 hits; the same wrong hit (art. 21-octies) is still in the top ten.

**Chosen `PROXIMITY = 6`**, not the plan's assumed default of 8: 6, 8 and 12 do not agree (the
brief's fallback rule for 8 only applies when they do), and 6 is the largest value whose ten
results are all correct. Task 2's draft code sets `PROXIMITY = 8` and its docstring's own
measurement note — these must be corrected to 6 when Task 2 is implemented, including the
`test_a_numbered_act_is_a_proximity_phrase` expectation (the proximity is read from the
constant, so the test itself does not need a literal change, only the constant's value and its
docstring).

Fixtures recorded (`rows=3`, `fl=id,numdec,anno,datdep,szdec,tipoprov,kind`, `sort=pd desc`,
highlighting on, one fragment of ≤200 characters per hit; bodies saved exactly as received):
- `italgiure_search_2043_cc.json` — `kind:"snciv" AND (ocr:"art. 2043 c.c." OR ocr:"art. 2043
  cod. civ.")` — numFound 1,430.
- `italgiure_search_topic_chance_2043.json` — `kind:"snciv" AND ocr:"perdita di chance" AND
  ocr:"art. 2043 c.c."` — numFound 34.
- `italgiure_search_empty.json` — `kind:"snciv" AND ocr:"art. 99999 c.c."` — numFound 0.

Every fragment in the three fixtures was read by hand: none names a private person (each is a
point of law — a *motivo di ricorso* or a holding — never a party, a fact pattern naming
someone, or a case detail), so no record needed replacing.

**Rewrite, 2026-10-05 (afternoon) — the owner's additions «testo pulito» and «scaricarle in PDF».**
Measured before proposing (about 20 requests, 2.5 s apart): Italgiure's `ocr` field ends mid-word in about a third of 34 whole decisions (one at exactly 8,000 characters; dispositivi missing), the court's original PDF (`filename` → `…hc.dll?verbo=attach&db=<kind>&id=<name>.clean.pdf`, in the archive's session) is whole, and the `rnc-*` fields index the cited norms (art. 2043 c.c.: 3,904 civil decisions against 939 by text). A controller prototype of the PDF reader (pdfminer.six) rebuilt three PDFs whole, with no furniture left, after two fixes the plan's code already carries (a footer present on one page only; pdfminer's `PSEOF` on a truncated file). Answers «43. 1a + 1d», «44. 2a + 2b». Added Tasks 2, 3, 4, 8, 22; changed Tasks 5, 6, 7, 9; renumbered every later task.

**Task 2, 2026-10-05 — measured on Italgiure's public `sn.solr` endpoint and the attach
endpoint for the original PDFs (54 live requests in all: 4 session-opening GETs across four
script runs, 36 PDF fetches — 3 of them bytes already on disk from the controller's own probe,
not refetched — and 14 Solr POSTs; every request ≥ 2.5 s after the one before it). Sample: 40
decisions (20 `snciv`, 20 `snpen`), sections 1/2/U/L (civil) and 1/2/4/6 (penal), years
2021–2026, sentenze and ordinanze for civil, sentenze only for penal (no penal ordinanza turned
up in the queries drawn), 4 of the 40 withheld by the source (`oscuramento`, no `filename` to
read a PDF from — confirms the design's own statement that a withheld text has no PDF). The
prototype run was Task 3's own code (plan Task 3, Step 3), copied into the scratch venv and run
unmodified before any tuning, then re-run after each fix below; every fix is a correction to
that code, to be carried into Task 3 verbatim.**

*The thresholds (`services/visualex/visualex_api/services/decisions/pdf_text.py`, replacing
Task 3's drafted defaults):*

| constant | plan's draft | measured value | why |
|---|---|---|---|
| `TOP_BAND` | 60 | **90** | a running header repeated on 15 of a document's pages, without the colon it carries on page 0 ("Data pubblicazione 21/02/2022"), sits at y=765 on a height-842 page — 77 pt from the top edge; 60 pt of band missed it by 17 pt, so it leaked into the body text verbatim. 90 pt leaves a 13 pt margin and introduced no new drop of real text (checked: no dropped line over 55 characters with 6 or more lowercase words, across all 36 PDFs, before or after). |
| `BOTTOM_BAND` | 80 | **110** | two more leaks the 80 pt band missed: a running footer ("Ric. 2017 n. 30254 sez. SU - ud. 14-09-2021") repeated on 20 of 24 pages at y≈88–90, and bare page numbers ("2", "3", …) repeated on every page of two decisions at y≈99. Both are well inside the `_RUNNING` / `_PAGE_NUMBER` patterns the code already has — they were never tested against those patterns because they never reached the in-band check. 110 pt catches both with margin. |
| `INDENT` | 8 | **8 (unchanged)** | correctly started a paragraph at every genuine first-line indent across all 36; no false start, no missed one. |
| `GAP` | 30 | **30 (unchanged)** | correctly started a paragraph at every genuine vertical break across all 36. |
| `CENTER_INDENT` | — (new) | **40** | the detail the plan's own Task 3 text flagged as unsettled: a centred heading ("RITENUTO IN FATTO E CONSIDERATO IN DIRITTO", measured x0 94–95 pt beyond the body's left edge) ends its own paragraph correctly, but the ordinary, left-aligned line right after it glued onto the heading's paragraph in 2 of 36 fixtures read closely, and — once the fix below was in place and I checked every paragraph break it added — at least 20 more headings across the sample that the narrower keyword-only check had not even been counting ("ORDINANZA", "FATTI DI CAUSA", "P.Q.M.", "RILEVATO CHE", party-designation lines like "- ricorrente -" and "contro"). A one-line paragraph in progress whose line's `x0` is beyond `left + CENTER_INDENT` forces the next line to start a new paragraph regardless of its own indent or the gap. |
| `HEADING_MAX_CHARS` | — (new) | **60** | pairs with `CENTER_INDENT`: the measured headings were 42 characters; 60 keeps margin without reaching into an ordinary first line of prose that happens to sit far right. |
| `REPEATED_ON` | 2 | **2 (unchanged)** | every genuine running header/footer in the sample repeated on at least 3 pages in practice; 2 is the safe floor the plan already chose. |
| `OGGETTO_X` | 0.6 | **0.6 (unchanged)** | confirmed again on `snciv_26034_2026` (the fixture): the box's lines sit at x0 ≈ 407 of a 595-wide page, the title at y 393, every Oggetto line above it in y and past `width * 0.6` — dropped correctly, nothing else at that position on any of the 36 pages. |

*The `_PQM` pattern* (same file) needs two more spellings or 3 of 36 decisions lose their
dispositivo to the motivazione: `"PQM."` (no periods between the letters: `snciv_05628_2022`)
and `"PER QUESTI MOTIVI"` (spelled out — an older civil-ordinanza template that does not use
"P.Q.M." at all: `snciv_26052_2026`, `snciv_26054_2026`). With both added, all 36 non-withheld
decisions split a `dispositivo` correctly, each one starting with "P." (or, now, "Dichiara" /
"Accoglie" / "Annulla" / "Rigetta" / "La Corte …" right after one of the three headings) and
every one of the 36 reads to a genuine closing line ("Così deciso …", a date, the President's
or the extensor's name) — read by hand on all 36, not ten: none is cut, none stops short of its
dispositivo. `_HEADER` and `_PAGE_NUMBER` needed no change; one PDF (`snciv_01674_2024` and its
four `L`-section siblings) has *no* page-0 header or Oggetto box at all — a template without
one, not a bug — so a decision missing that block is expected, not a failure.

*A confirmed hyphen-join case*: `snciv_26034_2026` has a hyphenated compound broken at the end of
one baseline, the rest starting the next (verified in the raw lines, not just the output); the
joined text reads like "Emilia-Romagna", the example Task 3's own docstring names — pin `test_a_line_ending_in_a_hyphen_joins_
without_a_space` against, and to assert `"RILEVATO CHE"` / `"CONSIDERATO CHE"` / `"P.Q.M."`
each start their own paragraph in.

*Furniture left over, by design, not a defect*: letter-spaced OCR noise around the judges'
signatures in 5 of 36 (`snpen_05881/05882/05883/05884_2022`, `snpen_35166_2026` — e.g. a
judge's name broken into pieces, two names merged: «[nomi dei magistrati]») and stamp debris in
1 of 36 (`snpen_35172_2026`: "p Q w [firma del cancelliere] eLz 2? - scrj g …"), confined to the closing
signature block in every case, never the motivazione or dispositivo text itself — exactly the
"OCR debris from stamps" and "digital signature printed letter by letter" faults the design
already named for the text field; Task 3/4 should not try to remove these, they cost nothing to
leave and trying would risk the real text next to them. One stray glyph, `_99_`, sits alone at
the bottom margin of one page of `snciv_05624_2022`, appears once (not repeated, so `REPEATED_ON`
never catches it) and is not `(cid:N)`-shaped either; left as a known, harmless residual (four
characters inline, no word broken).

*The fallback checks* (plan Task 4) — measured against all 36 non-withheld decisions' own field
(`ocr`) text:

- **Length ratio** (`len(pdf_text) / len(field_text)`): ranged **0.761–1.019**. The low end is
  not the PDF losing text: `ocr` is a flat OCR dump that *keeps* every page's running
  header/footer inline, so a 27-page decision's field is inflated by as many repeats as it has
  pages, while the PDF reader strips them by design — the ratio falls with page count for this
  reason alone, confirmed on the two 27-page fixtures (`snciv_05633_2022`, `snciv_05669_2022`,
  both 0.761, both with 130 furniture lines correctly dropped, nothing of the body touched).
  **Recommended floor: 0.70** (margin below the measured 0.761, so a legitimately long,
  furniture-heavy decision never trips the fallback).
- **Opening words**: the brief's own "do the field's first twenty words appear in order in the
  PDF text" cannot be a simple left-to-right two-pointer subsequence scan — measured and then
  fixed: the field's own text is *also* truncated at its **front** in most records, not only
  cut short at the end, e.g. `ocr` starting "iato la seguente SENTENZA …" (missing the front of
  "pronunciato"), "CC ha pronunciato la seguente ORDINANZA …" (extra words the PDF's own first
  page never has, because that template has no header/judges paragraph at all), "osti da: …"
  (missing the front of "proposti"). A strict two-pointer match on the literal first word
  starves on this and returns near-zero even for a perfect PDF read. The fix: count the length
  of the **longest common subsequence** between the field's first 20 words and the PDF's first
  250 words (both tokenised on `[a-z0-9]+`, so "n.5672/2020" and "n. 5672/2020" tokenise
  alike). Measured on the 36 genuine pairs: **14–20 of 20**. A negative control (each
  decision's field matched against a *different*, unrelated decision's PDF, 36 random pairs)
  scored **3–13**, because common boilerplate ("sul ricorso … proposto da … elettivamente
  domiciliato … che lo rappresenta e difende … contro …") alone can reach into the teens even
  across unrelated decisions. **Recommended floor: 10** — comfortably below the measured
  true-positive floor of 14, comfortably above most (not all) of the false pairs; the fallback
  must use **both** checks together (ratio ≥ 0.70 **and** opening-words ≥ 10), since the two
  false-positive risks (boilerplate overlap; a coincidentally similar length) are close to
  independent. Every one of the 36 passes both; the 40-decision outcome table below shows the
  result per decision.

*The index of cited norms* (plan Task 5), measured with 11 more Solr requests after the 40-
sample's own `rnc-*` data was mined for free (no request): one decision already in the sample,
`snciv2026126034O`, alone carries 8 citations across 3 different families (`rnc-gen`
`CC`/`LS`/`PC`), which is most of the table below without asking Italgiure anything.

| act | `rnc-gen` | `rnc-sp` | confidence |
|---|---|---|---|
| codice civile (c.c.) | `CC` | `COD` | confirmed (art. 2043, art. 1227, art. 1375, … in the 40-sample and the 100-row art. 2043 query) |
| codice di procedura civile (c.p.c.) | `PC` | `COD` | confirmed (art. 360 — "motivi di ricorso" — by far the single most common citation in the whole sample, 139 of the sample's own citations) |
| codice penale (c.p.) | `CP` | `COD` | confirmed (art. 62-bis, art. 416-bis — see the suffix table below) |
| codice di procedura penale (c.p.p.) | `PV` | `COD` | confirmed (art. 606 "ricorso per cassazione", art. 568, art. 609 — all penal-only in the sample, all genuine c.p.p. articles) |
| Costituzione | `LC` | `LC` | confirmed (every article seen is ≤ 139 — the Constitution's own range — and matched by hand against the decisions' own text: "artt. 3, 4 e 97 Cost.") |
| legge ordinaria (l.) | `LS` | `LS` | confirmed (`rnc-num`/`rnc-dat` pairs land on a decision's own "l. 241/1990" and similar) |
| decreto legislativo (d.lgs.) | `LS` | `DLG` | confirmed (d.lgs. 58/1998 art. 21, TUF, already in the 40-sample) |
| decreto-legge (d.l.) | `LS` | `DL` | confirmed (seen in the 40-sample's own mined data; not independently re-queried, so weaker than the two above) |
| d.P.R. | `LS` | `DPR` | confirmed (d.P.R. 115/2002 art. 13, the contributo-unificato article almost every decision cites, already in the 40-sample) |
| preleggi (disp. prel. c.c.) | — | — | **not established within the budget.** Three decisions whose text names "disposizioni sulla legge in generale (preleggi)" with a specific article (art. 12, art. 15) do not carry a matching `rnc-art` entry at all — the citation is in the text but not, as far as three samples show, in the index. Task 5 should leave preleggi out of the index table and send it through the text search only. |
| disp. att. c.c. | `CC` | `COD` | **confirmed indexed, but not distinguishable from the codice civile itself.** Three decisions citing "art. 66 disp. att. c.c.", "da 11 a 20 disp. att. c.c." and "art. 63 disp. att. c.c." carry those exact article numbers under `rnc-gen:"CC" AND rnc-sp:"COD"` — the same coordinates as codice civile proper. A query for a *low* article number (disp. att. c.c. runs to a few hundred articles; the codice civile to 2969) cannot tell the two apart from the index alone; Task 5 should say so if it offers disp. att. c.c. as a choice, or restrict it to numbers the codice civile itself does not reach. |
| two more families seen, not asked for | `CR` / `DM` | `COD` / `DM` | seen a handful of times each (5 and 9 citations) with inconsistent article ranges; not one of the eleven families in the brief, and not pinned down — left unidentified, as the brief allows. |

*How a suffix is written in `rnc-art`* (the "2043 00" / "-bis" question): confirmed **`02` =
"-bis"**, independently, on five different articles across the sample and the follow-up
queries: art. 416-bis c.p., art. 62-bis c.p. (both read directly from the decision's own text
next to the matching index entry), art. 163-bis c.p.c., art. 380-bis c.p.c. and art. 348-bis
c.p.c. (all four read from the mined 40-sample data). `03` and `04` are very likely "-ter" and
"-quater" by the same sequence (a decision indexed as `"0391 04"` has, in its own text, "391
bis, 391 nonies, 391 quater c.p.p." together in one sentence — consistent with `04` = "-quater"
but, because that sentence names three suffixes of the same base article at once, not as fully
independent a confirmation as the five "-bis" cases). **Recommendation: trust `02` = "-bis" for
Task 5; treat `03`/`04` as a working hypothesis ("-ter"/"-quater") to verify with one more
query before the index table is frozen, and fall back to the text search for any suffix beyond
that (quinquies and up) until measured.**

*How `rnc-num`/`rnc-dat` align with `rnc-gen`/`rnc-art`* — measured on far more than the
brief's 20 records (every citation in the 40-sample plus the 100-, 100- and 29-row false-match
samples below, several hundred citations in all): **`rnc-num` and `rnc-dat` align by position
among only the entries of `rnc-gen` that are *not* a code (i.e. not tagged `rnc-sp:"COD"`), in
the same left-to-right order as `rnc-gen` itself** — confirmed by hand on `snciv2026126034O`
(2 non-code entries, 2 `rnc-num`/`rnc-dat` pairs, both match a real numbered act read from the
decision's own text), on `snciv2026109211O` (2 non-code entries, 2 pairs, one of them the
`d.lgs. 58/1998, art. 21` citation this plan needs), and on every one of the hand-checked
records in the false-match tables below. This held in every record checked; I found no
exception.

*But `rnc-art` itself is not reliably the same length as `rnc-gen`/`rnc-sp`* — this is the
measurement that changes Task 5's re-check (N15) the most. `rnc-gen` and `rnc-sp` are always
the same length as each other (confirmed on every record read). `rnc-art` is shorter whenever
one or more citations in the decision name an act with no specific article (a bare "ai sensi
del d.lgs. 52/1998", with no article number) — that citation is simply missing from `rnc-art`,
which shifts every citation after it out of naive same-index alignment with `rnc-gen`. Measured
rate of `len(rnc-gen) != len(rnc-art)` among records that otherwise match a family query:

| query | length-matched | length-mismatched |
|---|---|---|
| `rnc-gen:"CC" AND rnc-art:"2043 00"` (100 rows) | 51 | 49 (49%) |
| `rnc-gen:"LS" AND rnc-sp:"DLG" AND rnc-num:"0058" AND rnc-dat:"1998" AND rnc-art:"0021 00"` (29 rows, the whole population) | 2 | 27 (93%) |
| `rnc-gen:"LS" AND rnc-sp:"LS" AND rnc-num:"0241" AND rnc-dat:"1990" AND rnc-art:"0002 00"` (100 rows) | 4 | 96 (96%) |

Manually reconstructed one mismatched record (`snciv2026109211O`, 5 `rnc-gen` entries, 4
`rnc-art` entries) against its own `rnc-num`/`rnc-dat`: the citation the server actually wants
(d.lgs. 58/1998 art. 21) **was** present, just not at the same raw index as its `rnc-gen` entry
— a naive `zip()` would have called this one unverifiable, not wrongly matched, which is the
safe failure direction, but the practical effect is the same: **a same-index check alone misses
or discards the majority of genuine numbered-act citations and roughly half of the codes'.**

*False-match rate, restricted to the length-matched records only* (where a same-index check is
at least coherent — this is the rate Task 5's N15 re-check can actually trust today):

| family | length-matched n | genuinely wrong | rate |
|---|---|---|---|
| `CC` art. 2043 | 51 | 1 | **2.0%** |
| numbered acts (d.lgs. 58/1998 art. 21 + l. 241/1990 art. 2 pooled) | 6 | 2 | **33%** (small n — one record genuinely cites l. 241/1990 art. 31, another art. 3, not art. 2; both are real, different citations the query's five independent filters still matched because each filter alone is satisfied somewhere in the decision) |

Both the code family and the numbered-act family, at the full (not length-matched-only) false-
match rate implied by the mismatch table above, are **well past the plan's 5% "circa N"
threshold** — not because the index is unreliable, but because most of its matches cannot be
verified by position at all with the fields as given. **Recommendation for Task 5**: show every
family's count as "circa N" (per the plan's own fallback rule) until a smarter re-check — one
that accounts for citations with no article, not a raw `zip()` — is built and itself measured
against a labelled sample; in the meantime, treat a length-mismatched record as *unconfirmed*
rather than silently counting or silently discarding it.

*`hl.q` on an index query* — confirmed it gives a passage: `q=kind:"snciv" AND rnc-gen:"CC" AND
rnc-art:"2043 00"` with `hl.q=ocr:"art. 2043 c.c." OR ocr:"art. 2043 cod. civ."` highlighted 2 of
5 rows with a real fragment ("… ex <em>art</em>.<em>2043</em> <em>cod</em>. <em>civ</em>. …") and
answered the other 3 with an empty `{}` — never an error, exactly as spec §5.2 describes: a
passage when the decision's text phrases the citation in a form `hl.q` knows, nothing otherwise.

*Fixtures recorded* — four original PDFs and their full Solr record (`fl=*`), all civil (`snciv`):
Cassazione civil nos. 26034/2026 and 26035/2026 (Sez. 1, the same template: header, Oggetto box,
the hyphen join, the glued-words-with-no-space fault) and nos. 5626/2022 and 5628/2022 (Sez. U,
both cut short in the field, both with a running footer, the second also the "PQM." spelling).
Every one of the 20 penal decisions in the sample names its defendant by birth name and
birthplace (Italian penal judgments always do), and no anonymised penal decision turned up in the
one follow-up query the remaining budget allowed. Every party in the four civil ones is a company,
a bank or a public administration; no other name appears anywhere in them (checked by extracting
every capitalised multi-word run from the complete `ocr` text of each). The files are not in the
repository, which is public: they live in `services/visualex/tests/fixtures/decisions/private/`
(git-ignored), the reader is tested on synthetic PDFs, and the local tests that read the real
ones are skipped without them (fixtures README).
`italgiure_index_2043_cc.json` is the first five rows of the `rnc-gen:"CC" AND rnc-art:"2043 00"`
query above (deterministic under `sort=pd desc`, so identical to a fresh `rows=5` request).

*The forty decisions measured* (pages, whether the text reads whole to a genuine closing line —
checked by hand on all 40, not ten — furniture lines dropped, paragraphs, and the two fallback
checks together):

| id | archive | numero | anno | pages | whole | furniture lines dropped | paragraphs | fallback check |
|---|---|---|---|---|---|---|---|---|
| snciv2026126034O | snciv | 26034 | 2026 | 7 | yes | 26 | 28 | pass |
| snciv2026126035O | snciv | 26035 | 2026 | 7 | yes | 26 | 25 | pass |
| snciv2026126036O | snciv | 26036 | 2026 | 7 | yes | 26 | 25 | pass |
| snciv2026126039O | snciv | 26039 | 2026 | 10 | yes | 36 | 25 | pass |
| snciv2026126052O | snciv | 26052 | 2026 | 12 | yes | 15 | 57 | pass |
| snciv2026126054O | snciv | 26054 | 2026 | 25 | yes | 28 | 60 | pass |
| snciv2026126055O | snciv | 26055 | 2026 | — | withheld (`oscuramento`, no filename) | — | — | — |
| snciv2026226018O | snciv | 26018 | 2026 | 8 | yes | 11 | 34 | pass |
| snciv2022U05624S | snciv | 05624 | 2022 | 24 | yes | 42 | 218 | pass |
| snciv2022U05625S | snciv | 05625 | 2022 | 6 | yes | 9 | 34 | pass |
| snciv2022U05626O | snciv | 05626 | 2022 | 8 | yes | 11 | 42 | pass |
| snciv2022U05628O | snciv | 05628 | 2022 | 14 | yes | 17 | 19 | pass |
| snciv2022U05633S | snciv | 05633 | 2022 | 27 | yes | 130 | 80 | pass |
| snciv2022U05669S | snciv | 05669 | 2022 | 27 | yes | 130 | 80 | pass |
| snciv2024L01674O | snciv | 01674 | 2024 | 27 | yes | 26 | 140 | pass |
| snciv2024L01675O | snciv | 01675 | 2024 | 27 | yes | 26 | 140 | pass |
| snciv2024L01676O | snciv | 01676 | 2024 | 25 | yes | 24 | 139 | pass |
| snciv2024L01678O | snciv | 01678 | 2024 | 25 | yes | 24 | 139 | pass |
| snciv2024L01680O | snciv | 01680 | 2024 | 25 | yes | 24 | 136 | pass |
| snciv2024L01689O | snciv | 01689 | 2024 | 3 | yes | 11 | 13 | pass |
| snpen2026135162S | snpen | 35162 | 2026 | 11 | yes | 12 | 62 | pass |
| snpen2026135163S | snpen | 35163 | 2026 | — | withheld (`oscuramento`, no filename) | — | — | — |
| snpen2026135164S | snpen | 35164 | 2026 | — | withheld (`oscuramento`, no filename) | — | — | — |
| snpen2026135165S | snpen | 35165 | 2026 | 6 | yes | 7 | 36 | pass |
| snpen2026135166S | snpen | 35166 | 2026 | 14 | yes | 13 | 114 | pass |
| snpen2026135167S | snpen | 35167 | 2026 | 5 | yes | 6 | 32 | pass |
| snpen2026135170S | snpen | 35170 | 2026 | — | withheld (`oscuramento`, no filename) | — | — | — |
| snpen2026135172S | snpen | 35172 | 2026 | 9 | yes | 12 | 57 | pass |
| snpen2022205881S | snpen | 05881 | 2022 | 3 | yes | 4 | 18 | pass |
| snpen2022205882S | snpen | 05882 | 2022 | 4 | yes | 5 | 19 | pass |
| snpen2022205883S | snpen | 05883 | 2022 | 5 | yes | 6 | 14 | pass |
| snpen2022205884S | snpen | 05884 | 2022 | 4 | yes | 6 | 13 | pass |
| snpen2022205886S | snpen | 05886 | 2022 | 9 | yes | 10 | 12 | pass |
| snpen2022205888S | snpen | 05888 | 2022 | 4 | yes | 5 | 60 | pass |
| snpen2021447002S | snpen | 47002 | 2021 | 3 | yes | 3 | 25 | pass |
| snpen2021447004S | snpen | 47004 | 2021 | 4 | yes | 5 | 29 | pass |
| snpen2021447006S | snpen | 47006 | 2021 | 5 | yes | 5 | 25 | pass |
| snpen2024647649S | snpen | 47649 | 2024 | 3 | yes | 4 | 25 | pass |
| snpen2024647652S | snpen | 47652 | 2024 | 6 | yes | 7 | 43 | pass |
| snpen2024647653S | snpen | 47653 | 2024 | 2 | yes | 3 | 19 | pass |

36 of 36 non-withheld decisions pass both fallback checks at the recommended thresholds — the
thresholds were chosen with margin below this floor, not fitted exactly to it, so a decision
Task 3 has not yet seen is expected to pass by a comparable margin, not by luck.

**Amendment, 2026-10-05 (evening) — the Sentenze session's review of §8, and privacy.** Accepted in full (spec §8.2, §8.4, §8.5, §11.6): the projection strips each block's edges; a decision read from the text field is cached 24 h with a «provvisorio» notice; the freeze takes effect with PR 4 and `italgiure:v4:` is the last change of characters (v4: carriage returns normalised, 7 October); `line_paragraphs`/`paragraphs` may still change; Corte costituzionale corrections are a cause in §8.4. Privacy: real decisions stay in the git-ignored `private/` folder, CI tests run on synthetic PDFs and records, freeze goldens are SHA-256 and length. With the owner's «46 sì» the branch was rebuilt from c98e1f40 so that no commit holds a real PDF or record (Tasks 2–3 now in 5d6d11dd and e42ad740). Tasks 4, 9 and 18 carry the amendment at their head.

**Amendments, 2026-10-07 — the rulings of 6–7 October, as the code has them.**
- The index serves the codes and the Constitution only (c.c. `CC`, c.p.c. `PC`, c.p. `CP`, c.p.p. `PV`, Cost. `LC`). Numbered acts, the preleggi and the disp. att. go to the text search. Among the suffixes only «-bis» (`02`) is established.
- `cites` keeps a record whose `rnc-gen` and `rnc-art` lists are not aligned (`rnc-art` is shorter when a citation names no article, so positions cannot be trusted); on aligned records the false matches measured 2.0 %. The answer has no `totale_approssimato`.
- No homepage request in the normal path: a cold select answers and sets the session cookie itself (measured 7 Oct; the homepage timed out 20-25 s about one time in two). One lock-guarded reopen of the session, on an answer that is not JSON (the anti-bot page).
- `archivio_dal` is the earliest of the two archive starts for a search of both archives; an answer without it is not cached.
- An original PDF whose header cannot be read is served on the record and filename checks; a damaged one never. A cached original PDF is served only while the decision's text entry is cached.
- The strip of the projection is of ASCII whitespace (space, `\t`, `\n`, `\r`, `\f`, `\v`), in the API's freeze test and in the web's `decisionProjection` (spec §8.2).
- Known limits, accepted for now: the PDF body is read whole before the size check (allowlisted host, pinned TLS, 8 s budget); an anti-bot page on the download path answers 404 `non_disponibile`; `_plausible` tokenises on whitespace (Task 2 measured `[a-z0-9]+`; genuine pairs score 16–17 either way); a parse that times out keeps its worker thread.

**Amendments, 2026-10-07 (evening) — PR 2 as built (`feat/decision-tabs`), and what PR 3 inherits.**
- A decision tab keeps the reference as cited, section included, until the route finds the decision; then it holds the identity. The answer already on screen is kept when the identity lands (no second request), so the notices about the cited section stay; the session cache also keeps that answer under the identity, without the notices about what was cited (`sezione_diversa`, `sezione_non_riconosciuta`, `archivio_dedotto`). One tab per decision: a reference with an archive matches only a tab of that archive; an archive-less reference matches any tab of the same court, number and year; an unresolved tab matched by a reference that adds a section or an archive takes that reference and asks again; a candidate chosen in a tab whose decision is already open elsewhere raises that tab and closes this one.
- Workspace tabs are `position: fixed` without `top`/`left`, so their x/y are offsets from the results area (`#tour-results-area`). `utils/workspaceOrigin.ts` measures that area; side-by-side placement and the drag limits are computed in viewport pixels and converted. Saved tabs never move. A decision opened with nothing else visible takes the free area (desktop only).
- A tab with `view` takes no content: the store refuses it (`refuseViewTab`). One `renderTabView` draws a tab's view on the desktop and on the phone, with an exhaustive switch: Task 17 replaces its `decision-search` branch (`null` today) there, once for both surfaces.
- The way back from an article to a decision is recorded in PR 2: `DecisionLink` takes an optional `backEntry`, built in `ArticleTabContent` from `readingOrigin`, and pushes it on the plain click («‹ Torna a art. 2043 c.c.», the same control as citation jumps). Task 16 threads `besideTabId` and `backEntry` to its «Giurisprudenza» rows, and to the Massimario's `DecisionChip` through the `article_case_law` slot props (today the chip opens at the cascade position, without a way back).
- `/sentenze` alone opens the palette; an address that does not parse opens it and says why in a toast (raised above the palette). `DecisionLookupForm` and `DecisionPage` are gone: the palette reads decision citations. `?palette=sentenze` was not built (nothing reads it). «Cerca nella barra di ricerca» opens the palette with the citation typed in (`openCommandPaletteWith`, session-only).
- Logout clears the pending decision, the focus request and the session cache of decisions.
- Left for later (not this round): `ui/Toast`'s fixed `z-[60]` sits under every overlay band (pre-existing; the decision address notice is lifted on its own); the phone's tab arrows are 40 px, under the 44 px target (pre-existing).

**Amendments, 2026-10-07 (late evening) — the owner's requests of 7 October** («alle sentenze possiamo aggiungere gli stessi tool di note, eviodenziazioni e commenti? Assicuriamoci anche che gli ambienti possano mantenere sentenze»).
- Notes and highlights on decisions are the article's own tools, signs included (spec §8.3; Task 20 amended at its head).
- Discussions on decisions are new scope: spec §8.7 and PR 4b (Tasks 26–29), after PR 4. The owner answered questions 5–7 the same day: columns of their own (a migration, announced in the register before its code), a withdrawn quotation hidden by the panel and released by an admin, signs per paragraph.
- Environments keep decisions: the web already rebuilt them on import; the server now rebuilds a published environment's decision entries from closed values on publish, update and restore, refuses an entry of an unknown type and a note that is not a text of at most 4,000 characters (`fix/environment-decision-entries`, a pull request of its own after PR 2). The dev database held no entry those refusals would reject (read-only count, 7 October). Annotations on decisions inside environments stay Task 21's.

