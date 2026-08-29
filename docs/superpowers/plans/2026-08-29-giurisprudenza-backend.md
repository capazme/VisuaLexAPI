# Case law backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give VisuaLex four live case-law sources behind one interface, reachable over HTTP, so a later plan can build the reading panel on top.

**Architecture:** One adapter per court, all speaking the same contract and all going through the existing `ThrottledHttpClient` (throttle, retry, circuit breaker, egress allowlist). A registry fans a query out to every adapter and isolates failures per source. Nothing is stored: every answer is fetched live.

**Tech Stack:** Python 3.12+/3.14, Quart, aiohttp via `ThrottledHttpClient`, `lxml` (already a dependency), pytest with `asyncio_mode = auto`.

**Spec:** `docs/superpowers/specs/2026-08-29-giurisprudenza-design.md`

## Global Constraints

- **Scope: backend only.** The reading panel, the search page and the lookup UI belong to a separate plan. This plan ends at HTTP endpoints verifiable with `curl`.
- **Nothing is stored.** No corpus, no index, no decision text written to disk. Corte costituzionale is out of this plan entirely (spec D9).
- **Every outbound call goes through `http_client.request()`.** No new `aiohttp.ClientSession`, no `httpx`. (spec D6)
- **TLS verification stays on for every source.** `ssl=False` must never appear. Italgiure gets a *verifying* SSL context carrying an extra intermediate — that is the opposite of disabling verification, and Task 2 adds a test that fails if anyone confuses the two. (spec D4)
- **Honest User-Agent:** `VisuaLex/<version> (ricerca giuridica; +https://visualex.org)`. No browser impersonation. (spec D5)
- **Every new host must be declared in `visualex_api/tools/egress.py`**, or `tests/test_egress_allowlist.py` fails the build.
- **Code, comments and commits in English.** UI copy is Italian, but this plan produces no UI copy.
- Live tests carry `@pytest.mark.live` and are excluded by default (`pytest.ini`). Run them with `.venv/bin/python -m pytest tests/ -m live`.
- Run the suite through the project venv from the repo root: `.venv/bin/python -m pytest tests/ -q`. The ambient `python3` cannot import quart.

---

### Task 1: The contract, and the hosts it will reach

**Files:**
- Create: `visualex_api/services/case_law/__init__.py`
- Create: `visualex_api/services/case_law/base.py`
- Modify: `visualex_api/tools/egress.py`
- Test: `tests/test_case_law_base.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `LinkKind`, `Decisione`, `SourceResult`, `CaseLawAdapter` — every later task imports these.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_base.py
import pytest

from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


def test_decisione_carries_how_it_was_found():
    """`link_kind` is the one field that must survive to the UI: it separates a
    citation the source declares from a string a search engine matched."""
    d = Decisione(
        organo="CGUE",
        numero="C-36/21",
        anno=2022,
        link_kind=LinkKind.CITED,
        url="https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62021CJ0036",
    )
    assert d.link_kind is LinkKind.CITED
    assert d.to_dict()["link_kind"] == "cited"


def test_source_result_reports_failure_without_pretending_emptiness():
    """A source that is down must not look like a source with no results —
    the panel has to be able to say which one it was (spec: Failure)."""
    ok = SourceResult(organo="CGUE", decisioni=[], ok=True)
    ko = SourceResult(organo="CGUE", decisioni=[], ok=False, error="timeout")

    assert ok.to_dict()["ok"] is True
    assert ko.to_dict()["ok"] is False
    assert ko.to_dict()["error"] == "timeout"


def test_identifies_itself_honestly():
    """Spec D5. `ThrottledHttpClient` sends no User-Agent of its own — aiohttp's
    default — so the adapters supply one. It names the product and carries a
    contact URL; it never impersonates a browser, which is a different posture
    for a shared server than for a personal tool."""
    from visualex_api.services.case_law.base import USER_AGENT, http_headers

    assert USER_AGENT.startswith("VisuaLex/")
    assert "+https://visualex.org" in USER_AGENT
    assert "Mozilla" not in USER_AGENT and "Chrome" not in USER_AGENT

    h = http_headers({"Referer": "https://example.test/"})
    assert h["User-Agent"] == USER_AGENT
    assert h["Referer"] == "https://example.test/"


def test_coverage_note_travels_with_the_result():
    """An empty Cassazione section means "nothing in the last five years",
    never "nothing"."""
    r = SourceResult(organo="Cassazione", decisioni=[], ok=True,
                     coverage="ultimi 5 anni")
    assert r.to_dict()["coverage"] == "ultimi 5 anni"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_base.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'visualex_api.services.case_law'`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/__init__.py
"""Live case-law sources, one adapter per court.

Nothing here stores a decision. Every answer is fetched from the source at
request time, which is the same rule the norm side follows.
"""
from .base import CaseLawAdapter, Decisione, LinkKind, SourceResult, http_headers

__all__ = ["CaseLawAdapter", "Decisione", "LinkKind", "SourceResult", "http_headers"]
```

```python
# visualex_api/services/case_law/base.py
"""The contract every court adapter speaks.

`link_kind` is the load-bearing field. The sources do not agree on what
"related to this article" means: CELLAR publishes a citation graph the court
itself declared, while Italgiure and CeRDEF match strings in the decision text.
Averaging those into one relevance score would hide exactly the difference a
lawyer needs in order to decide how far to trust a row, so the difference is
carried, not resolved (spec D2).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Protocol


class LinkKind(str, Enum):
    #: The source declares this decision cites the norm.
    CITED = "cited"
    #: The norm's text was found in the decision. An inference, not a fact.
    MATCHED = "matched"


@dataclass
class Decisione:
    organo: str
    numero: str
    anno: int
    link_kind: LinkKind
    url: str
    sezione: str = ""
    data: str = ""
    ecli: str = ""
    estratto: str = ""

    def to_dict(self) -> dict:
        return {
            "organo": self.organo,
            "numero": self.numero,
            "anno": self.anno,
            "link_kind": self.link_kind.value,
            "url": self.url,
            "sezione": self.sezione,
            "data": self.data,
            "ecli": self.ecli,
            "estratto": self.estratto,
        }


@dataclass
class SourceResult:
    """One source's answer, including the answer "I could not reach it".

    A failed source returns `ok=False` rather than an empty list, so the caller
    can say which source is missing instead of implying there is nothing to
    find (CLAUDE.md gotcha 18).
    """

    organo: str
    decisioni: list[Decisione] = field(default_factory=list)
    ok: bool = True
    error: str = ""
    coverage: str = ""

    def to_dict(self) -> dict:
        return {
            "organo": self.organo,
            "ok": self.ok,
            "error": self.error,
            "coverage": self.coverage,
            "decisioni": [d.to_dict() for d in self.decisioni],
            "count": len(self.decisioni),
        }


def _version() -> str:
    """The deployed version, so a source operator can tell releases apart."""
    from pathlib import Path

    f = Path(__file__).resolve().parents[3] / "version.txt"
    try:
        return f.read_text().strip() or "0"
    except OSError:
        return "0"


#: Spec D5. Names the product, carries a contact, impersonates nothing. Every
#: source in this package was verified to answer this string; if one starts
#: refusing it, that is a fact to record and act on, not to hide behind a
#: browser string.
USER_AGENT = f"VisuaLex/{_version()} (ricerca giuridica; +https://visualex.org)"


def http_headers(extra: dict | None = None) -> dict:
    """Request headers for an outbound call to a case-law source."""
    headers = {"User-Agent": USER_AGENT}
    if extra:
        headers.update(extra)
    return headers


class CaseLawAdapter(Protocol):
    organo: str
    coverage: str

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        ...

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        ...

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        ...
```

- [ ] **Step 4: Declare the new hosts**

Add to `ALLOWED_HOSTS` in `visualex_api/tools/egress.py`, keeping the existing
"who operates it" style of the surrounding entries:

```python
    "publications.europa.eu": "Publications Office of the EU — CELLAR, CJEU case law",
    "www.italgiure.giustizia.it": "Ministero della Giustizia — CED, Corte di cassazione",
    "def.finanze.it": "MEF — Documentazione economica e finanziaria, giurisprudenza",
    "www.giustizia-amministrativa.it": "Giustizia amministrativa — Consiglio di Stato e TAR",
    "mdp.giustizia-amministrativa.it": "Giustizia amministrativa — testi dei provvedimenti",
    "titrust.crt.sectigo.com": "Sectigo — intermediate CA for italgiure.giustizia.it (Task 2)",
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_base.py tests/test_egress_allowlist.py -q`
Expected: PASS (both files)

- [ ] **Step 6: Commit**

```bash
git add visualex_api/services/case_law/ visualex_api/tools/egress.py tests/test_case_law_base.py
git commit -m "feat(case-law): the adapter contract, and the hosts it will reach"
```

---

### Task 2: A verifying TLS context for Italgiure

**Files:**
- Create: `visualex_api/tools/tls.py`
- Test: `tests/test_tls_italgiure.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `async def italgiure_ssl_context() -> ssl.SSLContext` — Task 4 passes its return value to `http_client.request(..., ssl=ctx)`.

**Why this task exists:** `www.italgiure.giustizia.it` presents a certificate issued by *TI Trust Technologies OV CA*, which chains to *USERTrust RSA Certification Authority* — already in `certifi`. The server does not send the intermediate, so verification fails with "unable to get local issuer certificate" from Python under both `certifi` and the system store. Fetching the intermediate from the leaf's own AIA URI and adding it to the bundle makes verification pass. Measured; see the spec.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tls_italgiure.py
import inspect
import ssl

import pytest

from visualex_api.tools import tls


def test_module_never_disables_verification():
    """The previous round re-enabled TLS verification repo-wide. This module
    exists to KEEP it on for a host with an incomplete chain — the opposite of
    turning it off. If someone ever reaches for the easy fix, this fails."""
    src = inspect.getsource(tls)
    assert "CERT_NONE" not in src
    assert "check_hostname = False" not in src
    assert "ssl=False" not in src


@pytest.mark.live
async def test_context_verifies_italgiure():
    ctx = await tls.italgiure_ssl_context()
    assert ctx.verify_mode is ssl.CERT_REQUIRED
    assert ctx.check_hostname is True

    import asyncio
    reader, writer = await asyncio.open_connection(
        "www.italgiure.giustizia.it", 443, ssl=ctx,
        server_hostname="www.italgiure.giustizia.it",
    )
    writer.close()
    await writer.wait_closed()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_tls_italgiure.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'visualex_api.tools.tls'`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/tools/tls.py
"""A verifying SSL context for a host that serves an incomplete chain.

`www.italgiure.giustizia.it` presents a leaf issued by "TI Trust Technologies
OV CA", which is itself issued by "USERTrust RSA Certification Authority" —
present in certifi. The server omits the intermediate, so a default context
cannot build the chain and fails with "unable to get local issuer certificate".

The fix is to supply the missing link, not to stop checking. The intermediate is
downloaded from the URI the leaf certificate itself advertises (Authority
Information Access), and it is only trusted because it verifies against a root
already in certifi — an attacker substituting it changes nothing, because the
signature check still has to pass.

Do not "simplify" this into `ssl=False`. tests/test_tls_italgiure.py fails if
anyone does.
"""
from __future__ import annotations

import asyncio
import ssl
import subprocess

import certifi
import structlog

log = structlog.get_logger()

_AIA_URI = "http://titrust.crt.sectigo.com/TITrustTechnologiesOVCA.crt"

_context: ssl.SSLContext | None = None
_lock = asyncio.Lock()


def _der_to_pem(der: bytes) -> str:
    result = subprocess.run(
        ["openssl", "x509", "-inform", "DER"],
        input=der, capture_output=True, check=True,
    )
    return result.stdout.decode()


async def italgiure_ssl_context() -> ssl.SSLContext:
    """Built once per process. Raises if the intermediate cannot be fetched —
    a caller that cannot verify must fail, not fall back to not verifying."""
    global _context
    async with _lock:
        if _context is not None:
            return _context

        from ..services.http_client import http_client

        result = await http_client.request("GET", _AIA_URI, source="sectigo-aia")
        pem = await asyncio.to_thread(_der_to_pem, result.text.encode("latin-1"))

        ctx = ssl.create_default_context(cafile=certifi.where())
        ctx.load_verify_locations(cadata=pem)
        _context = ctx
        log.info("Italgiure TLS context built with the AIA intermediate")
        return ctx
```

- [ ] **Step 4: Run the offline test**

Run: `.venv/bin/python -m pytest tests/test_tls_italgiure.py -q`
Expected: PASS (1 passed, 1 deselected — the live one)

- [ ] **Step 5: Run the live test**

Run: `.venv/bin/python -m pytest tests/test_tls_italgiure.py -m live -q`
Expected: PASS. If it fails with a certificate error, the chain changed — read the new leaf's AIA URI before editing `_AIA_URI`.

- [ ] **Step 6: Commit**

```bash
git add visualex_api/tools/tls.py tests/test_tls_italgiure.py
git commit -m "feat(case-law): keep TLS verification on for italgiure's short chain"
```

---

### Task 3: CGUE adapter — the only structural link

**Files:**
- Create: `visualex_api/services/case_law/cellar.py`
- Test: `tests/test_case_law_cellar.py`

**Interfaces:**
- Consumes: `Decisione`, `LinkKind`, `SourceResult` (Task 1).
- Produces: `CellarAdapter` with `organo = "CGUE"`, `coverage = ""`, and the three contract methods. Task 7 instantiates it.

**Why first:** CELLAR is the only source that publishes which acts a judgment cites, so this adapter is the one that emits `LinkKind.CITED`. Getting it right first fixes the shape the weaker adapters must fit.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_cellar.py
import pytest

from visualex_api.services.case_law.cellar import CellarAdapter, _celex_from_riferimento

SPARQL_JSON = """{"head":{"vars":["celex","ecli"]},"results":{"bindings":[
 {"celex":{"value":"62017CJ0496"},"ecli":{"value":"ECLI:EU:C:2019:26"}},
 {"celex":{"value":"62016CC0073"},"ecli":{"value":"ECLI:EU:C:2017:253"}}
]}}"""


def test_maps_a_norm_reference_to_a_celex_number():
    """The adapter is asked about a norm the way the rest of VisuaLex names
    one; CELLAR keys on CELEX, so the mapping happens here."""
    assert _celex_from_riferimento("Regolamento UE 679/2016") == "32016R0679"
    assert _celex_from_riferimento("Direttiva UE 2019/790") == "32019L0790"
    assert _celex_from_riferimento("art. 2043 codice civile") is None


async def test_parses_judgments_and_marks_them_cited(monkeypatch):
    adapter = CellarAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = SPARQL_JSON
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    result = await adapter.cerca_per_norma("Regolamento UE 679/2016")

    assert result.ok is True
    assert result.organo == "CGUE"
    assert [d.numero for d in result.decisioni] == ["62017CJ0496", "62016CC0073"]
    # CELLAR declares the citation, so it is a fact, not a guess.
    assert all(d.link_kind.value == "cited" for d in result.decisioni)
    assert result.decisioni[0].ecli == "ECLI:EU:C:2019:26"


async def test_a_norm_with_no_celex_is_not_an_error(monkeypatch):
    """Asking the CGUE adapter about the codice civile is a normal question
    with an empty answer — not a failure to report."""
    adapter = CellarAdapter()
    result = await adapter.cerca_per_norma("art. 2043 codice civile")
    assert result.ok is True
    assert result.decisioni == []


async def test_an_unreachable_endpoint_is_reported_not_swallowed(monkeypatch):
    adapter = CellarAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("Regolamento UE 679/2016")
    assert result.ok is False
    assert "connection reset" in result.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_cellar.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'visualex_api.services.case_law.cellar'`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/cellar.py
"""CJEU case law from the EU Publications Office's CELLAR endpoint.

The only source in this package whose link to a norm is a fact rather than an
inference: `cdm:work_cites_work` is a citation graph the publisher declares, so
everything here is `LinkKind.CITED`. Public SPARQL, no authentication, no
coverage cut-off. Measured; see the spec.
"""
from __future__ import annotations

import json
import re
import urllib.parse

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql"
_EURLEX_DOC = "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:"

# "Regolamento UE 679/2016" -> 32016R0679 ; "Direttiva UE 2019/790" -> 32019L0790
_REG = re.compile(r"regolamento\s+ue\s+(\d{1,4})/(\d{4})", re.I)
_DIR = re.compile(r"direttiva\s+ue\s+(?:(\d{4})/(\d{1,4})|(\d{1,4})/(\d{4}))", re.I)


def _celex_from_riferimento(riferimento: str) -> str | None:
    m = _REG.search(riferimento)
    if m:
        return f"3{m.group(2)}R{int(m.group(1)):04d}"
    m = _DIR.search(riferimento)
    if m:
        anno, num = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        return f"3{anno}L{int(num):04d}"
    return None


_QUERY = """PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?ecli WHERE {
  ?norma cdm:resource_legal_id_celex '%s'^^<http://www.w3.org/2001/XMLSchema#string> .
  ?sent cdm:work_cites_work ?norma .
  ?sent cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?sent cdm:case-law_ecli ?ecli }
  FILTER(STRSTARTS(STR(?celex),'6'))
} LIMIT %d"""


class CellarAdapter:
    organo = "CGUE"
    coverage = ""

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        celex = _celex_from_riferimento(riferimento)
        if celex is None:
            # Not an EU act. A normal question with an empty answer.
            return SourceResult(organo=self.organo, decisioni=[], ok=True)

        query = _QUERY % (celex, limite)
        url = f"{_ENDPOINT}?{urllib.parse.urlencode({'query': query})}"
        try:
            result = await http_client.request(
                "GET", url, source="cellar",
                headers=http_headers({"Accept": "application/sparql-results+json"}),
            )
            data = json.loads(result.text)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("CELLAR query failed", riferimento=riferimento, error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc))

        seen: set[str] = set()
        decisioni: list[Decisione] = []
        for b in data.get("results", {}).get("bindings", []):
            celex_val = b.get("celex", {}).get("value", "")
            if not celex_val or celex_val in seen:
                continue
            seen.add(celex_val)
            decisioni.append(Decisione(
                organo=self.organo,
                numero=celex_val,
                anno=int(celex_val[1:5]) if celex_val[1:5].isdigit() else 0,
                link_kind=LinkKind.CITED,
                url=_EURLEX_DOC + celex_val,
                ecli=b.get("ecli", {}).get("value", ""),
            ))
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        return Decisione(
            organo=self.organo, numero=numero, anno=anno,
            link_kind=LinkKind.CITED, url=_EURLEX_DOC + numero,
        )

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        # CELLAR is a metadata graph, not a full-text index. Free search belongs
        # to the sources that have one; answering with an empty list here is
        # honest, and the registry labels it.
        return SourceResult(organo=self.organo, decisioni=[], ok=True,
                            coverage="ricerca libera non supportata da CELLAR")
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_cellar.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Add and run a live test**

```python
# append to tests/test_case_law_cellar.py
@pytest.mark.live
async def test_cellar_answers_for_the_gdpr():
    result = await CellarAdapter().cerca_per_norma("Regolamento UE 679/2016", limite=5)
    assert result.ok is True
    assert len(result.decisioni) > 0
```

Run: `.venv/bin/python -m pytest tests/test_case_law_cellar.py -m live -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add visualex_api/services/case_law/cellar.py tests/test_case_law_cellar.py
git commit -m "feat(case-law): CGUE decisions from CELLAR's declared citation graph"
```

---

### Task 4: Cassazione adapter

**Files:**
- Create: `visualex_api/services/case_law/italgiure.py`
- Test: `tests/test_case_law_italgiure.py`

**Interfaces:**
- Consumes: `Decisione`, `LinkKind`, `SourceResult` (Task 1); `italgiure_ssl_context()` (Task 2).
- Produces: `ItalgiureAdapter` with `organo = "Cassazione"`, `coverage = "ultimi 5 anni"`. Task 7 instantiates it.

**The request, verified:** fetch `https://www.italgiure.giustizia.it/sncass/` first to obtain the session cookie (the shared `ClientSession` keeps a cookie jar, so no extra work), then POST form-encoded to `/sncass/isapi/hc.dll/sn.solr/sn-collection/select?app.query` with `q`, `rows`, `fl`, `wt=json`. Measured: `kind:"snciv" AND ocr:("art. 2043")` returns 1594.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_italgiure.py
import pytest

from visualex_api.services.case_law.italgiure import ItalgiureAdapter, build_norma_query

SOLR_JSON = """{"response":{"numFound":1594,"docs":[
 {"numdec":"28469","anno":"2024","szdec":"3"},
 {"numdec":"16056","anno":"2023","szdec":"3"}]}}"""


def test_the_query_never_drops_the_code():
    """The source repo's variant builder emits a bare "art. 2043", so a
    decision citing art. 2043 c.p.c. lands in the results for art. 2043 c.c.
    Every variant here keeps the code."""
    q = build_norma_query("art. 2043 c.c.")
    assert '"art. 2043 c.c."' in q or '"2043 c.c."' in q
    assert '"art. 2043"' not in q


def test_the_query_survives_suffixes_past_decies():
    """Normattiva goes well past `decies` — 2409 octiesdecies exists. An
    enumerated suffix list is the bug fixed twice already (gotcha 9)."""
    q = build_norma_query("art. 2409-octiesdecies c.c.")
    assert "2409-octiesdecies" in q


async def test_parses_decisions_and_marks_them_matched(monkeypatch):
    adapter = ItalgiureAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = SOLR_JSON
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", fake_request
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context",
        _fake_ctx,
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")

    assert result.ok is True
    assert [d.numero for d in result.decisioni] == ["28469", "16056"]
    # A string match in the decision text is an inference, not a declaration.
    assert all(d.link_kind.value == "matched" for d in result.decisioni)
    assert result.coverage == "ultimi 5 anni"


async def _fake_ctx():
    return None


async def test_failure_is_reported(monkeypatch):
    adapter = ItalgiureAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("gateway timeout")

    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.http_client.request", boom
    )
    monkeypatch.setattr(
        "visualex_api.services.case_law.italgiure.italgiure_ssl_context", _fake_ctx
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")
    assert result.ok is False
    assert "gateway timeout" in result.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_italgiure.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/italgiure.py
"""Corte di cassazione from the CED's Solr endpoint (SentenzeWeb).

Two things to know before editing.

Coverage is a rolling five years: SentenzeWeb publishes the most recent five,
and decisions age out. An empty answer therefore means "nothing in the last five
years", never "nothing" — which is why `coverage` is filled in.

The link to a norm is a string match over the decision's OCR text, so every row
is `LinkKind.MATCHED`. `build_norma_query` deliberately never emits a bare
"art. N" without the code: the source repo does, and it drops decisions about
art. 2043 c.p.c. into the results for art. 2043 c.c.
"""
from __future__ import annotations

import json
import re

import structlog

from ...tools.tls import italgiure_ssl_context
from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_BASE = "https://www.italgiure.giustizia.it/sncass"
_SELECT = f"{_BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
_DOC = f"{_BASE}/?dsm=0&provvedimento="

# Any alphabetic tail, not an enumerated ordinal list (gotcha 9).
_ART = re.compile(r"(?:art\.?|articolo)\s*(\d+(?:[-\s][a-z]+)?)", re.I)


def build_norma_query(riferimento: str) -> str:
    """A Solr `ocr:` clause whose every variant keeps the act it belongs to."""
    m = _ART.search(riferimento)
    if not m:
        return f'ocr:("{riferimento.strip()}")'
    numero = m.group(1).strip()
    resto = riferimento[m.end():].strip(" ,.;")
    if not resto:
        return f'ocr:("art. {numero}")'
    variants = [f'"art. {numero} {resto}"', f'"articolo {numero} {resto}"',
                f'"{numero} {resto}"']
    return "ocr:(" + " OR ".join(variants) + ")"


class ItalgiureAdapter:
    organo = "Cassazione"
    coverage = "ultimi 5 anni"

    async def _query(self, q: str, limite: int) -> dict:
        ctx = await italgiure_ssl_context()
        # Session cookie first: the endpoint rejects a cold session. The shared
        # ClientSession keeps a cookie jar, so this is the whole handshake.
        await http_client.request("GET", f"{_BASE}/", source="italgiure", ssl=ctx,
                                  headers=http_headers())
        result = await http_client.request(
            "POST", _SELECT, source="italgiure", ssl=ctx,
            data={"q": q, "rows": str(limite), "wt": "json",
                  "fl": "numdec,anno,szdec,datdep", "sort": "score desc"},
            headers=http_headers({"Referer": f"{_BASE}/",
                                  "X-Requested-With": "XMLHttpRequest"}),
        )
        return json.loads(result.text)

    def _to_result(self, data: dict) -> SourceResult:
        decisioni = [
            Decisione(
                organo=self.organo,
                numero=str(doc.get("numdec", "")),
                anno=int(doc.get("anno") or 0),
                sezione=str(doc.get("szdec", "")),
                data=str(doc.get("datdep", "")),
                link_kind=LinkKind.MATCHED,
                url=f"{_DOC}{doc.get('anno','')}-{doc.get('numdec','')}",
            )
            for doc in data.get("response", {}).get("docs", [])
        ]
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        try:
            data = await self._query(build_norma_query(riferimento), limite)
        except Exception as exc:  # noqa: BLE001
            log.warning("Italgiure query failed", riferimento=riferimento, error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)
        return self._to_result(data)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        try:
            data = await self._query(f'ocr:("{testo}")', limite)
        except Exception as exc:  # noqa: BLE001
            log.warning("Italgiure free search failed", testo=testo[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)
        return self._to_result(data)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        try:
            data = await self._query(f'numdec:"{numero}" AND anno:"{anno}"', 1)
        except Exception as exc:  # noqa: BLE001
            log.warning("Italgiure lookup failed", numero=numero, anno=anno, error=str(exc))
            return None
        result = self._to_result(data)
        return result.decisioni[0] if result.decisioni else None
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_italgiure.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Add and run a live test**

```python
# append to tests/test_case_law_italgiure.py
@pytest.mark.live
async def test_italgiure_answers_for_art_2043():
    result = await ItalgiureAdapter().cerca_per_norma("art. 2043 c.c.", limite=3)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0
```

Run: `.venv/bin/python -m pytest tests/test_case_law_italgiure.py -m live -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add visualex_api/services/case_law/italgiure.py tests/test_case_law_italgiure.py
git commit -m "feat(case-law): Corte di cassazione from the CED Solr endpoint"
```

---

### Task 5: CeRDEF adapter — four courts in one source

**Files:**
- Create: `visualex_api/services/case_law/cerdef.py`
- Test: `tests/test_case_law_cerdef.py`

**Interfaces:**
- Consumes: `Decisione`, `LinkKind`, `SourceResult` (Task 1).
- Produces: `CerdefAdapter` with `organo = "CeRDEF"`, `coverage = "Cassazione, Corte cost. e Commissioni tributarie, dal 1979"`. Task 7 instantiates it.

**The request, verified.** POST form-encoded to
`https://def.finanze.it/DocTribFrontend/executeAdvancedGiurisprudenzaSearch.do`
after a GET of the same URL for the session cookie. The hidden fields are what
make it work, and the source repo's client posts none of them:
`ambitoRicerca=G`, `tipoRicerca=RA`, `tipoComplessitaRicerca=avanzata`,
`device=D`, `js_enabled=0`, `ricercaAreaRiservata=false`, `tipo_ord=DATA`,
plus `parole` and `tipoCriterioRicerca` (`0` = all words, `2` = exact phrase).
The response is HTML carrying `var xmlResult = '<?xml …>';`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_cerdef.py
import pytest

from visualex_api.services.case_law.cerdef import CerdefAdapter, _extract_xml

PAGE = (
    "<html><script>var xmlResult = '<?xml version=\\\"1.0\\\"?>"
    "<risultatiRicerca><contatori><contatoreGiurisprudenza>66700"
    "</contatoreGiurisprudenza></contatori><risultati>"
    "<Provvedimento idProvvedimento=\\\"{ABC}\\\">"
    "<estremi link=\\\"true\\\">Sentenza del 18\\/07\\/2026 n. 23488 - "
    "Corte di Cassazione - Sezione\\/Collegio Sezioni unite</estremi>"
    "</Provvedimento></risultati></risultatiRicerca>';</script></html>"
)


def test_extracts_the_embedded_xml():
    xml = _extract_xml(PAGE)
    assert "contatoreGiurisprudenza" in xml
    assert "/" in xml  # escaped slashes are unescaped


async def test_parses_the_issuing_court_out_of_the_estremi(monkeypatch):
    """CeRDEF is not one court: a single answer mixes Cassazione, Corte
    costituzionale and the tax commissions, so the body has to be read off
    each row rather than assumed."""
    adapter = CerdefAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    result = await adapter.cerca_per_norma("articolo 2043")

    assert result.ok is True
    d = result.decisioni[0]
    assert d.organo == "Corte di Cassazione"
    assert d.numero == "23488"
    assert d.anno == 2026
    assert d.link_kind.value == "matched"


async def test_failure_is_reported(monkeypatch):
    adapter = CerdefAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("service unavailable")

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("articolo 2043")
    assert result.ok is False
    assert "service unavailable" in result.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_cerdef.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/cerdef.py
"""Giurisprudenza from the MEF's Documentazione economica e finanziaria.

Not the tax court. One search returns Corte di cassazione, Corte costituzionale
and the Commissioni tributarie together, and it reaches back to at least 1979 —
seventy years more than Italgiure's rolling five. The issuing body is read off
each row, never assumed.

Its link to a norm is the weakest of the four: a literal phrase match. Asking
for "articolo 2043" finds decisions; asking for "art. 36-bis" finds none,
because hyphenated ordinals break the index. Callers get `LinkKind.MATCHED` and
should not read an empty answer as "no case law".

The hidden form fields below are load-bearing. Sending only the visible ones
returns "errore sconosciuto"; the source repo's client posts field names this
form dropped.
"""
from __future__ import annotations

import re

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_EP = "https://def.finanze.it/DocTribFrontend/executeAdvancedGiurisprudenzaSearch.do"

_XML_VAR = re.compile(r"var xmlResult = '(.*?)';", re.S)
_ESTREMI = re.compile(r"<estremi[^>]*>(.*?)</estremi>", re.S)
# "Sentenza del 18/07/2026 n. 23488 - Corte di Cassazione - Sezione/Collegio 3"
_ROW = re.compile(
    r"^(?P<tipo>\w+)\s+del\s+(?P<data>\d{2}/\d{2}/(?P<anno>\d{4}))\s+"
    r"n\.\s*(?P<numero>[\w-]+)\s*-\s*(?P<organo>[^-]+?)(?:\s*-\s*Sezione/Collegio\s*(?P<sez>.+))?$"
)


def _extract_xml(page: str) -> str:
    m = _XML_VAR.search(page)
    if not m:
        return ""
    return m.group(1).replace("\\/", "/").replace('\\"', '"').replace("\\'", "'")


class CerdefAdapter:
    organo = "CeRDEF"
    coverage = "Cassazione, Corte cost. e Commissioni tributarie, dal 1979"

    async def _search(self, parole: str, criterio: str, limite: int) -> SourceResult:
        form = {
            "js_enabled": "0", "tipoComplessitaRicerca": "avanzata",
            "ricercaAreaRiservata": "false", "tipoRicerca": "RA", "device": "D",
            "ambitoRicerca": "G", "parole": parole,
            "tipoCriterioRicerca": criterio, "tipo_ord": "DATA", "numero": "",
            "giornoDataEmissioneDa": "", "meseDataEmissioneDa": "",
            "annoDataEmissioneDa": "", "dataEmissioneDa": "",
            "giornoDataEmissioneA": "", "meseDataEmissioneA": "",
            "annoDataEmissioneA": "", "dataEmissioneA": "",
        }
        try:
            await http_client.request("GET", _EP, source="cerdef",
                                      headers=http_headers())
            result = await http_client.request(
                "POST", _EP, source="cerdef", data=form,
                headers=http_headers({"Referer": _EP}),
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("CeRDEF search failed", parole=parole[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

        xml = _extract_xml(result.text)
        decisioni: list[Decisione] = []
        for estremi in _ESTREMI.findall(xml)[:limite]:
            testo = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", estremi)).strip()
            m = _ROW.match(testo)
            if not m:
                continue
            decisioni.append(Decisione(
                organo=m.group("organo").strip(),
                numero=m.group("numero"),
                anno=int(m.group("anno")),
                sezione=(m.group("sez") or "").strip(),
                data=m.group("data"),
                link_kind=LinkKind.MATCHED,
                url=_EP,
                estratto=testo,
            ))
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        # Exact phrase: the index matches literally, so "tutte le parole" would
        # return decisions containing the words anywhere, which is noise.
        return await self._search(riferimento, criterio="2", limite=limite)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        return await self._search(testo, criterio="0", limite=limite)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        result = await self._search(f"n. {numero}", criterio="2", limite=20)
        for d in result.decisioni:
            if d.numero == numero and d.anno == anno:
                return d
        return None
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_cerdef.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Add and run a live test**

```python
# append to tests/test_case_law_cerdef.py
@pytest.mark.live
async def test_cerdef_answers_and_mixes_courts():
    result = await CerdefAdapter().cerca_libera("accertamento", limite=10)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0
```

Run: `.venv/bin/python -m pytest tests/test_case_law_cerdef.py -m live -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add visualex_api/services/case_law/cerdef.py tests/test_case_law_cerdef.py
git commit -m "feat(case-law): CeRDEF, four courts and seventy years in one source"
```

---

### Task 6: TAR and Consiglio di Stato adapter

**Files:**
- Create: `visualex_api/services/case_law/giustizia_amm.py`
- Test: `tests/test_case_law_giustizia_amm.py`

**Interfaces:**
- Consumes: `Decisione`, `LinkKind`, `SourceResult` (Task 1).
- Produces: `GiustiziaAmmAdapter` with `organo = "Giustizia amministrativa"`, `coverage = "Consiglio di Stato, CGA e 29 TAR"`. Task 7 instantiates it.

**The request, verified.** GET
`https://www.giustizia-amministrativa.it/web/guest/dcsnprr`, scrape the portlet
id and the `p_auth` token from the returned HTML, then POST form-encoded to the
same path with the query string
`?p_p_id=<portlet>&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&_<portlet>_javax.portlet.action=search&p_auth=<token>`.
Omitting `javax.portlet.action`, `p_p_mode` or `p_auth` returns 403. Every form
field the portlet declares must be present in the body.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_giustizia_amm.py
import pytest

from visualex_api.services.case_law.giustizia_amm import (
    GiustiziaAmmAdapter, _scrape_session,
)

FORM_PAGE = (
    '<html><a href="/web/guest/dcsnprr?p_auth=HkY3UQTe">x</a>'
    '<div id="_decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_XKc17mrB8J10_x">'
    "</div></html>"
)
RESULTS_PAGE = (
    '<html><a href="https://mdp.giustizia-amministrativa.it/visualizza/'
    '?nrg=202614447&nomeFile=202614447_20.html&schema=cds">Sentenza n. 4447/2026</a>'
    "</html>"
)


def test_scrapes_the_portlet_id_and_the_csrf_token():
    """Both are session-bound. Hardcoding either is how this breaks silently
    the next time the portal is reorganised."""
    portlet, auth = _scrape_session(FORM_PAGE)
    assert portlet.endswith("INSTANCE_XKc17mrB8J10")
    assert auth == "HkY3UQTe"


def test_a_page_without_a_token_raises_rather_than_posting_blind():
    with pytest.raises(ValueError):
        _scrape_session("<html>no token here</html>")


async def test_parses_provvedimenti(monkeypatch):
    adapter = GiustiziaAmmAdapter()
    pages = [FORM_PAGE, RESULTS_PAGE]

    async def fake_request(method, url, **kwargs):
        class R:
            text = pages.pop(0)
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.giustizia_amm.http_client.request",
        fake_request,
    )
    result = await adapter.cerca_per_norma("risarcimento danno")

    assert result.ok is True
    assert len(result.decisioni) == 1
    assert result.decisioni[0].numero == "202614447"
    assert result.decisioni[0].link_kind.value == "matched"


async def test_failure_is_reported(monkeypatch):
    adapter = GiustiziaAmmAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("403 forbidden")

    monkeypatch.setattr(
        "visualex_api.services.case_law.giustizia_amm.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("risarcimento danno")
    assert result.ok is False
    assert "403" in result.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_giustizia_amm.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/giustizia_amm.py
"""Consiglio di Stato, CGA Sicilia and the 29 TAR, from the public search.

Liferay. Three things a naive POST omits and the portal answers 403 without:
`javax.portlet.action=search`, `p_p_mode=view`, and `p_auth` — a session-bound
CSRF token. The portlet id is session-bound too. Both are scraped from the
search page on every call: the portal was reorganised in 2026 and the id in the
source repo is only still valid by luck. Never hardcode either.
"""
from __future__ import annotations

import re
import urllib.parse

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_BASE = "https://www.giustizia-amministrativa.it"
_PATH = "/web/guest/dcsnprr"

_PORTLET = re.compile(r"(decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_[A-Za-z0-9]+)")
_AUTH = re.compile(r"p_auth=([A-Za-z0-9]+)")
_PROVV = re.compile(r"nrg=(\d{4,})[^\"']*?nomeFile=([^&\"']+)")


def _scrape_session(html: str) -> tuple[str, str]:
    portlet = _PORTLET.search(html)
    auth = _AUTH.search(html)
    if not portlet or not auth:
        raise ValueError("portlet id or p_auth token not present in the search page")
    return portlet.group(1), auth.group(1)


class GiustiziaAmmAdapter:
    organo = "Giustizia amministrativa"
    coverage = "Consiglio di Stato, CGA e 29 TAR"

    async def _search(self, testo: str, limite: int) -> SourceResult:
        try:
            page = await http_client.request("GET", _BASE + _PATH, source="giustizia-amm",
                                             headers=http_headers())
            portlet, auth = _scrape_session(page.text)
            pre = f"_{portlet}_"
            url = (f"{_BASE}{_PATH}?" + urllib.parse.urlencode({
                "p_p_id": portlet, "p_p_lifecycle": "1", "p_p_state": "normal",
                "p_p_mode": "view", f"{pre}javax.portlet.action": "search",
                "p_auth": auth,
            }))
            result = await http_client.request(
                "POST", url, source="giustizia-amm",
                headers=http_headers({"Referer": _BASE + _PATH}),
                data={
                    pre + "searchtextProvvedimenti": testo,
                    pre + "searchAllWords": "", pre + "searchAnyWords": "",
                    pre + "searchNotWords": "", pre + "searchPhrase": "",
                    pre + "pageSize": str(limite),
                    pre + "TipoProvvedimentoItem": "", pre + "sedeProvvedimenti": "",
                    pre + "searchModeRadio": "provv", pre + "DataYearItem": "",
                    pre + "numeroProvvedimenti": "", pre + "DataNrgItem": "",
                    pre + "numeroNrg": "", pre + "isAdvancedSearch": "false",
                    pre + "asSearchMode": "provv",
                },
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Giustizia amministrativa search failed",
                        testo=testo[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

        seen: set[str] = set()
        decisioni: list[Decisione] = []
        for nrg, nome in _PROVV.findall(result.text):
            if nrg in seen:
                continue
            seen.add(nrg)
            decisioni.append(Decisione(
                organo=self.organo, numero=nrg,
                anno=int(nrg[:4]) if nrg[:4].isdigit() else 0,
                link_kind=LinkKind.MATCHED,
                url=("https://mdp.giustizia-amministrativa.it/visualizza/"
                     f"?nrg={nrg}&nomeFile={nome}&subDir=Provvedimenti"),
            ))
            if len(decisioni) >= limite:
                break
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        return await self._search(riferimento, limite)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        return await self._search(testo, limite)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        result = await self._search(f"{numero}", limite=20)
        for d in result.decisioni:
            if d.numero == numero:
                return d
        return None
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_giustizia_amm.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Add and run a live test**

```python
# append to tests/test_case_law_giustizia_amm.py
@pytest.mark.live
async def test_giustizia_amm_answers():
    result = await GiustiziaAmmAdapter().cerca_libera("risarcimento danno", limite=5)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0
```

Run: `.venv/bin/python -m pytest tests/test_case_law_giustizia_amm.py -m live -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add visualex_api/services/case_law/giustizia_amm.py tests/test_case_law_giustizia_amm.py
git commit -m "feat(case-law): Consiglio di Stato and the TAR from the public search"
```

---

### Task 7: The registry — fan out, isolate failures

**Files:**
- Create: `visualex_api/services/case_law/registry.py`
- Modify: `visualex_api/services/case_law/__init__.py`
- Test: `tests/test_case_law_registry.py`

**Interfaces:**
- Consumes: all four adapters (Tasks 3-6), `SourceResult` (Task 1).
- Produces: `async def cerca_per_norma(riferimento, limite) -> list[SourceResult]`, `async def cerca_libera(testo, limite) -> list[SourceResult]`, `async def leggi(organo, numero, anno) -> Decisione | None`, `ADAPTERS: dict[str, CaseLawAdapter]`. Task 8 calls these.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_registry.py
import pytest

from visualex_api.services.case_law import registry
from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


class _Adapter:
    def __init__(self, organo, ok=True, boom=False):
        self.organo, self._ok, self._boom = organo, ok, boom
        self.coverage = ""

    async def cerca_per_norma(self, riferimento, limite=10):
        if self._boom:
            raise RuntimeError("adapter exploded")
        return SourceResult(
            organo=self.organo, ok=self._ok,
            decisioni=[Decisione(organo=self.organo, numero="1", anno=2024,
                                 link_kind=LinkKind.MATCHED, url="u")],
        )

    async def cerca_libera(self, testo, limite=10):
        return await self.cerca_per_norma(testo, limite)

    async def leggi(self, numero, anno):
        return None


async def test_one_dead_source_does_not_empty_the_others(monkeypatch):
    """The whole point of returning per-source results: a source that is down
    must cost its own section, not the panel."""
    monkeypatch.setattr(registry, "ADAPTERS", {
        "vivo": _Adapter("vivo"),
        "morto": _Adapter("morto", boom=True),
    })
    results = await registry.cerca_per_norma("art. 2043 c.c.")

    per_organo = {r.organo: r for r in results}
    assert per_organo["vivo"].ok is True
    assert len(per_organo["vivo"].decisioni) == 1
    assert per_organo["morto"].ok is False
    assert "adapter exploded" in per_organo["morto"].error


async def test_every_source_is_represented_even_when_empty(monkeypatch):
    """A source missing from the response is indistinguishable from a source
    with nothing to say. Both must appear."""
    monkeypatch.setattr(registry, "ADAPTERS", {
        "a": _Adapter("a"), "b": _Adapter("b", boom=True),
    })
    results = await registry.cerca_per_norma("x")
    assert {r.organo for r in results} == {"a", "b"}


async def test_lookup_targets_one_source(monkeypatch):
    monkeypatch.setattr(registry, "ADAPTERS", {"a": _Adapter("a")})
    assert await registry.leggi("a", "1", 2024) is None
    with pytest.raises(KeyError):
        await registry.leggi("inesistente", "1", 2024)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_registry.py -q`
Expected: FAIL with `ImportError: cannot import name 'registry'`

- [ ] **Step 3: Write minimal implementation**

```python
# visualex_api/services/case_law/registry.py
"""Fans a question out to every source and keeps their failures apart.

`asyncio.gather(..., return_exceptions=True)`: one source raising must not lose
the others' answers, and a source that failed comes back as `ok=False` rather
than as an absence. A missing section and an empty section look identical to a
reader, and only one of them means "there is nothing here".
"""
from __future__ import annotations

import asyncio

import structlog

from .base import CaseLawAdapter, Decisione, SourceResult
from .cellar import CellarAdapter
from .cerdef import CerdefAdapter
from .giustizia_amm import GiustiziaAmmAdapter
from .italgiure import ItalgiureAdapter

log = structlog.get_logger()

ADAPTERS: dict[str, CaseLawAdapter] = {
    "cgue": CellarAdapter(),
    "cassazione": ItalgiureAdapter(),
    "cerdef": CerdefAdapter(),
    "giustizia-amm": GiustiziaAmmAdapter(),
}


async def _fan_out(method: str, *args, limite: int) -> list[SourceResult]:
    adapters = list(ADAPTERS.values())
    outcomes = await asyncio.gather(
        *(getattr(a, method)(*args, limite=limite) for a in adapters),
        return_exceptions=True,
    )
    results: list[SourceResult] = []
    for adapter, outcome in zip(adapters, outcomes):
        if isinstance(outcome, BaseException):
            log.warning("Case-law adapter raised", organo=adapter.organo,
                        error=str(outcome))
            results.append(SourceResult(
                organo=adapter.organo, ok=False, error=str(outcome),
                coverage=getattr(adapter, "coverage", ""),
            ))
        else:
            results.append(outcome)
    return results


async def cerca_per_norma(riferimento: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_per_norma", riferimento, limite=limite)


async def cerca_libera(testo: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_libera", testo, limite=limite)


async def leggi(organo: str, numero: str, anno: int) -> Decisione | None:
    """Raises KeyError for an unknown source — the caller turns that into a 400."""
    return await ADAPTERS[organo].leggi(numero, anno)
```

Then extend `visualex_api/services/case_law/__init__.py`:

```python
from . import registry
from .base import CaseLawAdapter, Decisione, LinkKind, SourceResult

__all__ = ["CaseLawAdapter", "Decisione", "LinkKind", "SourceResult", "registry"]
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_registry.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add visualex_api/services/case_law/registry.py visualex_api/services/case_law/__init__.py tests/test_case_law_registry.py
git commit -m "feat(case-law): fan out to every source, isolate their failures"
```

---

### Task 8: HTTP endpoints

**Files:**
- Modify: `app.py` (add three routes in `NormaController._setup_routes()` and three handlers)
- Modify: `CLAUDE.md` (endpoint list)
- Test: `tests/test_case_law_endpoints.py`

**Interfaces:**
- Consumes: `registry.cerca_per_norma`, `registry.cerca_libera`, `registry.leggi` (Task 7).
- Produces: `POST /fetch_case_law`, `POST /search_case_law`, `POST /fetch_decision`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_case_law_endpoints.py
import json

import pytest

from app import NormaController
from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


@pytest.fixture
def client(monkeypatch):
    async def fake_cerca(riferimento, limite=10):
        return [
            SourceResult(organo="CGUE", ok=True, decisioni=[
                Decisione(organo="CGUE", numero="62017CJ0496", anno=2019,
                          link_kind=LinkKind.CITED, url="u")]),
            SourceResult(organo="Cassazione", ok=False, error="timeout",
                         coverage="ultimi 5 anni"),
        ]

    monkeypatch.setattr("app.case_law_registry.cerca_per_norma", fake_cerca)
    return NormaController().app.test_client()


async def test_returns_every_source_including_the_failed_one(client):
    resp = await client.post("/fetch_case_law", json={"riferimento": "art. 5 GDPR"})
    assert resp.status_code == 200
    body = await resp.get_json()

    per_organo = {s["organo"]: s for s in body["fonti"]}
    assert per_organo["CGUE"]["ok"] is True
    assert per_organo["CGUE"]["decisioni"][0]["link_kind"] == "cited"
    # The dead source is present and says so, rather than being absent.
    assert per_organo["Cassazione"]["ok"] is False
    assert per_organo["Cassazione"]["coverage"] == "ultimi 5 anni"


async def test_a_missing_riferimento_is_a_400(client):
    resp = await client.post("/fetch_case_law", json={})
    assert resp.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_case_law_endpoints.py -q`
Expected: FAIL with 404 (route not registered)

- [ ] **Step 3: Register the routes**

In `app.py`, next to the other imports:

```python
from visualex_api.services.case_law import registry as case_law_registry
```

In `NormaController._setup_routes()`, beside the existing `add_url_rule` calls:

```python
        self.app.add_url_rule('/fetch_case_law', view_func=self.fetch_case_law, methods=['POST'])
        self.app.add_url_rule('/search_case_law', view_func=self.search_case_law, methods=['POST'])
        self.app.add_url_rule('/fetch_decision', view_func=self.fetch_decision, methods=['POST'])
```

- [ ] **Step 4: Write the handlers**

```python
    async def fetch_case_law(self):
        """Decisions bearing on a norm, one section per source.

        Always answers 200 when the request is well formed: a source that is
        down is reported inside its own section, because an error status here
        would hide the sources that did answer.
        """
        data = await request.get_json() or {}
        riferimento = (data.get('riferimento') or '').strip()
        if not riferimento:
            return self._error_response(
                ValidationError("Campo obbligatorio mancante: riferimento"),
                'fetch_case_law')
        limite = min(int(data.get('limite') or 10), 50)
        fonti = await case_law_registry.cerca_per_norma(riferimento, limite)
        return jsonify({'fonti': [f.to_dict() for f in fonti]})

    async def search_case_law(self):
        data = await request.get_json() or {}
        testo = (data.get('testo') or '').strip()
        if not testo:
            return self._error_response(
                ValidationError("Campo obbligatorio mancante: testo"),
                'search_case_law')
        limite = min(int(data.get('limite') or 10), 50)
        fonti = await case_law_registry.cerca_libera(testo, limite)
        return jsonify({'fonti': [f.to_dict() for f in fonti]})

    async def fetch_decision(self):
        data = await request.get_json() or {}
        organo = (data.get('organo') or '').strip()
        numero = (data.get('numero') or '').strip()
        anno = data.get('anno')
        if not organo or not numero or not anno:
            return self._error_response(
                ValidationError("Campi obbligatori: organo, numero, anno"),
                'fetch_decision')
        try:
            decisione = await case_law_registry.leggi(organo, numero, int(anno))
        except KeyError:
            return self._error_response(
                ValidationError(f"Organo non riconosciuto: {organo}"), 'fetch_decision')
        if decisione is None:
            return self._error_response(
                ResourceNotFoundError(f"Decisione {numero}/{anno} non trovata in {organo}"),
                'fetch_decision')
        return jsonify(decisione.to_dict())
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_case_law_endpoints.py -q`
Expected: PASS (2 passed)

- [ ] **Step 6: Run the whole suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS, no regressions.

- [ ] **Step 7: Document the endpoints**

In `CLAUDE.md`, under "Key API Endpoints", after the `/fetch_alias_catalog` line:

```markdown
- `/fetch_case_law` — decisions bearing on a norm, grouped by source. Always 200
  on a well-formed request: a source that is down reports `ok:false` inside its
  own section, so one dead source never hides the ones that answered
- `/search_case_law` — free-text search across the same sources
- `/fetch_decision` — one decision by `organo`, `numero`, `anno`
```

- [ ] **Step 8: Verify by hand**

```bash
.venv/bin/python app.py &
curl -s -X POST http://localhost:5000/fetch_case_law -H 'Content-Type: application/json' -d '{"riferimento":"Regolamento UE 679/2016"}' | head -c 400
```

Expected: a `fonti` array with four sections, CGUE carrying `"link_kind":"cited"`.

- [ ] **Step 9: Commit**

```bash
git add app.py CLAUDE.md tests/test_case_law_endpoints.py
git commit -m "feat(api): expose case law over HTTP, one section per source"
```

---

## After this plan

The reading panel, the search page and the lookup UI are a separate plan, written
once these endpoints answer. Corte costituzionale joins when a live per-decision
route is found (spec D9).
