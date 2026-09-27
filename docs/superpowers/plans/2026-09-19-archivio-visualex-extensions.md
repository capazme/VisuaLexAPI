# VisuaLex Extensions for the Legal Archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the VisuaLex Python API the three capabilities the local legal archive needs and does not have today: EU recitals, per-article AKN fingerprints (with the article's FRBRWork date), and EU consolidated texts.

**Architecture:** Three vanilla features on the root Quart controller (`app.py`), each a thin endpoint over a pure function in `visualex_api/services/`. Recitals and consolidated texts extend `EurlexScraper` and the EUR-Lex tree parser; fingerprints extend the AKN parser (`ParsedPart.dates`) and `AktIndex`. No new hosts, no new dependencies. Every parser change is driven by offline fixtures captured from real EUR-Lex pages.

**Tech Stack:** Python 3.12/3.14, Quart, BeautifulSoup4, lxml, pytest + pytest-asyncio (`asyncio_mode = auto`). Run tests with `.venv/bin/python -m pytest tests/ -q` from the repo root — the ambient `python3` cannot import quart.

**Spec:** `docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`, section "VisuaLex extensions". Plan 2 (`2026-09-19-archivio-normativo.md`) consumes the endpoints defined here.

## Global Constraints

- Branch: `feature/archivio-normativo` (already created from `main`). Commit after every task; never amend.
- `article_text` is frozen: none of these tasks may change what `NormattivaScraper` or `EurlexScraper.extract_article_text` returns for pages that already parse today (gotcha 23). Consolidated-page support adds branches; it does not alter the existing ones.
- The AKN export is structure and fallback only, never display text. A fingerprint is a hash, not the text; the endpoint must not return AKN article text.
- Every URL literal must name a host in `visualex_api/tools/egress.py` `ALLOWED_HOSTS` — `tests/test_egress_allowlist.py` fails the build otherwise. Only `eur-lex.europa.eu` and `www.normattiva.it` are used here.
- Article numbers with ordinal suffixes go through the shared table `visualex_api/tools/article_suffixes.py` (`ARTICLE_SUFFIX_ALTERNATION`); never a private `bis|ter|…` list.
- New endpoints go on the root controller only (`app.py`); the `/api` twin in `visualex_api/app.py` does not mirror `fetch_rubriche` and does not need these either.
- Docs travel with code: each endpoint task updates the "Key API Endpoints" list in `CLAUDE.md`.
- One `-m live` test per feature, excluded by default.

## Fixture notes (read before Task 1)

Three EUR-Lex HTML formats exist in the corpus, verified on 2026-09-19:

| format | example | article marker | rubrica | recitals | headings |
|---|---|---|---|---|---|
| modern OJ (2014+) | `/eli/reg/2016/679/oj/ita` | `p.oj-ti-art` | `p.oj-sti-art` | `div.eli-subdivision#rct_N` → table, `(N)` in first cell | `p.oj-ti-section-1/2` |
| legacy OJ (pre-2010) | `legal-content/IT/TXT/HTML/?uri=CELEX:32002L0058` | plain `<p>Articolo 5</p>` | none | plain `<p>(1) …</p>` after "considerando quanto segue:" until "HANNO ADOTTATO" | plain `<p>CAPO I</p>` |
| consolidated | `legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219` | `p.title-article-norm` ("Articolo 14 <span class=italics>bis</span>") | `p.stitle-article-norm` | **none** — consolidated texts carry no preamble | `p.title-division-1/2`; `p.modref` markers "▼B"/"▼M1" to strip |

Consequence for the archive (Plan 2): an act with `celex_consolidated` takes its articles from the consolidated page and its recitals from the OJ page of the base act.

---

### Task 1: Capture EUR-Lex fixtures

**Files:**
- Create: `tests/fixtures/eurlex/README.md`
- Create: `tests/fixtures/eurlex/gdpr_oj_trimmed.html` (modern OJ)
- Create: `tests/fixtures/eurlex/eprivacy_oj_legacy.html` (legacy OJ, whole page ≈ 68 KB)
- Create: `tests/fixtures/eurlex/eprivacy_consolidated_20091219.html` (whole page ≈ 58 KB)
- Create: `tests/fixtures/eurlex/eidas_consolidated_20241018_trimmed.html`
- Test: `tests/test_eurlex_fixtures.py`

**Interfaces:**
- Produces: the four fixture paths above, loaded by Tasks 2, 3, 8, 9 via `Path(__file__).parent / "fixtures" / "eurlex" / <name>`.

- [ ] **Step 1: Download the four pages into the scratchpad**

EUR-Lex answers plain `curl` when a browser User-Agent is sent; the `/eli/...` URLs sometimes answer `202` with an empty body (WAF challenge) — use the `legal-content` form, which is the same document.

```bash
mkdir -p /tmp/eurlex_capture && cd /tmp/eurlex_capture
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -sL -A "$UA" -o gdpr_oj.html      "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:32016R0679"
curl -sL -A "$UA" -o eprivacy_oj.html  "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:32002L0058"
curl -sL -A "$UA" -o eprivacy_cons.html "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
curl -sL -A "$UA" -o eidas_cons.html   "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02014R0910-20241018"
ls -la
```

Expected: four files; `gdpr_oj.html` ≈ 1 MB, `eprivacy_oj.html` ≈ 68 KB, `eprivacy_cons.html` ≈ 58 KB, `eidas_cons.html` ≈ 480 KB. If a file is under 5 KB the WAF blocked it: wait 5 s and retry that one URL.

- [ ] **Step 2: Trim the two large pages with BeautifulSoup**

Run from the repo root with the project venv (it has bs4):

```bash
.venv/bin/python - <<'EOF'
import re
from pathlib import Path
from bs4 import BeautifulSoup

SRC = Path("/tmp/eurlex_capture")
DST = Path("tests/fixtures/eurlex")
DST.mkdir(parents=True, exist_ok=True)

def assemble(soup, ids, preamble_text=None):
    parts = []
    if preamble_text:
        p = soup.find("p", string=re.compile(preamble_text))
        if p is not None:
            parts.append(str(p))
    for i in ids:
        el = soup.find(id=i)
        if el is None:
            raise SystemExit(f"fixture id missing: {i}")
        parts.append(str(el))
    return "<html><body>\n" + "\n".join(parts) + "\n</body></html>\n"

gdpr = BeautifulSoup((SRC / "gdpr_oj.html").read_text(encoding="utf-8"), "html.parser")
# Recitals 1-3 and the last one, Capo I (articles 1-4 with their oj-ti-section
# headings), and art. 17 so the fixture has an article outside the first chapter.
(DST / "gdpr_oj_trimmed.html").write_text(
    assemble(gdpr, ["rct_1", "rct_2", "rct_3", "rct_173", "cpt_I", "art_17"],
             preamble_text="considerando quanto segue"),
    encoding="utf-8")

eidas = BeautifulSoup((SRC / "eidas_cons.html").read_text(encoding="utf-8"), "html.parser")
# Capo I with its title-division headings and first articles, plus art. 50.
(DST / "eidas_consolidated_20241018_trimmed.html").write_text(
    assemble(eidas, ["cpt_I", "art_50"]), encoding="utf-8")

for src, dst in [("eprivacy_oj.html", "eprivacy_oj_legacy.html"),
                 ("eprivacy_cons.html", "eprivacy_consolidated_20091219.html")]:
    (DST / dst).write_text((SRC / src).read_text(encoding="utf-8"), encoding="utf-8")

for f in sorted(DST.glob("*.html")):
    print(f.name, f.stat().st_size)
EOF
```

Expected: four files printed; `gdpr_oj_trimmed.html` and `eidas_consolidated_20241018_trimmed.html` each well under 150 KB. If `cpt_I` is missing in `eidas_cons.html`, open the file, find the `<div id="cpt_…">` wrapping "CAPO I" and use that id.

- [ ] **Step 3: Write the fixture README**

`tests/fixtures/eurlex/README.md`:

```markdown
# EUR-Lex fixtures

Captured 2026-09-19 with a browser User-Agent from the `legal-content/IT/TXT/HTML`
URLs (the `/eli/` URLs answer 202 to non-browsers). Three markups live here:

- `gdpr_oj_trimmed.html` — modern OJ format (`oj-ti-art`, `oj-sti-art`,
  `div#rct_N` recitals, `oj-ti-section-1/2` headings). Recitals 1-3 and 173,
  Capo I (art. 1-4), art. 17.
- `eprivacy_oj_legacy.html` — legacy OJ format, whole page: class-less `<p>`,
  recitals as `<p>(N) …</p>` after "considerando quanto segue:", articles as
  `<p>Articolo N</p>`.
- `eprivacy_consolidated_20091219.html` — consolidated format, whole page:
  `title-article-norm` / `stitle-article-norm`, `modref` markers, no recitals,
  "Articolo 14 <span class="italics">bis</span>".
- `eidas_consolidated_20241018_trimmed.html` — consolidated format with
  `eli-subdivision` wrappers and `title-division-1/2` headings. Capo I, art. 50.

Trimming: `str()` of the elements with the listed ids, assembled inside
`<html><body>`. The capture and trim commands are in
`docs/superpowers/plans/2026-09-19-archivio-visualex-extensions.md`, Task 1.
```

- [ ] **Step 4: Write the fixture invariant test**

`tests/test_eurlex_fixtures.py`:

```python
"""The EUR-Lex fixtures carry the markers the parsers are written against.

If a fixture is re-captured and a marker disappears, the parser tests would
fail for the wrong reason; this file names the real one.
"""
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def _read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_modern_oj_fixture_has_recitals_articles_and_headings():
    html = _read("gdpr_oj_trimmed.html")
    for marker in ('id="rct_1"', 'id="rct_173"', 'class="oj-ti-art"', 'oj-sti-art',
                   'oj-ti-section-1', 'considerando quanto segue'):
        assert marker in html, marker


def test_legacy_oj_fixture_is_class_less():
    html = _read("eprivacy_oj_legacy.html")
    assert "considerando quanto segue" in html
    assert "<p>(1) " in html
    assert "oj-ti-art" not in html and "title-article-norm" not in html


def test_consolidated_fixtures_use_norm_classes():
    for name in ("eprivacy_consolidated_20091219.html",
                 "eidas_consolidated_20241018_trimmed.html"):
        html = _read(name)
        assert "title-article-norm" in html, name
        assert "stitle-article-norm" in html, name
        assert 'class="modref"' in html, name
        assert "rct_" not in html, name  # consolidated texts have no preamble


def test_consolidated_eprivacy_has_a_suffixed_article():
    html = _read("eprivacy_consolidated_20091219.html")
    assert 'Articolo 14 <span class="italics">bis</span>' in html
```

- [ ] **Step 5: Run the test**

Run: `.venv/bin/python -m pytest tests/test_eurlex_fixtures.py -q`
Expected: 4 passed. If `<p>(1) ` is not found in the legacy fixture, look at the actual bytes around "considerando quanto segue" and adjust the assertion to the real spacing (the parser in Task 2 uses a regex, not this literal).

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/eurlex tests/test_eurlex_fixtures.py
git commit -m "test(eurlex): capture modern, legacy and consolidated page fixtures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `extract_recitals` — pure parser for EU recitals

**Files:**
- Modify: `visualex_api/services/eurlex_scraper.py` (module-level function after the class, plus two compiled regexes at module top)
- Test: `tests/test_eurlex_recitals.py`

**Interfaces:**
- Produces: `extract_recitals(soup: BeautifulSoup) -> list[dict]`, each `{"number": "1", "text": "La protezione…"}`, in document order, numbers as strings without parentheses. Empty list when the page has no recitals (consolidated texts).

- [ ] **Step 1: Write the failing tests**

`tests/test_eurlex_recitals.py`:

```python
"""Recitals (considerando) of EU acts.

Two markups: the modern OJ page wraps each recital in
`<div class="eli-subdivision" id="rct_N">` with the number in the first table
cell; the legacy page (pre-2010 acts) has class-less `<p>(N) text</p>`
paragraphs between "considerando quanto segue:" and the enacting formula.
Consolidated texts have no preamble at all and must yield nothing.
"""
from pathlib import Path

from bs4 import BeautifulSoup

from visualex_api.services.eurlex_scraper import extract_recitals

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def soup_of(name):
    return BeautifulSoup((FIXTURES / name).read_text(encoding="utf-8"), "html.parser")


class TestModernMarkup:
    def test_reads_number_and_text_from_the_rct_divs(self):
        recitals = extract_recitals(soup_of("gdpr_oj_trimmed.html"))
        numbers = [r["number"] for r in recitals]
        assert numbers == ["1", "2", "3", "173"]
        assert recitals[0]["text"].startswith("La protezione delle persone fisiche")

    def test_the_number_cell_is_not_part_of_the_text(self):
        first = extract_recitals(soup_of("gdpr_oj_trimmed.html"))[0]
        assert not first["text"].startswith("(1)")

    def test_footnote_call_outs_are_dropped(self):
        # Recital 173 cites Dir. 2002/58/CE with a footnote "(18)" rendered as
        # <a>(<span class="oj-super oj-note-tag">18</span>)</a>.
        last = extract_recitals(soup_of("gdpr_oj_trimmed.html"))[-1]
        assert "(18)" not in last["text"]
        assert "direttiva 2002/58/CE" in last["text"]

    def test_multi_paragraph_recital_keeps_paragraph_breaks(self):
        html = (
            '<div class="eli-subdivision" id="rct_9"><table><tbody><tr>'
            '<td><p class="oj-normal">(9)</p></td>'
            '<td><p class="oj-normal">Primo capoverso.</p>'
            '<p class="oj-normal">Secondo capoverso.</p></td>'
            '</tr></tbody></table></div>'
        )
        assert extract_recitals(BeautifulSoup(html, "html.parser")) == [
            {"number": "9", "text": "Primo capoverso.\nSecondo capoverso."}
        ]


class TestLegacyMarkup:
    def test_reads_the_paragraph_sequence_after_the_preamble_marker(self):
        recitals = extract_recitals(soup_of("eprivacy_oj_legacy.html"))
        assert [r["number"] for r in recitals[:3]] == ["1", "2", "3"]
        assert recitals[0]["text"].startswith("La direttiva 95/46/CE")
        # Dir. 2002/58/CE has 49 recitals.
        assert recitals[-1]["number"] == "49"
        assert len(recitals) == 49

    def test_stops_at_the_enacting_formula(self):
        html = (
            "<p>considerando quanto segue:</p>"
            "<p>(1) Primo.</p><p>(2) Secondo.</p>"
            "<p>HANNO ADOTTATO LA PRESENTE DIRETTIVA:</p>"
            "<p>(1) Questo è il paragrafo 1 dell'articolo 1, non un considerando.</p>"
        )
        recitals = extract_recitals(BeautifulSoup(html, "html.parser"))
        assert [r["number"] for r in recitals] == ["1", "2"]

    def test_numbers_must_be_consecutive(self):
        # A "(4)" footnote reference paragraph between recitals is not recital 4
        # if recital 3 has not been seen.
        html = (
            "<p>considerando quanto segue:</p>"
            "<p>(1) Primo.</p><p>(4) Nota a piè di pagina.</p><p>(2) Secondo.</p>"
            "<p>HA ADOTTATO IL PRESENTE REGOLAMENTO:</p>"
        )
        recitals = extract_recitals(BeautifulSoup(html, "html.parser"))
        assert [r["number"] for r in recitals] == ["1", "2"]


class TestNoRecitals:
    def test_consolidated_text_yields_nothing(self):
        assert extract_recitals(soup_of("eprivacy_consolidated_20091219.html")) == []
        assert extract_recitals(soup_of("eidas_consolidated_20241018_trimmed.html")) == []

    def test_empty_document(self):
        assert extract_recitals(BeautifulSoup("<div>nulla</div>", "html.parser")) == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_eurlex_recitals.py -q`
Expected: ImportError — `extract_recitals` does not exist.

- [ ] **Step 3: Implement `extract_recitals`**

In `visualex_api/services/eurlex_scraper.py`, add after the imports (module level, above the class):

```python
# --- Recitals -------------------------------------------------------------
#
# Two markups. The modern OJ page (acts published since ~2014) wraps every
# recital in <div class="eli-subdivision" id="rct_N"> holding a two-cell table:
# "(N)" on the left, the text on the right. Older acts are served class-less:
# a run of <p>(N) …</p> between "considerando quanto segue:" and the enacting
# formula ("HA/HANNO ADOTTATO …"). Consolidated texts have no preamble at all.
_RECITAL_DIV_ID = re.compile(r"^rct_(\d+)$")
_RECITAL_NUMBER_ONLY = re.compile(r"^\(\d+\)$")
_LEGACY_RECITAL = re.compile(r"^\((\d+)\)\s+(.*)$", re.S)
_LEGACY_PREAMBLE_MARKER = re.compile(r"considerando quanto segue", re.I)
_LEGACY_ENACTING_FORMULA = re.compile(r"^HA(?:NNO)?\s+ADOTTAT[OA]\b", re.I)


def _strip_footnote_marks(element) -> None:
    """Remove "(18)"-style footnote call-outs in place.

    EUR-Lex renders them as <a>(<span class="oj-note-tag">18</span>)</a>; the
    anchor's whole text is the parenthesised number, so dropping the anchor
    leaves the sentence intact. The soup is built per request from the cached
    HTML, so mutating it here is local to this call.
    """
    for span in element.find_all("span", class_="oj-note-tag"):
        anchor = span.find_parent("a")
        target = anchor if anchor is not None else span
        if _RECITAL_NUMBER_ONLY.match(target.get_text(strip=True) or ""):
            target.decompose()


def _extract_recitals_modern(soup) -> list[dict]:
    recitals = []
    for div in soup.find_all("div", id=_RECITAL_DIV_ID):
        number = _RECITAL_DIV_ID.match(div["id"]).group(1)
        _strip_footnote_marks(div)
        paragraphs = []
        for p in div.find_all("p"):
            text = p.get_text(" ", strip=True)
            if not text or _RECITAL_NUMBER_ONLY.match(text):
                continue  # the "(N)" cell
            paragraphs.append(text)
        if paragraphs:
            recitals.append({"number": number, "text": "\n".join(paragraphs)})
    return recitals


def _extract_recitals_legacy(soup) -> list[dict]:
    marker = soup.find("p", string=_LEGACY_PREAMBLE_MARKER)
    if marker is None:
        return []
    recitals = []
    expected = 1
    for p in marker.find_all_next("p"):
        text = p.get_text(" ", strip=True)
        if _LEGACY_ENACTING_FORMULA.match(text):
            break
        match = _LEGACY_RECITAL.match(text)
        if not match:
            continue
        number, body = match.group(1), match.group(2).strip()
        # Footnote paragraphs also read "(4) …"; a recital number is the next
        # one in the sequence, nothing else.
        if int(number) != expected:
            continue
        recitals.append({"number": number, "text": body})
        expected += 1
    return recitals


def extract_recitals(soup) -> list[dict]:
    """Recitals of an EU act as ``[{"number": "1", "text": "…"}, …]``.

    Modern markup first; the legacy paragraph walk only when the page has no
    ``rct_N`` divs. A consolidated text yields ``[]``: it has no preamble.
    """
    recitals = _extract_recitals_modern(soup)
    if recitals:
        return recitals
    return _extract_recitals_legacy(soup)
```

`re` is already imported at the top of the module.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_eurlex_recitals.py -q`
Expected: 9 passed. If `test_reads_the_paragraph_sequence_after_the_preamble_marker` reports fewer than 49, print `[r["number"] for r in recitals]` and look at the first missing number in the fixture: a recital split across two `<p>` (rare in legacy pages) would need the body of the following non-numbered `<p>` appended — add that branch only if the fixture shows it.

- [ ] **Step 5: Run the whole suite and commit**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green (the recitals code is not yet called by anything else).

```bash
git add visualex_api/services/eurlex_scraper.py tests/test_eurlex_recitals.py
git commit -m "feat(eurlex): parse recitals from modern and legacy OJ pages

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `EurlexScraper.get_recitals` and `POST /fetch_recitals`

**Files:**
- Modify: `visualex_api/services/eurlex_scraper.py` (class `EurlexScraper`: new `_load_soup`, new `get_recitals`; `get_document` refactored to call `_load_soup`)
- Modify: `app.py` (route registration in `_setup_routes`, new handler `fetch_recitals`)
- Modify: `CLAUDE.md` ("Key API Endpoints")
- Test: `tests/test_fetch_recitals.py`

**Interfaces:**
- Consumes: `extract_recitals(soup)` from Task 2.
- Produces: `EurlexScraper.get_recitals(norma) -> tuple[list[dict], str]` (recitals, page URL); `POST /fetch_recitals {act_type, date, act_number}` → `200 {"recitals": [...], "count": n, "url": "..."}`; `400` for a non-EUR-Lex `act_type` or a missing one. The archive (Plan 2) calls this once per EU act.

- [ ] **Step 1: Write the failing tests**

`tests/test_fetch_recitals.py`:

```python
"""`POST /fetch_recitals`: all the considerando of an EU act in one call.

The recitals sit in the same page the tree and the articles are parsed from,
which the scraper caches for 24 h — so one call per act costs nothing extra.
Only regulations and directives are accepted: Normattiva acts have no
recitals, and the treaties' preambles are not numbered.
"""
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.norma import Norma

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"
GDPR_HTML = (FIXTURES / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestScraper:
    async def test_get_recitals_reads_the_cached_page_without_network(self):
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=GDPR_HTML)
        scraper.request_document = AsyncMock(side_effect=AssertionError("network"))

        norma = Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679")
        recitals, url = await scraper.get_recitals(norma)

        assert [r["number"] for r in recitals] == ["1", "2", "3", "173"]
        assert url == "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
        scraper.request_document.assert_not_called()

    async def test_get_recitals_fetches_and_caches_on_a_cold_cache(self):
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=None)
        scraper.cache.set = AsyncMock()
        scraper.request_document = AsyncMock(return_value=GDPR_HTML)

        norma = Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679")
        recitals, _ = await scraper.get_recitals(norma)

        assert len(recitals) == 4
        scraper.cache.set.assert_awaited_once()

    async def test_get_document_still_uses_the_same_loader(self):
        """The refactor must not change what get_document returns."""
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=GDPR_HTML)
        text, url = await scraper.get_document(act_type="regolamento ue", article="1", year="2016", num="679")
        assert text.startswith("Articolo 1")
        assert "Oggetto e finalità" in text
        assert url == "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


class TestEndpoint:
    async def test_returns_the_recitals_of_an_eu_act(self, client):
        fake = AsyncMock(return_value=(
            [{"number": "1", "text": "La protezione…"}, {"number": "2", "text": "I principi…"}],
            "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
        ))
        with patch("app.eurlex_scraper.get_recitals", fake):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            })
        assert response.status_code == 200
        body = await response.get_json()
        assert body["count"] == 2
        assert body["recitals"][0] == {"number": "1", "text": "La protezione…"}
        assert body["url"].startswith("https://eur-lex.europa.eu/")
        called_norma = fake.await_args.args[0]
        assert called_norma.numero_atto == "679"

    async def test_the_frontend_spelling_of_the_act_type_is_accepted(self, client):
        fake = AsyncMock(return_value=([], "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/ita"))
        with patch("app.eurlex_scraper.get_recitals", fake):
            response = await client.post("/fetch_recitals", json={
                "act_type": "Direttiva UE", "date": "2022", "act_number": "2555",
            })
        assert response.status_code == 200

    async def test_a_normattiva_act_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={
            "act_type": "codice civile", "article": "1",
        })
        assert response.status_code == 400
        assert "EUR-Lex" in (await response.get_json())["error"]

    async def test_missing_act_type_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={"date": "2016"})
        assert response.status_code == 400
        assert "act_type" in (await response.get_json())["error"]

    async def test_a_scraper_failure_is_a_500_with_a_message(self, client):
        boom = AsyncMock(side_effect=RuntimeError("EUR-Lex is down"))
        with patch("app.eurlex_scraper.get_recitals", boom):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            })
        assert response.status_code == 500
        assert "EUR-Lex is down" in (await response.get_json())["error"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_fetch_recitals.py -q`
Expected: `TestScraper` fails with `AttributeError: 'EurlexScraper' object has no attribute 'get_recitals'`; `TestEndpoint` fails with 404/405 on the unknown route.

- [ ] **Step 3: Add `_load_soup` and `get_recitals`, refactor `get_document`**

In `visualex_api/services/eurlex_scraper.py`, inside `class EurlexScraper`, replace the cache/fetch block of `get_document` and add the two methods:

```python
    async def _load_soup(self, url: str):
        """The parsed page for ``url``, from the persistent cache when it has it.

        One page carries the whole act — tree, articles, rubriche and recitals
        — so every extractor goes through here and the WAF is crossed once.
        """
        cached_html = await self.cache.get(url)
        if cached_html:
            log.info("Cache hit", source="eurlex_persistent")
            return self.parse_document(cached_html)
        html_content = await self.request_document(url)
        await self.cache.set(url, html_content)
        return self.parse_document(html_content)

    async def get_recitals(self, norma) -> tuple[list[dict], str]:
        """All recitals (considerando) of an EU act, and the page they came from.

        ``norma.url`` is the act page (the OJ version: consolidated texts carry
        no preamble, so a consolidated URL yields an empty list).
        """
        url = norma.url
        log.info("Fetching EUR-Lex recitals", url=url)
        soup = await self._load_soup(url)
        recitals = extract_recitals(soup)
        log.info("EUR-Lex recitals extracted", url=url, count=len(recitals))
        return recitals, url
```

and in `get_document`, replace

```python
        # Check persistent cache first
        cache_key = url
        cached_html = await self.cache.get(cache_key)
        if cached_html:
            log.info("Cache hit", source="eurlex_persistent")
            soup = self.parse_document(cached_html)
        else:
            html_content = await self.request_document(url)
            await self.cache.set(cache_key, html_content)
            soup = self.parse_document(html_content)
```

with

```python
        soup = await self._load_soup(url)
```

- [ ] **Step 4: Add the endpoint**

In `app.py`, `_setup_routes`, after the `/fetch_rubriche` rule:

```python
        self.app.add_url_rule('/fetch_recitals', view_func=self.fetch_recitals, methods=['POST'])
```

and the handler, right after `fetch_rubriche`:

```python
    async def fetch_recitals(self):
        """All the considerando of an EU act, in one call.

        A separate endpoint rather than a flag on /stream_article_text: a
        recital is not an article — no URN, no annex, no Brocardi — and the
        archive that consumes this wants the whole preamble at once. The
        page is the one the tree and the articles already come from, cached
        for 24 h, so the call costs one parse and no network on a warm cache.
        Consolidated texts have no preamble; they answer an empty list.
        """
        try:
            data = await request.get_json() or {}
            act_type = data.get('act_type')
            if not act_type:
                raise ValidationError("Campo obbligatorio mancante: act_type")
            if normalize_act_type(act_type).lower() not in ('regolamento ue', 'direttiva ue'):
                raise ValidationError(
                    "fetch_recitals accetta solo atti EUR-Lex (regolamento ue, direttiva ue)"
                )
            norma = Norma(
                tipo_atto=act_type,
                data=data.get('date') or None,
                numero_atto=data.get('act_number'),
            )
            recitals, url = await eurlex_scraper.get_recitals(norma)
            return jsonify({'recitals': recitals, 'count': len(recitals), 'url': url})
        except Exception as exc:
            return self._error_response(exc, 'fetch_recitals')
```

`eurlex_scraper` is the module-level instance created next to `brocardi_scraper` at the top of `app.py`; `Norma`, `normalize_act_type` and `ValidationError` are already imported there.

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_fetch_recitals.py tests/test_eurlex_recitals.py -q`
Expected: all passed. If `test_the_frontend_spelling_of_the_act_type_is_accepted` fails, print `normalize_act_type("Direttiva UE")` — the check must use whatever spelling that function returns, lower-cased.

- [ ] **Step 6: Document the endpoint**

In `CLAUDE.md`, "Key API Endpoints", after the `/fetch_rubriche` bullet add:

```markdown
- `/fetch_recitals` — every considerando of an EU act (`regolamento ue` /
  `direttiva ue`) in one call: `{recitals: [{number, text}], count, url}`.
  Reads the OJ page the tree already uses; a consolidated text has no
  preamble and answers an empty list. Normattiva acts get a 400
```

- [ ] **Step 7: Full suite and commit**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green.

```bash
git add visualex_api/services/eurlex_scraper.py app.py CLAUDE.md tests/test_fetch_recitals.py
git commit -m "feat(api): POST /fetch_recitals serves the considerando of an EU act

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-article FRBRWork dates in the AKN parser

**Files:**
- Modify: `visualex_api/services/akn_parser.py` (`ParsedPart`, `ParsedAct`, `_parse_component`, `parse_akn`)
- Test: `tests/test_akn_parser.py` (append a class)

**Interfaces:**
- Produces: `ParsedPart.dates: dict[str, str]` and `ParsedAct.dates: dict[str, str]` — article key (`"3-bis"`) → ISO date read from the article's own `<doc>/<meta>/<identification>/<FRBRWork>/<FRBRdate @date>`. Only component acts (codici) have one per article; flat acts leave both maps empty.

Why the Work date and not the Expression date: on the committed fixture art. 3-bis c.p. carries `FRBRWork/FRBRdate 2018-04-06` (the day its text came into force, d.lgs. 21/2018) and `FRBRExpression/FRBRdate 1931-07-01` (the code's own expression date, identical for every article). The spec's mention of the Expression date was written before this was checked; the Work date is the one that changes when the article changes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_akn_parser.py`:

```python
class TestPerArticleDates:
    """The date of the text currently in force, per article.

    Component acts (codici) give each article its own <doc> with its own FRBR
    metadata; the FRBRWork date there moves when the article is amended:
    art. 1 c.p. still reads 1931-07-01, art. 3-bis (d.lgs. 21/2018) reads
    2018-04-06. Flat acts have act-level metadata only, so no article date.
    """

    def test_component_act_dates_follow_each_article(self, cp):
        assert cp.dates["1"] == "1931-07-01"
        assert cp.dates["3-bis"] == "2018-04-06"

    def test_every_article_of_a_component_act_has_a_date(self, cp):
        assert set(cp.dates) == set(cp.order)

    def test_dates_are_iso_strings(self, cp):
        assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) for d in cp.dates.values())

    def test_flat_acts_have_no_article_dates(self, l241):
        assert l241.dates == {}

    def test_parts_carry_their_own_dates(self, cp):
        main = cp.parts["Codice Penale"]
        assert main.dates["3-bis"] == "2018-04-06"
        assert cp.dates == main.dates
```

`cp` and `l241` are the module-scoped fixtures already defined at the top of `tests/test_akn_parser.py` (they parse `codice_penale_trimmed.xml` and `legge_241_1990.xml`). Add `import re` at the top of the test module if missing.

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_akn_parser.py -q -k PerArticleDates`
Expected: `AttributeError: 'ParsedAct' object has no attribute 'dates'`.

- [ ] **Step 3: Implement**

In `visualex_api/services/akn_parser.py`:

`ParsedPart` — add a field after `order`:

```python
    # Article key -> ISO date of the text in force for that article, read from
    # the article's own FRBRWork/FRBRdate. Component acts only.
    dates: dict[str, str] = field(default_factory=dict)
```

`ParsedAct` — add a field after `order` (before `structure`):

```python
    # Mirrors the dominant part's ``dates``; empty for flat acts, whose
    # lifecycle is recorded at act level only.
    dates: dict[str, str] = field(default_factory=dict)
```

A helper next to `_render_component_doc`:

```python
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _doc_work_date(doc) -> str | None:
    """The FRBRWork date of a component <doc>, or None.

    Expression and Manifestation dates sit beside it and are the act's, not
    the article's — the Work date is the one that moves when the article's
    text is replaced.
    """
    dates = doc.xpath(
        f".//{_local('meta')}//{_local('FRBRWork')}/{_local('FRBRdate')}/@date"
    )
    for value in dates:
        value = (value or "").strip()
        if _ISO_DATE.match(value):
            return value
    return None
```

In `_parse_component`, collect the dates alongside the articles:

```python
    parts: dict[str, ParsedPart] = {}
    for part_name, entries in by_part.items():
        articles: dict[str, str] = {}
        order: list[str] = []
        dates: dict[str, str] = {}
        for num_raw, doc in entries:
            key = normalize_article_key(num_raw)
            if not key or key in articles:
                continue
            rendered = _render_component_doc(doc, num_raw)
            if rendered:
                articles[key] = rendered
                order.append(key)
                work_date = _doc_work_date(doc)
                if work_date:
                    dates[key] = work_date
        if articles:
            parts[part_name] = ParsedPart(name=part_name, articles=articles, order=order, dates=dates)
```

In `parse_akn`, the component branch returns:

```python
        return ParsedAct(
            title=title,
            articles=main.articles,
            order=main.order,
            dates=main.dates,
            structure="component",
            parts=parts,
        )
```

The flat branch is unchanged (`dates` defaults to `{}`).

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_akn_parser.py -q`
Expected: all passed, including the five new ones. If `test_every_article_of_a_component_act_has_a_date` fails, print the keys missing from `cp.dates`: a `<doc>` whose FRBRWork carries an empty `date=""` is possible in the export — that article legitimately has no date, so relax that test to `set(cp.dates) <= set(cp.order)` and `len(cp.dates) >= 0.95 * len(cp.order)`.

- [ ] **Step 5: Commit**

```bash
git add visualex_api/services/akn_parser.py tests/test_akn_parser.py
git commit -m "feat(akn): read each article's FRBRWork date from the component export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Fingerprints on `AktIndex`

**Files:**
- Modify: `visualex_api/services/akn_fetch.py` (`AktIndex`, `_to_index`, imports)
- Test: `tests/test_akn_fetch.py` (append a class)

**Interfaces:**
- Consumes: `ParsedAct.dates` / `ParsedPart.dates` from Task 4; `ParsedAct.articles`, `ParsedAct.parts[*].articles` (existing).
- Produces: `AktIndex.fingerprints: dict[str, dict]` — article key → `{"fingerprint": <sha256 hex of the AKN article text>, "date": <ISO date or None>}` for the dominant part; `AktIndex.parts_detail[i]["fingerprints"]` with the same shape per part. Persisted with the index (the persistent key already carries the day, so no stale shape survives a deploy).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_akn_fetch.py`:

```python
class TestFingerprints:
    """A hash per article, so a client can learn WHICH articles changed with one
    act-level download instead of refetching every article's HTML.

    The hash is of the AKN text, which is never shown (it transliterates
    accents) — it is a change detector, not content. The index stays
    text-free: 64 hex characters per article.
    """

    CP_XML = (FIXTURES / "codice_penale_trimmed.xml").read_text(encoding="utf-8")

    @pytest.mark.asyncio
    async def test_flat_act_index_carries_one_fingerprint_per_article(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            index = await akn_fetch.fetch_act_index(FakeNorma())
        assert set(index.fingerprints) == set(index.keys)
        entry = index.fingerprints["1"]
        assert re.fullmatch(r"[0-9a-f]{64}", entry["fingerprint"])
        assert entry["date"] is None  # flat acts have no per-article lifecycle

    def test_to_index_uses_the_parsed_texts_and_dates(self):
        from visualex_api.services.akn_parser import parse_akn
        index = akn_fetch._to_index(parse_akn(self.CP_XML), "codice", "19301026")
        assert index.fingerprints["3-bis"]["date"] == "2018-04-06"
        assert index.fingerprints["1"]["date"] == "1931-07-01"
        assert len({v["fingerprint"] for v in index.fingerprints.values()}) == len(index.fingerprints), \
            "two different articles must not share a fingerprint"

    def test_fingerprint_is_the_sha256_of_the_akn_text(self):
        import hashlib
        from visualex_api.services.akn_parser import parse_akn
        act = parse_akn(self.CP_XML)
        index = akn_fetch._to_index(act, "codice", "19301026")
        expected = hashlib.sha256(act.articles["3-bis"].encode("utf-8")).hexdigest()
        assert index.fingerprints["3-bis"]["fingerprint"] == expected

    def test_parts_detail_carries_fingerprints_too(self):
        from visualex_api.services.akn_parser import parse_akn
        index = akn_fetch._to_index(parse_akn(self.CP_XML), "codice", "19301026")
        by_name = {p["name"]: p for p in index.parts_detail}
        assert "Codice Penale" in by_name
        assert set(by_name["Codice Penale"]["fingerprints"]) == set(by_name["Codice Penale"]["keys"])

    @pytest.mark.asyncio
    async def test_fingerprints_survive_the_persistent_cache(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            first = await akn_fetch.fetch_act_index(FakeNorma())
            akn_fetch._memory.clear()  # force the disk path
            second = await akn_fetch.fetch_act_index(FakeNorma())
        assert len(calls) == 2, "the second call must come from the persistent cache"
        assert second.fingerprints == first.fingerprints
```

Add `import re` at the top of the test module if it is missing.

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_akn_fetch.py -q -k Fingerprints`
Expected: `AttributeError: 'AktIndex' object has no attribute 'fingerprints'`.

- [ ] **Step 3: Implement**

In `visualex_api/services/akn_fetch.py`, add `import hashlib` next to `import asyncio`. In `AktIndex`, after `parts_detail`:

```python
    # Article key -> {"fingerprint": sha256 of the AKN article text, "date":
    # the article's FRBRWork date or None}, dominant part. The AKN text is
    # never served (it transliterates accents), but its hash tells a client
    # which articles changed since it last looked — one act-level download
    # instead of one request per article. ~200 KB for the codice civile.
    fingerprints: dict[str, dict] = field(default_factory=dict)
```

Add a helper above `_to_index`:

```python
def _fingerprints(articles: dict[str, str], dates: dict[str, str]) -> dict[str, dict]:
    return {
        key: {
            "fingerprint": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "date": dates.get(key),
        }
        for key, text in articles.items()
    }
```

and extend `_to_index`:

```python
def _to_index(act, codice: str, data_gu: str) -> AktIndex:
    return AktIndex(
        title=act.title,
        keys=list(act.order),
        structure=act.structure,
        parts={name: list(part.order) for name, part in act.parts.items()},
        codice_redaz=codice,
        data_gu=data_gu,
        rubriche=act.rubriche(),
        abrogati=act.abrogati(),
        parts_detail=[
            {
                "name": name,
                "keys": list(part.order),
                "rubriche": act.rubriche(name),
                "abrogati": act.abrogati(name),
                "fingerprints": _fingerprints(part.articles, part.dates),
            }
            for name, part in act.parts.items()
        ],
        fingerprints=_fingerprints(act.articles, act.dates),
    )
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_akn_fetch.py -q`
Expected: all passed. `TestTheIndexOnlyContract.test_no_article_text_is_retained` bounds `repr(index)` at 20,000 characters for L. 241/1990 (51 articles); 51 fingerprints add about 6 KB. If that assertion now fails, raise its bound to `40000` and extend its comment: "fingerprints are 64-hex hashes, not text — still bounded, still no article body".

- [ ] **Step 5: Commit**

```bash
git add visualex_api/services/akn_fetch.py tests/test_akn_fetch.py
git commit -m "feat(akn): per-article fingerprints and dates on the act index

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /fetch_act_fingerprints`

**Files:**
- Modify: `app.py` (route + handler after `fetch_rubriche`)
- Modify: `CLAUDE.md` ("Key API Endpoints"; `akn_parser.py` bullet in Architecture)
- Test: `tests/test_fetch_act_fingerprints.py`

**Interfaces:**
- Consumes: `fetch_act_index(SimpleNamespace(url=act_url))` and `AktIndex.fingerprints` / `parts_detail` from Task 5.
- Produces: `POST /fetch_act_fingerprints {urn}` → `200 {"fingerprints": {...}, "parts": [{"name", "fingerprints"}], "count": n}`; `200` with empty maps and `"available": false` when no AKN index exists; `400` without `urn` or for an EUR-Lex URL.

- [ ] **Step 1: Write the failing tests**

`tests/test_fetch_act_fingerprints.py`:

```python
"""`POST /fetch_act_fingerprints`: which articles of an act changed, cheaply.

The archive that consumes this compares the hashes with the ones it stored
last time and refetches only the articles whose hash moved — minutes instead
of hours for a full refetch. When the AKN export is unavailable the endpoint
says so with `available: false` and empty maps; the caller falls back to a
full fetch rather than concluding nothing changed.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _index():
    return AktIndex(
        title="Legge 7 agosto 1990, n. 241",
        keys=["1", "2", "2-bis"],
        fingerprints={
            "1": {"fingerprint": "a" * 64, "date": None},
            "2": {"fingerprint": "b" * 64, "date": None},
            "2-bis": {"fingerprint": "c" * 64, "date": None},
        },
        parts_detail=[],
    )


ACT_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"


class TestHappyPath:
    async def test_serves_the_index_fingerprints(self, client):
        fake = AsyncMock(return_value=_index())
        with patch("app.fetch_act_index", fake):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 200
        body = await response.get_json()
        assert body["available"] is True
        assert body["count"] == 3
        assert body["fingerprints"]["2-bis"]["fingerprint"] == "c" * 64
        assert body["parts"] == []

    async def test_the_article_suffix_is_stripped_from_the_urn(self, client):
        fake = AsyncMock(return_value=_index())
        with patch("app.fetch_act_index", fake):
            await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL + "~art2"})
        norma = fake.await_args.args[0]
        assert norma.url == ACT_URL

    async def test_parts_are_served_with_their_fingerprints(self, client):
        index = _index()
        index.parts_detail = [{
            "name": "Disposizioni sulla legge in generale", "keys": ["1"],
            "rubriche": {}, "abrogati": [],
            "fingerprints": {"1": {"fingerprint": "d" * 64, "date": "1942-04-21"}},
        }]
        with patch("app.fetch_act_index", AsyncMock(return_value=index)):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        body = await response.get_json()
        assert body["parts"] == [{
            "name": "Disposizioni sulla legge in generale",
            "fingerprints": {"1": {"fingerprint": "d" * 64, "date": "1942-04-21"}},
        }]


class TestDegradedAndInvalid:
    async def test_no_index_is_a_200_that_says_so(self, client):
        with patch("app.fetch_act_index", AsyncMock(return_value=None)):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 200
        body = await response.get_json()
        assert body == {"available": False, "fingerprints": {}, "parts": [], "count": 0}

    async def test_missing_urn_is_a_400(self, client):
        response = await client.post("/fetch_act_fingerprints", json={})
        assert response.status_code == 400

    async def test_eurlex_urls_are_a_400(self, client):
        response = await client.post("/fetch_act_fingerprints", json={
            "urn": "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
        })
        assert response.status_code == 400
        assert "Normattiva" in (await response.get_json())["error"]

    async def test_an_unexpected_failure_is_a_500_not_an_empty_200(self, client):
        """Empty-and-200 means "nothing changed" to the caller; a crash must not
        be mistaken for that."""
        with patch("app.fetch_act_index", AsyncMock(side_effect=RuntimeError("boom"))):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 500
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_fetch_act_fingerprints.py -q`
Expected: failures on the unknown route (404/405).

- [ ] **Step 3: Implement**

In `app.py`, `_setup_routes`, after the `/fetch_recitals` rule:

```python
        self.app.add_url_rule('/fetch_act_fingerprints', view_func=self.fetch_act_fingerprints, methods=['POST'])
```

Handler, after `fetch_recitals`:

```python
    async def fetch_act_fingerprints(self):
        """Per-article change detectors for a Normattiva act.

        One download of the act's AKN export yields a hash of every article's
        text and, for the codici, the date each article's text came into
        force. A client that stored the hashes last time can tell which
        articles to refetch without touching the others — the archive's
        update run drops from hours to minutes on this.

        The AKN text itself is never served (it transliterates accents; see
        akn_parser.py). Two answers are deliberately different: no index
        (AKN disabled or unavailable) is `available: false` with empty maps
        and 200, so the caller falls back to a full fetch; a crash is a 500,
        so it is never read as "nothing changed".
        """
        try:
            data = await request.get_json() or {}
            urn = data.get('urn')
            if not urn:
                raise ValidationError("Missing 'urn' in request data")
            if 'eur-lex' in str(urn):
                raise ValidationError(
                    "fetch_act_fingerprints accetta solo atti Normattiva: EUR-Lex non ha un export AKN"
                )
            # The AKN index keys off the ACT, so an article suffix has to go:
            # ...;241~art2 -> ...;241 (same rule as fetch_rubriche).
            act_url = str(urn).split('~')[0]
            index = await fetch_act_index(SimpleNamespace(url=act_url))
            if index is None:
                log.info("No AKN index available for fingerprints", urn=act_url[:100])
                return jsonify({'available': False, 'fingerprints': {}, 'parts': [], 'count': 0})
            log.info("Fingerprints served", urn=act_url[:100], count=len(index.fingerprints))
            return jsonify({
                'available': True,
                'fingerprints': index.fingerprints,
                'parts': [
                    {'name': part['name'], 'fingerprints': part.get('fingerprints', {})}
                    for part in index.parts_detail
                ],
                'count': len(index.fingerprints),
            })
        except Exception as exc:
            return self._error_response(exc, 'fetch_act_fingerprints')
```

`SimpleNamespace` and `fetch_act_index` are already imported in `app.py` (used by `fetch_rubriche`).

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_fetch_act_fingerprints.py -q`
Expected: 7 passed.

- [ ] **Step 5: Document**

`CLAUDE.md`, "Key API Endpoints", after the `/fetch_recitals` bullet:

```markdown
- `/fetch_act_fingerprints` — `{urn}` → a sha256 per article of the act's
  AKN text plus, for the codici, the FRBRWork date of each article (the day
  its current text came into force). A change detector, never the text:
  a client refetches only the articles whose hash moved. `available: false`
  with empty maps when there is no AKN index — the caller must then refetch
  everything, not conclude nothing changed
```

And in the Architecture section, `akn_parser.py` bullet, append one sentence after "Article texts are never cached.":

```markdown
    `ParsedPart.dates` carries each article's FRBRWork date (component acts
    only), and `AktIndex.fingerprints` a sha256 per article — both are
    metadata about the text, not the text.
```

- [ ] **Step 6: Full suite and commit**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green.

```bash
git add app.py CLAUDE.md tests/test_fetch_act_fingerprints.py
git commit -m "feat(api): POST /fetch_act_fingerprints — which articles changed, from one AKN download

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `celex_consolidated` — model, URL and request threading

**Files:**
- Modify: `visualex_api/tools/norma.py` (`Norma`: new field, `url`, `to_dict`; `NormaVisitata`: `urn`, `__hash__`, `__eq__`, `from_dict`)
- Modify: `visualex_api/tools/urngenerator.py` (`generate_urn` gains `celex_consolidated=None`)
- Modify: `visualex_api/services/eurlex_scraper.py` (`get_uri` gains `celex_consolidated=None`)
- Modify: `app.py` (`create_norma_visitata_from_data` reads `celex_consolidated`)
- Test: `tests/test_eurlex_consolidated.py` (part 1: model and endpoint)

**Interfaces:**
- Produces: `Norma(..., celex_consolidated="02002L0058-20091219").url == "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"`; the same URL from `NormaVisitata.urn`; request field `celex_consolidated` on `/fetch_norma_data`, `/fetch_article_text`, `/stream_article_text`, `/fetch_all_data` (all go through `create_norma_visitata_from_data`). `EurlexScraper.get_uri(act_type, year, num, celex_consolidated=None)`. Consolidated CELEX shape: `^0\d{4}[A-Z]\d{4}-\d{8}$` (sector 0, year, type letter, number, `-`, YYYYMMDD).

Why a field on `Norma` rather than a raw URL override: the URL is derived in two places (`Norma.url` and `NormaVisitata.urn`, both through `generate_urn`), and the scraper cache keys off the URL — carrying the CELEX on the model keeps both derivations and the cache key consistent, and `to_dict()` shows the client what version it got.

- [ ] **Step 1: Write the failing tests**

`tests/test_eurlex_consolidated.py`:

```python
"""EU consolidated texts.

For regulations and directives VisuaLex reads the Official Journal page
(`/eli/…/oj/ita`) — the act as published. That is the wrong text for an act
that has been amended: Dir. 2002/58/CE without the 2009 amendment has no
cookie rule in art. 5(3); Reg. 910/2014 was rewritten by Reg. 2024/1183.
EUR-Lex publishes consolidated versions under a sector-0 CELEX
("02002L0058-20091219"); a request may name one and VisuaLex serves it.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.exceptions import ValidationError
from visualex_api.tools.norma import Norma, NormaVisitata

CONSOLIDATED = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
OJ = "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita"


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestModel:
    def test_without_the_field_the_oj_url_is_unchanged(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        assert norma.url == OJ

    def test_the_field_selects_the_consolidated_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        assert norma.url == CONSOLIDATED

    def test_the_article_urn_follows_the_act_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        assert nv.urn == CONSOLIDATED

    def test_to_dict_round_trips_the_field(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        data = nv.to_dict()
        assert data["celex_consolidated"] == "02002L0058-20091219"
        assert data["url"] == CONSOLIDATED
        again = NormaVisitata.from_dict(data)
        assert again.norma.celex_consolidated == "02002L0058-20091219"
        assert again.urn == CONSOLIDATED

    def test_to_dict_omits_the_field_when_unset(self):
        nv = NormaVisitata(norma=Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58"),
                           numero_articolo="5")
        assert "celex_consolidated" not in nv.to_dict()

    def test_consolidated_and_oj_versions_are_different_visits(self):
        base = dict(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        oj = NormaVisitata(norma=Norma(**base), numero_articolo="5")
        cons = NormaVisitata(norma=Norma(**base, celex_consolidated="02002L0058-20091219"),
                             numero_articolo="5")
        assert oj != cons
        assert hash(oj) != hash(cons)

    def test_a_malformed_celex_is_rejected(self):
        with pytest.raises(ValidationError):
            Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="32002L0058").url  # sector 3 is the OJ act, not a consolidation

    def test_get_uri_accepts_the_field_directly(self):
        scraper = EurlexScraper()
        assert scraper.get_uri("direttiva ue", "2002", "58",
                               celex_consolidated="02002L0058-20091219") == CONSOLIDATED
        assert scraper.get_uri("direttiva ue", "2002", "58") == OJ


class TestRequestThreading:
    @pytest.fixture(autouse=True)
    def _no_network(self):
        # create_norma_visitata_from_data probes the tree for the annex lookup
        # and the AKN index for the existence check; both are network.
        with patch("app.get_tree", AsyncMock(return_value=([], 0, {}))), \
             patch("app.fetch_act_index", AsyncMock(return_value=None)), \
             patch("app.add_to_history"):
            yield

    async def test_fetch_norma_data_carries_the_consolidated_url(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58",
            "article": "5", "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 200
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == CONSOLIDATED
        assert norma_data["urn"] == CONSOLIDATED
        assert norma_data["celex_consolidated"] == "02002L0058-20091219"

    async def test_without_the_field_nothing_changes(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58", "article": "5",
        })
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == OJ

    async def test_the_field_on_a_normattiva_act_is_a_400(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "codice civile", "article": "2043",
            "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 400
        assert "EUR-Lex" in (await response.get_json())["error"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_eurlex_consolidated.py -q`
Expected: `TypeError: Norma.__init__() got an unexpected keyword argument 'celex_consolidated'` and endpoint assertions failing on the OJ URL.

- [ ] **Step 3: Implement the scraper side**

`visualex_api/services/eurlex_scraper.py` — import `ValidationError` alongside the other exceptions, add a module-level regex and extend `get_uri`:

```python
from ..tools.exceptions import DocumentNotFoundError, NetworkError, ValidationError
```

```python
# A consolidated version's CELEX: sector 0, year, type letter, act number,
# then the consolidation date. "02002L0058-20091219" is Dir. 2002/58/CE as
# amended up to 19 December 2009. Sector 3 ("32002L0058") is the OJ act and
# is what the ELI URL already serves, so it is not accepted here.
_CONSOLIDATED_CELEX = re.compile(r"^0\d{4}[A-Z]\d{4}-\d{8}$")
```

```python
    def get_uri(self, act_type, year, num, celex_consolidated=None):
        log.debug(f"get_uri called with act_type={act_type}, year={year}, num={num}, "
                  f"celex_consolidated={celex_consolidated}")

        if celex_consolidated:
            if not _CONSOLIDATED_CELEX.match(str(celex_consolidated)):
                raise ValidationError(
                    f"celex_consolidated non valido: {celex_consolidated!r} "
                    "(atteso il CELEX di una versione consolidata, es. 02002L0058-20091219)"
                )
            uri = f"https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:{celex_consolidated}"
            log.info(f"Consolidated version requested. URI: {uri}")
            return uri

        # EUR-Lex only needs the year, not full date (YYYY-MM-DD → YYYY)
        if year and '-' in str(year):
            year = str(year).split('-')[0]

        if act_type in EURLEX and EURLEX[act_type].startswith('https'):
            uri = EURLEX[act_type]
            log.info(f"Act type is a treaty. Using predefined URI: {uri}")
        else:
            uri = f'{self.base_url}/{EURLEX[act_type]}/{year}/{num}/oj/ita'
            log.info(f"Constructed URI for regulation or directive: {uri}")

        return uri
```

- [ ] **Step 4: Thread it through `generate_urn`**

`visualex_api/tools/urngenerator.py`, signature and the EURLEX branch:

```python
def generate_urn(act_type, date=None, act_number=None, article=None, annex=None, version=None,
                 version_date=None, urn_flag=True, celex_consolidated=None):
```

```python
    # Handle EURLEX cases (check before replacing spaces with dots)
    if normalized_act_type.lower() in EURLEX:
        eurlex_scraper = EurlexScraper()
        return eurlex_scraper.get_uri(act_type=normalized_act_type.lower(), year=date, num=act_number,
                                      celex_consolidated=celex_consolidated)
```

Add `celex_consolidated -- Sector-0 CELEX of a consolidated EU version (optional, EU acts only)` to the docstring's argument list.

- [ ] **Step 5: The model**

`visualex_api/tools/norma.py`:

`Norma` — new field after `tipo_atto_reale`:

```python
    # Sector-0 CELEX of a consolidated EU version ("02002L0058-20091219").
    # EU acts only; when set, `url` points at that version instead of the OJ
    # page, and so does every NormaVisitata built on this Norma.
    celex_consolidated: str = None
```

`Norma.url`:

```python
            self._url = generate_urn(
                act_type=self.tipo_atto_urn,
                date=self.data,
                act_number=self.numero_atto,
                urn_flag=False,
                celex_consolidated=self.celex_consolidated,
            )
```

`Norma.to_dict` — after the `tipo_atto_reale` block:

```python
        if self.celex_consolidated:
            result['celex_consolidated'] = self.celex_consolidated
```

`NormaVisitata.__hash__`:

```python
        return hash((self.norma.tipo_atto_urn, self.norma.data, self.norma.numero_atto,
                     self.norma.celex_consolidated, self.numero_articolo, self.versione,
                     self.data_versione))
```

`NormaVisitata.__eq__` — add one clause:

```python
                self.norma.celex_consolidated == other.norma.celex_consolidated and
```

`NormaVisitata.urn`:

```python
            self._urn = generate_urn(
                act_type=self.norma.tipo_atto_urn,
                date=self.norma.data,
                act_number=self.norma.numero_atto,
                annex = self.allegato,
                article=self.numero_articolo,
                version=self.versione,
                version_date=self.data_versione,
                celex_consolidated=self.norma.celex_consolidated,
            )
```

`NormaVisitata.from_dict` — the `Norma(...)` call gains:

```python
            celex_consolidated=data.get('celex_consolidated'),
```

`NormaVisitata.to_dict` needs no change: it starts from `self.norma.to_dict()`.

- [ ] **Step 6: The request**

`app.py`, `create_norma_visitata_from_data`, right after `norma_date = data.get('date')`:

```python
        # A consolidated EU version. Validated here so a Normattiva request
        # carrying the field fails loudly instead of being silently ignored.
        celex_consolidated = data.get('celex_consolidated') or None
        if celex_consolidated and normalize_act_type(act_type).lower() not in ('regolamento ue', 'direttiva ue'):
            raise ValidationError(
                "celex_consolidated vale solo per atti EUR-Lex (regolamento ue, direttiva ue)"
            )
```

and the `Norma(...)` construction gains `celex_consolidated=celex_consolidated`.

- [ ] **Step 7: Run the tests, then the whole suite**

Run: `.venv/bin/python -m pytest tests/test_eurlex_consolidated.py -q`
Expected: 11 passed.

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green. `tests/test_egress_allowlist.py` scans URL literals: the new one names `eur-lex.europa.eu`, which is allowed.

- [ ] **Step 8: Commit**

```bash
git add visualex_api/tools/norma.py visualex_api/tools/urngenerator.py visualex_api/services/eurlex_scraper.py app.py tests/test_eurlex_consolidated.py
git commit -m "feat(eurlex): a request may name a consolidated CELEX version

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Consolidated-page markup — article text, rubriche, tree

**Files:**
- Modify: `visualex_api/services/eurlex_scraper.py` (module-level consolidated helpers; one branch at the top of `extract_article_text`)
- Modify: `visualex_api/tools/treextractor.py` (`_parse_eurlex_tree` consolidated branch, `_extract_eurlex_rubriche` consolidated branch, two helpers)
- Test: `tests/test_eurlex_consolidated.py` (part 2: parsers)

**Interfaces:**
- Consumes: fixtures from Task 1; `normalize_article_key` from `visualex_api/services/akn_parser.py` (pure, reads the shared suffix table).
- Produces: `is_consolidated_markup(soup) -> bool`, `extract_article_consolidated(soup, article) -> str | None` in `eurlex_scraper.py`; `_walk_consolidated_tree(soup, normurn, link, details, eli_info) -> tuple[list, int]` and `_extract_consolidated_rubriche(soup) -> dict` in `treextractor.py`. Article numbers with suffixes come out hyphenated (`14-bis`, `5-quinquies`) on both the tree and the text.

The OJ paths are untouched: each function first asks `is_consolidated_markup` (a `p.title-article-norm` exists) and only then takes the new branch. Verified against the real pages on 2026-09-19: Dir. 2002/58 consolidated has 23 articles including `14-bis` and `15-bis` and no chapter headings; Reg. 910/2014 consolidated has 82 articles, `CAPO I DISPOSIZIONI GENERALI` before art. 1 and `SEZIONE 1 Portafoglio europeo di identità digitale` before art. 5-bis.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_eurlex_consolidated.py`:

```python
from pathlib import Path

from bs4 import BeautifulSoup

from visualex_api.tools.exceptions import DocumentNotFoundError
from visualex_api.tools.treextractor import _extract_eurlex_rubriche, _parse_eurlex_tree

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def soup_of(name):
    return BeautifulSoup((FIXTURES / name).read_text(encoding="utf-8"), "html.parser")


class TestConsolidatedArticleText:
    async def test_flat_consolidated_page(self):
        text = await EurlexScraper().extract_article_text(
            soup_of("eprivacy_consolidated_20091219.html"), "5")
        lines = text.split("\n")
        assert lines[0] == "Articolo 5"
        assert lines[1] == "Riservatezza delle comunicazioni"
        assert lines[2].startswith("1. Gli Stati membri assicurano")
        assert "▼" not in text, "modref markers are not text"
        assert "Articolo 6" not in text, "the next article must not leak in"

    async def test_suffixed_article_in_both_spellings(self):
        soup = soup_of("eprivacy_consolidated_20091219.html")
        hyphen = await EurlexScraper().extract_article_text(soup, "14-bis")
        space = await EurlexScraper().extract_article_text(soup, "14 bis")
        assert hyphen == space
        assert hyphen.startswith("Articolo 14 bis\nProcedura di comitato\n1. La Commissione")

    async def test_subdivision_wrapped_consolidated_page(self):
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "50")
        assert text.startswith("Articolo 50\nAbrogazione\n1. La direttiva 1999/93/CE")
        assert "2. I riferimenti alla direttiva abrogata" in text
        assert "Articolo 51" not in text

    async def test_paragraph_numbers_are_separated_from_their_text(self):
        # eIDAS renders "1." in a <span class="no-parag"> beside the text; a
        # bare get_text(strip=True) would glue them into "1.Il presente".
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "2")
        assert "\n1. " in text or text.split("\n")[2].startswith("1. ")

    async def test_missing_article_raises(self):
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(
                soup_of("eidas_consolidated_20241018_trimmed.html"), "999")

    async def test_oj_pages_take_the_old_path(self):
        text = await EurlexScraper().extract_article_text(soup_of("gdpr_oj_trimmed.html"), "1")
        assert text.startswith("Articolo 1")
        assert "Oggetto e finalità" in text


class TestConsolidatedRubriche:
    def test_flat_page(self):
        rubriche = _extract_eurlex_rubriche(soup_of("eprivacy_consolidated_20091219.html"))
        assert rubriche["5"] == "Riservatezza delle comunicazioni"
        assert rubriche["14-bis"] == "Procedura di comitato"
        assert len(rubriche) == 23

    def test_subdivision_page(self):
        rubriche = _extract_eurlex_rubriche(soup_of("eidas_consolidated_20241018_trimmed.html"))
        assert rubriche["1"] == "Oggetto"
        assert rubriche["50"] == "Abrogazione"

    def test_oj_page_unchanged(self):
        rubriche = _extract_eurlex_rubriche(soup_of("gdpr_oj_trimmed.html"))
        assert rubriche["1"] == "Oggetto e finalità"
        assert rubriche["17"] == "Diritto alla cancellazione («diritto all'oblio»)"


class TestConsolidatedTree:
    CONS = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"

    async def test_flat_page_lists_suffixed_articles_in_order(self):
        result, count, metadata = await _parse_eurlex_tree(
            soup_of("eprivacy_consolidated_20091219.html"), self.CONS, link=False, details=True)
        numbers = [item["numero"] for item in result if isinstance(item, dict)]
        assert count == 23
        assert numbers[13:17] == ["14", "14-bis", "15", "15-bis"]
        assert metadata["rubriche"]["14-bis"] == "Procedura di comitato"

    async def test_headings_carry_their_title_and_precede_their_articles(self):
        result, count, _ = await _parse_eurlex_tree(
            soup_of("eidas_consolidated_20241018_trimmed.html"), self.CONS, link=False, details=True)
        assert result[0] == "CAPO I DISPOSIZIONI GENERALI"
        assert result[1] == {"numero": "1"}
        assert count >= 6  # Capo I (art. 1-5) + art. 50

    async def test_headings_are_omitted_without_details(self):
        result, _, _ = await _parse_eurlex_tree(
            soup_of("eidas_consolidated_20241018_trimmed.html"), self.CONS, link=False, details=False)
        assert all(isinstance(item, dict) for item in result)

    async def test_link_true_falls_back_to_an_anchor_on_the_consolidated_url(self):
        result, _, _ = await _parse_eurlex_tree(
            soup_of("eprivacy_consolidated_20091219.html"), self.CONS, link=True, details=False)
        first = result[0]
        assert first["numero"] == "1"
        assert first["url"] == f"{self.CONS}#art_1"

    async def test_oj_page_unchanged(self):
        result, count, metadata = await _parse_eurlex_tree(
            soup_of("gdpr_oj_trimmed.html"), "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
            link=False, details=True)
        numbers = [item["numero"] for item in result if isinstance(item, dict)]
        assert numbers == ["1", "2", "3", "4", "17"]
        assert "CAPO I" in result
```

The GDPR art. 17 rubrica literal: check the fixture (`grep -o 'oj-sti-art">[^<]*' tests/fixtures/eurlex/gdpr_oj_trimmed.html`) and paste the exact string, quotes included.

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_eurlex_consolidated.py -q -k "Consolidated"`
Expected: text tests fail with `DocumentNotFoundError` or wrong line 2 ("▼B" leaking); rubriche tests fail with `KeyError: '5'`; tree tests fail on count (the generic fallback collapses `14 bis` into `14`).

- [ ] **Step 3: Consolidated helpers in the scraper**

`visualex_api/services/eurlex_scraper.py` — add an import and a module-level block after the recitals block:

```python
from .akn_parser import normalize_article_key
```

```python
# --- Consolidated texts ---------------------------------------------------
#
# EUR-Lex renders a consolidated version with a markup of its own: the number
# is <p class="title-article-norm">Articolo 5</p> (an ordinal suffix as
# <span class="italics">bis</span>), the rubrica <p class="stitle-article-norm">
# (bare, or inside <div class="eli-title">), the body in `norm` paragraphs or
# divs with `no-parag` numbers and `grid-list` tables for lettered points,
# and <p class="modref">▼M1</p> markers naming the amending act before each
# changed block. Recent consolidations wrap every article in
# <div class="eli-subdivision" id="art_N">; older ones are flat.
_CONS_ARTICLE_CLASS = "title-article-norm"
_CONS_RUBRICA_CLASS = "stitle-article-norm"
_CONS_SKIP_CLASSES = {"modref", "separator", "separator-short", "hd-modifiers", "footnote", "arrow"}
_CONS_BODY_CLASSES = {"norm", "grid-container", "grid-list", "list", "no-parag"}


def is_consolidated_markup(soup) -> bool:
    return soup.find("p", class_=_CONS_ARTICLE_CLASS) is not None


def _element_classes(element) -> set:
    return set(element.get("class", []) or [])


def _cons_text(element) -> str:
    # A separator between child nodes: "1." sits in its own span next to the
    # paragraph text, and NBSP is EUR-Lex's favourite space.
    return re.sub(r"[ \t\xa0]+", " ", element.get_text(" ", strip=True)).strip()


def _cons_find_title(soup, article):
    wanted = normalize_article_key(str(article))
    for marker in soup.find_all("p", class_=_CONS_ARTICLE_CLASS):
        if normalize_article_key(marker.get_text(" ", strip=True)) == wanted:
            return marker
    return None


def extract_article_consolidated(soup, article) -> "str | None":
    """Article text from a consolidated page, or None when the page lacks it.

    Same line structure as the OJ extractor — "Articolo N", the rubrica, one
    line per paragraph — so a client sees the same shape whichever version it
    asked for. Modification markers are not text and are dropped.
    """
    title = _cons_find_title(soup, article)
    if title is None:
        return None
    lines = [_cons_text(title)]
    for sibling in title.find_next_siblings():
        classes = _element_classes(sibling)
        if (_CONS_ARTICLE_CLASS in classes or "eli-subdivision" in classes
                or "hd-modifiers" in classes
                or any(c.startswith("title-division") for c in classes)):
            break  # next article, next chapter, or the amendments table
        if _CONS_RUBRICA_CLASS in classes:
            lines.append(_cons_text(sibling))
            continue
        if "eli-title" in classes:
            rubrica = sibling.find("p", class_=_CONS_RUBRICA_CLASS)
            if rubrica is not None:
                lines.append(_cons_text(rubrica))
            continue
        if classes & _CONS_SKIP_CLASSES:
            continue
        if sibling.name == "table" or classes & _CONS_BODY_CLASSES:
            text = _cons_text(sibling)
            if text:
                lines.append(text)
    return "\n".join(lines)
```

At the top of `EurlexScraper.extract_article_text`, before `search_patterns`:

```python
        if is_consolidated_markup(soup):
            text = extract_article_consolidated(soup, article)
            if text is None:
                log.warning(f"Article {article} not found in the consolidated document")
                raise DocumentNotFoundError(
                    f"Article {article} not found in EUR-Lex consolidated document",
                    urn=soup.find('link', rel='canonical')['href'] if soup.find('link', rel='canonical') else None
                )
            log.info(f"Article {article} text extracted from consolidated markup")
            return text
```

- [ ] **Step 4: Consolidated helpers in the tree extractor**

`visualex_api/tools/treextractor.py` — import at the top:

```python
from ..services.akn_parser import normalize_article_key
```

(Check for an import cycle: `akn_parser` imports only `..tools.article_suffixes`, `lxml`, `structlog` — fine.)

Two helpers next to `_extract_eurlex_rubriche`:

```python
def _cons_rubrica_of(marker):
    """The rubrica element that follows a consolidated article marker.

    Bare `stitle-article-norm` (flat pages) or inside `div.eli-title`
    (subdivision pages); a `modref` marker may sit in between.
    """
    sibling = marker.find_next_sibling()
    while sibling is not None and "modref" in (sibling.get("class", []) or []):
        sibling = sibling.find_next_sibling()
    if sibling is None:
        return None
    classes = sibling.get("class", []) or []
    if "stitle-article-norm" in classes:
        return sibling
    if "eli-title" in classes:
        return sibling.find("p", class_="stitle-article-norm")
    return None


def _extract_consolidated_rubriche(soup):
    rubriche = {}
    for marker in soup.find_all("p", class_="title-article-norm"):
        key = normalize_article_key(marker.get_text(" ", strip=True))
        if not key:
            continue
        rubrica = _cons_rubrica_of(marker)
        if rubrica is None:
            continue
        title = re.sub(r"\s+", " ", rubrica.get_text(" ", strip=True)).strip()
        if title:
            rubriche[key] = title
    return rubriche


def _walk_consolidated_tree(soup, normurn, link, details, eli_info):
    """Articles and (with details) chapter headings of a consolidated page.

    `title-division-1` is the heading number ("CAPO I", "SEZIONE 1") and the
    `title-division-2` right after it the heading text; both are kept so the
    index reads "CAPO I DISPOSIZIONI GENERALI". Article numbers are
    canonicalised through the shared suffix table: "Articolo 14 bis" is
    14-bis, not a second 14.
    """
    result = []
    seen = set()
    count = 0
    for elem in soup.find_all("p", class_=["title-division-1", "title-article-norm"]):
        classes = elem.get("class", []) or []
        if "title-division-1" in classes:
            if not details:
                continue
            heading = elem.get_text(" ", strip=True)
            nxt = elem.find_next_sibling()
            if nxt is not None and "title-division-2" in (nxt.get("class", []) or []):
                heading = f"{heading} {nxt.get_text(' ', strip=True)}"
            result.append(re.sub(r"\s+", " ", heading).strip())
            continue
        key = normalize_article_key(elem.get_text(" ", strip=True))
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(_format_eurlex_article(key, normurn, eli_info, link))
        count += 1
    return result, count
```

In `_extract_eurlex_rubriche`, first line of the body:

```python
    if soup.find("p", class_="title-article-norm"):
        return _extract_consolidated_rubriche(soup)
```

In `_parse_eurlex_tree`, right after `eli_info = _extract_eli_info(normurn)` and before the patterns:

```python
    if soup.find("p", class_="title-article-norm"):
        result, count_articles = _walk_consolidated_tree(soup, normurn, link, details, eli_info)
        rubriche = _extract_eurlex_rubriche(soup)
        logging.info(f"Consolidated EUR-Lex tree: {count_articles} articles, {len(rubriche)} rubriche")
        return result, count_articles, {"rubriche": rubriche}
```

`_format_eurlex_article` with `link=True` on a `legal-content` URL takes its existing fallback (`f"{normurn}#art_{article_num}"`) because `_extract_eli_info` finds no `/eli/` or sector-3 CELEX in it — that is what the link test asserts.

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `.venv/bin/python -m pytest tests/test_eurlex_consolidated.py tests/test_eurlex_rubriche.py -q`
Expected: all passed.

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green — in particular `tests/test_eurlex_rubriche.py` (OJ markup) unchanged.

- [ ] **Step 6: Document and commit**

`CLAUDE.md`, Scraping Architecture, after item 1 ("Routing") add:

```markdown
   EU acts come from the Official Journal page unless the request names a
   `celex_consolidated` (sector-0 CELEX, `02002L0058-20091219`): then the
   tree, rubriche and article text are read from that consolidated page,
   whose markup is different (`title-article-norm`, `modref` markers) and
   handled by its own branch in `eurlex_scraper.py` / `treextractor.py`.
   Consolidated texts carry no preamble — recitals always come from the OJ
   page of the base act.
```

```bash
git add visualex_api/services/eurlex_scraper.py visualex_api/tools/treextractor.py CLAUDE.md tests/test_eurlex_consolidated.py
git commit -m "feat(eurlex): read consolidated pages — text, rubriche, tree, suffixed articles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Live smoke tests and the request-field documentation

**Files:**
- Create: `tests/test_archive_extensions_live.py`
- Modify: `CLAUDE.md` (request example under "Key API Endpoints")

**Interfaces:**
- Consumes: everything above. No new interfaces.

- [ ] **Step 1: Write the live tests (excluded by default)**

`tests/test_archive_extensions_live.py`:

```python
"""Live checks for the three archive extensions. Run with `-m live`.

One request per feature against the real sources, asserting only what a
change on their side would break: a recital count, a fingerprint shape, a
consolidated article the OJ text does not have.
"""
import pytest

from visualex_api.services.akn_fetch import fetch_act_index
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.norma import Norma

pytestmark = pytest.mark.live


async def test_gdpr_has_173_recitals():
    recitals, url = await EurlexScraper().get_recitals(
        Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679"))
    assert url.endswith("/eli/reg/2016/679/oj/ita")
    assert [r["number"] for r in recitals][:3] == ["1", "2", "3"]
    assert len(recitals) == 173


async def test_legge_241_fingerprints_cover_every_article():
    index = await fetch_act_index(Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"))
    assert index is not None
    assert set(index.fingerprints) == set(index.keys)
    assert all(len(v["fingerprint"]) == 64 for v in index.fingerprints.values())


async def test_eprivacy_consolidated_has_the_2009_cookie_rule():
    norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="02002L0058-20091219")
    scraper = EurlexScraper()
    text, url = await scraper.get_document(normavisitata=None, act_type="direttiva ue",
                                           article="5", year="2002", num="58", urn=norma.url)
    assert "CELEX:02002L0058-20091219" in url
    assert "consenso" in text  # art. 5(3) as amended by Dir. 2009/136/CE
```

- [ ] **Step 2: Run them once, for real**

Run: `.venv/bin/python -m pytest tests/test_archive_extensions_live.py -m live -q`
Expected: 3 passed (Playwright must be installed: `playwright install chromium`). A failure here is information about the source, not the code — record it in the commit message and move on.

- [ ] **Step 3: Document the request field**

`CLAUDE.md`, the JSON request example under "Key API Endpoints" — add a line:

```json
  "celex_consolidated": "02002L0058-20091219"  // optional, EU acts only: serve this consolidated version
```

- [ ] **Step 4: Full default suite and commit**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green; the live module reports as deselected.

```bash
git add tests/test_archive_extensions_live.py CLAUDE.md
git commit -m "test(live): smoke checks for recitals, fingerprints and consolidated texts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Extension 1 (`/fetch_recitals`): Tasks 2-3. Extension 2 (`/fetch_act_fingerprints`, `AktIndex.fingerprints`, per-article date): Tasks 4-6 — the spec said the date comes from `FRBRExpression`; the fixture shows the article-level date is `FRBRWork/FRBRdate`, and the spec is corrected in the same commit as this plan. Extension 3 (consolidated texts, gated on a spike): the spike ran during planning against `02002L0058-20091219` and `02014R0910-20241018` — tractable, with a dedicated branch; Tasks 7-8. The fallback `text_status: oj` in the spec stays available to the archive (Plan 2) for acts whose manifest names no consolidated version. Live tests: Task 9. CLAUDE.md updates: Tasks 3, 6, 8, 9.

**Placeholders.** None: every step carries its code or its command.

**Type consistency.** `extract_recitals(soup) -> list[dict]` (Task 2) is what `get_recitals` returns in a tuple (Task 3). `ParsedPart.dates` / `ParsedAct.dates` (Task 4) feed `_fingerprints(articles, dates)` (Task 5), which fills `AktIndex.fingerprints` and `parts_detail[*]["fingerprints"]`, which the endpoint serves under the same names (Task 6). `get_uri(..., celex_consolidated=None)` (Task 7) is the only signature change and every caller in the plan passes it by keyword. `normalize_article_key` is imported from `visualex_api.services.akn_parser` in both Task 8 modules.
