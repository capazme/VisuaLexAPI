# Transfusion from mcp-legal-it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the improvements worth having from `mcp-legal-it` into VisuaLex — a 387-name act resolver, a machine-checked egress allowlist with CI and offline scraper fixtures, Akoma Ntoso as a structure/fallback source, and six Brocardi fixes plus the Glossario — without moving a single stored highlight or note.

**Architecture:** Safety net first (fixtures, egress guard, CI), so every later change is covered. Then pure-data and pure-function work (act tables, resolver), then the correctness fix that needs no new source (article existence), then AKN as an index-and-fallback layer on the existing HTTP stack, then Brocardi. Everything lands in `visualex_api/tools/` and `visualex_api/services/` so both Quart controllers inherit it; only root `app.py` gets handler-level edits.

**Tech Stack:** Python 3.14 + Quart + aiohttp + BeautifulSoup + lxml (new) + structlog + pytest/pytest-asyncio; React 18 + TypeScript + Zustand + Tailwind + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-trasfusione-mcp-legal-design.md`

## Status: executed 2026-08-26

All 16 tasks implemented on `feature/mcp-legal-transfusion`, uncommitted. Gates at
close: **362 Python tests** (from a 169 baseline), **86 frontend tests**, `npm run
build` and `npm run lint` clean. The step checkboxes below were not ticked during
execution — the tests are the record of what landed, this plan the record of intent.

Two phases failed independent review and were fixed (CI jobs that could not pass; an
article-suffix normaliser that rejected 50 real articles). Five further defects were
found and fixed after the phase reviews:

1. the four HTML extractors returned an `"Error in _estrai_..."` sentinel instead of
   raising, so it was rendered to the reader as the article's text and cached for 24h,
   and the AKN fallback never fired for the failure it was built for;
2. `alignOffsetToTrimmedText` counted `\n` in the leading run, over-shifting anchors
   for selections that start at a line boundary — the same silent data loss Task 15
   exists to stop;
3. the AKN single-flight future could be cancelled by a follower, raising
   `InvalidStateError` into an unrelated request;
4. the Glossario harvested Brocardi's reader Q&A block — 107 of the 114 dictionary
   links on the art. 2043 page — and presented it as the article's glossary;
5. `look_up` passed the bare domain into `_find_article_link`; fixing it exposed that
   the same-site filter compared a string prefix against `brocardi.it` while the pages
   are served from `www.brocardi.it`, which emptied the whole sub-page crawl.

The central gate held: article text is **byte-identical to `main`** across 8 articles
in 5 acts, so no stored highlight or note moved.

Open, deliberately: the AKN fallback response does not carry `source="normattiva-akn"`
(needs a `get_document` signature change), and `ValidationError` / `ResourceNotFoundError`
now map to 400/404 only through `_error_response` in the root controller.


## Global Constraints

- **Interpreter is always `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python`.** With the ambient `python3` the suite is 10 failed / 159 passed because `quart` is not importable. Every command below names it explicitly. Referred to as `$PY`.
- **Baseline to preserve: 169 passed.** No task may reduce it; each task adds tests.
- Source repo, referred to as `$M`: `/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it`. Its library root is `$M/plugin/server/src`.
- **`article_text` must not change shape.** Highlights and anchored notes are pinned by `(startOffset, text)` with an exact case-insensitive equality gate and no fuzzy fallback (`useArticleMarkers.ts:59-88`). A single added space before an anchor silently deletes it from the body. No task may alter `normattiva_scraper._estrai_testo_*` output formatting.
- UI copy Italian; code, comments, commits English. Conventional Commits.
- **Owner rule — no auto-commit.** Each task ends with a *proposed* commit message; the commit is made only when the owner has authorised per-task commits.
- Licence: ported code is relicensed MIT by the owner. Ported files carry **no** Apache header; provenance is one line in `README.md` (Task 16).
- Never block the event loop: XML parsing and disk I/O go through `asyncio.to_thread` (gotcha 2).
- Never swallow errors in load paths: log with structlog and context before any fallback (gotcha 18). No `print(..., file=sys.stderr)`.
- Pre-existing errors surfaced in files being touched are fixed, not deferred (owner's standing rule). The five bugs listed in the spec are assigned to specific tasks below.
- Frontend gates are `npm run test -- --run` and `npm run build` (`tsc -b`; a bare `tsc --noEmit` is a false green).

---

## Phase A — Safety net

### Task 1: pytest config, offline fixtures, and the first scraper regression tests

**Files:**
- Create: `pytest.ini`
- Create: `tests/fixtures/__init__.py` (empty), `tests/fixtures/normattiva/akn_comma_div.html`, `tests/fixtures/normattiva/akn_just_text.html`, `tests/fixtures/normattiva/attachment.html`, `tests/fixtures/normattiva/fallback.html`, `tests/fixtures/normattiva/abrogato.html`
- Create: `tests/test_normattiva_extraction.py`
- Modify: `visualex_api/services/normattiva_scraper.py` (the four `logger` → `log` fixes)
- Modify: `visualex_api/tools/norma.py:161-162` (remove the module-level side effect)

**Interfaces:**
- Consumes: `NormattivaScraper.estrai_da_html(atto: str) -> str` (existing, unchanged signature).
- Produces: `tests/fixtures/normattiva/*.html` — the scenario corpus every later scraper task asserts against.

- [ ] **Step 1: Capture the five fixtures from live Normattiva**

Run this once and commit the output. It writes real HTML, so the tests never need the network again.

```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/.claude/worktrees/wonderful-tereshkova-56ca06
mkdir -p tests/fixtures/normattiva
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.map import extract_codice_details
from visualex_api.services.normattiva_scraper import NormattivaScraper

# (filename, Norma kwargs or codice name, annex, article)
CASES = [
    ("akn_comma_div.html", ("legge", "1990-08-07", "241"), None, "3"),
    ("akn_just_text.html", ("costituzione", None, None), None, "3"),
    ("attachment.html", ("codice civile",), "2", "2043"),
    ("fallback.html", ("decreto legislativo", "2001-06-08", "231"), None, "5"),
    ("abrogato.html", ("legge", "1990-08-07", "241"), None, "6-bis"),
]

async def main():
    s = NormattivaScraper()
    for fname, spec, annex, art in CASES:
        if len(spec) == 1:
            d = extract_codice_details(spec[0])
            n = Norma(tipo_atto=spec[0], data=d["data"], numero_atto=d["numero_atto"],
                      tipo_atto_reale=d["tipo_atto_reale"])
        else:
            n = Norma(tipo_atto=spec[0], data=spec[1], numero_atto=spec[2])
        nv = NormaVisitata(norma=n, numero_articolo=art, allegato=annex)
        html = await s.request_document(nv.urn, source="normattiva")
        with open(f"tests/fixtures/normattiva/{fname}", "w", encoding="utf-8") as fh:
            fh.write(html)
        print(fname, len(html), "bytes")

asyncio.run(main())
EOF
```

Then inspect which extractor branch each fixture actually exercises and rename if a
case landed on the wrong branch:

```bash
for f in tests/fixtures/normattiva/*.html; do
  echo -n "$f: "
  grep -o "art-comma-div-akn\|art-just-text-akn\|attachment-just-text" "$f" | sort -u | tr '\n' ' '
  echo
done
```

Every one of the four branch classes must appear at least once across the corpus. If a
class is missing, find another article that produces it and re-capture — the point of
the corpus is branch coverage, not these specific articles.

- [ ] **Step 2: Write the failing test**

`tests/test_normattiva_extraction.py`:

```python
"""Offline regression corpus for the Normattiva article extractor.

Every scraper in this repo parses third-party HTML, so a break means the site
changed. These fixtures freeze what the site looked like when the extractor was
known good; a diff here is the signal that a selector needs updating.
"""
from pathlib import Path

import pytest

from visualex_api.services.normattiva_scraper import NormattivaScraper

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"

CASES = [
    "akn_comma_div.html",
    "akn_just_text.html",
    "attachment.html",
    "fallback.html",
]


@pytest.fixture(scope="module")
def scraper():
    return NormattivaScraper()


@pytest.mark.parametrize("fixture_name", CASES)
@pytest.mark.asyncio
async def test_every_branch_yields_text(scraper, fixture_name):
    html = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    text = await scraper.estrai_da_html(html)
    assert isinstance(text, str)
    assert len(text.strip()) > 50, f"{fixture_name} produced no usable text"


@pytest.mark.asyncio
async def test_extraction_preserves_italian_accents(scraper):
    """The reading surface shows this text to a lawyer verbatim.

    Normattiva's Akoma Ntoso export transliterates accents ("attivita'", "e'");
    the HTML rendering does not. This asserts we stay on the accented side.
    """
    html = (FIXTURES / "akn_comma_div.html").read_text(encoding="utf-8")
    text = await scraper.estrai_da_html(html)
    assert "'" not in text.replace("dell'", "").replace("all'", "").replace("l'", "") \
        or any(ch in text for ch in "àèéìòù"), "accented characters disappeared"


@pytest.mark.asyncio
async def test_parse_failure_reports_the_real_cause(scraper):
    """A malformed page must not raise NameError from the error path itself."""
    with pytest.raises(Exception) as exc:
        await scraper.estrai_da_html("<html><body>nothing useful here</body></html>")
    assert "logger" not in str(exc.value), (
        "the except block referenced an undefined name instead of reporting the cause"
    )
```

- [ ] **Step 3: Run it and watch it fail**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_normattiva_extraction.py -q
```

Expected: the async tests ERROR with "async def functions are not natively supported"
(asyncio mode is STRICT and there is no config file yet), and
`test_parse_failure_reports_the_real_cause` fails with `NameError: name 'logger' is not defined`.

- [ ] **Step 4: Add the pytest config**

`pytest.ini` at the repo root — deliberately not `pyproject.toml`, because a `[project]`
table would change how the app installs and `deploy.sh` installs with
`pip install -r requirements.txt`:

```ini
[pytest]
testpaths = tests
asyncio_mode = auto
addopts = -m "not live"
markers =
    live: hits real external sources; excluded by default, run with -m live
```

- [ ] **Step 5: Fix the undefined `logger`**

`visualex_api/services/normattiva_scraper.py` defines `log = structlog.get_logger()` at
line 16 but four except blocks call `logger.error(...)`. Replace all four occurrences:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
from pathlib import Path
p = Path("visualex_api/services/normattiva_scraper.py")
src = p.read_text(encoding="utf-8")
assert "logger.error" in src
p.write_text(src.replace("logger.error", "log.error"), encoding="utf-8")
print(src.count("logger.error"), "occurrences replaced")
EOF
grep -n "logger\." visualex_api/services/normattiva_scraper.py || echo "no stale references"
```

Expected: `4 occurrences replaced`, then `no stale references`.

- [ ] **Step 6: Remove the import-time side effect**

`visualex_api/tools/norma.py:161-162` currently runs at import:

```python
codice_civile = Norma(tipo_atto='codice civile')
print(codice_civile.to_dict())
```

Constructing a `Norma` triggers `generate_urn`, so importing the models module does work
*and* writes to stdout. Delete both lines.

- [ ] **Step 7: Run the tests and the full suite**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

Expected: 169 pre-existing + the new ones, all passing, and no stray dict printed
during collection.

- [ ] **Step 8: Propose the commit**

```
test: offline Normattiva extraction corpus + pytest config

Freezes the four extractor branches against captured HTML so a selector break
is a red test rather than a silent empty article. Fixes the undefined `logger`
in four except blocks, which turned every parse failure into a NameError, and
removes the import-time print in tools/norma.py.
```

---

### Task 2: Egress allowlist, enforced, and TLS verification turned back on

**Files:**
- Create: `visualex_api/tools/egress.py`
- Create: `tests/test_egress_allowlist.py`
- Modify: `visualex_api/services/http_client.py` (guard in `request`; `ssl=False` → verified)
- Modify: `visualex_api/tools/treextractor.py:91-94` (its own `ssl=False` session)
- Create: `SECURITY.md`

**Interfaces:**
- Produces: `is_allowed(url: str) -> bool`, `ALLOWED_HOSTS: dict[str, str]`, `NON_NETWORK_HOSTS: dict[str, str]` from `visualex_api.tools.egress`.
- Consumes: `ThrottledHttpClient.request(method, url, *, source, **kwargs)` (existing).

- [ ] **Step 1: Write the failing test**

`tests/test_egress_allowlist.py`. Note `parents[1]` — VisuaLex's `tests/` is flat, unlike
the source repo's `tests/unit/`, where the same line is `parents[2]`. Note also that the
walker covers the root `app.py` explicitly: `start.sh` launches that file and a package
walk would miss its three health-check URLs.

```python
"""No URL may appear in the code for a host this project has not declared.

A lawyer evaluating this server has to answer one question before running it on
client matters: where does my data go. A prose list drifts the first time
someone adds a scraper; this fails the build instead.

The guarantee is STATIC — it checks URL literals in the source, not what happens
at runtime. It would not catch a URL assembled from fragments, and nothing here
claims otherwise. The runtime half is `is_allowed()`, wired into
ThrottledHttpClient.request.
"""
import re
from pathlib import Path

import pytest

from visualex_api.tools.egress import ALLOWED_HOSTS, NON_NETWORK_HOSTS, is_allowed

ROOT = Path(__file__).resolve().parents[1]
URL = re.compile(r"https?://([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])")


def hosts_in_sources() -> dict[str, list[str]]:
    """Every host in a URL literal across the server's own source."""
    found: dict[str, list[str]] = {}
    targets = list((ROOT / "visualex_api").rglob("*.py")) + [ROOT / "app.py"]
    for path in sorted(targets):
        for host in set(URL.findall(path.read_text(encoding="utf-8"))):
            found.setdefault(host, []).append(str(path.relative_to(ROOT)))
    return found


SERVER_HOSTS = sorted(hosts_in_sources())


@pytest.mark.parametrize("host", SERVER_HOSTS)
def test_server_contacts_only_declared_hosts(host):
    allowed = ALLOWED_HOSTS | NON_NETWORK_HOSTS
    assert host in allowed, (
        f"'{host}' appears in a URL literal but is not declared.\n"
        "If the server really contacts it, add it to ALLOWED_HOSTS in "
        "visualex_api/tools/egress.py and to SECURITY.md. If it is a namespace, "
        "a comment or a placeholder, add it to NON_NETWORK_HOSTS."
    )


@pytest.mark.parametrize("host", sorted(ALLOWED_HOSTS))
def test_every_allowed_host_is_documented(host):
    assert host in (ROOT / "SECURITY.md").read_text(encoding="utf-8"), (
        f"'{host}' is allowed in code but absent from SECURITY.md"
    )


def test_the_allowlist_is_not_vacuous():
    assert "www.normattiva.it" in ALLOWED_HOSTS
    assert len(ALLOWED_HOSTS) >= 4


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge", True),
        ("https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita", True),
        ("https://www.normattiva.it.evil.test/phish", False),
        ("http://169.254.169.254/latest/meta-data/", False),
        ("not-a-url", False),
    ],
)
def test_is_allowed(url, expected):
    assert is_allowed(url) is expected
```

- [ ] **Step 2: Run it to see the shape of the failure**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_egress_allowlist.py -q
```

Expected: collection error, `ModuleNotFoundError: visualex_api.tools.egress`.

- [ ] **Step 3: Write the allowlist**

`visualex_api/tools/egress.py`:

```python
"""The complete list of hosts this server may contact, and who operates each one.

Answering "where does my data go" by reading the code is days of work, and
answering it with a promise in a README is worth nothing. So the answer lives
here as data, `tests/test_egress_allowlist.py` fails the build if a URL literal
appears for a host not listed, and `is_allowed()` is checked at request time in
ThrottledHttpClient.

The server sends no telemetry and has no analytics endpoint. Every host below is
a source consulted to answer a specific legal question.
"""
from __future__ import annotations

from urllib.parse import urlparse

#: Hosts the running server may contact, mapped to who operates them.
ALLOWED_HOSTS: dict[str, str] = {
    # --- Italian State: legislation ---
    "www.normattiva.it": "Normattiva — Istituto Poligrafico e Zecca dello Stato",
    # --- European Union ---
    "eur-lex.europa.eu": "EUR-Lex — Ufficio delle pubblicazioni UE",
    # --- Private ---
    # The only non-institutional source. Brocardi supplies doctrinal notes and
    # case-law abstracts, never the text of a norm: that always comes from
    # Normattiva or EUR-Lex. Two spellings are in use across the codebase
    # (services/brocardi_scraper.py uses the bare form, tools/map.py the www one),
    # so both are declared.
    "brocardi.it": "Brocardi.it — annotazioni dottrinali (fonte privata)",
    "www.brocardi.it": "Brocardi.it — annotazioni dottrinali (fonte privata)",
}

#: Strings that look like hosts but are never fetched.
NON_NETWORK_HOSTS: dict[str, str] = {
    "localhost": "default CORS origins and the frontend link in a JSON response",
    "www.normattiva.it.evil.com": (
        "appears only inside the comment in services/pdfextractor.py explaining "
        "why the SSRF guard compares hosts exactly"
    ),
}


def is_allowed(url: str) -> bool:
    """True when `url`'s host is one the running server may contact."""
    try:
        return (urlparse(url).hostname or "") in ALLOWED_HOSTS
    except ValueError:
        return False
```

- [ ] **Step 4: Write SECURITY.md**

`SECURITY.md` must contain each allowed host verbatim — the test greps for it.

**Corrected after review (2026-08-26).** The first draft of this step claimed
`is_allowed()` runs "before every outbound request". That is false: three paths
reach the network without it (`POST /fetch_tree` through treextractor's own
aiohttp session, the Playwright `page.goto()` calls, and redirect-following in
the shared client, which never re-checks the target host). The gaps themselves
stay out of scope for this round — Step 6 deliberately only turns TLS back on for
treextractor — but the document must not imply they are closed. Wording below is
the corrected version.

```markdown
# Security

## Where your queries go

VisuaLex sends no telemetry and has no analytics endpoint. These are the only
hosts the server is *meant* to contact — read the next section for how far that
is actually enforced today:

| Host | Operator |
|---|---|
| `www.normattiva.it` | Normattiva — Istituto Poligrafico e Zecca dello Stato |
| `eur-lex.europa.eu` | EUR-Lex — Ufficio delle pubblicazioni UE |
| `brocardi.it` | Brocardi.it — annotazioni dottrinali (fonte privata) |
| `www.brocardi.it` | Brocardi.it — annotazioni dottrinali (fonte privata) |

The list lives as data in `visualex_api/tools/egress.py`.

## How that claim is enforced

Two mechanisms, with different guarantees:

- **Static.** `tests/test_egress_allowlist.py` walks every `.py` file under
  `visualex_api/` plus the root `app.py` and fails if a URL literal names a host
  that is not declared. It checks what is *written in the code*. It would not
  catch a URL assembled from fragments at runtime, and nothing here claims
  otherwise.
- **Runtime.** `is_allowed()` is checked in `ThrottledHttpClient.request` before
  every request made **through the shared HTTP client**, so a host that is not on
  the list is refused there even if the URL was built dynamically. That client
  carries the scrapers' document fetches; it is not the only way this process
  opens a socket.

### Not yet covered

Three paths reach the network without passing `is_allowed()`. They are known and
open, not oversights:

- **`POST /fetch_tree`.** The caller-supplied `urn` goes to
  `tools/treextractor.get_tree`, which opens its own `aiohttp` session
  (`treextractor.py`, the `aiohttp.ClientSession` in `get_tree`) instead of using
  the shared client. An arbitrary URL in that field is fetched — including one
  pointing at a host on the deployment's internal network. Routing this call
  through `ThrottledHttpClient` is the fix and is not done yet.
- **Playwright navigation.** `page.goto()` in `tools/treextractor.py`,
  `services/eurlex_scraper.py` and `services/pdfextractor.py` drives a real
  browser and never consults the allowlist. `POST /export_pdf` has its own,
  narrower guard (`is_allowed_pdf_urn`, Normattiva URNs only); the other two do
  not.
- **Redirects.** The shared client checks the host of the URL it is given.
  `aiohttp` follows redirects by default and the client does not re-check the
  target, so an allowed host that answers with a 302 can move the request
  somewhere unlisted.

If you are evaluating this server for client work, treat the table above as the
list of sources it consults on its own initiative, and this section as the list
of ways a crafted request could still make it fetch something else.

## Transport

Certificate verification is enabled for every outbound request.

## Reporting

Open a private issue or contact the maintainer directly.
```

- [ ] **Step 5: Wire the guard into the HTTP client and enable TLS verification**

In `visualex_api/services/http_client.py`, add the import and the guard at the top of
`request()` (before the semaphore is taken), and drop `ssl=False`:

```python
from ..tools.egress import is_allowed
```

```python
    async def request(
        self,
        method: str,
        url: str,
        *,
        source: str = "generic",
        **kwargs,
    ) -> HttpResult:
        if not is_allowed(url):
            log.error("Blocked request to undeclared host", url=url[:120], source=source)
            raise NetworkError(
                f"Host non consentito: {url[:80]}",
                status_code=403,
            )
```

and at line 44:

```python
            connector = aiohttp.TCPConnector()  # certificate verification enabled
```

- [ ] **Step 6: Do the same for the tree extractor's own session**

`visualex_api/tools/treextractor.py:91-94` opens its own session with
`aiohttp.TCPConnector(ssl=False)`. Change it to `aiohttp.TCPConnector()`. (Routing this
call through `http_client` is a known follow-up, deliberately not in this round — see
the spec's "deliberately left alone" table.)

- [ ] **Step 7: Verify TLS actually works against all three live sources**

This is the step that decides whether the change is safe to ship. A source with a
genuinely broken chain must be recorded per-host, never fixed by disabling verification
globally.

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, aiohttp

URLS = [
    "https://www.normattiva.it/",
    "https://eur-lex.europa.eu/homepage.html",
    "https://brocardi.it/",
    "https://www.brocardi.it/",
]

async def main():
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector()) as s:
        for u in URLS:
            try:
                async with s.get(u, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    print(f"{u:45} OK  {r.status}")
            except Exception as e:
                print(f"{u:45} FAIL {type(e).__name__}: {e}")

asyncio.run(main())
EOF
```

Expected: four `OK`. Any `FAIL` with an SSL error must be reported to the owner with the
exact certificate problem before proceeding — do not re-disable verification.

- [ ] **Step 8: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

Expected: all green. If `test_server_contacts_only_declared_hosts` red-lights on a host
not anticipated here, add it to the correct dict with a one-line justification rather
than loosening the regex.

- [ ] **Step 9: Propose the commit**

```
feat(security): egress allowlist enforced at request time, TLS verification on

Declares the four hosts the server may contact as data, fails the build on an
undeclared URL literal, and checks the host in ThrottledHttpClient.request so a
dynamically built URL is refused too. Also removes ssl=False from the shared
client and from the tree extractor's own session: certificate verification was
disabled for every outbound request.
```

---

### Task 3: CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/security-audit.yml`
- Modify: `requirements.txt` (add `lxml>=5.0`, needed from Task 9 on)

**Interfaces:**
- Consumes: `pytest.ini` from Task 1, `requirements-dev.txt` (existing).
- Produces: the build that Tasks 1 and 2 assume exists.

- [ ] **Step 1: Add the runtime dependency**

`lxml` is verified to ship a `cp314` wheel (`lxml-6.1.2-cp314-cp314-macosx_10_15_universal2.whl`),
so `deploy.sh` step 2 installs it without a compiler. Append to `requirements.txt`:

```
lxml>=5.0
```

No `httpx`: the AKN fetch in Task 10 goes through the existing aiohttp client.

- [ ] **Step 2: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  # main is included so its state is never unverified between deploys: deploy.sh
  # runs no tests and has no rollback, so a red main is a production risk.
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  python:
    name: Python tests
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.12', '3.14']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      # requirements-dev.txt pulls requirements.txt, so the runtime deps the
      # tests import are installed too.
      - run: pip install -r requirements-dev.txt
      - run: pytest tests/ -q

  frontend:
    name: Frontend build, test, lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run test -- --run
        working-directory: frontend
      # `tsc -b` is the real type-check: a bare `tsc --noEmit` does not walk the
      # project references and reports a false green.
      - run: npm run build
        working-directory: frontend
      - run: npm run lint
        working-directory: frontend

  backend:
    name: Backend tests
    runs-on: ubuntu-latest
    # backend/tests/setup.ts runs `prisma migrate reset --force` in beforeAll and
    # TRUNCATEs every table in beforeEach, both against a live database, so this
    # job needs a real Postgres or it cannot pass at all.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: visualex
          POSTGRES_PASSWORD: visualex
          # The name must contain "test": assertTestDatabase() in setup.ts
          # refuses to run the destructive reset against anything else.
          POSTGRES_DB: visualex_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U visualex -d visualex_test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      # `npm run test` is `dotenv -e .env.test -- vitest run`, and dotenv-cli
      # calls dotenv.config({ override: false }) unless -o is passed, so a
      # variable already in the environment wins over the file. That is what
      # lets this URL replace the developer-local one in backend/.env.test
      # without touching that file. JWT_SECRET and REDIS_ENABLED still come
      # from .env.test.
      DATABASE_URL: postgresql://visualex:visualex@localhost:5432/visualex_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npx prisma generate
        working-directory: backend
      - run: npm run test
        working-directory: backend
```

**Added after review (2026-08-26).** The first draft of this step had no
`services:` block, so the backend job could not pass on any commit, and the
verification in Step 4 ("the YAML parses") never surfaced that. Two corrections
to the step:

- The Postgres service and job-level `DATABASE_URL` above are mandatory. The
  override behaviour is a property of dotenv-cli, so verify it rather than
  assume: `DATABASE_URL=… node node_modules/dotenv-cli/cli.js -e .env.test -p
  DATABASE_URL` must print the injected URL, not the one in the file.
- **`npm run lint` must exit 0 before this workflow lands.** It did not: 22
  pre-existing errors in `ImportEnvironmentModal.tsx`, `AdminPage.tsx`,
  `types/index.ts`, `normattivaParser.ts` and `sanitize.tsx`. Shipping the gate
  is what surfaces them, and the owner's standing rule is to fix errors a gate
  surfaces rather than defer them. Run every frontend gate in this task even
  though the task touches no frontend source — the task's deliverable *is* the
  command that runs them.

- [ ] **Step 3: Write the security audit workflow**

`.github/workflows/security-audit.yml`:

```yaml
name: Security Audit

# Python deps are declared with lower bounds, so a resolution that is clean
# today can become vulnerable tomorrow with no change to this repository.
# Auditing only on pull requests would never catch that; hence the schedule.

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'  # Monday 06:00 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  pip-audit:
    name: pip-audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      # Audits requirements.txt, which is what deploy.sh installs. There is no
      # packaging file, so `pip install .` is not an option here.
      - uses: pypa/gh-action-pip-audit@1220774d901786e6f652ae159f7b6bc8fea6d266  # v1.1.0
        with:
          inputs: requirements.txt

  npm-audit:
    name: npm audit
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: [frontend, backend]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm audit --audit-level=high
        working-directory: ${{ matrix.workspace }}
```

- [ ] **Step 4: Check the workflows parse**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -c "
import yaml, pathlib
for p in sorted(pathlib.Path('.github/workflows').glob('*.yml')):
    d = yaml.safe_load(p.read_text())
    print(p.name, '->', list(d['jobs']))
"
```

Expected: `ci.yml -> ['python', 'frontend', 'backend']` and
`security-audit.yml -> ['pip-audit', 'npm-audit']`.

- [ ] **Step 5: Verify the audits pass locally before CI ever runs them**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pip install --quiet pip-audit
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pip_audit -r requirements.txt || true
cd frontend && npm audit --audit-level=high || true
```

Record any finding in the task summary. A pre-existing high-severity advisory is the
owner's call to fix or accept — do not silently lower `--audit-level`.

- [ ] **Step 6: Propose the commit**

```
ci: test, build and audit workflows

Runs the Python suite on 3.12 and 3.14, the frontend build/test/lint and the
backend tests on every PR and push to main, plus a weekly pip-audit and
npm audit. deploy.sh runs no tests and has no rollback, so main is gated here
or nowhere. Adds lxml to requirements.txt for the AKN parser.
```

---

## Phase B — Act-name resolver

### Task 4: Merge the act tables

**Files:**
- Modify: `visualex_api/tools/map.py` (add `ATTI_NOTI`, `_ATTI_DENOMINATI_SPEC`, `ATTI_DENOMINATI`, `_URN_CODICI_LOWER`, `codice_urn`; extend `NORMATTIVA_SEARCH`; rewrite `extract_codice_details` to use `codice_urn`)
- Create: `tests/test_act_tables.py`
- Modify: `visualex_api/tools/urngenerator.py:111`, `app.py:416`, `app.py:780` (case-insensitive codici membership)

**Interfaces:**
- Produces, consumed by Task 5:
  - `codice_urn(codice_name: str) -> str | None`
  - `extract_codice_details(codice_name: str) -> dict | None` — `{"tipo_atto_reale", "data", "numero_atto"}`
  - `ATTI_NOTI: dict[str, dict]` — alias → `{"tipo_atto", "data", "numero_atto"}`
  - `ATTI_DENOMINATI: dict[str, dict]` — same shape
  - `_URN_CODICI_LOWER: dict[str, str]`

- [ ] **Step 1: Write the failing test**

`tests/test_act_tables.py`:

```python
"""The merged act tables, and the two lookups that were case-broken."""
import pytest

from visualex_api.tools.map import (
    ATTI_DENOMINATI,
    ATTI_NOTI,
    NORMATTIVA,
    NORMATTIVA_SEARCH,
    NORMATTIVA_URN_CODICI,
    BROCARDI_CODICI,
    codice_urn,
    extract_codice_details,
)


class TestNothingWasLost:
    """The merge is additive. These keys existed before and must survive."""

    @pytest.mark.parametrize("key", [
        "regolamento di attuazione del Codice della proprietà industriale",
        "regolamento per l'esecuzione del codice di procedura penale",
    ])
    def test_visualex_only_urn_codici_survive(self, key):
        assert key in NORMATTIVA_URN_CODICI

    def test_visualex_only_brocardi_key_survives(self):
        assert any("28 luglio 1989, n. 271" in k for k in BROCARDI_CODICI)

    def test_the_dotted_urn_table_is_untouched(self):
        # text_op.normalize_act_type(search=False) reads this one; the source
        # repo has no counterpart, so a wholesale replacement would ImportError.
        assert len(NORMATTIVA) == 111

    @pytest.mark.parametrize("key", [
        "codice del Terzo settore",
        "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
        "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    ])
    def test_capitalised_spellings_are_kept_alongside_lowercase(self, key):
        assert key in NORMATTIVA_SEARCH
        assert key.lower() in NORMATTIVA_SEARCH


class TestNewTables:
    def test_atti_noti_size(self):
        assert len(ATTI_NOTI) >= 63

    def test_atti_denominati_size(self):
        assert len(ATTI_DENOMINATI) >= 200

    @pytest.mark.parametrize("alias,numero", [
        ("statuto dei lavoratori", "300"),
        ("legge fallimentare", "267"),
        ("tusl", "81"),
        ("legge fornero", "92"),
    ])
    def test_known_aliases_resolve_to_the_right_act(self, alias, numero):
        assert ATTI_DENOMINATI[alias]["numero_atto"] == numero

    def test_every_row_has_the_three_fields(self):
        for alias, row in {**ATTI_NOTI, **ATTI_DENOMINATI}.items():
            assert set(row) == {"tipo_atto", "data", "numero_atto"}, alias


class TestCaseInsensitiveCodici:
    """The capital-T bug: 6 URN keys carry capitals, every lookup arrives lowered."""

    @pytest.mark.parametrize("name", ["codice del Terzo settore", "codice del terzo settore"])
    def test_codice_urn_is_case_insensitive(self, name):
        assert codice_urn(name) == "decreto.legislativo:2017-07-03;117"

    @pytest.mark.parametrize("name", ["codice del Terzo settore", "codice del terzo settore"])
    def test_extract_codice_details_resolves_either_casing(self, name):
        details = extract_codice_details(name)
        assert details is not None
        assert details["numero_atto"] == "117"
        assert details["data"] == "2017-07-03"

    def test_allegato_bearing_codici_still_resolve(self):
        assert codice_urn("codice civile") == "regio.decreto:1942-03-16;262:2"
        assert extract_codice_details("codice civile")["numero_atto"] == "262"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_act_tables.py -q
```

Expected: `ImportError: cannot import name 'ATTI_DENOMINATI'`.

- [ ] **Step 3: Confirm the merge really is conflict-free before merging**

Do not take this on trust — run it and read the output:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import importlib.util, sys, pathlib

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

A = load("/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it/plugin/server/src/lib/visualex/map.py", "map_a")
B = load("visualex_api/tools/map.py", "map_b")

for t in ["NORMATTIVA_URN_CODICI", "NORMATTIVA_SEARCH", "BROCARDI_CODICI", "BROCARDI_SEARCH", "EURLEX"]:
    a, b = getattr(A, t, {}), getattr(B, t, {})
    conflicts = {k: (a[k], b[k]) for k in set(a) & set(b) if a[k] != b[k]}
    print(f"{t:24} A={len(a):4} B={len(b):4} shared={len(set(a)&set(b)):4} "
          f"A-only={len(set(a)-set(b)):3} B-only={len(set(b)-set(a)):3} conflicts={len(conflicts)}")
    for k, v in conflicts.items():
        print("   CONFLICT", repr(k), v)
EOF
```

Expected: `conflicts=0` on every line. **If any line reports a conflict, stop and report
it to the owner** — the additive merge assumption in the spec (D4) no longer holds.

- [ ] **Step 4: Copy the tables**

From `$M/plugin/server/src/lib/visualex/map.py`, copy verbatim into
`visualex_api/tools/map.py`:

- `_URN_CODICI_LOWER` (line 50) — place immediately after `NORMATTIVA_URN_CODICI`.
- `ATTI_NOTI` (lines 57-125, 63 entries).
- `_ATTI_DENOMINATI_SPEC` (lines 142-340, 80 rows) **and** the build loop (lines 341-348):

```python
ATTI_DENOMINATI: dict[str, dict] = {}
for _tipo, _data, _numero, _aliases in _ATTI_DENOMINATI_SPEC:
    for _alias in _aliases:
        ATTI_DENOMINATI[_alias] = {
            "tipo_atto": _tipo,
            "data": _data,
            "numero_atto": _numero,
        }
del _tipo, _data, _numero, _aliases, _alias
```

The trailing `del` is a deliberate deviation: the source leaks these loop variables at
module scope, where they show up in `dir()` and in any star-import.

For `NORMATTIVA_SEARCH`, add the 22 keys the source has and this repo lacks — **keeping
the three capitalised spellings already present**. Compute the additions rather than
retyping them:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import importlib.util, sys
def load(p, n):
    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s)
    sys.modules[n] = m; s.loader.exec_module(m); return m
A = load("/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it/plugin/server/src/lib/visualex/map.py", "a")
B = load("visualex_api/tools/map.py", "b")
for k in sorted(set(A.NORMATTIVA_SEARCH) - set(B.NORMATTIVA_SEARCH)):
    print(f'    {k!r}: {A.NORMATTIVA_SEARCH[k]!r},')
EOF
```

Paste the printed lines into `NORMATTIVA_SEARCH`.

- [ ] **Step 5: Add `codice_urn` and route `extract_codice_details` through it**

Replace the body of the existing `extract_codice_details` lookup (`map.py:12`,
`NORMATTIVA_URN_CODICI.get(codice_name.lower().strip())`) with a call to the new helper:

```python
def codice_urn(codice_name: str) -> str | None:
    """URN fragment for a codice, matched case-insensitively.

    Six keys in NORMATTIVA_URN_CODICI carry capitals ("codice del Terzo
    settore"), while every lookup arrives lowercased — without this index those
    codici silently fall through to a generic, wrong URN.
    """
    return _URN_CODICI_LOWER.get(codice_name.lower().strip())
```

and inside `extract_codice_details`:

```python
    urn = codice_urn(codice_name)
```

- [ ] **Step 6: Fix the three other case-sensitive membership tests**

Each of these does `if <name> in NORMATTIVA_URN_CODICI`, which misses the same six keys:

- `visualex_api/tools/urngenerator.py:111` — `if normalized_act_type in codici_urn:`
- `app.py:416` — the default-annex lookup
- `app.py:780` — the Brocardi skip

Rewrite each to resolve through `codice_urn` instead. For `urngenerator.py:111`:

```python
    codice_fragment = codice_urn(normalized_act_type)
    if codice_fragment:
        urn = codice_fragment
```

keeping the existing allegato-strip block that follows unchanged. Import `codice_urn`
alongside the existing `NORMATTIVA_URN_CODICI` import in each file.

- [ ] **Step 7: Run the new tests, then the full suite**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_act_tables.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 8: Check what the widened table did to citation detection**

`citation_linker.py:22-30` rebuilds three regexes from every `NORMATTIVA_SEARCH` key at
import, so 22 new keys widen the alternation by ~20%.

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_citation_linker.py tests/test_nl_parser.py tests/test_alias_resolver.py -q
```

Expected: green. A failure here is a real behaviour change — report which citation
changed and why before adjusting anything.

- [ ] **Step 9: Propose the commit**

```
feat(map): merge the act tables from mcp-legal-it

Adds ATTI_NOTI (63) and ATTI_DENOMINATI (200 aliases over 80 acts) plus 22
NORMATTIVA_SEARCH keys, all additive — the shared keys were verified to have
identical values in both repos, and the VisuaLex-only keys are preserved.
Also fixes the case-sensitive codici lookup: six URN keys carry capitals, so
"codice del Terzo settore" resolved to nothing in extract_codice_details,
generate_urn and both annex lookups.
```

---

### Task 5: The resolver

**Files:**
- Create: `visualex_api/tools/act_resolver.py`
- Create: `tests/test_act_resolver.py`

**Interfaces:**
- Consumes from Task 4: `ATTI_NOTI`, `ATTI_DENOMINATI`, `NORMATTIVA_SEARCH`, `NORMATTIVA_URN_CODICI`, `extract_codice_details`.
- Produces, consumed by Task 6:
  - `resolve_atto(name: str) -> dict | None` — `{"tipo_atto", "data", "numero_atto"}` or `None`
  - `strip_leading_particles(name: str) -> str`
  - `known_act_names() -> list[str]`
  - `suggest_acts(name: str, limit: int = 3) -> list[str]`

- [ ] **Step 1: Write the failing test**

`tests/test_act_resolver.py`:

```python
"""The resolver must resolve to the RIGHT act, not merely resolve."""
import pytest

from visualex_api.tools.act_resolver import (
    known_act_names,
    resolve_atto,
    strip_leading_particles,
    suggest_acts,
)


def assert_act(name, tipo, numero):
    got = resolve_atto(name)
    assert got is not None, f"{name!r} did not resolve"
    assert got["numero_atto"] == numero, f"{name!r} -> n. {got['numero_atto']}, expected {numero}"
    assert tipo in got["tipo_atto"].lower()


class TestDenominati:
    @pytest.mark.parametrize("name,tipo,numero", [
        ("statuto dei lavoratori", "legge", "300"),
        ("legge fallimentare", "regio decreto", "267"),
        ("legge fornero", "legge", "92"),
        ("tusl", "decreto legislativo", "81"),
        ("testo unico sulla sicurezza sul lavoro", "decreto legislativo", "81"),
        ("legge biagi", "decreto legislativo", "276"),
    ])
    def test_resolves(self, name, tipo, numero):
        assert_act(name, tipo, numero)


class TestLeadingParticles:
    @pytest.mark.parametrize("name", [
        "lo statuto dei lavoratori",
        "dello statuto dei lavoratori",
        "del lo statuto dei lavoratori",
    ])
    def test_articles_and_prepositions_are_stripped(self, name):
        assert_act(name, "legge", "300")

    def test_legge_is_not_eaten_by_the_le_article(self):
        # The trailing \s+ in the leading-words pattern is what protects this.
        assert strip_leading_particles("legge fallimentare") == "legge fallimentare"


class TestCodici:
    @pytest.mark.parametrize("name", ["codice civile", "il codice civile", "c.c."])
    def test_codice_keeps_its_name_as_tipo_atto(self, name):
        got = resolve_atto(name)
        assert got is not None
        # Load-bearing: generate_urn keys the default allegato off the codice
        # NAME. Rewriting it to the underlying regio decreto loses the ":2".
        assert "codice civile" in got["tipo_atto"].lower()

    def test_capitalised_codice_resolves(self):
        assert resolve_atto("codice del Terzo settore")["numero_atto"] == "117"


class TestDottedAcronyms:
    @pytest.mark.parametrize("name", ["c.p.p.", "cpp"])
    def test_dots_are_optional(self, name):
        assert resolve_atto(name) is not None

    def test_dot_removal_does_not_touch_names_with_numbers(self):
        # "d.lgs. 196/2003" has digits, so it must not be de-dotted into a
        # lookup key — it belongs to the citation-pattern path.
        got = resolve_atto("d.lgs. 196/2003")
        assert got is None or got.get("numero_atto") == "196"


class TestNeverGuesses:
    def test_unknown_returns_none(self):
        assert resolve_atto("legge sulle unicorno") is None

    def test_empty_returns_none(self):
        assert resolve_atto("") is None

    def test_typo_gets_a_suggestion(self):
        assert "legge fallimentare" in suggest_acts("legge fallimentre")

    def test_suggestions_are_bounded(self):
        assert len(suggest_acts("codice", limit=3)) <= 3


class TestKnownNames:
    def test_covers_every_table(self):
        names = set(known_act_names())
        assert "statuto dei lavoratori" in names
        assert "codice civile" in names
        assert len(names) >= 380
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_act_resolver.py -q
```

Expected: `ModuleNotFoundError: visualex_api.tools.act_resolver`.

- [ ] **Step 3: Write the resolver**

`visualex_api/tools/act_resolver.py`. The private `_normalize_search_type` is a
deliberate rename: `text_op.normalize_act_type` already exists in this repo with an
incompatible three-argument signature, and the two must not be confused.

```python
"""Resolve an act the way a lawyer writes it into scraper parameters.

"statuto dei lavoratori", "del D.Lgs. 231/2001", "TUSL", "c.p.p." all name real
acts; the tables in map.py hold what they mean. This module is the lookup side:
it normalises the query, tries the tables in order of trustworthiness, and
returns None rather than guessing — an unrecognised name must be reported to the
user, not silently answered with the wrong law.
"""
from __future__ import annotations

import difflib
import re

from .map import (
    ATTI_DENOMINATI,
    ATTI_NOTI,
    NORMATTIVA_SEARCH,
    NORMATTIVA_URN_CODICI,
    extract_codice_details,
)

# Leading articles and prepositions: "art. 111 *della* Costituzione".
# The trailing \s+ is load-bearing: without it "le" would be stripped from "legge".
_LEADING_WORDS = re.compile(
    r"^(?:(?:del|della|dello|dei|degli|delle|di|il|lo|la|i|gli|le|un|una|uno)\s+|[dl]')",
    re.IGNORECASE,
)

# A dotted acronym: letters and dots only, at least one dot ("t.u.e.l.", "c.c.").
# Restricted to letter-only keys so "d.lgs. 196/2003" keeps its shape and goes
# down the citation-pattern path instead of being mangled into a lookup key.
_DOTTED_ACRONYM = re.compile(r"^[a-zà-ù]+(?:\.[a-zà-ù]*)+$", re.IGNORECASE)


def _normalize_search_type(input_type: str) -> str:
    """Act-type abbreviation -> canonical full name, via NORMATTIVA_SEARCH.

    Named apart from text_op.normalize_act_type, which has an incompatible
    three-argument signature and selects between three different tables.
    """
    if input_type in {"TUE", "TFUE", "CDFUE"}:
        return input_type
    key = input_type.lower().strip()
    return NORMATTIVA_SEARCH.get(key, key)


def _normalize_key(name: str) -> str:
    """Lowercase and tidy an act name for table lookup.

    Trailing dots are preserved: several table keys are dotted abbreviations
    ("c.c.", "d.lgs."), so stripping them would break resolution rather than help.
    """
    key = name.strip().lower()
    key = key.replace("’", "'").replace("ʼ", "'")
    key = re.sub(r"\s+", " ", key)
    return key.strip(" ,;:")


def _strip_leading_words(key: str) -> str:
    """Drop leading articles/prepositions, repeatedly ("del lo statuto" -> "statuto")."""
    while True:
        stripped = _LEADING_WORDS.sub("", key, count=1).strip()
        if stripped == key or not stripped:
            return key
        key = stripped


def _candidate_keys(name: str):
    """Yield lookup keys for an act name, most literal first.

    Literal-first ordering means pre-existing exact matches always win; the
    normalised variants only ever add resolutions, never change one.
    """
    seen = set()
    normalized = _normalize_key(name)
    candidates = [name.strip(), normalized, _strip_leading_words(normalized)]
    if _DOTTED_ACRONYM.match(normalized):
        candidates.append(normalized.replace(".", ""))
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _lookup_key(key: str) -> dict | None:
    """Resolve one exact key against the tables, in order of trustworthiness.

    ATTI_NOTI and the codici URN table are hand-verified and take precedence
    over ATTI_DENOMINATI, whose base was generated from Brocardi labels.
    """
    if key in ATTI_NOTI:
        return dict(ATTI_NOTI[key])

    details = extract_codice_details(key)
    if details:
        # The codice NAME stays in tipo_atto: generate_urn keys the default
        # allegato off it (codice civile ":2", codice penale ":1", ...).
        return {"tipo_atto": key, "data": details["data"],
                "numero_atto": details["numero_atto"]}

    if key in ATTI_DENOMINATI:
        return dict(ATTI_DENOMINATI[key])

    normalized = _normalize_search_type(key)
    if normalized != key:
        if normalized in ATTI_NOTI:
            return dict(ATTI_NOTI[normalized])
        details = extract_codice_details(normalized)
        if details:
            return {"tipo_atto": normalized, "data": details["data"],
                    "numero_atto": details["numero_atto"]}
        if normalized.lower() in ATTI_DENOMINATI:
            return dict(ATTI_DENOMINATI[normalized.lower()])

    return None


def resolve_atto(name: str) -> dict | None:
    """Resolve a common act name to scraper parameters.

    Returns {"tipo_atto", "data", "numero_atto"} or None. Never guesses.
    """
    if not name:
        return None
    for key in _candidate_keys(name):
        result = _lookup_key(key)
        if result:
            return result
    return None


def strip_leading_particles(name: str) -> str:
    """Normalise an act name and drop leading articles/prepositions."""
    return _strip_leading_words(_normalize_key(name))


def known_act_names() -> list[str]:
    """Every act name the resolver recognises — used to suggest near misses."""
    return sorted(
        set(ATTI_NOTI)
        | set(ATTI_DENOMINATI)
        | set(NORMATTIVA_SEARCH)
        | set(NORMATTIVA_URN_CODICI)
    )


def suggest_acts(name: str, limit: int = 3) -> list[str]:
    """Near misses for an unresolved act name, best first."""
    if not name:
        return []
    return difflib.get_close_matches(
        strip_leading_particles(name), known_act_names(), n=limit, cutoff=0.7
    )
```

- [ ] **Step 4: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_act_resolver.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 5: Cross-check the tables against live Normattiva (opt-in)**

Add a `live`-marked drift detector at the end of `tests/test_act_resolver.py`. It is
excluded by `addopts = -m "not live"` and run deliberately.

```python
@pytest.mark.live
@pytest.mark.asyncio
async def test_every_denominato_resolves_on_normattiva():
    """Drift detector, not a correctness certificate.

    A wrong number on an act of the same date would still pass. It catches the
    table going stale, which is the realistic failure.
    """
    import asyncio

    import aiohttp

    from visualex_api.tools.map import _ATTI_DENOMINATI_SPEC

    base = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    sem = asyncio.Semaphore(4)
    failures = []

    async def check(session, tipo, data, numero):
        urn = f"{base}{tipo.replace(' ', '.')}:{data};{numero}"
        async with sem:
            try:
                async with session.get(urn, timeout=aiohttp.ClientTimeout(total=45)) as r:
                    body = await r.text()
            except Exception as exc:  # noqa: BLE001
                failures.append((tipo, data, numero, type(exc).__name__))
                return
        if f"n. {numero}" not in body:
            failures.append((tipo, data, numero, "numero non trovato nel titolo"))

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[
            check(session, tipo, data, numero)
            for tipo, data, numero, _ in _ATTI_DENOMINATI_SPEC
        ])

    assert not failures, f"{len(failures)} acts drifted: {failures[:10]}"
```

Run it once now and record the result — this is where the source repo's own
`disp. att. c.p.c.` date inconsistency (URN map says 1941-08-25, the spec rows say
1941-12-18) will surface:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_act_resolver.py -m live -q
```

Any act reported here is corrected in `_ATTI_DENOMINATI_SPEC` before the task closes,
and the correction is noted in the commit body.

- [ ] **Step 6: Propose the commit**

```
feat(resolver): resolve acts by the names lawyers actually use

resolve_atto() takes "statuto dei lavoratori", "del D.Lgs. 231/2001", "TUSL",
"c.p.p." and returns act parameters, trying literal, normalised, particle-
stripped and de-dotted forms in that order. It returns None rather than
guessing, and suggest_acts() offers near misses. Codici keep their name as
tipo_atto so the default allegato survives.
```

---

### Task 6: Wire the resolver into the two existing entry points

**Files:**
- Modify: `visualex_api/tools/alias_resolver.py` (chain `resolve_atto` after the exact YAML hit)
- Modify: `visualex_api/tools/nl_parser.py` (chain `resolve_atto` in `_identify_act_type`, and let it fill act_number/date)
- Modify: `tests/test_alias_resolver.py`, `tests/test_nl_parser.py` (add cases; existing assertions must not change)

**Interfaces:**
- Consumes from Task 5: `resolve_atto`, `suggest_acts`.
- Produces: `resolve_alias(text)` and `parse_nl_query(raw)` now resolve 387 act names instead of 78, with the same return shapes. Field mapping across the boundary is explicit: the resolver speaks `{tipo_atto, data, numero_atto}`, this layer speaks `{act_type, date, act_number}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_alias_resolver.py`:

```python
class TestResolverFallback:
    """Names the YAML never had, resolved through the act tables."""

    @pytest.mark.parametrize("text,act_number", [
        ("statuto dei lavoratori", "300"),
        ("legge fornero", "92"),
        ("tusl", "81"),
    ])
    def test_falls_through_to_resolve_atto(self, text, act_number):
        got = resolve_alias(text)
        assert got is not None, f"{text!r} did not resolve"
        assert got["act_number"] == act_number

    def test_yaml_still_wins_over_the_tables(self):
        # "jobs act" means d.lgs. 81/2015 in this product and is pinned by an
        # existing test; the source repo files it under 23/2015. The YAML is
        # consulted first precisely so existing behaviour cannot drift.
        assert resolve_alias("jobs act")["act_number"] == "81"

    def test_the_other_jobs_act_decree_has_its_own_alias(self):
        assert resolve_alias("jobs act tutele crescenti")["act_number"] == "23"

    def test_article_prefix_still_merges(self):
        got = resolve_alias("art. 18 statuto dei lavoratori")
        assert got["article"] == "18"
        assert got["act_number"] == "300"

    def test_unknown_still_returns_none(self):
        assert resolve_alias("legge sugli unicorni") is None
```

Append to `tests/test_nl_parser.py`:

```python
class TestResolverInNlParser:
    def test_denominato_fills_type_number_and_date_together(self):
        got = parse_nl_query("art. 18 statuto dei lavoratori")
        assert got is not None
        assert got.article == "18"
        assert got.act_number == "300"
        assert got.date and got.date.startswith("1970")

    def test_existing_abbreviations_are_unchanged(self):
        got = parse_nl_query("art. 2043 cc")
        assert got.act_type == "codice civile"
        assert got.article == "2043"
```

- [ ] **Step 2: Run them and watch them fail**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_alias_resolver.py tests/test_nl_parser.py -q
```

Expected: the new cases fail (`resolve_alias("statuto dei lavoratori")` is `None`); every
pre-existing case still passes.

- [ ] **Step 3: Add the two missing `jobs act` aliases to the YAML**

In `visualex_api/tools/preset_aliases.yaml`, leave the existing `jobs act` entry exactly
as it is and add, next to it:

```yaml
# Both decrees belong to the Jobs Act package; neither owns the name on its own.
# "jobs act" keeps its existing meaning (81/2015) — changing it would move
# existing users' results. The other decree gets an explicit alias.
jobs act tutele crescenti:
  act_type: "decreto legislativo"
  act_number: "23"
  date: "2015"

jobs act contratti:
  act_type: "decreto legislativo"
  act_number: "81"
  date: "2015"
```

- [ ] **Step 4: Chain the resolver into `resolve_alias`**

`visualex_api/tools/alias_resolver.py` — add the import and extend the exact-match tail
(currently `alias_resolver.py:66-72`, which returns `None` when the YAML has no key):

```python
from .act_resolver import resolve_atto
```

```python
    preset = _PRESET_ALIASES.get(remainder)
    if preset is not None:
        result = dict(preset)
        if article:
            result["article"] = article
        return result

    # The YAML is the override layer and is consulted first, so nothing that
    # resolves today can change meaning. Everything else goes to the act tables.
    resolved = resolve_atto(remainder)
    if resolved is not None:
        result = {"act_type": resolved["tipo_atto"]}
        if resolved.get("numero_atto"):
            result["act_number"] = resolved["numero_atto"]
        if resolved.get("data"):
            result["date"] = resolved["data"]
        if article:
            result["article"] = article
        return result

    return None
```

- [ ] **Step 5: Chain the resolver into the NL parser**

`visualex_api/tools/nl_parser.py:247-272` — `_identify_act_type` currently returns only a
type string. Give the caller the whole resolution instead, so a denominato fills the act
number and date in one go.

Add near the top:

```python
from .act_resolver import resolve_atto
```

Add a new helper directly above `_identify_act_type`:

```python
def _identify_known_act(text: str) -> Optional[dict]:
    """Resolve a full act name to type + number + date, or None.

    Runs before the substring scan so a denominato ("statuto dei lavoratori")
    yields its number and date rather than just a type.
    """
    return resolve_atto(text)
```

Then in `parse_nl_query`, immediately before the existing `_identify_act_type` call, try
the resolver on the remaining text and populate all three fields when it hits:

```python
    known = _identify_known_act(remaining)
    if known:
        result.act_type = known["tipo_atto"]
        if known.get("numero_atto") and not result.act_number:
            result.act_number = known["numero_atto"]
        if known.get("data") and not result.date:
            result.date = known["data"]
    else:
        result.act_type = _identify_act_type(remaining)
```

Do not delete `_identify_act_type`: the abbreviation and substring paths it implements
are what `test_nl_parser.py`'s 30+ existing cases exercise.

- [ ] **Step 6: Run everything that touches act-type resolution**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

Expected: green, with the new cases passing and no pre-existing case changed. If an
existing NL-parser case now resolves differently, the resolver is running too early —
move the call after the substring scan rather than editing the expectation.

- [ ] **Step 7: Propose the commit**

```
feat(resolver): wire resolve_atto into the alias and NL paths

resolve_alias falls through to the act tables when the preset YAML has no exact
key, and the NL parser resolves a full act name into type, number and date
together instead of type alone. Both chains run after the existing exact-match
paths, so no name that resolves today changes meaning. Adds explicit aliases for
the two Jobs Act decrees.
```

---

### Task 7: Fix the act-type normaliser that drops spaces

**Files:**
- Modify: `visualex_api/tools/text_op.py:203-227`
- Create: `tests/test_normalize_act_type.py`

**Interfaces:**
- Consumes: `NORMATTIVA`, `NORMATTIVA_SEARCH`, `BROCARDI_SEARCH` from `map.py`.
- Produces: `normalize_act_type(input_type, search=False, source='normattiva')` — unchanged signature, more keys reachable.

- [ ] **Step 1: Write the failing test**

`tests/test_normalize_act_type.py`:

```python
"""normalize_act_type strips spaces from the lookup key while the tables' keys
contain spaces, so every multi-word abbreviation is dead today."""
import pytest

from visualex_api.tools.map import NORMATTIVA, NORMATTIVA_SEARCH
from visualex_api.tools.text_op import normalize_act_type


class TestMultiWordKeysAreReachable:
    @pytest.mark.parametrize("abbrev", ["cod. civ.", "cod. pen.", "disp. att. c.c."])
    def test_spaced_abbreviations_resolve(self, abbrev):
        if abbrev not in NORMATTIVA:
            pytest.skip(f"{abbrev!r} is not in the table")
        assert normalize_act_type(abbrev) == NORMATTIVA[abbrev]

    def test_no_key_is_unreachable(self):
        unreachable = [k for k in NORMATTIVA if normalize_act_type(k) != NORMATTIVA[k]]
        assert not unreachable, f"{len(unreachable)} keys unreachable: {unreachable[:5]}"

    def test_search_table_keys_are_reachable_too(self):
        unreachable = [
            k for k in NORMATTIVA_SEARCH
            if normalize_act_type(k, search=True) != NORMATTIVA_SEARCH[k]
        ]
        assert not unreachable, f"{len(unreachable)} unreachable: {unreachable[:5]}"


class TestSpacelessAbbreviationsStillWork:
    @pytest.mark.parametrize("abbrev,expected", [("cc", "codice civile"), ("rd", "regio decreto")])
    def test_existing_behaviour_is_preserved(self, abbrev, expected):
        assert normalize_act_type(abbrev) == expected


class TestUrnGenerationIsUnaffected:
    def test_no_double_dots_in_the_urn(self):
        """generate_urn compensates with its own .replace(' ', '.'), so a
        normaliser that now returns 'regio decreto' must not produce
        'regio..decreto' downstream."""
        from visualex_api.tools.urngenerator import generate_urn

        urn = generate_urn("regio decreto", date="1942-03-16", act_number="262")
        assert ".." not in urn
        assert "regio.decreto" in urn
```

- [ ] **Step 2: Run it to see how many keys are dead**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_normalize_act_type.py -q
```

Expected: `test_no_key_is_unreachable` fails reporting ~62 of 111 keys.

- [ ] **Step 3: Fix the lookup**

`visualex_api/tools/text_op.py:224` currently reads:

```python
    normalized_type = act_types.get(input_type.lower().strip().replace(" ", ""), input_type.lower().strip())
```

The space-stripped key can never match a spaced table key. Try the literal key first and
keep the stripped form as a fallback, so the abbreviations that work today keep working:

```python
    key = input_type.lower().strip()
    # The tables hold both spaced keys ("cod. civ.") and spaceless ones ("cc").
    # Literal first, spaceless second: adding the literal attempt only ever
    # resolves more names, it never changes one that already resolved.
    normalized_type = act_types.get(key)
    if normalized_type is None:
        normalized_type = act_types.get(key.replace(" ", ""), key)
```

- [ ] **Step 4: Run the tests, then everything**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_normalize_act_type.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

`test_no_double_dots_in_the_urn` is the one that matters here: `generate_urn` compensates
for the old miss with its own `.replace(' ', '.')`, and this change makes the normaliser
return more canonical multi-word names than before.

- [ ] **Step 5: Confirm real URNs did not move**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import sys
sys.path.insert(0, ".")
from visualex_api.tools.urngenerator import generate_urn

CASES = [
    ("legge", "1990-08-07", "241", "3", None),
    ("codice civile", None, None, "2043", "2"),
    ("codice penale", None, None, "575", "1"),
    ("decreto legislativo", "2001-06-08", "231", "6", None),
    ("regio decreto", "1942-03-16", "262", "1", None),
    ("d.p.r.", "1988-09-22", "447", "1", None),
]
for tipo, data, num, art, annex in CASES:
    print(f"{tipo:22} -> {generate_urn(tipo, date=data, act_number=num, article=art, annex=annex)}")
EOF
```

Compare against the same output taken on `main` (`git stash` or a second checkout). Any
URN that changed must be explained before the task closes — a moved URN is a moved
article for every user.

- [ ] **Step 6: Propose the commit**

```
fix(text_op): make multi-word act-type abbreviations resolvable

normalize_act_type stripped every space from the lookup key while the tables'
keys contain spaces, so 62 of 111 NORMATTIVA entries could never be hit
("cod. civ." resolved to itself). Tries the literal key first and keeps the
spaceless form as a fallback, so the abbreviations that worked keep working.
```

---

## Phase C — The correctness fix

### Task 8: Never answer with a different article

**Files:**
- Modify: `app.py` (input validation at `:344`, the `parse_article_input` error guard at `:386`, the existence check before the fan-out at `:489`)
- Create: `tests/test_article_existence.py`

**Interfaces:**
- Consumes: `get_tree(normurn, link, details, return_metadata)` (existing, already cached and already called on this path); `normalize_article_key` is **not** available until Task 9, so this task uses a local normaliser and Task 11 replaces it.
- Produces: `NormaController._article_exists_in_tree(norma, article, annex) -> bool | None` — `True`/`False`, or `None` when the tree is unavailable (fail-open).

- [ ] **Step 1: Write the failing test**

`tests/test_article_existence.py`:

```python
"""Asking for an article that does not exist must not return a different one.

Measured on live Normattiva before this change: c.c. art. 99999, art. 7000 and
art. 2-bis all returned 592 characters of "Art. 1 — È approvato il testo del
Codice civile", with no error and no warning.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController


def _controller():
    # Same trick the existing suite uses: skip __init__ so no Quart app, no
    # routes and no scrapers are built.
    return NormaController.__new__(NormaController)


TREE = (
    [{"numero": "1", "allegato": None},
     {"numero": "2", "allegato": None},
     {"numero": "2-bis", "allegato": None},
     {"numero": "3", "allegato": None}],
    4,
    {},
)


class TestExistenceCheck:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["1", "2-bis", "3"])
    async def test_existing_articles_pass(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("article", ["99999", "7000", "4"])
    async def test_missing_articles_are_reported(self, article):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=TREE)):
            assert await ctrl._article_exists_in_tree("https://x", article, None) is False

    @pytest.mark.asyncio
    async def test_bis_spelling_variants_match(self):
        """The tree API and the scraper disagree on "2-bis" vs "2 bis"."""
        ctrl = _controller()
        spaced = ([{"numero": "2 bis", "allegato": None}], 1, {})
        with patch("app.get_tree", new=AsyncMock(return_value=spaced)):
            assert await ctrl._article_exists_in_tree("https://x", "2-bis", None) is True


class TestFailOpen:
    """A Normattiva outage must not become "this article does not exist"."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tree_result", [
        ("Failed to retrieve the page: boom", 0, {}),
        ("Empty response from server", 0, {}),
        ([], 0, {}),
    ])
    async def test_unavailable_tree_returns_none(self, tree_result):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=tree_result)):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None

    @pytest.mark.asyncio
    async def test_exception_returns_none(self):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(side_effect=RuntimeError("down"))):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None


class TestRequestValidation:
    @pytest.mark.asyncio
    async def test_missing_act_type_is_rejected(self):
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data({"article": "1"})

    @pytest.mark.asyncio
    async def test_missing_article_is_rejected(self):
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data({"act_type": "legge"})

    @pytest.mark.asyncio
    async def test_malformed_article_is_rejected_not_scraped(self):
        """parse_article_input returns an ERROR DICT rather than raising; the
        root controller never checked it, so `for article in articles` iterated
        the dict's keys and produced a URN ending in ~arterror."""
        from visualex_api.tools.exceptions import ValidationError

        ctrl = _controller()
        with pytest.raises(ValidationError):
            await ctrl.create_norma_visitata_from_data(
                {"act_type": "legge", "date": "1990-08-07",
                 "act_number": "241", "article": "!!!"}
            )
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_article_existence.py -q
```

Expected: `AttributeError: '_article_exists_in_tree'`, plus the three validation tests
failing because nothing raises.

- [ ] **Step 3: Add the validation the root controller never had**

At the top of `create_norma_visitata_from_data` (`app.py:344`), before anything else —
mirroring what the `/api` twin already does at `visualex_api/app.py:309-312`:

```python
        if 'act_type' not in data or not data.get('act_type'):
            raise ValidationError("Campo obbligatorio mancante: act_type")
        if 'article' not in data or data.get('article') in (None, ''):
            raise ValidationError("Campo obbligatorio mancante: article")
```

`ValidationError` is already importable in `app.py` from `visualex_api.tools.exceptions`;
add it to the import list if it is not.

- [ ] **Step 4: Guard the error dict from `parse_article_input`**

Immediately after `app.py:386` (`articles = await parse_article_input(...)`):

```python
        # parse_article_input returns an error DICT rather than raising. Without
        # this guard the loop below iterates the dict's KEYS and builds one
        # NormaVisitata with numero_articolo='error', whose URN ends in ~arterror.
        if isinstance(articles, dict) and 'error' in articles:
            raise ValidationError(articles['error'])
```

- [ ] **Step 5: Add the existence check**

Add the method to `NormaController` (next to `get_scraper_for_norma`, `app.py:504`):

```python
    @staticmethod
    def _normalize_article_key(value: str) -> str:
        """Canonical comparison form for an article number.

        The tree API and the scraper disagree on the separator ("1-bis" vs
        "1 bis"), so both sides are canonicalised before comparing. Task 11
        replaces this with normalize_article_key from the AKN parser, which is
        the same rule with more suffixes.
        """
        key = (value or '').strip().lower()
        key = re.sub(r'^\s*artic?o?l?[oi]?\b\.?\s*', '', key)
        key = re.sub(
            r'^(\d+)\s*[-\s]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)$',
            r'\1-\2', key,
        )
        return key.strip()

    async def _article_exists_in_tree(self, act_url, article, annex):
        """Whether `article` is in the act's article tree.

        Returns True/False, or None when the tree cannot be consulted — a
        Normattiva outage must not be reported to the user as "this article does
        not exist".
        """
        try:
            tree_result = await get_tree(act_url, link=False, details=False,
                                         return_metadata=True)
            articles = tree_result[0] if isinstance(tree_result, tuple) else tree_result
        except Exception as exc:  # noqa: BLE001 - never fail the request on a tree error
            logger.warning("Tree unavailable, skipping existence check",
                           extra={"error": str(exc), "url": act_url[:100]})
            return None

        # get_tree reports failures as a STRING in the articles slot.
        if isinstance(articles, str) or not articles:
            logger.warning("Tree unusable, skipping existence check",
                           extra={"tree": str(articles)[:120], "url": act_url[:100]})
            return None

        wanted = self._normalize_article_key(article)
        for entry in articles:
            if not isinstance(entry, dict):
                continue  # section/annex labels are bare strings
            if annex is not None and str(entry.get('allegato') or '') != str(annex):
                continue
            if self._normalize_article_key(entry.get('numero', '')) == wanted:
                return True
        return False
```

Then call it in the fan-out loop at `app.py:489`, collecting the misses instead of
building a `NormaVisitata` for them:

```python
        norma_visitata_list = []
        missing_articles = []
        for article in articles:
            cleaned_article = article.strip().replace(' ', '-') if ' ' in article.strip() else article.strip()

            exists = await self._article_exists_in_tree(norma.url, cleaned_article, annex_value)
            if exists is False:
                logger.info("Requested article is not in the act",
                            extra={"article": cleaned_article, "norma": str(norma)})
                missing_articles.append(cleaned_article)
                continue

            norma_visitata_list.append(NormaVisitata(...))  # unchanged

        if missing_articles and not norma_visitata_list:
            raise ResourceNotFoundError(
                f"Articolo {', '.join(missing_articles)} non presente in {norma}"
            )
```

Import `ResourceNotFoundError` alongside `ValidationError`. When only *some* of a range
is missing, the request proceeds with the rest — a range like `"1-50"` on an act with 32
articles must still return the 32.

- [ ] **Step 6: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_article_existence.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 7: Verify against live Normattiva — the whole point of the task**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from app import NormaController

CASES = [
    ("codice civile", None, None, "2043", "esiste"),
    ("codice civile", None, None, "99999", "NON esiste"),
    ("codice civile", None, None, "2-bis", "NON esiste"),
    ("legge", "1990-08-07", "241", "3", "esiste"),
    ("legge", "1990-08-07", "241", "2-bis", "esiste"),
]

async def main():
    ctrl = NormaController.__new__(NormaController)
    for tipo, data, num, art, expected in CASES:
        payload = {"act_type": tipo, "article": art}
        if data:
            payload["date"] = data
        if num:
            payload["act_number"] = num
        try:
            out = await ctrl.create_norma_visitata_from_data(payload)
            got = f"accettato ({len(out)} articoli)"
        except Exception as exc:
            got = f"{type(exc).__name__}: {exc}"
        print(f"{tipo:16} art.{art:8} atteso={expected:12} -> {got}")

asyncio.run(main())
EOF
```

Expected: the three `esiste` rows accepted, and both `NON esiste` rows rejected with
`ResourceNotFoundError: Articolo … non presente in …` — where before the change all five
returned text, two of them the wrong article.

- [ ] **Step 8: Propose the commit**

```
fix(api): reject articles that are not in the act instead of returning Art. 1

Normattiva answers a request for a nonexistent article with the act's Art. 1,
so c.c. art. 99999, art. 7000 and art. 2-bis all returned "È approvato il testo
del Codice civile" with no error — a wrong answer presented as right. The
requested article is now checked against the already-cached article tree, with
bis/ter spellings canonicalised on both sides, and the check fails open so a
Normattiva outage is never reported as "this article does not exist".

Also adds the input validation the root controller lacked and the guard for
parse_article_input's error dict, which previously produced a ~arterror URN.
```

---

## Phase D — Akoma Ntoso as structure and fallback

> Read the spec's "The finding that reshaped the round" before starting this phase.
> AKN is **not** the display text. Normattiva's export transliterates every accent
> ("attivita'", "e'", "responsabilita'" — 0 accented forms in the XML), and any change
> to `article_text` silently deletes every highlight and note anchored after the first
> changed character. Measured divergence over 19 articles: 0/19 identical, median word
> similarity 0.939.

### Task 9: The pure AKN parser

**Files:**
- Create: `visualex_api/services/akn_parser.py`
- Create: `tests/fixtures/akn/legge_241_1990.xml`, `costituzione.xml`, `dlgs_231_2001.xml`, `codice_penale_trimmed.xml`, `landing_legge_241_1990.html`
- Create: `tests/test_akn_parser.py`

**Interfaces:**
- Produces, consumed by Tasks 10 and 11:
  - `normalize_article_key(numero_articolo: str) -> str`
  - `@dataclass ParsedPart(name: str, articles: dict[str, str], order: list[str])` with `article_count` property
  - `@dataclass ParsedAct(title: str, articles: dict[str, str], order: list[str], structure: str, parts: dict[str, ParsedPart])` with `article(numero, part=None) -> str | None`, `full_text(part=None) -> str`, `part_article_count(part=None) -> int`, `part_title(part=None) -> str`, `article_count` property
  - `parse_akn(xml: str) -> ParsedAct`

- [ ] **Step 1: Copy the fixtures, trimming the big ones**

The source repo tracks ~15.7 MB of AKN XML, 14 MB of which is the codice civile and the
codice penale. Only the small flat fixtures are copied whole; the component structure
gets a trimmed fixture instead.

```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/.claude/worktrees/wonderful-tereshkova-56ca06
mkdir -p tests/fixtures/akn
M=/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it/tests/fixtures/akn
cp "$M/legge_241_1990.xml" "$M/costituzione.xml" "$M/dlgs_231_2001.xml" \
   "$M/landing_legge_241_1990.html" tests/fixtures/akn/
du -sh tests/fixtures/akn
```

Then generate the trimmed component fixture — the first 40 `<doc>` components of the
codice penale, which is enough to exercise the component branch, the `PART-art. N` name
parsing and the dominant-part selection:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
from lxml import etree

SRC = "/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it/tests/fixtures/akn/codice_penale.xml"
OUT = "tests/fixtures/akn/codice_penale_trimmed.xml"
KEEP = 40

parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=True)
tree = etree.parse(SRC, parser)
root = tree.getroot()

docs = root.xpath("//*[local-name()='attachments']//*[local-name()='doc']")
print("components in source:", len(docs))
for doc in docs[KEEP:]:
    doc.getparent().remove(doc)

tree.write(OUT, encoding="utf-8", xml_declaration=True)
import os
print(OUT, os.path.getsize(OUT), "bytes,", KEEP, "components kept")
EOF
```

Expected: the trimmed file is a few hundred KB rather than 3.9 MB. Confirm the whole
fixture directory stays under ~1 MB — it is committed to git and cloned by CI.

- [ ] **Step 2: Write the failing test**

`tests/test_akn_parser.py`:

```python
"""Pure parser tests. No network: XML string in, ParsedAct out."""
from pathlib import Path

import pytest

from visualex_api.services.akn_parser import ParsedAct, normalize_article_key, parse_akn

FIXTURES = Path(__file__).parent / "fixtures" / "akn"


@pytest.fixture(scope="module")
def l241():
    return parse_akn((FIXTURES / "legge_241_1990.xml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def costituzione():
    return parse_akn((FIXTURES / "costituzione.xml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def cp():
    return parse_akn((FIXTURES / "codice_penale_trimmed.xml").read_text(encoding="utf-8"))


class TestNormalizeArticleKey:
    @pytest.mark.parametrize("raw,expected", [
        ("2043", "2043"),
        ("art. 2 bis", "2-bis"),
        ("art_2-bis", "2-bis"),
        ("2 BIS", "2-bis"),
        ("2bis", "2-bis"),
        ("21-octies", "21-octies"),
        ("articolo 5", "5"),
        ("", ""),
    ])
    def test_canonical_form(self, raw, expected):
        assert normalize_article_key(raw) == expected


class TestFlatStructure:
    def test_detects_flat(self, l241):
        assert l241.structure == "flat"

    def test_article_count(self, l241):
        assert l241.article_count == 51

    def test_bis_forms_are_equivalent(self, l241):
        a = l241.article("2-bis")
        assert a
        assert l241.article("2 bis") == a
        assert l241.article("art. 2 bis") == a

    def test_modification_markers_are_stripped(self, l241):
        assert "((" not in l241.full_text()

    def test_missing_article_is_none(self, l241):
        assert l241.article("99999") is None

    def test_full_text_preserves_order(self, l241):
        text = l241.full_text()
        assert text.index("Art. 1") < text.index("Art. 3")


class TestComponentStructure:
    def test_detects_component(self, cp):
        assert cp.structure == "component"

    def test_articles_are_reachable(self, cp):
        assert cp.article("1")

    def test_dominant_part_is_mirrored_into_articles(self, cp):
        assert cp.articles
        assert cp.order


class TestSourceProperties:
    """Facts about Normattiva's export that the design depends on.

    These are not aspirations — they are why AKN is a fallback source and not
    the display text. If one of these ever starts failing, the design decision
    should be revisited.
    """

    def test_the_export_transliterates_accents(self, l241):
        text = l241.full_text()
        assert "attivita'" in text
        assert "attività" not in text

    def test_articles_carry_a_markdown_heading(self, l241):
        assert l241.article("3").startswith("### ")


class TestRobustness:
    def test_empty_xml_does_not_crash(self):
        act = parse_akn("")
        assert isinstance(act, ParsedAct)
        assert act.article_count == 0

    def test_garbage_does_not_crash(self):
        assert parse_akn("<nonsense/>").article_count == 0

    def test_entities_are_not_resolved(self, tmp_path):
        """XXE guard: an external entity must not be expanded."""
        evil = (
            '<?xml version="1.0"?>'
            '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
            '<akomaNtoso><body><article eId="art_1">'
            '<num>Art. 1</num><content><p>&xxe;</p></content>'
            '</article></body></akomaNtoso>'
        )
        act = parse_akn(evil)
        assert "root:" not in act.full_text()
```

- [ ] **Step 3: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_akn_parser.py -q
```

Expected: `ModuleNotFoundError: visualex_api.services.akn_parser`.

- [ ] **Step 4: Port the parser**

Copy `$M/plugin/server/src/lib/visualex/akn_parser.py` to
`visualex_api/services/akn_parser.py` **verbatim except for three changes**:

1. Replace the module docstring's reference to the source repo's fixture path with this
   repo's `tests/fixtures/akn/`.
2. **Harden the parser** (`akn_parser.py:443` in the source):

```python
    # recover=True keeps a malformed export usable. resolve_entities=False and
    # no_network=True close the XXE / billion-laughs surface that lxml leaves
    # open by default; huge_tree is dropped because it lifts libxml2's limits on
    # entity expansion and nesting depth and the fixtures parse without it.
    parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
```

3. Add a module header noting the provenance, matching the licence decision:

```python
"""Pure parser for Akoma Ntoso 3.0 XML exported by Normattiva (caricaAKN).

Ported from mcp-legal-it (same author, relicensed MIT).

NOTE ON SCOPE: this is a STRUCTURE and FALLBACK source, never the text the
reading surface shows. Normattiva's AKN export transliterates every accent
("attivita'", "e'"), and article_text is the offset space that every stored
highlight and note is anchored to. See
docs/superpowers/specs/2026-08-26-trasfusione-mcp-legal-design.md.
"""
```

- [ ] **Step 5: Verify `huge_tree` was genuinely unnecessary**

Dropping it is a security improvement only if the real acts still parse. The codice
civile is the largest export at 10.6 MB:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import sys, time
sys.path.insert(0, ".")
from visualex_api.services.akn_parser import parse_akn

for f in ["codice_civile.xml", "codice_penale.xml", "dlgs_152_2006.xml"]:
    path = f"/Users/gpuzio/Desktop/CODE/server-infra2.0/mcp-legal-it/tests/fixtures/akn/{f}"
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        print(f, "not present locally, skipped"); continue
    t0 = time.time()
    act = parse_akn(raw)
    print(f"{f:24} {act.article_count:5} articoli in {(time.time()-t0)*1000:.0f} ms")
EOF
```

Expected: the codice civile parses to 3249 articles in roughly 250 ms. **If any file now
parses to 0 articles, `huge_tree` was load-bearing** — restore it and record why in the
module docstring, since that reopens the hardening question.

- [ ] **Step 6: Run the tests and the full suite**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_akn_parser.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 7: Propose the commit**

```
feat(akn): pure Akoma Ntoso parser for Normattiva exports

Ports the parser from mcp-legal-it: handles both export shapes (flat <article>
and the component <doc> form the codici use), canonicalises bis/ter keys, and
strips the (( )) modification markers. Hardened against XXE — entities are not
resolved, no network access, no huge_tree — and the fixtures confirm the codici
still parse without it.

Scope is deliberate: this is a structure and fallback source, not the display
text. Normattiva's export transliterates every accent, and a test pins that
fact so the decision is revisited if the source ever changes.
```

---

### Task 10: The AKN fetch — index only, on the shared HTTP stack

**Files:**
- Create: `visualex_api/services/akn_fetch.py`
- Create: `tests/test_akn_fetch.py`
- Modify: `visualex_api/tools/config.py` (add `AKN_ENABLED`, `AKN_CACHE_MAX_ACTS`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `http_client.request` (Task 2 gave it the egress guard), `get_cache_manager().get_persistent("akn")`, `parse_akn` and `ParsedAct` from Task 9.
- Produces, consumed by Task 11:
  - `async fetch_act_index(norma, data_vigenza: str | None = None) -> AktIndex | None`
  - `@dataclass AktIndex(title: str, keys: list[str], structure: str, parts: dict[str, list[str]], codice_redaz: str, data_gu: str)`
  - `async fetch_act_article(norma, article: str, data_vigenza: str | None = None) -> str | None` — the text fallback; re-fetches, does not cache text
  - `akn_disabled() -> bool`
  - `clear_akn_cache() -> None` (tests only)

- [ ] **Step 1: Write the failing test**

`tests/test_akn_fetch.py`. The transport is mocked at `http_client.request`, so no test
touches the network and the round-trip count is asserted directly.

```python
"""Network + cache layer for the AKN export. No test hits the network."""
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from visualex_api.services import akn_fetch
from visualex_api.services.http_client import HttpResult

FIXTURES = Path(__file__).parent / "fixtures" / "akn"
LANDING = (FIXTURES / "landing_legge_241_1990.html").read_text(encoding="utf-8")
XML = (FIXTURES / "legge_241_1990.xml").read_text(encoding="utf-8")


class FakeNorma:
    """The whole contract fetch_act_index needs: an article-free act URL."""

    def __init__(self, url="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"):
        self._url = url

    @property
    def url(self):
        return self._url

    def __str__(self):
        return "legge 1990-08-07, n. 241"


def _responder(calls):
    async def fake_request(method, url, *, source="generic", **kwargs):
        calls.append(url)
        body = XML if "caricaAKN" in url else LANDING
        return HttpResult(text=body, status=200, headers={})
    return fake_request


@pytest.fixture(autouse=True)
def isolate_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("PERSISTENT_CACHE_DIR", str(tmp_path))
    akn_fetch.clear_akn_cache()
    yield
    akn_fetch.clear_akn_cache()


class TestParamExtraction:
    def test_extracts_both_params_from_the_landing_page(self):
        params = akn_fetch._extract_params(LANDING)
        assert params == ("090G0294", "19900818")

    def test_returns_none_when_either_is_missing(self):
        assert akn_fetch._extract_params("<html>nothing</html>") is None


class TestHappyPath:
    @pytest.mark.asyncio
    async def test_cold_fetch_costs_two_requests(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            index = await akn_fetch.fetch_act_index(FakeNorma())
        assert index is not None
        assert len(calls) == 2
        assert "caricaAKN" in calls[1]
        assert len(index.keys) == 51
        assert "2-bis" in index.keys

    @pytest.mark.asyncio
    async def test_warm_fetch_costs_nothing(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            await akn_fetch.fetch_act_index(FakeNorma())
            await akn_fetch.fetch_act_index(FakeNorma())
        assert len(calls) == 2, "the second call should have been served from cache"


class TestTheIndexOnlyContract:
    @pytest.mark.asyncio
    async def test_no_article_text_is_retained(self):
        """The cache holds keys, not texts — that is what bounds its size."""
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            index = await akn_fetch.fetch_act_index(FakeNorma())
        blob = repr(index)
        assert "L'attivita' amministrativa" not in blob
        assert len(blob) < 20000


class TestSingleFlight:
    @pytest.mark.asyncio
    async def test_concurrent_cold_requests_download_once(self):
        import asyncio

        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            await asyncio.gather(*[akn_fetch.fetch_act_index(FakeNorma()) for _ in range(5)])
        assert len(calls) == 2, (
            f"5 concurrent cold requests issued {len(calls)} round-trips; "
            "the codice civile is 10.6 MB, so this must be 2"
        )


class TestFailsClosed:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [
        "<html>error page</html>",          # not XML
        "<?xml version='1.0'?><empty/>",    # XML with no articles
    ])
    async def test_bad_payload_returns_none(self, body):
        async def bad(method, url, *, source="generic", **kwargs):
            return HttpResult(text=(LANDING if "caricaAKN" not in url else body),
                              status=200, headers={})
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=bad)):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None

    @pytest.mark.asyncio
    async def test_transport_error_returns_none(self):
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=RuntimeError("down"))):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None

    @pytest.mark.asyncio
    async def test_failures_are_logged_not_swallowed(self, caplog):
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=RuntimeError("down"))):
            await akn_fetch.fetch_act_index(FakeNorma())
        assert caplog.records, "a load-path failure was swallowed silently"


class TestKillSwitch:
    @pytest.mark.asyncio
    async def test_akn_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("AKN_ENABLED", "false")
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None
        assert not calls

    def test_the_switch_is_read_at_call_time(self, monkeypatch):
        monkeypatch.setenv("AKN_ENABLED", "false")
        assert akn_fetch.akn_disabled() is True
        monkeypatch.setenv("AKN_ENABLED", "true")
        assert akn_fetch.akn_disabled() is False
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_akn_fetch.py -q
```

Expected: `ModuleNotFoundError: visualex_api.services.akn_fetch`.

- [ ] **Step 3: Add the config knobs**

`visualex_api/tools/config.py`, next to the other HTTP settings:

```python
# Akoma Ntoso structure source. Kill switch for the whole AKN path; read at call
# time so it can be flipped without a code change.
AKN_ENABLED = os.getenv("AKN_ENABLED", "true").strip().lower() not in {"0", "false", "no"}
# Parsed indexes held in memory. An index is a few tens of KB (the codice civile
# is 3249 short keys), so this is cheap — unlike the source repo's cache, which
# held whole parsed acts.
AKN_CACHE_MAX_ACTS = int(os.getenv("AKN_CACHE_MAX_ACTS", "40"))
```

Add both to `.env.example` with a one-line comment each.

- [ ] **Step 4: Write the fetch layer**

`visualex_api/services/akn_fetch.py`. Four deliberate departures from the source, each
required by this being a shared server: the transport is `http_client` (throttle, retry,
backoff, breaker, egress guard); parsing runs off the event loop; only the index is
cached; and there is a single-flight registry so N concurrent cold requests for the
10.6 MB codice civile download it once.

```python
"""Fetch the article index of an act from Normattiva's Akoma Ntoso export.

Two requests, and the order matters: caricaAKN needs an act-specific session
cookie, so the act landing page must be fetched first on the same client. A cold
or generic session gets a ~32 KB HTML error page instead of XML.

What is cached is the INDEX — title, article keys, order, structure — never the
article texts. That is what keeps this cheap on a shared server: the codice
civile's index is a few tens of KB where its parsed text is 1.9 MB, and its XML
is 10.6 MB. The texts are not cached because the reading surface does not use
them; see the module note in akn_parser.py.

Every failure path returns None and logs with context. The caller falls back to
the HTML path, which is the primary source.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from datetime import date

import structlog

from ..tools.cache_manager import get_cache_manager
from ..tools.config import AKN_CACHE_MAX_ACTS, AKN_ENABLED
from .akn_parser import parse_akn
from .http_client import http_client

log = structlog.get_logger()

_CARICA_AKN_BASE = "https://www.normattiva.it/do/atto/caricaAKN"

# The cold error page is ~32 KB of HTML; the smallest real export is ~250 KB.
# Measured in characters, which is slightly stricter than bytes for accented text.
_MIN_XML_CHARS = 40000

_AKN_HREF_RE = re.compile(
    r"caricaAKN\?dataGU=(?P<dataGU>\d{8})&(?:amp;)?codiceRedaz=(?P<codice>[A-Z0-9]+)",
    re.IGNORECASE,
)
_ELI_LOCAL_RE = re.compile(r'eli:id_local"\s+content="(?P<codice>[A-Z0-9]+)"', re.IGNORECASE)
_DATA_PUB_RE = re.compile(r"dataPubblicazioneGazzetta=(\d{4})-(\d{2})-(\d{2})")


@dataclass
class AktIndex:
    """What an act's AKN export says about its own structure."""

    title: str
    keys: list[str] = field(default_factory=list)
    structure: str = "flat"
    parts: dict[str, list[str]] = field(default_factory=dict)
    codice_redaz: str = ""
    data_gu: str = ""


def akn_disabled() -> bool:
    """Read at call time so the switch can be flipped without a restart."""
    import os

    override = os.getenv("AKN_ENABLED")
    if override is not None:
        return override.strip().lower() in {"0", "false", "no"}
    return not AKN_ENABLED


_memory: dict[tuple[str, str, str], AktIndex] = {}
_inflight: dict[tuple[str, str, str], asyncio.Future] = {}


def clear_akn_cache() -> None:
    """Tests only."""
    _memory.clear()
    _inflight.clear()


def _today_vigenza() -> str:
    return date.today().strftime("%Y%m%d")


def _extract_params(html: str) -> tuple[str, str] | None:
    """(codiceRedaz, dataGU) from the act landing page, or None."""
    match = _AKN_HREF_RE.search(html)
    if match:
        return match.group("codice"), match.group("dataGU")

    codice_match = _ELI_LOCAL_RE.search(html)
    data_match = _DATA_PUB_RE.search(html)
    if codice_match and data_match:
        return codice_match.group("codice"), "".join(data_match.groups())
    return None


def _to_index(act, codice: str, data_gu: str) -> AktIndex:
    return AktIndex(
        title=act.title,
        keys=list(act.order),
        structure=act.structure,
        parts={name: list(part.order) for name, part in act.parts.items()},
        codice_redaz=codice,
        data_gu=data_gu,
    )


async def _fetch_and_parse(norma, data_vigenza: str) -> AktIndex | None:
    act_url = norma.url
    if not act_url:
        log.warning("AKN skipped: no act URL", norma=str(norma))
        return None

    try:
        landing = await http_client.request("GET", act_url, source="normattiva")
    except Exception as exc:  # noqa: BLE001 - AKN is a fallback; never fail the request
        log.warning("AKN landing page failed", norma=str(norma), error=str(exc))
        return None

    params = _extract_params(landing.text)
    if params is None:
        log.warning("AKN export params not found on landing page",
                    norma=str(norma), url=act_url[:100])
        return None

    codice, data_gu = params
    export_url = (f"{_CARICA_AKN_BASE}?dataGU={data_gu}"
                  f"&codiceRedaz={codice}&dataVigenza={data_vigenza}")
    try:
        export = await http_client.request("GET", export_url, source="normattiva")
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN export request failed", norma=str(norma), error=str(exc))
        return None

    xml = export.text
    if not xml.lstrip().startswith("<?xml"):
        log.warning("AKN export was not XML (cold session?)",
                    norma=str(norma), length=len(xml))
        return None
    if len(xml) < _MIN_XML_CHARS:
        log.warning("AKN export too short to be a real act",
                    norma=str(norma), length=len(xml))
        return None

    # Parsing a 10.6 MB export takes ~250 ms of CPU. On Quart that would stall
    # every concurrent request (CLAUDE.md gotcha 2).
    act = await asyncio.to_thread(parse_akn, xml)
    if not act.article_count:
        log.warning("AKN export parsed to zero articles", norma=str(norma))
        return None

    return _to_index(act, codice, data_gu)


async def fetch_act_index(norma, data_vigenza: str | None = None) -> AktIndex | None:
    """The act's article index from the AKN export, or None on any failure.

    `norma.url` must be the ARTICLE-FREE act URL: the cache and the session both
    key off the act, and an article-level URL would defeat both.
    """
    if akn_disabled():
        return None

    data_vigenza = data_vigenza or _today_vigenza()
    act_url = getattr(norma, "url", "") or ""
    key = (act_url, data_vigenza, "index")

    cached = _memory.get(key)
    if cached is not None:
        return cached

    persistent = get_cache_manager().get_persistent("akn")
    stored = await persistent.get(f"{act_url}|{data_vigenza}")
    if stored:
        index = AktIndex(**stored)
        _memory[key] = index
        return index

    # Single flight: the codice civile is 10.6 MB. Without this, N concurrent
    # cold requests each download and parse it independently.
    inflight = _inflight.get(key)
    if inflight is not None:
        return await inflight

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _inflight[key] = future
    try:
        index = await _fetch_and_parse(norma, data_vigenza)
        if index is not None:
            _memory[key] = index
            while len(_memory) > AKN_CACHE_MAX_ACTS:
                _memory.pop(next(iter(_memory)))
            await persistent.set(f"{act_url}|{data_vigenza}", index.__dict__)
        future.set_result(index)
        return index
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN index fetch failed", norma=str(norma), error=str(exc))
        future.set_result(None)
        return None
    finally:
        _inflight.pop(key, None)


async def fetch_act_article(norma, article: str, data_vigenza: str | None = None) -> str | None:
    """One article's AKN text — the LAST-RESORT fallback when HTML extraction fails.

    Deliberately uncached and deliberately not the normal path: this text
    transliterates accents ("attivita'") and carries a markdown heading, so it
    differs from every stored highlight's offset space. The caller must mark the
    response `source="normattiva-akn"` so the surface can say where it came from.
    """
    if akn_disabled():
        return None

    index = await fetch_act_index(norma, data_vigenza)
    if index is None:
        return None

    data_vigenza = data_vigenza or _today_vigenza()
    export_url = (f"{_CARICA_AKN_BASE}?dataGU={index.data_gu}"
                  f"&codiceRedaz={index.codice_redaz}&dataVigenza={data_vigenza}")
    try:
        export = await http_client.request("GET", export_url, source="normattiva")
        act = await asyncio.to_thread(parse_akn, export.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN article fallback failed",
                    norma=str(norma), article=article, error=str(exc))
        return None

    return act.article(article)
```

- [ ] **Step 5: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_akn_fetch.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 6: Verify the two-request flow against live Normattiva**

The `_MIN_XML_CHARS` threshold and the error-page shape are empirical and dated
2026-06-11 in the source repo; confirm they still hold today.

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys, time
sys.path.insert(0, ".")
from visualex_api.tools.norma import Norma
from visualex_api.tools.map import extract_codice_details
from visualex_api.services.akn_fetch import fetch_act_index, clear_akn_cache

async def main():
    cases = [
        Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
        Norma(tipo_atto="costituzione"),
    ]
    d = extract_codice_details("codice civile")
    cases.append(Norma(tipo_atto="codice civile", data=d["data"],
                       numero_atto=d["numero_atto"], tipo_atto_reale=d["tipo_atto_reale"]))
    for n in cases:
        clear_akn_cache()
        t0 = time.time()
        idx = await fetch_act_index(n)
        dt = (time.time() - t0) * 1000
        if idx is None:
            print(f"{str(n)[:40]:42} FALLITO")
        else:
            print(f"{str(n)[:40]:42} {len(idx.keys):5} articoli in {dt:6.0f} ms "
                  f"(codice={idx.codice_redaz})")

asyncio.run(main())
EOF
```

Expected: L. 241 → 51 keys, Costituzione → 139, codice civile → 3249 (cold, ~5 s: the
export is 10.6 MB). A `FALLITO` here means the landing-page regex or the threshold has
drifted — read the log line, it says which gate rejected the response.

- [ ] **Step 7: Propose the commit**

```
feat(akn): fetch the article index from Normattiva's AKN export

Two-request flow (landing page for the session and the export params, then
caricaAKN) on the shared ThrottledHttpClient, so it inherits the throttle,
retry, backoff, circuit breaker and egress guard rather than opening its own
client.

Three departures from the source, all required by this being a shared server:
only the INDEX is cached (a few tens of KB per act, not the 1.9 MB of parsed
text or the 10.6 MB of XML); parsing runs in asyncio.to_thread so a 250 ms
parse does not stall every concurrent request; and a single-flight registry
means N concurrent cold requests for the codice civile download it once.

The per-key hit counter is deliberately not ported: a log of which laws were
consulted, unpartitioned in a shared directory, is not something a shared
server for lawyers should write.
```

---

### Task 11: Wire AKN in — tree cross-check and text fallback

**Files:**
- Modify: `app.py` (use `normalize_article_key` in `_article_exists_in_tree`; AKN cross-check when the tree is unusable)
- Modify: `visualex_api/services/normattiva_scraper.py` (AKN text fallback when extraction fails)
- Create: `tests/test_akn_integration.py`

**Interfaces:**
- Consumes: `fetch_act_index`, `fetch_act_article` (Task 10); `normalize_article_key` (Task 9); `_article_exists_in_tree` (Task 8).
- Produces: no new public surface. `get_document` keeps returning `Tuple[str, str]`.

- [ ] **Step 1: Write the failing test**

`tests/test_akn_integration.py`:

```python
"""AKN's two jobs: repair the existence check when the tree is unusable, and
stand in for the HTML extractor when it fails outright."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex


def _controller():
    return NormaController.__new__(NormaController)


class TestTreeCrossCheck:
    @pytest.mark.asyncio
    async def test_akn_answers_when_the_tree_is_unusable(self):
        """A tree failure used to mean "skip the check". With AKN available the
        answer is still authoritative."""
        ctrl = _controller()
        index = AktIndex(title="L. 241/1990", keys=["1", "2", "2-bis", "3"])
        with patch("app.get_tree", new=AsyncMock(return_value=("Empty response from server", 0, {}))), \
             patch("app.fetch_act_index", new=AsyncMock(return_value=index)):
            assert await ctrl._article_exists_in_tree("https://x", "2-bis", None) is True
            assert await ctrl._article_exists_in_tree("https://x", "99999", None) is False

    @pytest.mark.asyncio
    async def test_still_fails_open_when_both_sources_are_down(self):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=("boom", 0, {}))), \
             patch("app.fetch_act_index", new=AsyncMock(return_value=None)):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None

    @pytest.mark.asyncio
    async def test_the_tree_stays_the_primary_enumerator(self):
        """AKN must not be consulted when the tree answered."""
        ctrl = _controller()
        tree = ([{"numero": "1", "allegato": None}], 1, {})
        akn = AsyncMock(return_value=AktIndex(title="x", keys=["1", "2"]))
        with patch("app.get_tree", new=AsyncMock(return_value=tree)), \
             patch("app.fetch_act_index", new=akn):
            assert await ctrl._article_exists_in_tree("https://x", "2", None) is False
        akn.assert_not_awaited()


class TestTextFallback:
    @pytest.mark.asyncio
    async def test_akn_text_is_used_only_when_html_extraction_fails(self):
        from visualex_api.tools.norma import Norma, NormaVisitata
        from visualex_api.services.normattiva_scraper import NormattivaScraper

        scraper = NormattivaScraper()
        nv = NormaVisitata(
            norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
            numero_articolo="3",
        )
        with patch.object(scraper, "request_document", new=AsyncMock(return_value="<html>broken</html>")), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article",
                   new=AsyncMock(return_value="### Art. 3. testo dall'AKN")):
            text, _ = await scraper.get_document(nv)
        assert "AKN" in text

    @pytest.mark.asyncio
    async def test_html_success_never_calls_akn(self):
        """The guard that protects every stored highlight: when HTML works, its
        text is what ships, byte for byte."""
        from pathlib import Path

        from visualex_api.tools.norma import Norma, NormaVisitata
        from visualex_api.services.normattiva_scraper import NormattivaScraper

        html = (Path(__file__).parent / "fixtures" / "normattiva" / "akn_comma_div.html").read_text(encoding="utf-8")
        scraper = NormattivaScraper()
        nv = NormaVisitata(
            norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
            numero_articolo="3",
        )
        akn = AsyncMock(return_value="### dall'AKN")
        with patch.object(scraper, "request_document", new=AsyncMock(return_value=html)), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article", new=akn):
            text, _ = await scraper.get_document(nv)
        akn.assert_not_awaited()
        assert "dall'AKN" not in text
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_akn_integration.py -q
```

- [ ] **Step 3: Replace the local normaliser with the real one**

In `app.py`, import `normalize_article_key` from `visualex_api.services.akn_parser` and
delete `NormaController._normalize_article_key` (added in Task 8), replacing its call
sites. The AKN version handles the full ordinal set (`bis` … `decies`) and the `art_`
eId prefix; keeping two implementations of the same rule is exactly the duplication
CLAUDE.md's shared-utilities section forbids.

- [ ] **Step 4: Add the AKN cross-check to the existence check**

In `_article_exists_in_tree`, where the tree is unusable, ask AKN before giving up:

```python
        if isinstance(articles, str) or not articles:
            log_ctx = {"tree": str(articles)[:120], "url": act_url[:100]}
            index = await fetch_act_index(norma)
            if index is not None:
                logger.info("Tree unusable, answered from the AKN index", extra=log_ctx)
                wanted = normalize_article_key(article)
                return any(normalize_article_key(k) == wanted for k in index.keys)
            logger.warning("Tree unusable and no AKN index, skipping existence check",
                           extra=log_ctx)
            return None
```

This needs the `norma` object rather than just its URL, so widen the signature to
`_article_exists_in_tree(self, norma, article, annex)` and take `norma.url` inside.
Update the call site in the fan-out loop and the Task 8 tests accordingly.

- [ ] **Step 5: Add the text fallback to the scraper**

In `visualex_api/services/normattiva_scraper.py`, wrap the extraction call in
`get_document` (currently `:47-52`):

```python
        if normavisitata.numero_articolo:
            try:
                document_text = await self.estrai_da_html(html_content)
            except Exception as exc:  # noqa: BLE001
                log.warning("HTML extraction failed, trying the AKN export",
                            urn=urn[:100], error=str(exc))
                document_text = None

            if not document_text or not document_text.strip():
                # Last resort. This text differs from the HTML rendering — it
                # transliterates accents and carries a markdown heading — so it
                # is served only when the alternative is an error, and the
                # caller marks it as such.
                akn_text = await fetch_act_article(
                    normavisitata.norma, normavisitata.numero_articolo
                )
                if akn_text:
                    log.info("Served article text from the AKN export",
                             urn=urn[:100])
                    return akn_text, urn
                raise ParsingError(f"Impossibile estrarre il testo dell'articolo da {urn}")

            return document_text, urn
```

Import `fetch_act_article` at module level from `.akn_fetch`.

- [ ] **Step 6: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 7: Prove the primary text did not move — the gate for the whole phase**

This is the check that every stored highlight and note still lands. It compares the
article text this branch produces against the same text on `main`.

```bash
git stash push --keep-index -m "akn-wip" 2>/dev/null || true
git switch main --detach 2>/dev/null
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - > /tmp/text_before.txt <<'EOF'
import asyncio, sys, json
sys.path.insert(0, ".")
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.map import extract_codice_details
from visualex_api.services.normattiva_scraper import NormattivaScraper

CASES = [("legge","1990-08-07","241",None,"3"),("legge","1990-08-07","241",None,"7"),
         ("costituzione",None,None,None,"117"),("codice civile",None,None,"2","2043"),
         ("codice penale",None,None,"1","575")]

async def main():
    s = NormattivaScraper(); out = {}
    for tipo, data, num, annex, art in CASES:
        if data is None and tipo.startswith("codice"):
            d = extract_codice_details(tipo)
            n = Norma(tipo_atto=tipo, data=d["data"], numero_atto=d["numero_atto"],
                      tipo_atto_reale=d["tipo_atto_reale"])
        else:
            n = Norma(tipo_atto=tipo, data=data, numero_atto=num)
        t, _ = await s.get_document(NormaVisitata(norma=n, numero_articolo=art, allegato=annex))
        out[f"{tipo}|{art}"] = t
    print(json.dumps(out, ensure_ascii=False, sort_keys=True))
asyncio.run(main())
EOF
git switch feature/mcp-legal-transfusion
git stash pop 2>/dev/null || true
```

Then run the identical script on this branch into `/tmp/text_after.txt` and diff:

```bash
diff <(/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -c "import json;print(open('/tmp/text_before.txt').read())") \
     <(/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -c "import json;print(open('/tmp/text_after.txt').read())") \
  && echo "IDENTICO — nessun offset si è mosso"
```

**Expected: byte-identical.** Any difference means an anchor somewhere moved and the
phase must not ship as it stands.

- [ ] **Step 8: Propose the commit**

```
feat(akn): use the AKN index to answer existence when the tree is unusable

Two narrow integrations, both fallbacks. The existence check consults the AKN
index when get_tree returns its error string, so a scraped-HTML failure no
longer degrades into "skip the check"; and the scraper serves AKN text when
HTML extraction fails outright, marked as such, rather than raising.

The HTML path stays primary and its output is unchanged byte for byte —
verified by diffing five articles against main. That is deliberate: article_text
is the offset space every stored highlight and note is anchored to, with an
exact-equality gate and no fuzzy fallback.

Also drops the temporary article-key normaliser in favour of the AKN parser's.
```

---

## Phase E — Brocardi

> The recon inverted this one: `mcp-legal-it`'s Brocardi client is a fork of VisuaLex's
> and is **worse** in six respects (no throttling, no HTML cache, footnote pattern 4
> dropped, `tipo` dropped, `numero_paragrafo` dropped, no per-section error isolation).
> So this is not a port. It is five bug fixes copied from the fork's better half, plus
> one genuinely new section.

### Task 12: Fix what the Brocardi scraper silently loses

**Files:**
- Modify: `visualex_api/services/brocardi_scraper.py` (five fixes)
- Delete: the `BrocardiSelectors` block in `visualex_api/tools/selectors.py:61-78` and its instantiation at `brocardi_scraper.py:68`
- Create: `tests/fixtures/brocardi/article.html`, `tests/fixtures/brocardi/article_extra_class.html`
- Create: `tests/test_brocardi_extraction.py`

**Interfaces:**
- Consumes: `BrocardiScraper.get_info(norma_visitata) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]` (unchanged signature).
- Produces: the same `info` dict keys, with `CrossReferences[].tipo_atto` populated for the procedure codes and `Footnotes[].tipo` values that satisfy the TS union.

- [ ] **Step 1: Capture the fixtures**

```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/.claude/worktrees/wonderful-tereshkova-56ca06
mkdir -p tests/fixtures/brocardi
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.map import extract_codice_details

async def main():
    s = BrocardiScraper()
    d = extract_codice_details("codice civile")
    n = Norma(tipo_atto="codice civile", data=d["data"], numero_atto=d["numero_atto"],
              tipo_atto_reale=d["tipo_atto_reale"])
    nv = NormaVisitata(norma=n, numero_articolo="2043", allegato="2")
    url = await s.look_up(nv)
    print("article url:", url)
    result = await s.request_document(url, source="brocardi")
    with open("tests/fixtures/brocardi/article.html", "w", encoding="utf-8") as fh:
        fh.write(result)
    print(len(result), "bytes")

asyncio.run(main())
EOF
```

Then make the second fixture — the same page with one extra class on the content
container. This is the shape that silently empties every section today:

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
src = open("tests/fixtures/brocardi/article.html", encoding="utf-8").read()
old = "panes-condensed panes-w-ads content-ext-guide content-mark"
assert old in src, "the exact class string is not in the fixture; inspect it before proceeding"
open("tests/fixtures/brocardi/article_extra_class.html", "w", encoding="utf-8").write(
    src.replace(old, old + " content-redesign-2027")
)
print("variant written")
EOF
```

- [ ] **Step 2: Write the failing test**

`tests/test_brocardi_extraction.py`:

```python
"""Offline corpus for the Brocardi extractor, and the five things it lost."""
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from visualex_api.services.brocardi_scraper import BrocardiScraper

FIXTURES = Path(__file__).parent / "fixtures" / "brocardi"


@pytest.fixture(scope="module")
def scraper():
    return BrocardiScraper()


def _info(scraper, filename):
    soup = BeautifulSoup((FIXTURES / filename).read_text(encoding="utf-8"), "html.parser")
    info = {"Position": scraper._extract_position(soup)}
    scraper._extract_sections(soup, info)
    return info


class TestSelectorResilience:
    """One class added on brocardi.it currently empties every section."""

    def test_sections_survive_an_extra_class(self, scraper):
        baseline = _info(scraper, "article.html")
        variant = _info(scraper, "article_extra_class.html")
        assert set(baseline) - {"Position"}, "the baseline fixture has no sections at all"
        assert set(baseline) == set(variant), (
            "an added class on the content container emptied the extraction"
        )


class TestPosition:
    def test_the_brocardi_prefix_is_stripped(self, scraper):
        soup = BeautifulSoup((FIXTURES / "article.html").read_text(encoding="utf-8"), "html.parser")
        position = scraper._extract_position(soup)
        assert position
        assert "Brocardi.it" not in position
        assert not position.startswith(">")

    def test_a_shorter_prefix_is_not_truncated(self, scraper):
        """The hardcoded [17:] slice ate 17 characters regardless of content."""
        soup = BeautifulSoup(
            '<div id="breadcrumb">Brocardi.it > Codice civile > Art. 2043</div>',
            "html.parser",
        )
        assert scraper._extract_position(soup).startswith("Codice civile")


class TestCrossReferenceTipoAtto:
    @pytest.mark.parametrize("href,expected", [
        ("https://brocardi.it/codice-di-procedura-civile/libro-primo/art100.html",
         "Codice Procedura Civile"),
        ("https://brocardi.it/codice-di-procedura-penale/libro-primo/art111.html",
         "Codice Procedura Penale"),
        ("https://brocardi.it/codice-civile/libro-quarto/art2043.html", "Codice Civile"),
        ("https://brocardi.it/codice-del-consumo/parte-i/art3.html", "Codice del Consumo"),
        ("https://brocardi.it/codice-della-privacy/parte-i/art1.html", "Codice Privacy"),
    ])
    def test_every_path_is_recognised(self, scraper, href, expected):
        html = f'<div class="text"><a href="{href}">rinvio</a></div>'
        corpo = BeautifulSoup(html, "html.parser")
        refs = scraper._extract_cross_references(corpo)
        assert refs, f"no cross-reference extracted for {href}"
        assert refs[0]["tipo_atto"] == expected


class TestFootnoteTipoMatchesTheTypeScriptUnion:
    def test_only_declared_values_are_emitted(self, scraper):
        info = _info(scraper, "article.html")
        allowed = {"nota", "riferimento", "footnote"}
        for note in info.get("Footnotes", []):
            assert note["tipo"] in allowed, (
                f"{note['tipo']!r} is not in the Footnote['tipo'] union in types/index.ts"
            )


class TestArticleUrlResolution:
    @pytest.mark.asyncio
    async def test_relative_href_keeps_its_path(self, scraper):
        """urljoin against the bare domain drops the path segments."""
        soup = BeautifulSoup(
            '<a href="libro-quarto/titolo-ix/art2043.html">2043</a>', "html.parser"
        )
        url = await scraper._find_article_link(
            soup, "https://brocardi.it/codice-civile/", "2043"
        )
        assert url == "https://brocardi.it/codice-civile/libro-quarto/titolo-ix/art2043.html"

    @pytest.mark.asyncio
    async def test_offsite_subpages_are_not_followed(self, scraper):
        soup = BeautifulSoup(
            '<div class="section-title"><a href="https://example.com/altro.html">x</a></div>',
            "html.parser",
        )
        assert await scraper._find_article_link(
            soup, "https://brocardi.it/codice-civile/", "2043"
        ) is None
```

- [ ] **Step 3: Run it and record which assertions fail**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_brocardi_extraction.py -q
```

Expected failures: the extra-class test (sections vanish), the short-prefix test (`[17:]`
truncates), the two procedure-code parameters, the footnote `tipo` union, and both URL
resolution tests.

- [ ] **Step 4: Fix the corpo selector**

`brocardi_scraper.py:496` matches the full class string exactly, and on a miss it logs a
warning and returns — losing every section. Replace with a substring predicate:

```python
        corpo = soup.find(
            'div',
            class_=lambda c: c and 'panes-condensed' in c and 'content-ext-guide' in c,
        )
        if corpo is None:
            log.warning("Brocardi content container not found", url=info.get('link'))
            return
```

Do **not** copy the source repo's `or soup.find('body')` fallback: scoping the
cross-reference scan to the whole page pulls navigation and footer article links in as
false positives.

- [ ] **Step 5: Fix the position slice**

`brocardi_scraper.py:487-493` — replace the `[17:]` slice with an anchored regex:

```python
    def _extract_position(self, soup: BeautifulSoup) -> Optional[str]:
        position_tag = soup.find('div', id='breadcrumb', recursive=True)
        if position_tag is None:
            log.warning("Breadcrumb position not found")
            return None
        text = position_tag.get_text(strip=False).replace('\n', '').replace('  ', '')
        return re.sub(r'^Brocardi\.it\s*>\s*', '', text).strip()
```

- [ ] **Step 6: Fix the two dead cross-reference branches and add two paths**

`brocardi_scraper.py:294-297` tests `/codice-procedura-civile/` and
`/codice-procedura-penale/`; the real Brocardi paths carry `di-` (confirmed in
`visualex_api/tools/map.py:89,93`), so neither branch can ever fire. Replace the if/elif
chain with a table:

```python
_CROSS_REF_TIPI = {
    '/codice-civile/': 'Codice Civile',
    '/codice-penale/': 'Codice Penale',
    '/costituzione/': 'Costituzione',
    # These two carried no "di-" and could never match.
    '/codice-di-procedura-civile/': 'Codice Procedura Civile',
    '/codice-di-procedura-penale/': 'Codice Procedura Penale',
    '/codice-del-consumo/': 'Codice del Consumo',
    '/codice-della-privacy/': 'Codice Privacy',
}
```

and in the loop: `tipo_atto = next((v for k, v in _CROSS_REF_TIPI.items() if k in href), None)`.

Note the longer keys must be tested before the shorter ones they contain — with this
table `/codice-civile/` and `/codice-di-procedura-civile/` do not overlap, but keep the
ordering in mind if a path is added.

- [ ] **Step 7: Fix the footnote `tipo` values**

`brocardi_scraper.py:101-206` emits `'nota_dispositivo'` for patterns 1 and 2, which is
not in the TS union `'nota' | 'riferimento' | 'footnote'` at `types/index.ts:59-63`.
Change those two sites to `'nota'`. Patterns 3 (`'nota'`) and 4 (`'riferimento'`) are
already valid. Keep all four patterns — the fork dropped pattern 4 and that is one of
the ways it is worse.

- [ ] **Step 8: Fix relative-href resolution and filter the sub-page crawl**

`brocardi_scraper.py:439-461`. Two changes:

```python
        # Resolve against the page we actually fetched, not the bare domain:
        # "libro-quarto/titolo-ix/art2043.html" must keep its path segments.
        page_url = base_url if base_url.endswith('/') else base_url + '/'
        article_url = urljoin(page_url, match.group(1))
```

and in the sub-page loop:

```python
            sub_url = urljoin(page_url, href)
            # Same-domain only, and never the page we are already on: without
            # this the crawl can re-fetch the index or walk off-site.
            if not sub_url.startswith(BASE_URL) or sub_url == base_url:
                continue
```

Replace the `requests.compat.urljoin` calls with `from urllib.parse import urljoin` —
`requests` is pulled in only for that one helper.

- [ ] **Step 9: Delete the dead selector class**

`BrocardiSelectors` (`selectors.py:61-78`) is instantiated at `brocardi_scraper.py:68`
and never read, and its `SPIEGAZIONE_CLASS` / `MASSIME_CONTAINER_CLASS` values are
already stale relative to the live code. Delete the class and the `self.selectors = ...`
line. Leave `NormattivaSelectors` alone — that one is used.

- [ ] **Step 10: Run the tests**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_brocardi_extraction.py -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 11: Verify against live Brocardi**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.map import extract_codice_details

async def main():
    s = BrocardiScraper()
    for codice, annex, art in [("codice civile", "2", "2043"), ("codice penale", "1", "575")]:
        d = extract_codice_details(codice)
        n = Norma(tipo_atto=codice, data=d["data"], numero_atto=d["numero_atto"],
                  tipo_atto_reale=d["tipo_atto_reale"])
        pos, info, link = await s.get_info(NormaVisitata(norma=n, numero_articolo=art, allegato=annex))
        print(f"\n{codice} art. {art}")
        print("  position:", pos)
        for k, v in info.items():
            if k == "Position":
                continue
            size = len(v) if isinstance(v, (list, dict, str)) else v
            print(f"  {k}: {size}")

asyncio.run(main())
EOF
```

Expected: `Ratio`, `Spiegazione`, `Massime`, `Brocardi` all non-empty for art. 2043, and
`position` free of the `Brocardi.it >` prefix.

- [ ] **Step 12: Propose the commit**

```
fix(brocardi): stop losing sections to selector fragility

Five fixes, each with a live failure mode:
- the content container was matched by an exact four-class string, so one class
  added on brocardi.it would silently empty every section;
- the breadcrumb prefix was stripped with a hardcoded [17:] slice;
- the cross-reference table tested /codice-procedura-civile/ and
  /codice-procedura-penale/, but the real paths carry "di-", so both branches
  were dead; adds consumo and privacy;
- relative article hrefs were resolved against the bare domain instead of the
  page URL, dropping the path segments;
- the sub-page crawl had no same-domain filter and could re-fetch the index or
  follow off-site links.

Also aligns Footnote.tipo with the TypeScript union it is typed against, and
deletes BrocardiSelectors, which was instantiated, never read, and stale.
```

---

### Task 13: Add the Glossario

**Files:**
- Modify: `visualex_api/services/brocardi_scraper.py` (`_extract_glossario`, called from `get_info`)
- Modify: `app.py:227-240`, `app.py:722-732`, `app.py:793-802` (all three wire literals)
- Modify: `tests/test_brocardi_extraction.py`

**Interfaces:**
- Produces: `info['Glossario'] -> List[{termine: str, url: str, dizionario_id: str}]`, present only when non-empty. PascalCase, matching the other content keys byte-for-byte — the frontend reads the Python dict keys directly.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_brocardi_extraction.py`:

```python
class TestGlossario:
    def test_dictionary_links_are_collected(self, scraper):
        html = (
            '<div><a href="/dizionario/1234.html">colpa</a>'
            '<a href="/dizionario/1234.html">colpa</a>'
            '<a href="https://brocardi.it/dizionario/5678.html">dolo</a>'
            '<a href="/codice-civile/art2043.html">art. 2043</a>'
            '<a href="/dizionario/9999.html"></a></div>'
        )
        soup = BeautifulSoup(html, "html.parser")
        entries = scraper._extract_glossario(soup)

        assert [e["termine"] for e in entries] == ["colpa", "dolo"], "dedupe or filtering failed"
        assert entries[0]["url"] == "https://brocardi.it/dizionario/1234.html"
        assert entries[0]["dizionario_id"] == "1234"

    def test_absent_glossary_yields_no_key(self, scraper):
        soup = BeautifulSoup("<div><p>nessun link</p></div>", "html.parser")
        info = {}
        scraper._attach_glossario(soup, info)
        assert "Glossario" not in info
```

- [ ] **Step 2: Run it to verify it fails**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/test_brocardi_extraction.py -k Glossario -q
```

- [ ] **Step 3: Write the extractor**

In `brocardi_scraper.py`, next to `_extract_related_articles` (which is also scoped to
the whole `soup` rather than to `corpo`):

```python
    def _extract_glossario(self, soup) -> List[Dict[str, str]]:
        """Links to Brocardi's legal dictionary for terms used in the article.

        Scoped to the whole page rather than to `corpo`: the dictionary links
        are inline in the article text, which sits outside the sections
        container.
        """
        entries: List[Dict[str, str]] = []
        seen = set()
        try:
            for link in soup.find_all('a', href=True):
                href = link['href']
                if '/dizionario/' not in href or '.html' not in href:
                    continue
                termine = self._clean_text(link.get_text())
                if not termine:
                    continue
                url = href if href.startswith('http') else f"{BASE_URL}{href}"
                if url in seen:
                    continue
                seen.add(url)
                match = re.search(r'/dizionario/(\d+)\.html', href)
                entries.append({
                    'termine': termine,
                    'url': url,
                    'dizionario_id': match.group(1) if match else '',
                })
        except Exception as exc:  # noqa: BLE001 - one bad link must not kill the page
            log.warning("Glossary extraction failed", error=str(exc))
            return entries
        return entries

    def _attach_glossario(self, soup, info: Dict[str, Any]) -> None:
        entries = self._extract_glossario(soup)
        if entries:
            info['Glossario'] = entries
            log.debug("Extracted glossary entries", count=len(entries))
```

Call `self._attach_glossario(soup, info)` in `get_info`, next to the existing
`RelatedArticles` attachment at `:479-483`.

- [ ] **Step 4: Add the key to all three wire literals**

`app.py` builds `brocardi_info` in three places, each an explicit key whitelist: `:227`
(stream), `:722` (fetch_all_data) and `:793` (the annex-retry path, which uses `b_info`
rather than `brocardi_info` as the variable name). **A key missing from any one of them
never reaches the frontend on that path.** Add to each:

```python
            'Glossario': info.get('Glossario'),
```

Verify all three were edited:

```bash
grep -n "Glossario" app.py
```

Expected: exactly three lines.

- [ ] **Step 5: Run the tests and check the wire end to end**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python - <<'EOF'
import asyncio, sys, json
sys.path.insert(0, ".")
from visualex_api.services.brocardi_scraper import BrocardiScraper
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.map import extract_codice_details

async def main():
    s = BrocardiScraper()
    d = extract_codice_details("codice civile")
    n = Norma(tipo_atto="codice civile", data=d["data"], numero_atto=d["numero_atto"],
              tipo_atto_reale=d["tipo_atto_reale"])
    _, info, _ = await s.get_info(NormaVisitata(norma=n, numero_articolo="2043", allegato="2"))
    print(json.dumps(info.get("Glossario", [])[:5], ensure_ascii=False, indent=2))

asyncio.run(main())
EOF
```

Expected: a handful of dictionary terms with absolute URLs. An empty list is a valid
outcome for an article with no glossary links — try art. 1218 before concluding the
extractor is broken.

- [ ] **Step 6: Propose the commit**

```
feat(brocardi): extract the Glossario

Collects Brocardi's legal-dictionary links for terms used in the article
({termine, url, dizionario_id}), deduplicated by URL. Added to all three
brocardi_info wire literals in app.py — a key missing from any one of them never
reaches the frontend on that path.

Dispositivo is deliberately not extracted: it is the article text, which the
reading surface already shows from Normattiva.
```

---

### Task 14: Render the Glossario and the already-plumbed RelatedArticles

**Files:**
- Modify: `frontend/src/types/index.ts` (add `GlossaryEntry`, extend `BrocardiInfo`)
- Modify: `frontend/src/components/features/search/BrocardiDisplay.tsx` (two new sections, two `hasContent` entries)
- Create: `frontend/src/components/features/search/BrocardiDisplay.test.tsx`

**Interfaces:**
- Consumes: `info.Glossario` and `info.RelatedArticles` from `BrocardiInfo`.
- Produces: no new exports; two local section components following the existing bespoke-collapsible pattern.

- [ ] **Step 1: Write the failing test**

There is currently no test for any Brocardi component. `BrocardiDisplay` renders
`MarkableBrocardiSection` and three local sections that call `useAppStore`, so the test
passes only the fields under test and lets the rest be null.

`frontend/src/components/features/search/BrocardiDisplay.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrocardiDisplay } from './BrocardiDisplay';
import type { BrocardiInfo } from '../../../types';

const empty: BrocardiInfo = {
  position: null, link: null, Brocardi: null, Ratio: null,
  Spiegazione: null, Massime: null,
};

describe('BrocardiDisplay — Glossario', () => {
  it('renders the dictionary terms', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [
        { termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' },
        { termine: 'dolo', url: 'https://brocardi.it/dizionario/2.html', dizionario_id: '2' },
      ],
    }} />);
    expect(screen.getByText('colpa')).toBeInTheDocument();
    expect(screen.getByText('dolo')).toBeInTheDocument();
  });

  it('does not fall through to the empty state when only the Glossario is present', () => {
    // The hasContent OR-chain is a silent failure mode: a field with a render
    // block but no gate entry shows the empty state on sparse articles.
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [{ termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' }],
    }} />);
    expect(screen.queryByText(/nessuna annotazione/i)).not.toBeInTheDocument();
  });

  it('opens dictionary links in a new tab, safely', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      Glossario: [{ termine: 'colpa', url: 'https://brocardi.it/dizionario/1.html', dizionario_id: '1' }],
    }} />);
    const link = screen.getByRole('link', { name: 'colpa' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('BrocardiDisplay — RelatedArticles', () => {
  it('renders previous and next', () => {
    render(<BrocardiDisplay info={{
      ...empty,
      RelatedArticles: {
        previous: { numero: '2042', url: 'https://brocardi.it/a.html', titolo: 'Art. 2042' },
        next: { numero: '2044', url: 'https://brocardi.it/b.html', titolo: 'Art. 2044' },
      },
    }} />);
    expect(screen.getByText(/2042/)).toBeInTheDocument();
    expect(screen.getByText(/2044/)).toBeInTheDocument();
  });
});

describe('BrocardiDisplay — empty', () => {
  it('shows the empty state when nothing is present', () => {
    render(<BrocardiDisplay info={empty} />);
    expect(screen.queryByText('colpa')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npm run test -- --run src/components/features/search/BrocardiDisplay.test.tsx
```

Expected: the Glossario and RelatedArticles cases fail (nothing rendered); the empty
case passes.

- [ ] **Step 3: Add the types**

`frontend/src/types/index.ts` — the item interface next to `CrossReference` (around
line 78), and the field at the end of `BrocardiInfo` (after `CrossReferences`, line 103).
Casing must match the Python dict keys byte-for-byte: content keys are PascalCase,
`position` and `link` are the two lowercase exceptions.

```ts
export interface GlossaryEntry {
    termine: string;
    url: string;
    dizionario_id: string;
}
```

```ts
    // Brocardi legal-dictionary links for terms used in the article
    Glossario?: GlossaryEntry[] | null;
```

- [ ] **Step 4: Add the two sections**

In `BrocardiDisplay.tsx`, after `CrossReferencesSection` (which ends at :432), following
the same bespoke-collapsible shape: an accent colour, a count chip, and the keyboard
conventions from CLAUDE.md (`role="button"`, `tabIndex={0}`, `aria-expanded`, a dynamic
`aria-label`, Enter/Space with `preventDefault()`, the
`if (e.target !== e.currentTarget) return;` guard, and the focus-visible ring).

```tsx
function GlossarioSection({ entries }: { entries: GlossaryEntry[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = () => setIsOpen((v) => !v);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50/50 dark:border-teal-900 dark:bg-teal-950/20">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Comprimi il glossario' : 'Espandi il glossario'}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className="flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0"
      >
        <span className="text-sm font-semibold text-teal-900 dark:text-teal-200">
          Glossario
        </span>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-800 dark:bg-teal-900 dark:text-teal-200">
          {entries.length}
        </span>
      </div>
      {isOpen && (
        <ul className="flex flex-wrap gap-2 px-4 pb-3">
          {entries.map((entry) => (
            <li key={entry.url}>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-full border border-teal-300 px-3 py-1 text-xs text-teal-900 hover:bg-teal-100 dark:border-teal-800 dark:text-teal-200 dark:hover:bg-teal-900"
              >
                {entry.termine}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RelatedArticlesSection({ related }: { related: NonNullable<BrocardiInfoType['RelatedArticles']> }) {
  const items = [
    related.previous ? { ...related.previous, label: 'Precedente' } : null,
    related.next ? { ...related.next, label: 'Successivo' } : null,
  ].filter(Boolean) as Array<{ numero: string; url: string; titolo?: string; label: string }>;

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a
          key={item.url}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 md:min-h-0 md:py-2"
        >
          <span className="text-xs uppercase tracking-wide text-slate-400">{item.label}</span>
          <span>{item.titolo || `Art. ${item.numero}`}</span>
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Render them and extend the gate**

In the section list (`:522-583`), before the `info.link` footer at `:585`:

```tsx
          {info.Glossario && info.Glossario.length > 0 && (
            <GlossarioSection entries={info.Glossario} />
          )}
          {info.RelatedArticles && <RelatedArticlesSection related={info.RelatedArticles} />}
```

And extend the `hasContent` OR-chain (`:490-495`) with both — omitting them there is the
silent failure mode the second test pins:

```tsx
    || (info.Glossario?.length ?? 0) > 0
    || Boolean(info.RelatedArticles?.previous || info.RelatedArticles?.next)
```

Import `GlossaryEntry` alongside the other type imports at the top of the file.

- [ ] **Step 6: Run the frontend gates**

```bash
cd frontend
npm run test -- --run
npm run build
npm run lint
```

`npm run build` (`tsc -b`) is the real type-check. Fix any pre-existing error surfaced in
the files touched here rather than deferring it.

- [ ] **Step 7: Propose the commit**

```
feat(brocardi): render the Glossario and the related articles

The Glossario is new. RelatedArticles was already emitted by the backend and
typed in TypeScript but rendered by nothing — it is wired up here. Both are
added to the hasContent gate, without which an article carrying only one of
them would show the empty state instead.

Adds the first tests for any Brocardi component, including one that pins the
hasContent gate, since that failure only appears on sparse articles.
```

---

## Phase F — Finish

### Task 15: Fix the selection offset that never matches

**Files:**
- Modify: `frontend/src/components/features/search/SelectionPopup.tsx`
- Create: `frontend/src/components/features/search/SelectionPopup.test.tsx`

**Interfaces:**
- Consumes: `getPlainTextOffset(container, node, offset)` from `utils/selectionOffset.ts`.
- Produces: no signature change — `onHighlight(text, color, startOffset)` and `onAddNote(text, startOffset, rect)` keep their shapes; the pair is simply consistent.

This is a pre-existing bug, unrelated to the transfusion, found while establishing that
the AKN decision was necessary. It is included because it silently discards user data in
exactly the mechanism the whole of Phase D was designed to protect.

- [ ] **Step 1: Write the failing test**

`SelectionPopup.tsx:54` trims the selected text but `:81` takes the offset from the
untrimmed range start. A selection beginning on whitespace therefore stores an offset
one or more characters to the left of its own text, and `useArticleMarkers`'s equality
gate fails on the very first render — against unchanged text.

`frontend/src/components/features/search/SelectionPopup.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { alignOffsetToTrimmedText } from './SelectionPopup';

describe('alignOffsetToTrimmedText', () => {
  it('shifts the offset past leading whitespace', () => {
    expect(alignOffsetToTrimmedText('   danno ingiusto', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 13,
    });
  });

  it('leaves a clean selection untouched', () => {
    expect(alignOffsetToTrimmedText('danno ingiusto', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 10,
    });
  });

  it('handles trailing whitespace without moving the start', () => {
    expect(alignOffsetToTrimmedText('danno ingiusto   ', 10)).toEqual({
      text: 'danno ingiusto',
      startOffset: 10,
    });
  });

  it('handles a newline-only prefix', () => {
    expect(alignOffsetToTrimmedText('\n\ndanno', 5)).toEqual({
      text: 'danno',
      startOffset: 7,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd frontend && npm run test -- --run src/components/features/search/SelectionPopup.test.tsx
```

Expected: `alignOffsetToTrimmedText is not exported`.

- [ ] **Step 3: Add the helper and use it**

In `SelectionPopup.tsx`, above the component:

```tsx
/**
 * Keep the stored text and the stored offset describing the same span.
 *
 * `Selection.toString()` is trimmed before it is saved, but the offset comes
 * from the untrimmed range start. A selection that begins on whitespace
 * therefore stores an offset to the left of its own text, and the equality
 * gate in useArticleMarkers drops the marker on the first render — against
 * text that never changed. Exported for testing.
 */
export function alignOffsetToTrimmedText(
  raw: string,
  rawOffset: number,
): { text: string; startOffset: number } {
  const leading = raw.length - raw.trimStart().length;
  return { text: raw.trim(), startOffset: rawOffset + leading };
}
```

Then at the capture site (`:52-54` and `:81`), keep the untrimmed string until the
offset is known and align the pair:

```tsx
    const rawSelected = selection?.toString() ?? '';
    if (rawSelected.trim().length < 2) return;
    const rawOffset = getPlainTextOffset(containerRef.current, range.startContainer, range.startOffset);
    const { text: selectedText, startOffset } = alignOffsetToTrimmedText(rawSelected, rawOffset);
```

and store `selectedText` / `startOffset` in the popup state instead of the trimmed text
and the raw offset.

- [ ] **Step 4: Run the frontend gates**

```bash
cd frontend && npm run test -- --run && npm run build && npm run lint
```

- [ ] **Step 5: Verify in the browser**

Start the stack, log in, open an article, and select a span **starting with a space**
(drag from the whitespace before a word). Save the highlight, reload the page, and
confirm it is still painted in the text — not only listed in the side panel.

- [ ] **Step 6: Propose the commit**

```
fix(highlights): keep the stored text and offset describing the same span

The selected text was trimmed before saving while the offset came from the
untrimmed range start, so a selection beginning on whitespace stored a
mismatched pair. useArticleMarkers requires exact equality between the stored
text and the slice at the stored offset, with no fuzzy fallback, so those
highlights and notes were silently dropped from the article body on the very
first render — against text that had not changed.
```

---

### Task 16: Documentation

**Files:**
- Modify: `CLAUDE.md` (AKN section, egress, resolver, the fixed gotchas, new env vars)
- Modify: `README.md` (provenance line)
- Modify: `.env.example` (`AKN_ENABLED`, `AKN_CACHE_MAX_ACTS`)
- Modify: `docs/deployment.md` (the new `lxml` dependency and the CI gate)

- [ ] **Step 1: Add the provenance line to README.md**

One line, per the licence decision — the owner holds copyright on both repositories and
relicensed the ported code:

```markdown
Portions of the act-resolution tables and the Akoma Ntoso parser derive from
[mcp-legal-it](https://github.com/capazme/mcp-legal-it), by the same author,
relicensed MIT by the copyright holder.
```

- [ ] **Step 2: Update CLAUDE.md**

Four edits, each replacing a statement the code now contradicts:

1. In **Architecture → Python API → `tools/`**, add:

```markdown
  - `act_resolver.py` — `resolve_atto(name)` maps an act named the way a lawyer
    writes it ("statuto dei lavoratori", "TUSL", "del D.Lgs. 231/2001") to
    `{tipo_atto, data, numero_atto}`, over the `ATTI_NOTI` / `ATTI_DENOMINATI`
    tables in `map.py`. It **never guesses**: an unrecognised name returns `None`
    and `suggest_acts()` offers near misses. Chained after the exact-match paths
    in `alias_resolver` and `nl_parser`, so nothing that resolved before changes.
  - `egress.py` — `ALLOWED_HOSTS` plus `is_allowed(url)`, checked in
    `ThrottledHttpClient.request`. `tests/test_egress_allowlist.py` fails the
    build when a URL literal names an undeclared host. See `SECURITY.md`.
```

2. In **Architecture → Python API → `services/`**, add:

```markdown
  - `akn_parser.py` / `akn_fetch.py` — Normattiva's Akoma Ntoso export.
    **Structure and fallback only, never the display text**: the export
    transliterates every accent ("attivita'", "e'"), and `article_text` is the
    offset space every stored highlight and note is anchored to. Used to answer
    "does this article exist" when the HTML tree is unusable, and to serve an
    article when HTML extraction fails outright (marked `source="normattiva-akn"`).
    Only the article INDEX is cached; `AKN_ENABLED=false` disables the path.
```

3. In **Gotchas**, mark gotcha 9 as closed server-side and add two:

```markdown
9. **Article id formatting (`-bis` / `-ter`)** — the tree API and the scraper
   disagree (`"1-bis"` vs `"1 bis"`). Server-side both are now canonicalised
   through `normalize_article_key` (`services/akn_parser.py`). On the frontend
   the tolerant `findArticleByNormalizedId` is still required.

23. **`article_text` is a data contract, not a string.** Highlights and anchored
    notes are pinned by `(startOffset, text)` where the offset counts characters
    in a projection of `article_text` in which only `\n` is invisible.
    `useArticleMarkers` requires exact equality between the stored text and the
    slice at that offset and drops the marker silently on mismatch — no fuzzy
    fallback, no log, no visual difference from "never existed". Changing the
    scraper's output formatting by one space deletes every anchor after it, for
    every user, with no way to detect it afterwards. Measured: AKN vs HTML is
    0/19 identical.

24. **A missing article gets you a different one.** Normattiva answers a request
    for a nonexistent article with the act's Art. 1 and HTTP 200. The existence
    check in `create_norma_visitata_from_data` is what turns that into an error;
    it fails open, so a Normattiva outage is never reported as "does not exist".
```

4. In **Environment Variables → Python API**, add `AKN_ENABLED` (`true`) and
   `AKN_CACHE_MAX_ACTS` (`40`), and note the new `lxml` runtime dependency.

Also correct the **Development Commands** block: the Python suite must be run with the
project venv explicitly, because the ambient `python3` cannot import `quart`.

- [ ] **Step 3: Update docs/deployment.md**

Add to the step-2 notes that `requirements.txt` now includes `lxml`, which ships a
`cp314` wheel so no compiler is needed on the server, and record that CI now gates `main`
even though `deploy.sh` still runs no tests and has no rollback.

- [ ] **Step 4: Verify the docs match the code**

```bash
grep -n "AKN_ENABLED\|AKN_CACHE_MAX_ACTS" .env.example CLAUDE.md visualex_api/tools/config.py
grep -n "lxml" requirements.txt docs/deployment.md
```

Every name must appear in all of its places.

- [ ] **Step 5: Run the full gate one last time**

```bash
/Users/gpuzio/Desktop/CODE/VisuaLexAPI/.venv/bin/python -m pytest tests/ -q
cd frontend && npm run test -- --run && npm run build && npm run lint
```

- [ ] **Step 6: Propose the commit**

```
docs: record the AKN scope decision and the new safety net

Documents why AKN is a structure and fallback source rather than the display
text, adds the act resolver and the egress allowlist to the architecture
section, and adds two gotchas: article_text is a data contract that stored
annotations are anchored to, and Normattiva answers a missing article with
Art. 1 and HTTP 200.
```

---

## Closing the branch

Before proposing the merge:

1. **Full gate.** `pytest tests/ -q` with the project venv, then `npm run test -- --run`,
   `npm run build` and `npm run lint` in `frontend/`.
2. **The anchoring check.** Log in, open a Normattiva article that already carries a
   highlight and an anchored note, and confirm both still render in the text body — not
   only in the side panel. This is the one manual check the automated gates cannot
   replace, and it is the check that the central decision of this round held.
3. **The correctness check.** Search for `art. 99999 c.c.` and confirm it reports the
   article as absent instead of showing Art. 1.
4. **The resolver check.** Search for `statuto dei lavoratori art. 18` and confirm it
   resolves.
5. Report to the owner: what shipped, the live-gate result from Task 5 Step 5 (any
   drifted act in the tables), the `pip-audit` / `npm audit` findings from Task 3, and
   the follow-ups the spec deliberately left open.
