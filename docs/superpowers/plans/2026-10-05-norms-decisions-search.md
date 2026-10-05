# Norms and decisions in one search space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search space where a lawyer finds a norm or a decision from the same box, opens a decision in a tab of its own beside the article it applies, follows links both ways, annotates decisions, and finds them again in the Cronologia.

**Architecture:** One new Python route (`/search_decisions`) asks Italgiure for the decisions that mention an article or a topic, politely and cached. On the web, a decision becomes a kind of workspace tab (`WorkspaceTab.view`), the `/sentenze/…` address opens that tab inside the search space, the article gains a «Giurisprudenza» section, and the decision's text is rendered as escaped HTML by a renderer held to the same contract as `article_text` (root rule 23), which makes notes, highlights and norm links possible. The history gains a nullable `decision_key`.

**Tech Stack:** Python 3 / Quart / aiohttp / pytest (services/visualex); React 19 / TypeScript / Zustand + Immer / Vitest / Testing Library (apps/web); Express / Prisma / PostgreSQL / Vitest (apps/server).

**Spec:** `docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md`

## Global Constraints

- UI copy in Italian; code, comments, commits and docs in English.
- Labels of decisions come only from `apps/web/src/utils/decisionLinks.ts` (spec N13); the short form is the golden file's `labels.short` (`conventions/sources/golden.json`).
- A decision's text, minus `\n`, is never changed by a reader from PR 1 on (spec N10, §8.5). Renderers wrap characters; they never add, drop or change one.
- Every scraping route goes through `legalFetch` on the client, the Vite proxy list and the ingress `@legal` path list (ADR-001, gotcha 30).
- Italgiure: the decision reader's own `decisions_http_client`, honest User-Agent, verified TLS, one Solr request per page, 24 h cache, at most 10 pages per query, nothing fetched without a user's gesture (spec §5.3).
- Text from Italgiure is never rendered as HTML on the client (spec §5.1, Security).
- Topic words: letters, digits, spaces, `'` and `-` only; at most 80 characters; sent as one quoted phrase (spec §5.4).
- Prisma: one hand-written migration dated after every migration on `develop` (today the last is `20261005120000_add_trash_entries`), announced to the orchestrator before it is written; never `prisma migrate dev` or `reset`.
- `npm --prefix apps/server test` only after the orchestrator's go (shared test database).
- Branches from `origin/develop` in a worktree, one per PR; never switch branches in the main checkout. Merge commit title `merge: <branch> — <what changes>`, at green CI.
- Nothing private in the repository (no vault text, no personal paths, no infrastructure addresses).
- Shared utilities first (`apps/web/CLAUDE.md`, «Shared utilities»): `resolveAnchors`, `getSelectionAnchor`, `wrapCitationsInHtml`, `ArticleBody`, `legalFetch`, `useIsDesktop`, `readingBackStack`.

## Open owner questions this plan assumes

The spec's «Questions for the owner» are answered here with the recommended option. If the owner answers otherwise, amend the named task before it runs.

| Question | Assumed | Tasks it changes |
|---|---|---|
| 1. «In una propria tab» | Reading 1: a workspace tab placed beside the article's | 8, 9 |
| 2. The glossary | Glossary terms as the way into a topic, narrowed to the article, «Solo il tema» | 13 |
| 3. Excerpts with personal data | Nothing beyond §8.4's box | 16 |
| 4. Annotations in environments | They travel, labelled | 17 |

## Review Focus

1. **A decision whose text the source withdrew after the user annotated it** — the tab must show the notice and list every note and highlight in «Non ritrovate nel testo attuale», never an empty page. Test in Task 16.
2. **A topic typed with Solr syntax** (`ocr:*`, `kind:"snpen" OR x`, `{!lucene}`, `\`, `"`) — the route must search those words as words, or refuse, never run them. Test in Task 2.
3. **The same decision opened twice** (palette, then a chip, then a reload with the tab persisted) — one tab, focused, never two; a reload refetches by identity. Test in Task 8.
4. **A `/sentenze/…` link opened while logged out** — after the login the decision's tab opens; the address is not lost and the queue is drained once under StrictMode. Test in Task 10.
5. **A highlight dragged across two blocks or two paragraphs of a decision** — stored with the projection's offset, rendered back in both, and the HTML stays well-formed. Test in Task 14.

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

### Task 2: How an article and a topic become a Solr query

**Files:**
- Create: `services/visualex/visualex_api/services/decisions/search.py`
- Test: `services/visualex/tests/test_decisions_search_query.py`

**Interfaces:**
- Consumes: `visualex_api/tools/article_suffixes.py` (`ARTICLE_SUFFIXES` or the module's table; read it first and use its exported name).
- Produces:
  - `class UnsupportedAct(ValueError)`
  - `def article_clause(norma: dict) -> tuple[str, str | None]` — the Solr clause for the article and the default archive (`"civile"`, `"penale"` or `None`); raises `UnsupportedAct`.
  - `def topic_clause(raw: str) -> str` — `ocr:"<words>"`; raises `ValueError` when nothing is left.
  - `def build_query(article: str | None, topic: str | None, archivio: str | None) -> str`
  - `PROXIMITY: int` (Task 1's value)

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
#: positions (fixed by plan Task 1, 2026-10-05).
PROXIMITY = 8

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

- [ ] **Step 5: Commit**

```bash
git add services/visualex/visualex_api/services/decisions/search.py services/visualex/tests/test_decisions_search_query.py
git commit -m "feat(api): phrase an article and a topic as an Italgiure query, words only"
```

### Task 3: The reader searches, once per session, and returns fragments as ranges

**Files:**
- Modify: `services/visualex/visualex_api/services/decisions/italgiure.py`
- Test: `services/visualex/tests/test_decisions_italgiure_search.py`

**Interfaces:**
- Consumes: Task 1's fixtures; `KINDS` from `search.py`.
- Produces:
  - `@dataclass(frozen=True) class SearchHit: identita: Identity; attributi: dict; frammento: dict` (`{"testo": str, "evidenziati": list[list[int]]}`)
  - `@dataclass(frozen=True) class SearchPage: totale: int; decisioni: list[SearchHit]`
  - `async def ItalgiureReader.search(self, q: str, pagina: int, rows: int = 20) -> SearchPage`
  - `def fragment_ranges(snippet: str) -> dict`
  - The homepage GET runs once per reader instance and again only after a non-Solr answer.

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
    frammento: dict


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

    async def search(self, q: str, pagina: int, rows: int = 20) -> SearchPage:
        data = await self._select({
            "q": q, "rows": str(rows), "start": str((pagina - 1) * rows), "fl": SEARCH_FIELDS,
            "sort": "pd desc", "hl": "true", "hl.fl": "ocr", "hl.snippets": "1",
            "hl.fragsize": "200"})
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
            snippet = (highlights.get(_scalar(doc.get("id"))) or {}).get("ocr") or [""]
            hits.append(SearchHit(summary.identita, summary.attributes_dict(),
                                  fragment_ranges(snippet[0])))
        return SearchPage(int(data["response"].get("numFound") or 0), hits)
```

Before writing `summary.attributes_dict()`, read `model.py`'s `Decision.to_dict()` and use the part of it that writes `attributi` (extract a method `attributes_dict()` there if none exists, covered by the existing `test_decisions_model.py`). `to_decision` with empty `ocr` returns a decision without text and logs «Italgiure record without text»: pass a flag or call a smaller helper that builds identity and attributes only, so the search does not log a warning per row. Name it `to_summary(doc, archivio) -> tuple[Identity, dict]` and use it here; `to_decision` calls it too, so both read the record the same way.

Existing tests of `lookup` and `archive_start` must stay green: the session flag changes the number of GETs per lookup from one per call to one per reader. `test_decisions_italgiure.py`'s `_serve` answers any GET, so the tests that count calls (`calls`) must be read: update only assertions that counted a GET per lookup, and say so in the commit.

- [ ] **Step 4: Run the decision tests**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_italgiure_search.py tests/test_decisions_italgiure.py tests/test_decisions_resolver.py tests/test_decisions_model.py -q)`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/visualex/visualex_api/services/decisions/ services/visualex/tests/
git commit -m "feat(api): search Italgiure by text, sorted by deposit, fragments as ranges, one session per reader"
```

### Task 4: The route `/search_decisions`, its cache and its gate

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
- Consumes: Task 2 (`article_clause`, `topic_clause`, `build_query`, `UnsupportedAct`), Task 3 (`ItalgiureReader.search`, `SearchPage`).
- Produces: `POST /search_decisions`, body `{norma?, tema?, archivio?, pagina?}`, answers:
  - `{"esito": "risultati", "totale": int, "pagina": int, "archivio": "civile"|"penale"|null, "archivio_dal": "YYYY-MM-DD"|null, "decisioni": [{"identita": {...}, "attributi": {...}, "frammento": {"testo": str, "evidenziati": [[int,int]]}}]}` 200
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
                {"sezione": "L", "tipo": "ordinanza", "data_deposito": "2026-09-01"},
                {"testo": "ex art. 2043 c.c.", "evidenziati": [[3, 17]]})


class FakeSearcher:
    def __init__(self, page=None, error=None):
        self.page, self.error, self.queries = page, error, []

    async def search(self, q, pagina, rows=20):
        self.queries.append((q, pagina))
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
    assert s.queries[0][0].startswith('kind:"snciv" AND (')


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
from .search import UnsupportedAct, article_clause, build_query, topic_clause

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
    return errors, body


async def search_decisions(body: Any) -> tuple[dict, int]:
    errors, body = _errors(body)
    if errors:
        return {"esito": "richiesta_non_valida", "errori": errors}, 400
    article, archivio_default = None, None
    if body.get("norma") is not None:
        try:
            article, archivio_default = article_clause(body["norma"])
        except UnsupportedAct:
            return {"esito": "non_supportata"}, 200
    topic = None
    if body.get("tema") is not None:
        try:
            topic = topic_clause(body["tema"])
        except ValueError:
            return {"esito": "richiesta_non_valida", "errori": {"tema": "Il tema non contiene parole"}}, 400
    archivio = body.get("archivio") or archivio_default
    pagina = body.get("pagina", 1)
    q = build_query(article, topic, archivio)
    key = hashlib.sha256(json.dumps([q, pagina]).encode()).hexdigest()
    cache = get_cache()
    cached = await cache.get(key)
    if cached is not None:
        return cached, 200
    try:
        page = await get_searcher().search(q, pagina)
    except _SOURCE_ERRORS as exc:
        log.warning("Decision search failed", error=str(exc), error_type=type(exc).__name__)
        return {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}, 503
    answer = {
        "esito": "risultati", "totale": page.totale, "pagina": pagina, "archivio": archivio,
        "archivio_dal": await archive_start(archivio or "civile"),
        "decisioni": [{"identita": h.identita.to_dict(), "attributi": h.attributi,
                       "frammento": h.frammento} for h in page.decisioni],
    }
    await cache.set(key, answer)
    return answer, 200
```

Add to `Resolver` a public `archive_start_of(archivio)` that returns `await self._start(archivio)` (the cached start) and make sure `get_resolver().italgiure` is the reader instance (read `get_resolver` and the constructor first; if the reader is stored under another name, use it). In `cache_manager.py` add `"decisions_search": _create_cache("decisions_search", ttl=24 * 3600),` beside the three decision namespaces, and add `"decisions_search"` to the sweep loop in `resolver.py` (`for namespace in (FOUND_NS, ABSENT_NS, PENDING_NS, SEARCH_NS)`, with `SEARCH_NS = "decisions_search"` defined next to the others and imported by `search_route.py` instead of the literal).

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
git commit -m "feat(api): POST /search_decisions — decisions mentioning an article or a topic, cached, behind the login"
```

### Task 5: A decision's text is frozen

**Files:**
- Create: `services/visualex/tests/test_decisions_text_frozen.py`
- Create: `services/visualex/tests/fixtures/decisions/frozen_projections.json`
- Modify: `services/visualex/visualex_api/services/decisions/resolver.py` (the two «raise the version» comments)
- Modify: `CLAUDE.md` (root rule 23), `services/visualex/CLAUDE.md` (the decisions section)

**Interfaces:**
- Consumes: the existing fixtures `italgiure_snciv_10787_2024.json`, `italgiure_snpen_10787_2024.json`, `corte_cost_2014_sample.json`; `to_decision` and the Corte costituzionale reader's record → decision function (read `corte_cost.py` for its name).
- Produces: `projection(testo: dict) -> str` in the test module (blocks epigrafe, motivazione, dispositivo concatenated, `\n` removed) — the web's `decisionProjection` (Task 14) mirrors it.

- [ ] **Step 1: Write the test that records, then freezes**

```python
"""A decision's text is a data contract (design 2026-10-05 §8.5, root rule 23): anchors are
pinned by offset and text over the projection — the blocks in reading order, concatenated, with
every \n removed. A reader may add or move \n and move a boundary between blocks; it may never
add, drop or change another character. The golden projections were recorded on 2026-10-05 from
the fixtures, by the readers as merged then."""
import json
import pathlib

import pytest

from visualex_api.services.decisions.corte_cost import record_to_decision  # read the module: use its real name
from visualex_api.services.decisions.italgiure import to_decision

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


@pytest.mark.parametrize("name, archivio", [
    ("italgiure_snciv_10787_2024.json", "civile"),
    ("italgiure_snpen_10787_2024.json", "penale"),
])
def test_italgiure_text_is_frozen(name, archivio):
    assert projection(_italgiure(name, archivio)) == GOLDEN[name]


@pytest.mark.parametrize("key, record", _corte_cost_cases())
def test_corte_cost_text_is_frozen(key, record):
    assert projection(record_to_decision(record).testo) == GOLDEN[key]
```

- [ ] **Step 2: Record the golden file once** with a scratch script that imports the same functions and writes `frozen_projections.json` (`{name: projection}`), from the tree as merged on `develop` before this task — check `git diff origin/develop -- services/visualex/visualex_api/services/decisions/` shows only Task 3's `search` additions and the `to_summary` extraction, and that `to_decision`'s output is unchanged (`test_decisions_italgiure.py` green). Do not record from a tree where a reader's text changed.

- [ ] **Step 3: Run it**

Run: `(cd services/visualex && <python> -m pytest tests/test_decisions_text_frozen.py -q)`
Expected: pass. Then prove it bites: temporarily change one character in `paragraphs` (e.g. insert `" "` instead of `"\n\n"`), run again, expect FAIL, revert.

- [ ] **Step 4: Write the contract down**
  - Root `CLAUDE.md`, rule 23: after the sentence about `articleRender.test.ts`, add: «Decision texts are held to the same contract since 2026-10-05 (notes and highlights on decisions): the readers in `services/visualex/visualex_api/services/decisions/` may add or move `\n` and move a boundary between blocks, never change another character; `test_decisions_text_frozen.py` and `decisionRender.test.ts` check it, and an anchor that no longer matches is listed in the decision tab, never dropped.»
  - `services/visualex/CLAUDE.md`, decisions section: the same in two lines, naming the test.
  - `resolver.py`, both «Raise the version whenever the reader changes the shape of what it returns» comments: append «— the shape only (blocks, `\n`): a change of characters is refused by test_decisions_text_frozen.py (design 2026-10-05 §8.5)».

- [ ] **Step 5: Commit**

```bash
git add services/visualex/tests/ services/visualex/visualex_api/services/decisions/resolver.py CLAUDE.md services/visualex/CLAUDE.md
git commit -m "test(api): freeze decision texts — the projection anchors are pinned to"
```

**PR 1:** push, open the PR into `develop` titled «feat: search decisions by article or topic, and freeze decision texts», body naming the infra line (`Caddyfile`) for the other developer's area, the measurements of Task 1 and the frozen readers (the Sentenze session reviews §8.5 through the orchestrator before merge). Merge at green CI: `merge: feat/decision-search-route — decisions mentioning an article or a topic, from Italgiure; decision texts frozen`.

---

## PR 2 — `feat/decision-tabs` (apps/web)

Worktree from `origin/develop` after PR 1 merged: `.claude/worktrees/decision-tabs`, branch `feat/decision-tabs`.

### Task 6: The short label and keys of a decision

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

### Task 7: The palette reads decision citations

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

### Task 8: Decision tabs in the store

**Files:**
- Modify: `apps/web/src/store/useAppStore.ts` (types `TabView`, `WorkspaceTab.view`, `pendingDecision`; actions below; `partialize` keeps `view`, drops `pendingDecision`)
- Create: `apps/web/src/utils/decisionFetchCache.ts`
- Test: `apps/web/src/store/__tests__/decisionTabs.test.ts`
- Test: `apps/web/src/utils/__tests__/decisionFetchCache.test.ts`

**Interfaces:**
- Consumes: `decisionPath`, `formatDecisionShort`, `identityOf` (`decisionLinks.ts`); `fetchDecision` (`services/decisionService.ts`).
- Produces (store):
  - `type TabView = { kind: 'decision'; reference: DecisionReference } | { kind: 'decision-search'; query: DecisionSearchQuery }` (`DecisionSearchQuery` from Task 11's types — declare it in `types/decisions.ts` now: `{ norma?: DecisionSearchNorma; normaLabel?: string; tema?: string; archivio?: DecisionArchive }`, with `DecisionSearchNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>`)
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

### Task 9: The decision in its tab, on desktop and on a phone

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionView.tsx` (the page's body: identity line, notices, actions, text, source, every outcome)
- Create: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (fetches with `fetchDecisionCached`, records the identity, renders `DecisionView`)
- Modify: `apps/web/src/components/features/decisions/DecisionPage.tsx` (deleted at Task 10; until then a thin wrapper over `DecisionView` so its tests keep passing)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx` (a tab with `view` renders `DecisionTabView`; header hides the content actions)
- Modify: `apps/web/src/components/features/search/SearchPanel.tsx` (the phone view draws a tab with `view`; opening a decision shows its tab)
- Test: `apps/web/src/components/features/decisions/DecisionView.test.tsx` (moved from `DecisionPage.test.tsx`, every outcome kept)
- Test: `apps/web/src/components/features/decisions/DecisionTabView.test.tsx`

**Interfaces:**
- Consumes: Task 8's store actions and `fetchDecisionCached`.
- Produces:
  - `DecisionView({ answer, reference, onRetry, onChooseCandidate, onOpenPalette, actions? }: DecisionViewProps)` — `answer: FetchDecisionAnswer | null` (null = loading), `onChooseCandidate(identity)`, `actions?: React.ReactNode` (extra buttons, e.g. PR C's «Aggiungi al dossier»), `textSlot?: React.ReactNode` (Task 15 replaces the plain text with the reading surface).
  - `DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference })`

- [ ] **Step 1: Move the tests.** `git mv DecisionPage.test.tsx DecisionView.test.tsx`, then rewrite each test to render `<DecisionView answer={…} reference={…} onRetry={vi.fn()} onChooseCandidate={vi.fn()} onOpenPalette={vi.fn()} />` with the answer it used to get from a mocked `fetchDecision`. Keep every assertion on copy and roles: the copy is the Sentenze design's and must not change. Tests that were about the page's URL rewrite move to Task 10. Add:

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

- [ ] **Step 3: Implement `DecisionView`** by moving `FoundView`, `Alert`, `unreachableMessage` and the outcome switch out of `DecisionPage.tsx` unchanged, with three differences: candidates call `onChooseCandidate(c.identita)` (rendered as `<a href={decisionPath(c.identita)} onClick={e => { e.preventDefault(); onChooseCandidate(c.identita); }}>` so the address still shows and middle-click works); the invalid-address branch shows the alert and a button «Cerca nella barra di ricerca» calling `onOpenPalette`; `DecisionLookupForm` is no longer rendered (it goes in Task 10) — the not-found branch keeps the reason and the penal suggestion (as a `DecisionLink`-like anchor calling `onChooseCandidate(answer.suggerimento)`). «Copia collegamento» joins «Copia citazione»: it copies `window.location.origin + decisionPath(identity)`.

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

In `WorkspaceTabPanel.tsx`, where the content list renders (around the `item.type === 'norma'` map), branch first: `tab.view?.kind === 'decision' ? <DecisionTabView tabId={tab.id} reference={tab.view.reference} /> : tab.view?.kind === 'decision-search' ? null /* Task 13 */ : (existing list)`. In the header, render «Aggiungi al dossier», the collection button and the rename only when `!tab.view`. Leave a typed exhaustive check so Task 13 cannot forget its branch:

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

### Task 10: The address, the links, the sidebar and the palette

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
- Consumes: Tasks 6–9.
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

**PR 2:** title «feat: decisions open in the search space, in a tab of their own beside the article»; body: what the Sentenze page became, screenshots from a browser pass (Task 20's checklist for this PR's part: palette, `/sentenze/…` cold and after login, a Massimario chip, a phone width). Merge: `merge: feat/decision-tabs — decisions in the search space, from the palette, the address and the links`.

---

## PR 3 — `feat/article-case-law` (apps/web)

### Task 11: The search service and the result list

**Files:**
- Modify: `apps/web/src/types/decisions.ts` (`DecisionSearchHit`, `SearchDecisionsAnswer`)
- Create: `apps/web/src/services/decisionSearchService.ts`
- Create: `apps/web/src/components/features/decisions/DecisionResultList.tsx`
- Test: `apps/web/src/services/__tests__/decisionSearchService.test.ts`, `apps/web/src/components/features/decisions/DecisionResultList.test.tsx`

**Interfaces:**
- Produces:
  - `interface DecisionSearchHit { identita: DecisionIdentity; attributi: DecisionAttributes; frammento: { testo: string; evidenziati: Array<[number, number]> } }`
  - `type SearchDecisionsAnswer = { esito: 'risultati'; totale: number; pagina: number; archivio: DecisionArchive | null; archivio_dal: string | null; decisioni: DecisionSearchHit[] } | { esito: 'non_supportata' } | { esito: 'richiesta_non_valida'; errori: Record<string, string> } | { esito: 'fonte_non_raggiungibile'; fonte: string } | { esito: 'errore_interno' }`
  - `searchDecisions(query: DecisionSearchQuery, pagina: number): Promise<SearchDecisionsAnswer>` (same handling of 429 and non-answers as `fetchDecision`)
  - `DecisionResultList({ query, besideTabId, onArchiveChange? })` — loads page 1 on mount, «Altri risultati» appends the next page (up to 10), shows the count line, the archive switch (Civile / Penale / Entrambi), per-state messages.

- [ ] **Step 1: Failing tests.** Service: posts to `/search_decisions` through `legalFetch` with `{ norma, tema, archivio, pagina }` (no `normaLabel`); 429 → `fonte_non_raggiungibile` `quota`; a body without a known `esito` → `fonte_non_raggiungibile` `risposta <status>`. List:

```tsx
it('shows the count, the coverage and each row as «menzionato nel testo»', async () => {
  mockSearch({ esito: 'risultati', totale: 312, pagina: 1, archivio: 'civile', archivio_dal: '2021-01-04', decisioni: [HIT] });
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

Write the two elided tests in full, in the same style, before running.

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

and the chip «menzionato nel testo» (`text-xs` slate pill). The count line: `${totale.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} decisioni nell’archivio pubblico della Cassazione` + ` (${withPreposition('dal', formatDateItalianLong(archivio_dal))})` when known (memory gotcha: `Intl` it-IT groups 4 digits only with `useGrouping: 'always'`). Zero results: «Nessuna decisione negli ultimi cinque anni dell’archivio pubblico della Cassazione.» — never «nessuna decisione». The archive switch is a three-button segmented control (`aria-pressed`), defaulting to the answer's `archivio`.

- [ ] **Step 4: Run tests, build, lint.** Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/decisions.ts apps/web/src/services apps/web/src/components/features/decisions
git commit -m "feat(web): the list of decisions that mention an article or a topic"
```

### Task 12: «Giurisprudenza» under the article

**Files:**
- Create: `apps/web/src/components/features/search/CaseLawSection.tsx`
- Modify: `apps/web/src/components/features/search/MassimeSection.tsx` (court and number as `DecisionLink`; short label)
- Modify: `apps/web/src/components/features/search/BrocardiDisplay.tsx` (the massime leave it; it keeps everything else)
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (renders `CaseLawSection` after the text, before `BrocardiDisplay`; the Massimario panel's slot moves inside it)
- Modify: `apps/web/src/plugins/registry.tsx` (the rassegne panel registers in a slot `article_case_law` that `CaseLawSection` hosts)
- Test: `apps/web/src/components/features/search/CaseLawSection.test.tsx`, `MassimeSection.test.tsx` (new)

**Interfaces:**
- Consumes: Task 10 `DecisionLink`, Task 11 `DecisionResultList`, `linkableDecisionPath`, `formatDecisionShort`.
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

### Task 13: A topic, from the glossary or the palette

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionSearchTabView.tsx`
- Modify: `apps/web/src/components/features/search/BrocardiDisplay.tsx` (`GlossarioSection`: «Sentenze su questo tema» per term)
- Modify: `apps/web/src/components/features/workspace/WorkspaceTabPanel.tsx`, `SearchPanel.tsx` (the `decision-search` branch)
- Modify: `apps/web/src/components/features/search/CommandPalette.tsx` («Cerca "<parole>" nelle sentenze della Cassazione»)
- Test: `DecisionSearchTabView.test.tsx`; `BrocardiDisplay.test.tsx` (add); `CommandPalette.test.tsx` (add)

**Interfaces:**
- Consumes: Task 8 `openDecisionSearchTab`, Task 11 `DecisionResultList`.
- Produces: `DecisionSearchTabView({ tabId, query })` — heading «Tema: {tema}», the article named when the query has one («… e art. 2043 c.c.»), the switch «Solo il tema» (`aria-pressed`) that re-runs the list without `norma`, the limits line «Solo la Cassazione, ultimi cinque anni; le parole come sono scritte.», and `DecisionResultList`.

- [ ] **Step 1: Failing tests.** Glossary: each term shows a link to Brocardi (unchanged) and a button «Sentenze su questo tema» that calls `openDecisionSearchTab({ tema: 'danno ingiusto', norma, normaLabel }, 'Tema: danno ingiusto', { besideTabId })`. Tab view: renders the heading and the article; pressing «Solo il tema» re-queries without `norma` (assert the service's second call). Palette: «perdita di chance» (no norm, no decision) shows the line «Cerca "perdita di chance" nelle sentenze della Cassazione»; Enter on it opens a search tab with `{ tema: 'perdita di chance' }`; «art 2043 cc» never shows that line.

- [ ] **Step 2: Run to see them fail.**

- [ ] **Step 3: Implement.** `BrocardiDisplay` needs the article and the tab: pass `currentNorma` (it already gets the act; add `numero_articolo` and `tabId` props from `ArticleTabContent`). In the palette, the topic line is a `Command.Item` rendered when `inputValue.trim().length >= 3 && !parsedCitation && !decisionRef && !resolvingRemotely`, value `cerca-sentenze ${inputValue}`, `onSelect` → `openDecisionSearchTab({ tema: inputValue.trim() }, `Tema: ${inputValue.trim()}`)` then `onClose()`. Replace Task 9's `null` branch with `<DecisionSearchTabView tabId={tab.id} query={tab.view.query} />` in both the window and the phone view.

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): a topic from Brocardi's glossary or the palette finds the decisions that use it"
```

**PR 3:** title «feat: the case law of an article, and topics through the glossary»; merge: `merge: feat/article-case-law — massime as links, the Cassazione's decisions mentioning an article, topics`.

---

## PR 4 — `feat/decision-annotations` (apps/web)

### Task 14: The decision renderer and its contract

**Files:**
- Create: `apps/web/src/utils/decisionRender.ts`
- Create: `apps/web/src/utils/__fixtures__/decisionTexts.ts` (the same five texts as Task 5's fixtures, as `DecisionText` objects: copy them from the readers' outputs, recorded by a scratch run of the Python readers, byte for byte — compare SHA-256 of each string between the Python output and the TS fixture before committing, memory `subagent_byte_fidelity`)
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
  return BLOCKS.map(([k]) => testo[k] ?? '').join('').replace(/\n/g, '');
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

### Task 15: The decision's reading surface and its links to norms

**Files:**
- Create: `apps/web/src/components/features/decisions/DecisionReadingSurface.tsx`
- Create: `apps/web/src/hooks/useCitationLinks.ts` (the click/hover handlers of `ArticleTabContent`'s citation effect, extracted)
- Modify: `apps/web/src/components/features/search/ArticleTabContent.tsx` (uses `useCitationLinks`)
- Modify: `apps/web/src/components/features/search/ArticleBody.tsx` (`className` prop for the text root, default `'vlx-art'`)
- Modify: `apps/web/src/components/features/decisions/DecisionView.tsx` (`textSlot`)
- Modify: `apps/web/src/types/index.ts` (`SearchParams.besideTabId?: string`), `apps/web/src/components/features/search/SearchPanel.tsx` (a result tab created for a search with `besideTabId` is placed with `placeTabsSideBySide`)
- Test: `DecisionReadingSurface.test.tsx`, `apps/web/src/hooks/__tests__/useCitationLinks.test.tsx`

**Interfaces:**
- Consumes: Task 14; `ArticleBody`; `wrapCitationsInHtml`; `CitationPreviewPopup` + `useCitationPreview`; `pushReadingBack`.
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

`DecisionView` renders `textSlot ?? <DecisionTextView testo={…} />`; `DecisionTabView` passes `<DecisionReadingSurface …/>` (Task 16 adds the marks; this task passes empty arrays).

- [ ] **Step 4: Run tests, build, lint.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): a decision's text links the norms it cites, and they open beside it"
```

### Task 16: Notes and highlights on a decision, never lost

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

### Task 17: Annotations on decisions in environments and the Forum

**Files:**
- Modify: `apps/web/src/components/features/environments/EnvironmentContentViewer.tsx` (label a decision key with its short form)
- Modify: `apps/web/src/components/features/bulletin/SuggestionItemCard.tsx` if it labels an annotation's `normaKey` (read it; same change)
- Test: `EnvironmentContentViewer` test (create `__tests__/EnvironmentContentViewer.labels.test.tsx` if none exists)

**Interfaces:**
- Consumes: `identityFromKey`, `formatDecisionShort` (Task 6).
- Produces: `annotationTargetLabel(normaKey: string): string` in `environments/annotationLabels.ts`.

- [ ] **Step 1: Failing test.** `annotationTargetLabel('cassazione:civile:10787:2024')` → `'Cass. civ., n. 10787/2024'`; `annotationTargetLabel('codice-civile--2043')` → `'codice civile 2043'` (today's rendering: `normaKey.replace(/--/g, ' ').replace(/-/g, ' ')`); the viewer shows the decision label in its «per norma» list.

- [ ] **Step 2–4:** implement (`identityFromKey(key) ? formatDecisionShort(identity) : key.replace(/--/g, ' ').replace(/-/g, ' ')`), use it at the two `byNorm.map` sites, run tests/build/lint.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/features/environments apps/web/src/components/features/bulletin
git commit -m "feat(web): environments name the decision a note or highlight belongs to"
```

**PR 4:** title «feat: read, annotate and follow the norms of a decision»; body names the contract (root rule 23 now covers decisions) and the dossier PR 3 follow-up (adopt `renderDecisionHtml`). Merge: `merge: feat/decision-annotations — notes, highlights and norm links on decisions, never lost`.

---

## PR 5 — `feat/decision-history` (apps/server, apps/web)

Announce the migration to the orchestrator before Step 3 of Task 18, and ask its go before any `npm --prefix apps/server test`.

### Task 18: Decisions in `search_history`

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

### Task 19: The Cronologia shows and reopens decisions

**Files:**
- Modify: `apps/web/src/services/historyService.ts` (types; `addDecisionToHistory(decisionKey)`)
- Modify: `apps/web/src/components/features/decisions/DecisionTabView.tsx` (records a found decision once per opening)
- Modify: `apps/web/src/components/features/history/HistoryView.tsx` (decision rows)
- Test: `HistoryView` decision rows test; `DecisionTabView.test.tsx` (records once)

**Interfaces:**
- Consumes: Task 18; `identityFromKey`, `formatDecisionShort`; `openDecisionTab`.
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

## Task 20: Close the round

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
  10. a phone width (390 px): the decision tab full width, the back control.
- [ ] **Step 2: All suites** — `npm --prefix apps/web run test -- --run`, `run build`, `run lint`; `(cd services/visualex && <python> -m pytest tests/ -q)`; `node --test infra/ingress/paths.test.mjs`; the server suite with the orchestrator's go.
- [ ] **Step 3: Docs** as listed above; commit on a `docs/norms-decisions-search-closing` branch, PR, merge `merge: docs/norms-decisions-search-closing — the round's notes`.
- [ ] **Step 4: Handoff** to the orchestrator: done, left, the owner's decisions verbatim, the PRs, the test account deleted.

## Amendments during execution

(Empty until Task 1 runs.)
