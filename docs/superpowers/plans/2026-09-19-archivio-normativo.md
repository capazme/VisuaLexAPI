# Archivio Normativo (local legal archive) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable, idempotent, resumable command (`python -m archivio_normativo`) that builds and updates a local archive of the acts listed in a manifest — one SQLite record per article/recital plus one Markdown file per act — using the local VisuaLex API for text and structure and the `legal-it` MCP server for optional enrichment.

**Architecture:** A new top-level package `archivio_normativo/` in this repo. `manifest.py` turns `manifest.yaml` into frozen dataclasses; `sources/visualex.py` is an `aiohttp` client of the six VisuaLex endpoints; `sources/legalit.py` an MCP stdio client; `hierarchy.py` derives libro/titolo/capo/sezione from the tree; `store.py` owns SQLite; `pipeline.py` runs one act at a time (index → diff by fingerprint → fetch changed → enrich → store); `render_md.py`, `verify.py`, `report.py` read the store. Everything network-facing goes through `throttle.py` (token bucket + backoff).

**Tech Stack:** Python ≥ 3.11; `aiohttp`, `pyyaml` (already in `requirements.txt`); `mcp` (new, lazy, in `requirements-archivio.txt`); `sqlite3` stdlib; pytest + pytest-asyncio (`asyncio_mode = auto`), `aiohttp.test_utils.TestServer` for the fake VisuaLex.

**Spec:** `docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`. Depends on Plan 1 (`2026-09-19-archivio-visualex-extensions.md`) for `/fetch_recitals`, `/fetch_act_fingerprints` and `celex_consolidated`; the client here is tested against a fake server, so the tasks can be executed before Plan 1 lands, but the live run at the end needs it.

## Global Constraints

- Branch `feature/archivio-normativo`; one commit per task; never amend.
- Run tests from the repo root with the project venv: `.venv/bin/python -m pytest tests/archivio -q` (the whole suite is `tests/ -q`; `pytest.ini` sets `testpaths = tests`, so `tests/archivio/` is collected by CI).
- The archive stores VisuaLex's `article_text` verbatim. Never the AKN text. Never a stripped or reflowed copy: `text_hash` is the change registry and a formatting "improvement" would mark every article as changed.
- `id` and `area` from the manifest are validated as slugs `^[a-z0-9][a-z0-9-]*$`; `area` must be one of the eight areas. Output paths are built only from those two values under `--out`.
- The legal-it command comes from the manifest or `LEGALIT_MCP_COMMAND`; the `mcp` package is imported inside `LegalItClient` only.
- Third-party text written to Markdown has `<` escaped to `&lt;` in enrichment blocks; article text is written verbatim (it is plain text from VisuaLex).
- All SQLite statements are parametrised.
- Article-number suffixes are read from `visualex_api.tools.article_suffixes` (a leaf module, imports nothing). The package never carries its own `bis|ter|…` list.
- Two vocabularies: the manifest uses VisuaLex's request names (`act_type`, `date`, `act_number`, `annex`); VisuaLex answers with `norma_data` in Italian (`tipo_atto`, `data`, `numero_atto`, `allegato`, `urn`, `url`). Map explicitly, never assume (CLAUDE.md, "Key API Endpoints").
- Every VisuaLex response line for an article is matched to the request by `norma_data.numero_articolo`, normalised with `hierarchy.normalize_number`; an article requested and not answered is a `failed` unit with reason `not returned`.

## File structure

```
archivio_normativo/
  __init__.py            version string
  __main__.py            from .cli import main; raise SystemExit(main())
  cli.py                 argparse; build/verify/render/report/export; wires everything
  manifest.py            AREAS, KINDS, ActSpec, Manifest, load_manifest, ArticleSelection
  hierarchy.py           normalize_number, classify_heading, walk_tree, IndexedArticle
  throttle.py            Throttle, with_backoff, RetryableError
  store.py               Store (SQLite), UnitRecord, ActRecord, text_hash
  pipeline.py            Pipeline, RunOptions, ActReport: resolve → index → diff → fetch → store
  enrich.py              Enricher: refresh policy and legal-it calls per act/unit
  render_md.py           render_act, render_index, write_outputs, anchor_for
  verify.py              verify_act, Finding
  report.py              format_report
  sources/
    __init__.py
    visualex.py          VisuaLexClient + result dataclasses + select_fingerprints
    legalit.py           LegalItClient, ToolCall, unit_calls, act_calls
  manifest.yaml          the corpus
  README.md              how to run
requirements-archivio.txt
tests/archivio/
  __init__.py
  conftest.py            tmp store, fake VisuaLex server fixture, sample manifest
  fake_visualex.py       FakeVisuaLex (aiohttp app) with a scripted scenario
  test_throttle.py  test_manifest.py  test_hierarchy.py  test_store.py
  test_visualex_client.py  test_legalit.py  test_pipeline.py  test_enrich.py
  test_render_md.py  test_verify_report.py  test_cli.py
  golden/              expected Markdown
```

Shared identifiers used across tasks (defined once, referenced everywhere):

- unit id: `f"{act_id}:art:{number}"` for articles, `f"{act_id}:rec:{number}"` for recitals; `number` is `hierarchy.normalize_number(raw)` (`"2-bis"`, never `"2 bis"`).
- outcomes: `"new" | "updated" | "unchanged" | "failed" | "skipped"`.
- enrichment status: `"ok" | "empty" | "error"`.
- run status: `"running" | "done" | "interrupted"`.
- `text_status`: `"consolidated" | "oj"`.

---

### Task 1: Package skeleton and `throttle.py`

**Files:**
- Create: `archivio_normativo/__init__.py`, `archivio_normativo/sources/__init__.py`, `archivio_normativo/throttle.py`
- Create: `tests/archivio/__init__.py`, `tests/archivio/test_throttle.py`
- Modify: `.gitignore` (add `archivio_out/`)

**Interfaces:**
- Produces:
  - `class RetryableError(Exception)` — raise it (or a subclass) for 429/5xx/timeouts; `with_backoff` retries only these.
  - `class Throttle(rate_per_second: float, *, clock=time.monotonic, sleep=asyncio.sleep)` with `async acquire() -> None` and `async pace(n: int) -> None` (acquire `n` tokens, for a batch).
  - `async with_backoff(fn, *, attempts=5, base=2.0, factor=2.0, max_delay=60.0, jitter=random.random, sleep=asyncio.sleep, on_retry=None)` — calls `await fn()`; on `RetryableError` sleeps `min(max_delay, base * factor**k) * (0.5 + jitter())` and retries; re-raises the last error after `attempts`. `on_retry(attempt, delay, error)` is called before each sleep (the pipeline logs it).

- [ ] **Step 1: Write the failing tests**

`tests/archivio/__init__.py`: empty file.

`tests/archivio/test_throttle.py`:

```python
"""Pacing towards the sources, and retrying the failures worth retrying.

A fake clock and a recording sleep make the tests instant and exact.
"""
import pytest

from archivio_normativo.throttle import RetryableError, Throttle, with_backoff


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class RecordingSleep:
    def __init__(self, clock):
        self.clock = clock
        self.calls = []

    async def __call__(self, seconds):
        self.calls.append(round(seconds, 6))
        self.clock.now += seconds


class TestThrottle:
    async def test_first_call_does_not_wait(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(2.0, clock=clock, sleep=sleep)
        await throttle.acquire()
        assert sleep.calls == []

    async def test_calls_are_spaced_at_the_rate(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(2.0, clock=clock, sleep=sleep)  # one every 0.5 s
        await throttle.acquire()
        await throttle.acquire()
        await throttle.acquire()
        assert sleep.calls == [0.5, 0.5]

    async def test_idle_time_is_not_banked_beyond_one_token(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(1.0, clock=clock, sleep=sleep)
        await throttle.acquire()
        clock.now += 100  # a long pause must not allow a burst afterwards
        await throttle.acquire()
        await throttle.acquire()
        assert sleep.calls == [1.0]

    async def test_pace_takes_n_tokens(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(1.0, clock=clock, sleep=sleep)
        await throttle.pace(3)   # first batch: free
        await throttle.pace(3)   # second: wait for 3 tokens
        assert sleep.calls == [3.0]

    async def test_zero_or_negative_rate_means_no_pacing(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(0, clock=clock, sleep=sleep)
        for _ in range(5):
            await throttle.acquire()
        assert sleep.calls == []


class TestBackoff:
    async def test_returns_the_result_on_first_success(self):
        calls = []

        async def fn():
            calls.append(1)
            return "ok"

        assert await with_backoff(fn, sleep=RecordingSleep(FakeClock())) == "ok"
        assert len(calls) == 1

    async def test_retries_retryable_errors_with_exponential_delays(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 4:
                raise RetryableError("503")
            return "ok"

        result = await with_backoff(fn, attempts=5, base=2.0, factor=2.0,
                                    jitter=lambda: 0.5, sleep=sleep)
        assert result == "ok"
        assert sleep.calls == [2.0, 4.0, 8.0]   # base * factor**k, jitter factor 1.0

    async def test_delays_are_capped(self):
        sleep = RecordingSleep(FakeClock())
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 5:
                raise RetryableError("429")
            return "ok"

        await with_backoff(fn, attempts=5, base=10.0, factor=10.0, max_delay=15.0,
                           jitter=lambda: 0.5, sleep=sleep)
        assert sleep.calls == [10.0, 15.0, 15.0, 15.0]

    async def test_gives_up_after_attempts_and_reraises(self):
        sleep = RecordingSleep(FakeClock())

        async def fn():
            raise RetryableError("down")

        with pytest.raises(RetryableError, match="down"):
            await with_backoff(fn, attempts=3, jitter=lambda: 0.5, sleep=sleep)
        assert len(sleep.calls) == 2

    async def test_non_retryable_errors_propagate_immediately(self):
        sleep = RecordingSleep(FakeClock())

        async def fn():
            raise ValueError("bad input")

        with pytest.raises(ValueError):
            await with_backoff(fn, sleep=sleep)
        assert sleep.calls == []

    async def test_on_retry_is_told_about_each_wait(self):
        sleep = RecordingSleep(FakeClock())
        seen = []
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 2:
                raise RetryableError("503")
            return "ok"

        await with_backoff(fn, jitter=lambda: 0.5, sleep=sleep,
                           on_retry=lambda attempt, delay, err: seen.append((attempt, delay, str(err))))
        assert seen == [(1, 2.0, "503")]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_throttle.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo'`.

- [ ] **Step 3: Create the package and implement**

`archivio_normativo/__init__.py`:

```python
"""Local legal archive built on the VisuaLex API.

See docs/superpowers/specs/2026-09-19-archivio-normativo-design.md.
"""

__version__ = "0.1.0"
```

`archivio_normativo/sources/__init__.py`: empty file.

`archivio_normativo/throttle.py`:

```python
"""Pacing and retrying for the two providers.

`Throttle` is a token bucket with a capacity of one token per unit of work:
idle time earns at most one token, so a pause never turns into a burst
against Normattiva or Italgiure afterwards. `with_backoff` retries only the
errors a caller marks as retryable (429, 5xx, timeouts) with exponential,
jittered, capped delays and re-raises the last one when attempts run out.
"""
from __future__ import annotations

import asyncio
import random
import time
from typing import Awaitable, Callable


class RetryableError(Exception):
    """A failure worth retrying: rate limit, server error, timeout."""


class Throttle:
    def __init__(self, rate_per_second: float, *, clock=time.monotonic, sleep=asyncio.sleep):
        self.rate = float(rate_per_second)
        self._clock = clock
        self._sleep = sleep
        self._next_free: float | None = None  # earliest time the next token is available

    async def acquire(self) -> None:
        await self.pace(1)

    async def pace(self, tokens: int) -> None:
        """Wait until `tokens` units of work may proceed at the configured rate."""
        if self.rate <= 0 or tokens <= 0:
            return
        now = self._clock()
        if self._next_free is None or now > self._next_free:
            self._next_free = now  # idle bucket: one batch is free, nothing is banked
        wait = self._next_free - now
        self._next_free += tokens / self.rate
        if wait > 0:
            await self._sleep(wait)


async def with_backoff(
    fn: Callable[[], Awaitable],
    *,
    attempts: int = 5,
    base: float = 2.0,
    factor: float = 2.0,
    max_delay: float = 60.0,
    jitter: Callable[[], float] = random.random,
    sleep=asyncio.sleep,
    on_retry: Callable[[int, float, BaseException], None] | None = None,
):
    """Call `fn` until it succeeds or `attempts` are exhausted.

    Delay before retry k (1-based) is `min(max_delay, base * factor**(k-1))`
    scaled by `0.5 + jitter()`, so with `jitter() == 0.5` the delays are exact.
    """
    last: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except RetryableError as exc:
            last = exc
            if attempt == attempts:
                break
            delay = min(max_delay, base * factor ** (attempt - 1)) * (0.5 + jitter())
            if on_retry is not None:
                on_retry(attempt, delay, exc)
            await sleep(delay)
    assert last is not None
    raise last
```

Walk the tests: rate 2, three `acquire`s at t=1000: first sets horizon 1000 → wait 0, horizon 1000.5; second: now 1000 < 1000.5 → wait 0.5 (sleep moves clock to 1000.5), horizon 1001.0; third: now 1000.5 < 1001 → wait 0.5. ✓. Idle test: after the first acquire horizon 1001; clock jumps to 1101 > horizon → reset to 1101, wait 0, horizon 1102; next: wait 1.0 ✓. Batch test: `pace(3)` at 1000: horizon 1000, wait 0, horizon 1003; `pace(3)`: wait 3.0 ✓.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_throttle.py -q`
Expected: 11 passed.

- [ ] **Step 5: Ignore the default output directory and commit**

Append to `.gitignore`:

```
# Local legal archive output (python -m archivio_normativo build)
archivio_out/
```

```bash
git add archivio_normativo/__init__.py archivio_normativo/sources/__init__.py archivio_normativo/throttle.py tests/archivio/__init__.py tests/archivio/test_throttle.py .gitignore
git commit -m "feat(archivio): package skeleton with token-bucket throttle and backoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `manifest.py` and the shipped `manifest.yaml`

**Files:**
- Create: `archivio_normativo/manifest.py`, `archivio_normativo/manifest.yaml`
- Test: `tests/archivio/test_manifest.py`

**Interfaces:**
- Produces (all frozen dataclasses unless noted):
  - `AREAS: tuple[str, ...]` — the eight area slugs; `SOURCES = ("normattiva", "eurlex")`.
  - `KINDS: dict[str, EnrichKind]` with `EnrichKind(name, level)` where `level` is `"unit"` or `"act"`; `KIND_ALIASES = {"annotazioni": "brocardi"}`; `KIND_GROUPS = {"giurisprudenza": (...)}`; `expand_kinds(names: Iterable[str]) -> tuple[str, ...]` (aliases and groups resolved, order kept, duplicates dropped, unknown → `ManifestError`).
  - `ArticleSelection(ranges: tuple[tuple[int, int], ...], explicit: frozenset[str])` with `contains(number: str) -> bool`; `parse_article_selection(spec: str) -> ArticleSelection`.
  - `Providers(visualex_base_url: str, legalit_command: tuple[str, ...])`.
  - `Defaults(version, rate_per_second, enrich_rate_per_second, enrich_ttl_days, enrich, batch_size)`.
  - `ActSpec(id, area, label, source, act_type, cite, date, act_number, annex, celex, celex_consolidated, units, enrich, enrich_articles, version)` with `wants_recitals() -> bool`, `enrich_selection() -> ArticleSelection | None`, `is_eu() -> bool`.
  - `Manifest(providers, defaults, acts)` with `act(act_id) -> ActSpec` and `select(only: Iterable[str] | None, area: str | None) -> tuple[ActSpec, ...]`.
  - `load_manifest(path: Path) -> Manifest`; `ManifestError(ValueError)`.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_manifest.py`:

```python
"""The manifest is the owner's file. It must fail loudly on a typo and
never guess: an unknown key, an unknown kind or a bad slug are errors."""
from pathlib import Path

import pytest
import yaml

from archivio_normativo.manifest import (
    AREAS, KINDS, ManifestError, expand_kinds, load_manifest, parse_article_selection,
)

SHIPPED = Path(__file__).resolve().parents[2] / "archivio_normativo" / "manifest.yaml"


def write(tmp_path, data):
    path = tmp_path / "manifest.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def minimal(**overrides):
    act = {
        "id": "cc", "area": "civile", "label": "Codice civile", "source": "normattiva",
        "act_type": "codice civile", "cite": "c.c.",
    }
    act.update(overrides)
    return {"version": 1, "acts": [act]}


class TestLoading:
    def test_minimal_manifest_gets_defaults(self, tmp_path):
        m = load_manifest(write(tmp_path, minimal()))
        assert m.providers.visualex_base_url == "http://localhost:5000"
        assert m.providers.legalit_command == ()
        assert m.defaults.rate_per_second == 1.0
        assert m.defaults.enrich_rate_per_second == 0.5
        assert m.defaults.enrich_ttl_days == 90
        assert m.defaults.batch_size == 25
        act = m.act("cc")
        assert act.units == ("articles",)
        assert act.enrich == ()
        assert act.version == "vigente"
        assert act.date is None and act.act_number is None and act.annex is None

    def test_act_inherits_default_enrich_and_can_override(self, tmp_path):
        data = minimal()
        data["defaults"] = {"enrich": ["brocardi"]}
        data["acts"].append({
            "id": "gdpr", "area": "ue", "label": "GDPR", "source": "eurlex",
            "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            "celex": "32016R0679", "cite": "GDPR", "units": ["articles", "recitals"],
            "enrich": ["annotazioni", "giurisprudenza"],
        })
        m = load_manifest(write(tmp_path, data))
        assert m.act("cc").enrich == ("brocardi",)
        assert m.act("gdpr").enrich == (
            "brocardi", "cassazione", "amministrativa", "tributaria", "cgue", "costituzionale",
        )
        assert m.act("gdpr").wants_recitals() is True
        assert m.act("gdpr").is_eu() is True
        assert m.act("cc").is_eu() is False

    def test_annex_is_kept_as_a_string(self, tmp_path):
        m = load_manifest(write(tmp_path, minimal(annex=2)))
        assert m.act("cc").annex == "2"

    def test_providers_are_read(self, tmp_path):
        data = minimal()
        data["providers"] = {
            "visualex": {"base_url": "http://127.0.0.1:5001/"},
            "legalit": {"command": ["bash", "~/x/start_server.sh"]},
        }
        m = load_manifest(write(tmp_path, data))
        assert m.providers.visualex_base_url == "http://127.0.0.1:5001"  # trailing slash dropped
        assert m.providers.legalit_command[0] == "bash"
        assert m.providers.legalit_command[1].startswith("/")  # ~ expanded

    def test_environment_overrides_the_legalit_command(self, tmp_path, monkeypatch):
        monkeypatch.setenv("LEGALIT_MCP_COMMAND", '["python", "run_server.py"]')
        m = load_manifest(write(tmp_path, minimal()))
        assert m.providers.legalit_command == ("python", "run_server.py")

    def test_select_by_ids_and_area(self, tmp_path):
        data = minimal()
        data["acts"].append({
            "id": "cp", "area": "penale", "label": "Codice penale", "source": "normattiva",
            "act_type": "codice penale", "cite": "c.p.",
        })
        m = load_manifest(write(tmp_path, data))
        assert [a.id for a in m.select(None, None)] == ["cc", "cp"]
        assert [a.id for a in m.select(["cp"], None)] == ["cp"]
        assert [a.id for a in m.select(None, "civile")] == ["cc"]
        with pytest.raises(ManifestError, match="unknown act"):
            m.select(["nope"], None)


class TestValidation:
    @pytest.mark.parametrize("bad, message", [
        ({"id": "Codice Civile"}, "slug"),
        ({"area": "commerciale"}, "area"),
        ({"source": "brocardi"}, "source"),
        ({"units": ["recitals", "tables"]}, "units"),
        ({"enrich": ["giurisprudenza", "oracolo"]}, "kind"),
        ({"enrich_articles": "1173-abc"}, "enrich_articles"),
        ({"celex_consolidated": "32002L0058"}, "celex_consolidated"),
        ({"cite": ""}, "cite"),
        ({"nonsense": 1}, "unknown key"),
    ])
    def test_bad_act_entries_are_errors(self, tmp_path, bad, message):
        with pytest.raises(ManifestError, match=message):
            load_manifest(write(tmp_path, minimal(**bad)))

    def test_duplicate_ids_are_an_error(self, tmp_path):
        data = minimal()
        data["acts"].append(dict(data["acts"][0]))
        with pytest.raises(ManifestError, match="duplicate"):
            load_manifest(write(tmp_path, data))

    def test_recitals_on_a_normattiva_act_is_an_error(self, tmp_path):
        with pytest.raises(ManifestError, match="recitals"):
            load_manifest(write(tmp_path, minimal(units=["articles", "recitals"])))

    def test_unknown_top_level_key_is_an_error(self, tmp_path):
        data = minimal()
        data["defualts"] = {}
        with pytest.raises(ManifestError, match="unknown key"):
            load_manifest(write(tmp_path, data))

    def test_missing_file(self, tmp_path):
        with pytest.raises(ManifestError, match="not found"):
            load_manifest(tmp_path / "missing.yaml")


class TestKinds:
    def test_every_kind_has_a_level(self):
        assert {k.level for k in KINDS.values()} == {"unit", "act"}
        assert KINDS["attuazione"].level == "act"
        assert KINDS["base_ue"].level == "act"
        assert KINDS["brocardi"].level == "unit"

    def test_expand_resolves_aliases_and_groups_in_order(self):
        assert expand_kinds(["annotazioni", "giurisprudenza", "cassazione"]) == (
            "brocardi", "cassazione", "amministrativa", "tributaria", "cgue", "costituzionale",
        )

    def test_expand_rejects_unknown(self):
        with pytest.raises(ManifestError, match="oracolo"):
            expand_kinds(["oracolo"])


class TestArticleSelection:
    def test_ranges_and_explicit_numbers(self):
        sel = parse_article_selection("1173-2059, 2643, 2-bis")
        assert sel.contains("1173") and sel.contains("2059") and sel.contains("1500-ter")
        assert sel.contains("2643") and sel.contains("2-bis")
        assert not sel.contains("2644") and not sel.contains("2")

    def test_areas_are_the_eight_of_the_spec(self):
        assert AREAS == ("costituzionale", "civile", "penale", "amministrativo",
                         "tributario", "lavoro", "privacy-digitale", "ue")


class TestShippedManifest:
    def test_it_loads(self):
        m = load_manifest(SHIPPED)
        assert len(m.acts) >= 40

    def test_every_eu_act_has_a_celex_and_recitals(self):
        m = load_manifest(SHIPPED)
        for act in m.acts:
            if act.source == "eurlex":
                assert act.celex, act.id
                assert act.wants_recitals(), act.id

    def test_the_two_consolidated_versions_are_declared(self):
        m = load_manifest(SHIPPED)
        assert m.act("eprivacy").celex_consolidated == "02002L0058-20091219"
        assert m.act("eidas").celex_consolidated == "02014R0910-20241018"

    def test_every_area_is_populated(self):
        m = load_manifest(SHIPPED)
        assert {a.area for a in m.acts} == set(AREAS)
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_manifest.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.manifest'`.

- [ ] **Step 3: Implement `manifest.py`**

```python
"""The corpus, as the owner writes it.

Every act the archive knows comes from `manifest.yaml`; nothing is hardcoded
in the pipeline. Loading is strict on purpose: an unknown key, an unknown
enrichment kind or a malformed slug is an error at start-up, never a
silently ignored option.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml

# The one ordinal table of the repo (a leaf module: importing it pulls in
# nothing else). A third private copy is exactly what CLAUDE.md forbids.
from visualex_api.tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION


class ManifestError(ValueError):
    """The manifest cannot be used as written."""


AREAS: tuple[str, ...] = (
    "costituzionale", "civile", "penale", "amministrativo",
    "tributario", "lavoro", "privacy-digitale", "ue",
)
SOURCES: tuple[str, ...] = ("normattiva", "eurlex")
UNITS: tuple[str, ...] = ("articles", "recitals")
EU_ACT_TYPES: tuple[str, ...] = ("regolamento ue", "direttiva ue")

_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_CONSOLIDATED_CELEX = re.compile(r"^0\d{4}[A-Z]\d{4}-\d{8}$")
_SELECTION_ITEM = re.compile(r"^(\d+)(?:-(\d+))?$")
_SUFFIXED_ITEM = re.compile(rf"^\d+-(?:{ARTICLE_SUFFIX_ALTERNATION})$")


@dataclass(frozen=True)
class EnrichKind:
    name: str
    level: str  # "unit" (one call per article) or "act" (one per act)


KINDS: dict[str, EnrichKind] = {
    "brocardi": EnrichKind("brocardi", "unit"),
    "cassazione": EnrichKind("cassazione", "unit"),
    "cassazione_massime": EnrichKind("cassazione_massime", "unit"),
    "amministrativa": EnrichKind("amministrativa", "unit"),
    "tributaria": EnrichKind("tributaria", "unit"),
    "cgue": EnrichKind("cgue", "unit"),
    "costituzionale": EnrichKind("costituzionale", "unit"),
    "garante": EnrichKind("garante", "unit"),
    "attuazione": EnrichKind("attuazione", "act"),
    "base_ue": EnrichKind("base_ue", "act"),
}
KIND_ALIASES: dict[str, str] = {"annotazioni": "brocardi"}
KIND_GROUPS: dict[str, tuple[str, ...]] = {
    "giurisprudenza": ("cassazione", "amministrativa", "tributaria", "cgue", "costituzionale"),
}


def expand_kinds(names: Iterable[str]) -> tuple[str, ...]:
    """Resolve aliases and groups into concrete kinds, order kept, no repeats."""
    out: list[str] = []
    for raw in names:
        name = str(raw).strip().lower()
        name = KIND_ALIASES.get(name, name)
        expanded = KIND_GROUPS.get(name, (name,))
        for kind in expanded:
            if kind not in KINDS:
                raise ManifestError(f"unknown enrichment kind {raw!r}; known: {', '.join(KINDS)}")
            if kind not in out:
                out.append(kind)
    return tuple(out)


@dataclass(frozen=True)
class ArticleSelection:
    ranges: tuple[tuple[int, int], ...]
    explicit: frozenset[str]

    def contains(self, number: str) -> bool:
        if number in self.explicit:
            return True
        head = re.match(r"^(\d+)", number)
        if not head:
            return False
        value = int(head.group(1))
        return any(lo <= value <= hi for lo, hi in self.ranges)


def parse_article_selection(spec: str) -> ArticleSelection:
    """"1173-2059, 2643, 2-bis" -> ranges by numeric part, explicit keys otherwise."""
    ranges: list[tuple[int, int]] = []
    explicit: set[str] = set()
    for item in str(spec).split(","):
        item = item.strip().lower().replace(" ", "-")
        if not item:
            continue
        match = _SELECTION_ITEM.match(item)
        if match and match.group(2):
            lo, hi = int(match.group(1)), int(match.group(2))
            if lo > hi:
                raise ManifestError(f"enrich_articles: empty range {item!r}")
            ranges.append((lo, hi))
        elif match:
            explicit.add(item)
        elif _SUFFIXED_ITEM.match(item):
            explicit.add(item)
        else:
            raise ManifestError(f"enrich_articles: cannot read {item!r}")
    return ArticleSelection(tuple(ranges), frozenset(explicit))


@dataclass(frozen=True)
class Providers:
    visualex_base_url: str = "http://localhost:5000"
    legalit_command: tuple[str, ...] = ()


@dataclass(frozen=True)
class Defaults:
    version: str = "vigente"
    rate_per_second: float = 1.0
    enrich_rate_per_second: float = 0.5
    enrich_ttl_days: int = 90
    enrich: tuple[str, ...] = ()
    batch_size: int = 25


@dataclass(frozen=True)
class ActSpec:
    id: str
    area: str
    label: str
    source: str
    act_type: str
    cite: str
    date: str | None = None
    act_number: str | None = None
    annex: str | None = None
    celex: str | None = None
    celex_consolidated: str | None = None
    units: tuple[str, ...] = ("articles",)
    enrich: tuple[str, ...] = ()
    enrich_articles: str | None = None
    version: str = "vigente"

    def wants_recitals(self) -> bool:
        return "recitals" in self.units

    def is_eu(self) -> bool:
        return self.source == "eurlex"

    def enrich_selection(self) -> ArticleSelection | None:
        return parse_article_selection(self.enrich_articles) if self.enrich_articles else None

    def text_status(self) -> str:
        """Normattiva serves the consolidated text; EUR-Lex only when asked."""
        if not self.is_eu():
            return "consolidated"
        return "consolidated" if self.celex_consolidated else "oj"


@dataclass(frozen=True)
class Manifest:
    providers: Providers
    defaults: Defaults
    acts: tuple[ActSpec, ...]
    _by_id: dict = field(default_factory=dict, repr=False, compare=False)

    def act(self, act_id: str) -> ActSpec:
        try:
            return self._by_id[act_id]
        except KeyError:
            raise ManifestError(f"unknown act id {act_id!r}") from None

    def select(self, only: Iterable[str] | None, area: str | None) -> tuple[ActSpec, ...]:
        chosen = list(self.acts)
        if only is not None:
            wanted = [o.strip() for o in only if o.strip()]
            for act_id in wanted:
                self.act(act_id)  # raises on an unknown id
            chosen = [a for a in chosen if a.id in wanted]
        if area is not None:
            if area not in AREAS:
                raise ManifestError(f"unknown area {area!r}; known: {', '.join(AREAS)}")
            chosen = [a for a in chosen if a.area == area]
        return tuple(chosen)


_ACT_KEYS = {
    "id", "area", "label", "source", "act_type", "cite", "date", "act_number", "annex",
    "celex", "celex_consolidated", "units", "enrich", "enrich_articles", "version",
}
_TOP_KEYS = {"version", "providers", "defaults", "acts"}
_DEFAULT_KEYS = {"version", "rate_per_second", "enrich_rate_per_second", "enrich_ttl_days", "enrich", "batch_size"}


def _reject_unknown(mapping: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise ManifestError(f"{where}: unknown key(s) {', '.join(unknown)}")


def _optional_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_act(raw: dict, defaults: Defaults) -> ActSpec:
    if not isinstance(raw, dict):
        raise ManifestError(f"acts: each entry must be a mapping, got {type(raw).__name__}")
    where = f"act {raw.get('id', '?')!r}"
    _reject_unknown(raw, _ACT_KEYS, where)
    for key in ("id", "area", "label", "source", "act_type", "cite"):
        if not _optional_str(raw.get(key)):
            raise ManifestError(f"{where}: missing or empty {key!r}"
                                + (" (cite is how the act is written in a citation)" if key == "cite" else ""))
    act_id = str(raw["id"]).strip()
    if not _SLUG.match(act_id):
        raise ManifestError(f"{where}: id must be a slug [a-z0-9-], got {act_id!r}")
    area = str(raw["area"]).strip()
    if area not in AREAS:
        raise ManifestError(f"{where}: area must be one of {', '.join(AREAS)}, got {area!r}")
    source = str(raw["source"]).strip()
    if source not in SOURCES:
        raise ManifestError(f"{where}: source must be one of {', '.join(SOURCES)}, got {source!r}")
    units = tuple(str(u) for u in (raw.get("units") or ["articles"]))
    for unit in units:
        if unit not in UNITS:
            raise ManifestError(f"{where}: units must be among {', '.join(UNITS)}, got {unit!r}")
    if "recitals" in units and source != "eurlex":
        raise ManifestError(f"{where}: recitals exist only for EUR-Lex acts")
    enrich = expand_kinds(raw["enrich"]) if raw.get("enrich") is not None else defaults.enrich
    enrich_articles = _optional_str(raw.get("enrich_articles"))
    if enrich_articles:
        try:
            parse_article_selection(enrich_articles)
        except ManifestError as exc:
            raise ManifestError(f"{where}: {exc}") from None
    celex_consolidated = _optional_str(raw.get("celex_consolidated"))
    if celex_consolidated and not _CONSOLIDATED_CELEX.match(celex_consolidated):
        raise ManifestError(
            f"{where}: celex_consolidated must be a sector-0 CELEX like 02002L0058-20091219, got {celex_consolidated!r}"
        )
    if celex_consolidated and source != "eurlex":
        raise ManifestError(f"{where}: celex_consolidated applies to EUR-Lex acts only")
    version = _optional_str(raw.get("version")) or defaults.version
    return ActSpec(
        id=act_id,
        area=area,
        label=str(raw["label"]).strip(),
        source=source,
        act_type=str(raw["act_type"]).strip(),
        cite=str(raw["cite"]).strip(),
        date=_optional_str(raw.get("date")),
        act_number=_optional_str(raw.get("act_number")),
        annex=_optional_str(raw.get("annex")),
        celex=_optional_str(raw.get("celex")),
        celex_consolidated=celex_consolidated,
        units=units,
        enrich=enrich,
        enrich_articles=enrich_articles,
        version=version,
    )


def _parse_providers(raw: dict | None) -> Providers:
    raw = raw or {}
    _reject_unknown(raw, {"visualex", "legalit"}, "providers")
    visualex = raw.get("visualex") or {}
    legalit = raw.get("legalit") or {}
    _reject_unknown(visualex, {"base_url"}, "providers.visualex")
    _reject_unknown(legalit, {"command"}, "providers.legalit")
    base_url = str(visualex.get("base_url") or "http://localhost:5000").rstrip("/")
    command = legalit.get("command") or []
    env_command = os.environ.get("LEGALIT_MCP_COMMAND")
    if env_command:
        try:
            command = json.loads(env_command)
        except json.JSONDecodeError as exc:
            raise ManifestError(f"LEGALIT_MCP_COMMAND must be a JSON list: {exc}") from None
    if not isinstance(command, list) or not all(isinstance(c, str) for c in command):
        raise ManifestError("providers.legalit.command must be a list of strings")
    command = tuple(os.path.expanduser(c) for c in command)
    return Providers(visualex_base_url=base_url, legalit_command=command)


def _parse_defaults(raw: dict | None) -> Defaults:
    raw = raw or {}
    _reject_unknown(raw, _DEFAULT_KEYS, "defaults")
    base = Defaults()
    try:
        return Defaults(
            version=str(raw.get("version") or base.version),
            rate_per_second=float(raw.get("rate_per_second", base.rate_per_second)),
            enrich_rate_per_second=float(raw.get("enrich_rate_per_second", base.enrich_rate_per_second)),
            enrich_ttl_days=int(raw.get("enrich_ttl_days", base.enrich_ttl_days)),
            enrich=expand_kinds(raw.get("enrich") or ()),
            batch_size=int(raw.get("batch_size", base.batch_size)),
        )
    except (TypeError, ValueError) as exc:
        raise ManifestError(f"defaults: {exc}") from None


def load_manifest(path: Path) -> Manifest:
    path = Path(path)
    if not path.is_file():
        raise ManifestError(f"manifest not found: {path}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ManifestError(f"{path}: not valid YAML: {exc}") from None
    if not isinstance(data, dict):
        raise ManifestError(f"{path}: the manifest must be a mapping")
    _reject_unknown(data, _TOP_KEYS, "manifest")
    if data.get("version") != 1:
        raise ManifestError(f"{path}: version must be 1")
    providers = _parse_providers(data.get("providers"))
    defaults = _parse_defaults(data.get("defaults"))
    raw_acts = data.get("acts")
    if not isinstance(raw_acts, list) or not raw_acts:
        raise ManifestError(f"{path}: acts must be a non-empty list")
    acts = tuple(_parse_act(raw, defaults) for raw in raw_acts)
    seen: set[str] = set()
    for act in acts:
        if act.id in seen:
            raise ManifestError(f"duplicate act id {act.id!r}")
        seen.add(act.id)
    return Manifest(providers=providers, defaults=defaults, acts=acts, _by_id={a.id: a for a in acts})
```

- [ ] **Step 4: Write the shipped manifest**

`archivio_normativo/manifest.yaml` — the corpus from the spec's "Initial corpus" table. Codici use VisuaLex's codice names (no date/number: `visualex_api/tools/map.py` `NORMATTIVA_URN_CODICI`); everything else carries date and number. Annex numbers for the c.p.a. norme di attuazione are checked by the first `--dry-run` (the tree lists every annex with its label) and corrected in this file if needed.

```yaml
version: 1

providers:
  visualex:
    base_url: "http://localhost:5000"
  legalit:
    # The MCP server, as the Claude plugin starts it. Override with the
    # LEGALIT_MCP_COMMAND environment variable (a JSON list).
    command: ["bash", "~/.claude/plugins/cache/mcp-legal-it/legal-it/2.13.0/start_server.sh"]

defaults:
  version: vigente
  rate_per_second: 1.0
  enrich_rate_per_second: 0.5
  enrich_ttl_days: 90
  enrich: []
  batch_size: 25

acts:
  # --- A) Costituzione e codici -------------------------------------------
  - id: costituzione
    area: costituzionale
    label: Costituzione della Repubblica italiana
    source: normattiva
    act_type: costituzione
    cite: "Cost."
  - id: preleggi
    area: civile
    label: Disposizioni sulla legge in generale (preleggi)
    source: normattiva
    act_type: preleggi
    cite: "preleggi"
  - id: cc
    area: civile
    label: Codice civile
    source: normattiva
    act_type: codice civile
    cite: "c.c."
  - id: cc-disp-att
    area: civile
    label: Disposizioni per l'attuazione del codice civile e disposizioni transitorie
    source: normattiva
    act_type: disposizioni per l'attuazione del Codice civile e disposizioni transitorie
    cite: "disp. att. c.c."
  - id: cpc
    area: civile
    label: Codice di procedura civile
    source: normattiva
    act_type: codice di procedura civile
    cite: "c.p.c."
  - id: cpc-disp-att
    area: civile
    label: Disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie
    source: normattiva
    act_type: disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie
    cite: "disp. att. c.p.c."
  - id: cp
    area: penale
    label: Codice penale
    source: normattiva
    act_type: codice penale
    cite: "c.p."
  - id: cpp
    area: penale
    label: Codice di procedura penale
    source: normattiva
    act_type: codice di procedura penale
    cite: "c.p.p."
  - id: cpp-disp-att
    area: penale
    label: Norme di attuazione, di coordinamento e transitorie del codice di procedura penale
    source: normattiva
    act_type: norme di attuazione, di coordinamento e transitorie del codice di procedura penale
    cite: "disp. att. c.p.p."
  - id: cpa
    area: amministrativo
    label: Codice del processo amministrativo (d.lgs. 104/2010)
    source: normattiva
    act_type: codice del processo amministrativo
    cite: "c.p.a."
  - id: cpa-disp-att
    area: amministrativo
    label: Norme di attuazione del codice del processo amministrativo (d.lgs. 104/2010, allegato 2)
    source: normattiva
    act_type: decreto legislativo
    date: 2010-07-02
    act_number: "104"
    annex: "3"   # checked against the tree by --dry-run; VisuaLex maps the code body to annex 2
    cite: "disp. att. c.p.a."
  - id: cod-consumo
    area: civile
    label: Codice del consumo (d.lgs. 206/2005)
    source: normattiva
    act_type: codice del consumo
    cite: "cod. cons."

  # --- B) Fonti nazionali di settore --------------------------------------
  - id: dlgs-231-2001
    area: penale
    label: D.Lgs. 8 giugno 2001, n. 231 (responsabilità amministrativa degli enti)
    source: normattiva
    act_type: decreto legislativo
    date: 2001-06-08
    act_number: "231"
    cite: "D.Lgs. 231/2001"
    enrich: [base_ue]
  - id: l-241-1990
    area: amministrativo
    label: L. 7 agosto 1990, n. 241 (procedimento amministrativo)
    source: normattiva
    act_type: legge
    date: 1990-08-07
    act_number: "241"
    cite: "L. 241/1990"
  - id: l-689-1981
    area: amministrativo
    label: L. 24 novembre 1981, n. 689 (sanzioni amministrative)
    source: normattiva
    act_type: legge
    date: 1981-11-24
    act_number: "689"
    cite: "L. 689/1981"
  - id: cod-privacy
    area: privacy-digitale
    label: Codice in materia di protezione dei dati personali (d.lgs. 196/2003)
    source: normattiva
    act_type: codice in materia di protezione dei dati personali
    cite: "D.Lgs. 196/2003"
    enrich: [base_ue]
  - id: cad
    area: privacy-digitale
    label: Codice dell'amministrazione digitale (d.lgs. 82/2005)
    source: normattiva
    act_type: codice dell'amministrazione digitale
    cite: "CAD"
  - id: dlgs-138-2024
    area: privacy-digitale
    label: D.Lgs. 4 settembre 2024, n. 138 (recepimento NIS2)
    source: normattiva
    act_type: decreto legislativo
    date: 2024-09-04
    act_number: "138"
    cite: "D.Lgs. 138/2024"
    enrich: [base_ue]
  - id: dlgs-23-2025
    area: privacy-digitale
    label: D.Lgs. 10 marzo 2025, n. 23 (adeguamento a DORA)
    source: normattiva
    act_type: decreto legislativo
    date: 2025-03-10
    act_number: "23"
    cite: "D.Lgs. 23/2025"
    enrich: [base_ue]
  - id: dlgs-81-2008
    area: lavoro
    label: D.Lgs. 9 aprile 2008, n. 81 (sicurezza sul lavoro)
    source: normattiva
    act_type: decreto legislativo
    date: 2008-04-09
    act_number: "81"
    cite: "D.Lgs. 81/2008"
  - id: l-300-1970
    area: lavoro
    label: L. 20 maggio 1970, n. 300 (Statuto dei lavoratori)
    source: normattiva
    act_type: legge
    date: 1970-05-20
    act_number: "300"
    cite: "L. 300/1970"
  - id: l-633-1941
    area: civile
    label: L. 22 aprile 1941, n. 633 (diritto d'autore)
    source: normattiva
    act_type: legge
    date: 1941-04-22
    act_number: "633"
    cite: "L. 633/1941"
  - id: cod-appalti
    area: amministrativo
    label: Codice dei contratti pubblici (d.lgs. 36/2023)
    source: normattiva
    act_type: codice dei contratti pubblici
    cite: "D.Lgs. 36/2023"
  - id: dlgs-33-2013
    area: amministrativo
    label: D.Lgs. 14 marzo 2013, n. 33 (trasparenza)
    source: normattiva
    act_type: decreto legislativo
    date: 2013-03-14
    act_number: "33"
    cite: "D.Lgs. 33/2013"
  - id: ccii
    area: civile
    label: Codice della crisi d'impresa e dell'insolvenza (d.lgs. 14/2019)
    source: normattiva
    act_type: codice della crisi d'impresa e dell'insolvenza
    cite: "CCII"
  - id: tuir
    area: tributario
    label: Testo unico delle imposte sui redditi (d.P.R. 917/1986)
    source: normattiva
    act_type: d.p.r.
    date: 1986-12-22
    act_number: "917"
    cite: "TUIR"
  - id: dpr-600-1973
    area: tributario
    label: D.P.R. 29 settembre 1973, n. 600 (accertamento)
    source: normattiva
    act_type: d.p.r.
    date: 1973-09-29
    act_number: "600"
    cite: "D.P.R. 600/1973"
  - id: dpr-633-1972
    area: tributario
    label: D.P.R. 26 ottobre 1972, n. 633 (IVA)
    source: normattiva
    act_type: d.p.r.
    date: 1972-10-26
    act_number: "633"
    cite: "D.P.R. 633/1972"
  - id: dlgs-546-1992
    area: tributario
    label: D.Lgs. 31 dicembre 1992, n. 546 (processo tributario)
    source: normattiva
    act_type: codice del processo tributario
    cite: "D.Lgs. 546/1992"

  # --- C) Fonti europee ---------------------------------------------------
  - id: gdpr
    area: ue
    label: Regolamento (UE) 2016/679 (GDPR)
    source: eurlex
    act_type: regolamento ue
    date: "2016"
    act_number: "679"
    celex: 32016R0679
    units: [articles, recitals]
    cite: "GDPR"
    enrich: [attuazione]
  - id: eprivacy
    area: ue
    label: Direttiva 2002/58/CE (e-privacy)
    source: eurlex
    act_type: direttiva ue
    date: "2002"
    act_number: "58"
    celex: 32002L0058
    celex_consolidated: 02002L0058-20091219
    units: [articles, recitals]
    cite: "dir. 2002/58/CE"
    enrich: [attuazione]
  - id: ai-act
    area: ue
    label: Regolamento (UE) 2024/1689 (AI Act)
    source: eurlex
    act_type: regolamento ue
    date: "2024"
    act_number: "1689"
    celex: 32024R1689
    units: [articles, recitals]
    cite: "AI Act"
  - id: nis2
    area: ue
    label: Direttiva (UE) 2022/2555 (NIS2)
    source: eurlex
    act_type: direttiva ue
    date: "2022"
    act_number: "2555"
    celex: 32022L2555
    units: [articles, recitals]
    cite: "dir. (UE) 2022/2555"
    enrich: [attuazione]
  - id: dora
    area: ue
    label: Regolamento (UE) 2022/2554 (DORA)
    source: eurlex
    act_type: regolamento ue
    date: "2022"
    act_number: "2554"
    celex: 32022R2554
    units: [articles, recitals]
    cite: "DORA"
  - id: dsa
    area: ue
    label: Regolamento (UE) 2022/2065 (Digital Services Act)
    source: eurlex
    act_type: regolamento ue
    date: "2022"
    act_number: "2065"
    celex: 32022R2065
    units: [articles, recitals]
    cite: "DSA"
  - id: dma
    area: ue
    label: Regolamento (UE) 2022/1925 (Digital Markets Act)
    source: eurlex
    act_type: regolamento ue
    date: "2022"
    act_number: "1925"
    celex: 32022R1925
    units: [articles, recitals]
    cite: "DMA"
  - id: data-act
    area: ue
    label: Regolamento (UE) 2023/2854 (Data Act)
    source: eurlex
    act_type: regolamento ue
    date: "2023"
    act_number: "2854"
    celex: 32023R2854
    units: [articles, recitals]
    cite: "Data Act"
  - id: dga
    area: ue
    label: Regolamento (UE) 2022/868 (Data Governance Act)
    source: eurlex
    act_type: regolamento ue
    date: "2022"
    act_number: "868"
    celex: 32022R0868
    units: [articles, recitals]
    cite: "DGA"
  - id: eidas
    area: ue
    label: Regolamento (UE) 910/2014 (eIDAS, testo consolidato)
    source: eurlex
    act_type: regolamento ue
    date: "2014"
    act_number: "910"
    celex: 32014R0910
    celex_consolidated: 02014R0910-20241018
    units: [articles, recitals]
    cite: "reg. eIDAS"
  - id: eidas2
    area: ue
    label: Regolamento (UE) 2024/1183 (eIDAS 2)
    source: eurlex
    act_type: regolamento ue
    date: "2024"
    act_number: "1183"
    celex: 32024R1183
    units: [articles, recitals]
    cite: "reg. (UE) 2024/1183"
  - id: cra
    area: ue
    label: Regolamento (UE) 2024/2847 (Cyber Resilience Act)
    source: eurlex
    act_type: regolamento ue
    date: "2024"
    act_number: "2847"
    celex: 32024R2847
    units: [articles, recitals]
    cite: "CRA"
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_manifest.py -q`
Expected: all passed. `test_it_loads` needs ≥ 40 acts: the file above has 41.

- [ ] **Step 6: Commit**

```bash
git add archivio_normativo/manifest.py archivio_normativo/manifest.yaml tests/archivio/test_manifest.py
git commit -m "feat(archivio): strict manifest loader and the shipped corpus

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `hierarchy.py` — numbers and headings from the tree

**Files:**
- Create: `archivio_normativo/hierarchy.py`
- Test: `tests/archivio/test_hierarchy.py`

**Interfaces:**
- Produces:
  - `LEVELS = ("parte", "libro", "titolo", "capo", "sezione")`.
  - `normalize_number(raw: str) -> str` — `"Art. 2 bis"`, `"2-BIS"`, `"2bis"` → `"2-bis"`; `"2043"` → `"2043"`; the client-side mirror of the server's `normalize_article_key`, reading the shared suffix table.
  - `classify_heading(text: str) -> tuple[str, str] | None` — `("libro", "LIBRO QUARTO Delle obbligazioni")` or `None` for a string that is not a heading (annex labels, noise).
  - `IndexedArticle(number, raw_number, position, annex, parte, libro, titolo, capo, sezione)` (frozen).
  - `walk_tree(items: list) -> list[IndexedArticle]` — `items` is the `articles` list `/fetch_tree` returns with `details=true`: strings (headings, annex labels) and dicts (`numero`, optional `allegato`). Positions start at 0 and count articles only.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_hierarchy.py`:

```python
"""From the flat, stateful listing VisuaLex's tree gives, to a place for each
article: LIBRO resets TITOLO/CAPO/SEZIONE, a new annex resets everything, and
a string that is not a heading (an annex label) changes nothing."""
from archivio_normativo.hierarchy import (
    IndexedArticle, classify_heading, normalize_number, walk_tree,
)


class TestNormalizeNumber:
    def test_forms(self):
        assert normalize_number("2043") == "2043"
        assert normalize_number("2 bis") == "2-bis"
        assert normalize_number("2-BIS") == "2-bis"
        assert normalize_number("2bis") == "2-bis"
        assert normalize_number("Art. 2043") == "2043"
        assert normalize_number("art 25 terdecies") == "25-terdecies"
        assert normalize_number("2409 octiesdecies") == "2409-octiesdecies"
        assert normalize_number(" 7. ") == "7"

    def test_unknown_tails_collapse_to_dashes(self):
        assert normalize_number("1 allegato A") == "1-allegato-a"


class TestClassifyHeading:
    def test_levels(self):
        assert classify_heading("LIBRO QUARTO Delle obbligazioni") == ("libro", "LIBRO QUARTO Delle obbligazioni")
        assert classify_heading("Titolo IX Dei fatti illeciti") == ("titolo", "Titolo IX Dei fatti illeciti")
        assert classify_heading("CAPO I") == ("capo", "CAPO I")
        assert classify_heading("  SEZIONE   II  Degli effetti ") == ("sezione", "SEZIONE II Degli effetti")
        assert classify_heading("PARTE I Diritti e doveri dei cittadini") == ("parte", "PARTE I Diritti e doveri dei cittadini")

    def test_non_headings(self):
        assert classify_heading("CODICE CIVILE") is None
        assert classify_heading("Disposizioni sulla legge in generale") is None
        assert classify_heading("Capoluogo") is None  # word boundary: not CAPO
        assert classify_heading("") is None


class TestWalkTree:
    def test_headings_nest_and_reset(self):
        items = [
            "LIBRO QUARTO Delle obbligazioni",
            "TITOLO I Delle obbligazioni in generale",
            "CAPO I Disposizioni preliminari",
            {"numero": "1173", "allegato": "2"},
            "CAPO II Dell'adempimento",
            "SEZIONE I Dell'adempimento in generale",
            {"numero": "1176", "allegato": "2"},
            "TITOLO IX Dei fatti illeciti",
            {"numero": "2043", "allegato": "2"},
            "LIBRO QUINTO Del lavoro",
            {"numero": "2060", "allegato": "2"},
        ]
        out = walk_tree(items)
        assert [a.number for a in out] == ["1173", "1176", "2043", "2060"]
        assert [a.position for a in out] == [0, 1, 2, 3]
        a1173, a1176, a2043, a2060 = out
        assert (a1173.libro, a1173.titolo, a1173.capo, a1173.sezione) == (
            "LIBRO QUARTO Delle obbligazioni", "TITOLO I Delle obbligazioni in generale",
            "CAPO I Disposizioni preliminari", None)
        assert (a1176.capo, a1176.sezione) == ("CAPO II Dell'adempimento", "SEZIONE I Dell'adempimento in generale")
        assert (a2043.titolo, a2043.capo, a2043.sezione) == ("TITOLO IX Dei fatti illeciti", None, None)
        assert (a2060.libro, a2060.titolo) == ("LIBRO QUINTO Del lavoro", None)
        assert all(a.annex == "2" for a in out)

    def test_a_new_annex_resets_every_level_and_labels_do_not(self):
        items = [
            "Disposizioni sulla legge in generale",      # annex label, not a heading
            "CAPO I Delle fonti del diritto",
            {"numero": "1", "allegato": "1"},
            "CODICE CIVILE",                             # annex label
            "LIBRO PRIMO Delle persone e della famiglia",
            {"numero": "1", "allegato": "2"},
            {"numero": "2", "allegato": "2"},
        ]
        out = walk_tree(items)
        assert out[0] == IndexedArticle(number="1", raw_number="1", position=0, annex="1",
                                        parte=None, libro=None, titolo=None,
                                        capo="CAPO I Delle fonti del diritto", sezione=None)
        assert out[1].annex == "2" and out[1].capo is None
        assert out[1].libro == "LIBRO PRIMO Delle persone e della famiglia"
        assert out[2].position == 2

    def test_numbers_are_normalised_and_the_raw_kept(self):
        out = walk_tree([{"numero": "2 bis", "allegato": None}])
        assert out[0].number == "2-bis"
        assert out[0].raw_number == "2 bis"
        assert out[0].annex is None

    def test_eu_items_have_no_annex_key(self):
        out = walk_tree(["CAPO I", {"numero": "1"}, {"numero": "2"}])
        assert [a.annex for a in out] == [None, None]
        assert out[1].capo == "CAPO I"

    def test_parte_sits_above_libro(self):
        out = walk_tree(["PARTE I Diritti e doveri dei cittadini", "TITOLO I Rapporti civili",
                         {"numero": "13"}, "PARTE II Ordinamento della Repubblica", {"numero": "55"}])
        assert (out[0].parte, out[0].titolo) == ("PARTE I Diritti e doveri dei cittadini", "TITOLO I Rapporti civili")
        assert (out[1].parte, out[1].titolo) == ("PARTE II Ordinamento della Repubblica", None)

    def test_non_article_dicts_are_skipped(self):
        out = walk_tree([{"numero": ""}, {"foo": 1}, {"numero": "3"}])
        assert [a.number for a in out] == ["3"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_hierarchy.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`archivio_normativo/hierarchy.py`:

```python
"""Where an article sits in its act, read from the tree VisuaLex serves.

`/fetch_tree` with `details=true` answers a flat, stateful listing: heading
strings ("LIBRO QUARTO Delle obbligazioni", "CAPO I …"), annex labels
("CODICE CIVILE") and article dicts, in document order. Nesting is implied by
order, so it is rebuilt here with a stack: a heading at one level clears
every level below it, and a change of annex clears them all.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from visualex_api.tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION

LEVELS: tuple[str, ...] = ("parte", "libro", "titolo", "capo", "sezione")

_HEADING = re.compile(r"^(PARTE|LIBRO|TITOLO|CAPO|SEZIONE)\b", re.IGNORECASE)
_ART_PREFIX = re.compile(r"^\s*art(?:icol[oi])?\.?\s*", re.IGNORECASE)
_SUFFIXED = re.compile(rf"^(\d+)\s*-?\s*({ARTICLE_SUFFIX_ALTERNATION})\b$")


def normalize_number(raw: str) -> str:
    """Canonical article key: "2 bis" / "2-BIS" / "2bis" -> "2-bis"."""
    key = str(raw or "").strip().lower()
    key = _ART_PREFIX.sub("", key).strip().rstrip(".").strip()
    match = _SUFFIXED.match(key)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    if re.fullmatch(r"\d+", key):
        return key
    key = re.sub(r"\s+", "-", key)
    return re.sub(r"-{2,}", "-", key).strip("-")


def classify_heading(text: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    match = _HEADING.match(cleaned)
    if not match:
        return None
    return match.group(1).lower(), cleaned


@dataclass(frozen=True)
class IndexedArticle:
    number: str
    raw_number: str
    position: int
    annex: str | None
    parte: str | None
    libro: str | None
    titolo: str | None
    capo: str | None
    sezione: str | None


def walk_tree(items: list) -> list[IndexedArticle]:
    levels: dict[str, str | None] = {level: None for level in LEVELS}
    # Headings met since the last article. When the next article opens a new
    # annex, the levels are cleared and these are replayed: they belong to the
    # annex being entered, not to the one being left.
    pending: list[tuple[str, str]] = []
    current_annex: str | None = None
    seen_any = False
    out: list[IndexedArticle] = []

    def apply(level: str, text: str) -> None:
        levels[level] = text
        for lower in LEVELS[LEVELS.index(level) + 1:]:
            levels[lower] = None

    for item in items:
        if isinstance(item, str):
            heading = classify_heading(item)
            if heading is None:
                continue  # an annex label or noise: the annex change is read off the articles
            apply(*heading)
            pending.append(heading)
            continue
        if not isinstance(item, dict):
            continue
        raw = item.get("numero")
        if not raw or not str(raw).strip():
            continue
        annex = item.get("allegato")
        annex = str(annex) if annex is not None else None
        if seen_any and annex != current_annex:
            for level in LEVELS:
                levels[level] = None
            for heading in pending:
                apply(*heading)
        pending = []
        current_annex = annex
        seen_any = True
        out.append(IndexedArticle(
            number=normalize_number(str(raw)),
            raw_number=str(raw),
            position=len(out),
            annex=annex,
            parte=levels["parte"],
            libro=levels["libro"],
            titolo=levels["titolo"],
            capo=levels["capo"],
            sezione=levels["sezione"],
        ))
    return out
```

The second test pins down the subtlety: "LIBRO PRIMO" arrives *before* the first article of annex 2, while the annex change is only visible on that article — so the reset clears the levels and then replays the headings met since the previous article, which belong to the annex being entered.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_hierarchy.py -q`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/hierarchy.py tests/archivio/test_hierarchy.py
git commit -m "feat(archivio): rebuild libro/titolo/capo/sezione from the tree listing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `store.py` — the SQLite archive

**Files:**
- Create: `archivio_normativo/store.py`
- Test: `tests/archivio/test_store.py`

**Interfaces:**
- Produces:
  - `text_hash(text: str) -> str` (sha256 hex).
  - `ActRecord(id, area, label, source, identifier, act_type, date, act_number, annex, source_url, text_status, consolidated_celex)` and `UnitRecord(id, act_id, kind, number, position, identifier, rubrica, parte, libro, titolo, capo, sezione, text, fingerprint, abrogato, version, vigenza_al, ultimo_aggiornamento, source_url, fetched_at)` — plain dataclasses; `UnitRecord.text_hash` is computed, never passed.
  - `Store(path: Path)` with `close()`, context-manager support, and:
    - runs: `start_run(args: dict, started_at: str) -> int`, `finish_run(run_id, status, finished_at, stats: dict)`, `mark_running_as_interrupted() -> list[int]`, `latest_interrupted_run() -> int | None`, `get_run(run_id) -> dict | None`, `latest_run() -> dict | None`.
    - acts: `upsert_act(record: ActRecord, unit_count: int, updated_at: str)`, `acts() -> list[ActRecord]`, `get_act(act_id) -> ActRecord | None`.
    - units: `get_unit(unit_id) -> UnitRecord | None`, `upsert_unit(record, run_id) -> str` (`"new" | "updated" | "unchanged"`), `touch_checked(unit_id, run_id, vigenza_al)`, `units_for_act(act_id) -> list[UnitRecord]` (by position), `fingerprints_for_act(act_id) -> dict[str, str]` (article number → fingerprint), `unit_run_columns(unit_id) -> tuple[int, int, int]` (first_seen, last_changed, last_checked).
    - enrichments: `get_enrichment(act_id, unit_id, kind) -> dict | None`, `upsert_enrichment(act_id, unit_id, kind, tool, params, content_md, content_json, status, error, fetched_at, run_id)`, `enrichments_for_act(act_id) -> list[dict]`. Act-level enrichments use `unit_id=""`.
    - log: `log_unit(run_id, unit_id, outcome, reason=None)`, `logged_unit_ids(run_id) -> set[str]`, `act_changed_in_run(act_id, run_id) -> bool`.
    - export: `iter_units() -> Iterator[dict]` (unit row joined with its act's area/label and its enrichments).

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_store.py`:

```python
"""The archive on disk. Every write is a transaction; the text hash is the
change registry; nothing is guessed about time — callers pass ISO strings."""
import pytest

from archivio_normativo.store import ActRecord, Store, UnitRecord, text_hash


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "archivio.sqlite") as s:
        yield s


def act(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                identifier="urn:nir:stato:regio.decreto:1942-03-16;262", act_type="codice civile",
                date="1942-03-16", act_number="262", annex="2", source_url="https://www.normattiva.it/x",
                text_status="consolidated", consolidated_celex=None)
    base.update(kw)
    return ActRecord(**base)


def unit(number="2043", text="Qualunque fatto doloso o colposo…", **kw):
    base = dict(id=f"cc:art:{number}", act_id="cc", kind="article", number=number, position=0,
                identifier=f"urn:nir:stato:regio.decreto:1942-03-16;262:2~art{number}",
                rubrica="Risarcimento per fatto illecito", parte=None, libro="LIBRO QUARTO", titolo="TITOLO IX",
                capo=None, sezione=None, text=text, fingerprint="f" * 64, abrogato=False,
                version="vigente", vigenza_al="2026-09-19", ultimo_aggiornamento=None,
                source_url="https://www.normattiva.it/art2043", fetched_at="2026-09-19T21:00:00")
    base.update(kw)
    return UnitRecord(**base)


class TestRuns:
    def test_start_finish_and_read_back(self, store):
        run_id = store.start_run({"only": ["cc"]}, started_at="2026-09-19T21:00:00")
        assert store.get_run(run_id)["status"] == "running"
        store.finish_run(run_id, "done", finished_at="2026-09-19T21:05:00", stats={"new": 3})
        run = store.get_run(run_id)
        assert run["status"] == "done"
        assert run["stats"] == {"new": 3}
        assert run["args"] == {"only": ["cc"]}
        assert store.latest_run()["id"] == run_id

    def test_running_runs_become_interrupted_on_the_next_start(self, store):
        crashed = store.start_run({}, started_at="2026-09-19T21:00:00")
        assert store.mark_running_as_interrupted() == [crashed]
        assert store.get_run(crashed)["status"] == "interrupted"
        assert store.latest_interrupted_run() == crashed
        assert store.mark_running_as_interrupted() == []


class TestUnits:
    def test_new_then_unchanged_then_updated(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="2026-09-19T21:00:00")
        r1 = store.start_run({}, "2026-09-19T21:00:00")
        assert store.upsert_unit(unit(), r1) == "new"
        r2 = store.start_run({}, "2026-09-20T21:00:00")
        assert store.upsert_unit(unit(vigenza_al="2026-09-20", fetched_at="2026-09-20T21:00:00"), r2) == "unchanged"
        stored = store.get_unit("cc:art:2043")
        assert stored.vigenza_al == "2026-09-20", "an unchanged text is still 'in force as of' the new check"
        assert store.unit_run_columns("cc:art:2043") == (r1, r1, r2)
        r3 = store.start_run({}, "2026-09-21T21:00:00")
        assert store.upsert_unit(unit(text="Testo modificato."), r3) == "updated"
        stored = store.get_unit("cc:art:2043")
        assert stored.text == "Testo modificato."
        assert stored.text_hash == text_hash("Testo modificato.")
        assert store.unit_run_columns("cc:art:2043") == (r1, r3, r3)

    def test_metadata_changes_alone_do_not_count_as_updates(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        r2 = store.start_run({}, "t")
        assert store.upsert_unit(unit(rubrica="Nuova rubrica", fingerprint="g" * 64), r2) == "unchanged"
        stored = store.get_unit("cc:art:2043")
        assert stored.rubrica == "Nuova rubrica" and stored.fingerprint == "g" * 64

    def test_touch_checked_moves_the_check_and_the_vigenza(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        r2 = store.start_run({}, "t")
        store.touch_checked("cc:art:2043", r2, vigenza_al="2026-10-01")
        assert store.unit_run_columns("cc:art:2043") == (r1, r1, r2)
        assert store.get_unit("cc:art:2043").vigenza_al == "2026-10-01"

    def test_units_for_act_come_back_in_position_order(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_unit(unit("2044", position=1), r)
        store.upsert_unit(unit("2043", position=0), r)
        store.upsert_unit(UnitRecord(id="cc:rec:1", act_id="cc", kind="recital", number="1", position=0,
                                     identifier="x#rct_1", rubrica=None, parte=None, libro=None, titolo=None,
                                     capo=None, sezione=None, text="Considerando.", fingerprint=None,
                                     abrogato=False, version="vigente", vigenza_al="d", ultimo_aggiornamento=None,
                                     source_url="x", fetched_at="t"), r)
        numbers = [(u.kind, u.number) for u in store.units_for_act("cc")]
        assert numbers == [("article", "2043"), ("article", "2044"), ("recital", "1")]
        assert store.fingerprints_for_act("cc") == {"2043": "f" * 64, "2044": "f" * 64}

    def test_get_unit_missing(self, store):
        assert store.get_unit("nope") is None


class TestEnrichments:
    def test_upsert_replaces_by_key(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                                {"riferimento": "art. 2043 c.c."}, "## Sentenze…", None, "ok", None, "t1", r)
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                                {"riferimento": "art. 2043 c.c."}, "## Sentenze nuove", None, "ok", None, "t2", r)
        rows = store.enrichments_for_act("cc")
        assert len(rows) == 1
        assert rows[0]["content_md"] == "## Sentenze nuove"
        assert rows[0]["fetched_at"] == "t2"
        got = store.get_enrichment("cc", "cc:art:2043", "cassazione")
        assert got["params"] == {"riferimento": "art. 2043 c.c."}
        assert got["content_hash"] == text_hash("## Sentenze nuove")

    def test_act_level_uses_the_empty_unit_id(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "", "base_ue", "get_eu_basis", {"atto": "c.c."}, "nessuna", None, "empty", None, "t", r)
        assert store.get_enrichment("cc", "", "base_ue")["status"] == "empty"
        assert store.get_enrichment("cc", "cc:art:1", "base_ue") is None

    def test_json_content_round_trips(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "cc:art:2043", "brocardi", "visualex.show_brocardi_info", {},
                                None, {"Ratio": "…", "Massime": ["a", "b"]}, "ok", None, "t", r)
        assert store.get_enrichment("cc", "cc:art:2043", "brocardi")["content_json"] == {"Ratio": "…", "Massime": ["a", "b"]}


class TestLogAndChange:
    def test_log_and_resume_set(self, store):
        r = store.start_run({}, "t")
        store.log_unit(r, "cc:art:1", "new")
        store.log_unit(r, "cc:art:2", "failed", "404 not in act")
        store.log_unit(r, "cc:art:2", "unchanged")  # a later outcome for the same unit replaces
        assert store.logged_unit_ids(r) == {"cc:art:1", "cc:art:2"}

    def test_act_changed_in_run(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        store.log_unit(r1, "cc:art:2043", "new")
        assert store.act_changed_in_run("cc", r1) is True
        r2 = store.start_run({}, "t")
        store.log_unit(r2, "cc:art:2043", "unchanged")
        assert store.act_changed_in_run("cc", r2) is False
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "t", {}, "x", None, "ok", None, "t", r2)
        assert store.act_changed_in_run("cc", r2) is True


class TestActsAndExport:
    def test_act_upsert_and_listing(self, store):
        store.upsert_act(act(), unit_count=3, updated_at="t1")
        store.upsert_act(act(label="Codice civile (agg.)"), unit_count=4, updated_at="t2")
        acts = store.acts()
        assert len(acts) == 1 and acts[0].label == "Codice civile (agg.)"
        assert store.get_act("cc").annex == "2"

    def test_iter_units_joins_act_and_enrichments(self, store):
        store.upsert_act(act(), unit_count=1, updated_at="t")
        r = store.start_run({}, "t")
        store.upsert_unit(unit(), r)
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "tool", {}, "md", None, "ok", None, "t", r)
        rows = list(store.iter_units())
        assert rows[0]["id"] == "cc:art:2043"
        assert rows[0]["area"] == "civile"
        assert rows[0]["enrichments"][0]["kind"] == "cassazione"
        assert "text_hash" in rows[0]
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_store.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`archivio_normativo/store.py`:

```python
"""The archive: one SQLite file, one transaction per write.

`text_hash` is the change registry — a unit is "updated" only when the sha256
of its text moves. Everything else on the row (rubrica, position, headings,
fingerprint, dates) is refreshed silently, because none of it is what the
owner reads. Time never comes from here: callers pass ISO strings, so tests
are exact and a run's timestamps are consistent.

Act-level enrichments (attuazione, base_ue) use `unit_id = ""` rather than
NULL so the (act_id, unit_id, kind) key stays a plain UNIQUE.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Iterator


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


@dataclass
class ActRecord:
    id: str
    area: str
    label: str
    source: str
    identifier: str | None
    act_type: str
    date: str | None
    act_number: str | None
    annex: str | None
    source_url: str | None
    text_status: str
    consolidated_celex: str | None


@dataclass
class UnitRecord:
    id: str
    act_id: str
    kind: str
    number: str
    position: int
    identifier: str | None
    rubrica: str | None
    parte: str | None
    libro: str | None
    titolo: str | None
    capo: str | None
    sezione: str | None
    text: str
    fingerprint: str | None
    abrogato: bool
    version: str
    vigenza_al: str
    ultimo_aggiornamento: str | None
    source_url: str | None
    fetched_at: str

    @property
    def text_hash(self) -> str:
        return text_hash(self.text)


_UNIT_COLUMNS = [f.name for f in fields(UnitRecord)]
_ACT_COLUMNS = [f.name for f in fields(ActRecord)]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS acts (
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    identifier TEXT,
    act_type TEXT NOT NULL,
    date TEXT,
    act_number TEXT,
    annex TEXT,
    source_url TEXT,
    text_status TEXT NOT NULL,
    consolidated_celex TEXT,
    unit_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    act_id TEXT NOT NULL REFERENCES acts(id),
    kind TEXT NOT NULL,
    number TEXT NOT NULL,
    position INTEGER NOT NULL,
    identifier TEXT,
    rubrica TEXT,
    parte TEXT,
    libro TEXT,
    titolo TEXT,
    capo TEXT,
    sezione TEXT,
    text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    fingerprint TEXT,
    abrogato INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL,
    vigenza_al TEXT NOT NULL,
    ultimo_aggiornamento TEXT,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    first_seen_run INTEGER NOT NULL,
    last_changed_run INTEGER NOT NULL,
    last_checked_run INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS units_by_act ON units(act_id, kind, position);
CREATE TABLE IF NOT EXISTS enrichments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    act_id TEXT NOT NULL,
    unit_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    tool TEXT NOT NULL,
    params_json TEXT NOT NULL,
    content_md TEXT,
    content_json TEXT,
    content_hash TEXT,
    fetched_at TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    UNIQUE (act_id, unit_id, kind)
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    args_json TEXT NOT NULL,
    status TEXT NOT NULL,
    stats_json TEXT
);
CREATE TABLE IF NOT EXISTS unit_log (
    run_id INTEGER NOT NULL,
    unit_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    reason TEXT,
    PRIMARY KEY (run_id, unit_id)
);
"""


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(self.path), isolation_level=None)  # autocommit; explicit BEGIN below
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(_SCHEMA)

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- runs ---------------------------------------------------------------

    def start_run(self, args: dict, started_at: str) -> int:
        cur = self._db.execute(
            "INSERT INTO runs (started_at, args_json, status) VALUES (?, ?, 'running')",
            (started_at, json.dumps(args, ensure_ascii=False, sort_keys=True)),
        )
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, finished_at: str, stats: dict) -> None:
        self._db.execute(
            "UPDATE runs SET status = ?, finished_at = ?, stats_json = ? WHERE id = ?",
            (status, finished_at, json.dumps(stats, ensure_ascii=False, sort_keys=True), run_id),
        )

    def mark_running_as_interrupted(self) -> list[int]:
        rows = self._db.execute("SELECT id FROM runs WHERE status = 'running' ORDER BY id").fetchall()
        ids = [int(r["id"]) for r in rows]
        if ids:
            self._db.execute("UPDATE runs SET status = 'interrupted' WHERE status = 'running'")
        return ids

    def latest_interrupted_run(self) -> int | None:
        row = self._db.execute(
            "SELECT id FROM runs WHERE status = 'interrupted' ORDER BY id DESC LIMIT 1").fetchone()
        return int(row["id"]) if row else None

    def get_run(self, run_id: int) -> dict | None:
        row = self._db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return self._run_dict(row) if row else None

    def latest_run(self) -> dict | None:
        row = self._db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        return self._run_dict(row) if row else None

    @staticmethod
    def _run_dict(row) -> dict:
        return {
            "id": int(row["id"]),
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "status": row["status"],
            "args": json.loads(row["args_json"] or "{}"),
            "stats": json.loads(row["stats_json"]) if row["stats_json"] else None,
        }

    # -- acts ---------------------------------------------------------------

    def upsert_act(self, record: ActRecord, unit_count: int, updated_at: str) -> None:
        values = asdict(record)
        values["unit_count"] = unit_count
        values["updated_at"] = updated_at
        columns = list(values)
        placeholders = ", ".join("?" for _ in columns)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "id")
        self._db.execute(
            f"INSERT INTO acts ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}",
            [values[c] for c in columns],
        )

    def acts(self) -> list[ActRecord]:
        rows = self._db.execute("SELECT * FROM acts ORDER BY area, id").fetchall()
        return [ActRecord(**{c: row[c] for c in _ACT_COLUMNS}) for row in rows]

    def get_act(self, act_id: str) -> ActRecord | None:
        row = self._db.execute("SELECT * FROM acts WHERE id = ?", (act_id,)).fetchone()
        return ActRecord(**{c: row[c] for c in _ACT_COLUMNS}) if row else None

    def act_unit_count(self, act_id: str) -> int:
        row = self._db.execute("SELECT unit_count FROM acts WHERE id = ?", (act_id,)).fetchone()
        return int(row["unit_count"]) if row else 0

    # -- units --------------------------------------------------------------

    def get_unit(self, unit_id: str) -> UnitRecord | None:
        row = self._db.execute("SELECT * FROM units WHERE id = ?", (unit_id,)).fetchone()
        return self._unit_from_row(row) if row else None

    @staticmethod
    def _unit_from_row(row) -> UnitRecord:
        values = {c: row[c] for c in _UNIT_COLUMNS}
        values["abrogato"] = bool(values["abrogato"])
        return UnitRecord(**values)

    def upsert_unit(self, record: UnitRecord, run_id: int) -> str:
        values = asdict(record)
        values["abrogato"] = int(record.abrogato)
        values["text_hash"] = record.text_hash
        existing = self._db.execute(
            "SELECT text_hash FROM units WHERE id = ?", (record.id,)).fetchone()
        self._db.execute("BEGIN")
        try:
            if existing is None:
                columns = list(values) + ["first_seen_run", "last_changed_run", "last_checked_run"]
                params = [values[c] for c in values] + [run_id, run_id, run_id]
                self._db.execute(
                    f"INSERT INTO units ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                    params,
                )
                outcome = "new"
            else:
                changed = existing["text_hash"] != values["text_hash"]
                columns = [c for c in values if c != "id"]
                sets = ", ".join(f"{c} = ?" for c in columns) + ", last_checked_run = ?"
                params = [values[c] for c in columns] + [run_id]
                if changed:
                    sets += ", last_changed_run = ?"
                    params.append(run_id)
                params.append(record.id)
                self._db.execute(f"UPDATE units SET {sets} WHERE id = ?", params)
                outcome = "updated" if changed else "unchanged"
            self._db.execute("COMMIT")
        except Exception:
            self._db.execute("ROLLBACK")
            raise
        return outcome

    def touch_checked(self, unit_id: str, run_id: int, vigenza_al: str) -> None:
        self._db.execute(
            "UPDATE units SET last_checked_run = ?, vigenza_al = ? WHERE id = ?",
            (run_id, vigenza_al, unit_id),
        )

    def unit_run_columns(self, unit_id: str) -> tuple[int, int, int]:
        row = self._db.execute(
            "SELECT first_seen_run, last_changed_run, last_checked_run FROM units WHERE id = ?",
            (unit_id,)).fetchone()
        return (int(row["first_seen_run"]), int(row["last_changed_run"]), int(row["last_checked_run"]))

    def units_for_act(self, act_id: str) -> list[UnitRecord]:
        rows = self._db.execute(
            "SELECT * FROM units WHERE act_id = ? ORDER BY CASE kind WHEN 'article' THEN 0 ELSE 1 END, position",
            (act_id,)).fetchall()
        return [self._unit_from_row(r) for r in rows]

    def fingerprints_for_act(self, act_id: str) -> dict[str, str]:
        rows = self._db.execute(
            "SELECT number, fingerprint FROM units WHERE act_id = ? AND kind = 'article' AND fingerprint IS NOT NULL",
            (act_id,)).fetchall()
        return {r["number"]: r["fingerprint"] for r in rows}

    # -- enrichments ---------------------------------------------------------

    def get_enrichment(self, act_id: str, unit_id: str, kind: str) -> dict | None:
        row = self._db.execute(
            "SELECT * FROM enrichments WHERE act_id = ? AND unit_id = ? AND kind = ?",
            (act_id, unit_id or "", kind)).fetchone()
        return self._enrichment_dict(row) if row else None

    def upsert_enrichment(self, act_id: str, unit_id: str, kind: str, tool: str, params: dict,
                          content_md: str | None, content_json, status: str, error: str | None,
                          fetched_at: str, run_id: int) -> None:
        content_hash = text_hash(content_md) if content_md else (
            text_hash(json.dumps(content_json, ensure_ascii=False, sort_keys=True)) if content_json is not None else None)
        self._db.execute(
            "INSERT INTO enrichments (act_id, unit_id, kind, tool, params_json, content_md, content_json, "
            "content_hash, fetched_at, run_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(act_id, unit_id, kind) DO UPDATE SET tool = excluded.tool, "
            "params_json = excluded.params_json, content_md = excluded.content_md, "
            "content_json = excluded.content_json, content_hash = excluded.content_hash, "
            "fetched_at = excluded.fetched_at, run_id = excluded.run_id, status = excluded.status, "
            "error = excluded.error",
            (act_id, unit_id or "", kind, tool, json.dumps(params, ensure_ascii=False, sort_keys=True),
             content_md, json.dumps(content_json, ensure_ascii=False) if content_json is not None else None,
             content_hash, fetched_at, run_id, status, error),
        )

    def enrichments_for_act(self, act_id: str) -> list[dict]:
        rows = self._db.execute(
            "SELECT * FROM enrichments WHERE act_id = ? ORDER BY unit_id, kind", (act_id,)).fetchall()
        return [self._enrichment_dict(r) for r in rows]

    @staticmethod
    def _enrichment_dict(row) -> dict:
        return {
            "act_id": row["act_id"],
            "unit_id": row["unit_id"],
            "kind": row["kind"],
            "tool": row["tool"],
            "params": json.loads(row["params_json"] or "{}"),
            "content_md": row["content_md"],
            "content_json": json.loads(row["content_json"]) if row["content_json"] else None,
            "content_hash": row["content_hash"],
            "fetched_at": row["fetched_at"],
            "run_id": int(row["run_id"]),
            "status": row["status"],
            "error": row["error"],
        }

    # -- log ----------------------------------------------------------------

    def log_unit(self, run_id: int, unit_id: str, outcome: str, reason: str | None = None) -> None:
        self._db.execute(
            "INSERT INTO unit_log (run_id, unit_id, outcome, reason) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(run_id, unit_id) DO UPDATE SET outcome = excluded.outcome, reason = excluded.reason",
            (run_id, unit_id, outcome, reason),
        )

    def logged_unit_ids(self, run_id: int) -> set[str]:
        rows = self._db.execute("SELECT unit_id FROM unit_log WHERE run_id = ?", (run_id,)).fetchall()
        return {r["unit_id"] for r in rows}

    def act_changed_in_run(self, act_id: str, run_id: int) -> bool:
        row = self._db.execute(
            "SELECT 1 FROM unit_log l JOIN units u ON u.id = l.unit_id "
            "WHERE l.run_id = ? AND u.act_id = ? AND l.outcome IN ('new', 'updated') LIMIT 1",
            (run_id, act_id)).fetchone()
        if row:
            return True
        row = self._db.execute(
            "SELECT 1 FROM enrichments WHERE act_id = ? AND run_id = ? LIMIT 1", (act_id, run_id)).fetchone()
        return row is not None

    # -- export -------------------------------------------------------------

    def iter_units(self) -> Iterator[dict]:
        rows = self._db.execute(
            "SELECT u.*, a.area, a.label AS act_label FROM units u JOIN acts a ON a.id = u.act_id "
            "ORDER BY a.area, a.id, CASE u.kind WHEN 'article' THEN 0 ELSE 1 END, u.position").fetchall()
        for row in rows:
            record = dict(row)
            record["abrogato"] = bool(record["abrogato"])
            record["enrichments"] = [
                self._enrichment_dict(e) for e in self._db.execute(
                    "SELECT * FROM enrichments WHERE unit_id = ? ORDER BY kind", (row["id"],)).fetchall()
            ]
            yield record
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_store.py -q`
Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/store.py tests/archivio/test_store.py
git commit -m "feat(archivio): SQLite store with hash registry, runs and unit log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `sources/visualex.py` — the VisuaLex client, and the fake server for tests

**Files:**
- Create: `archivio_normativo/sources/visualex.py`
- Create: `tests/archivio/fake_visualex.py`, `tests/archivio/conftest.py`
- Test: `tests/archivio/test_visualex_client.py`

**Interfaces:**
- Consumes: `Throttle`, `with_backoff`, `RetryableError` (Task 1); `ActSpec` (Task 2); `normalize_number` (Task 3).
- Produces (module `archivio_normativo.sources.visualex`):
  - `VisuaLexError(Exception)` with `.status: int | None`; `VisuaLexRetryable(VisuaLexError, RetryableError)`.
  - frozen dataclasses `ActResolution(act_url, annex, tipo_atto, data, numero_atto, sample_urn)`, `TreeResult(items, count, annexes)`, `RubricheResult(rubriche, abrogati, parts)`, `FingerprintsResult(available, fingerprints, parts)`, `Recital(number, text)`, `ArticleResult(number, raw_number, text, urn, url, annex, brocardi, brocardi_error, error)`.
  - `VisuaLexClient(base_url, session, throttle, *, timeout=120, attempts=5, sleep=asyncio.sleep, jitter=random.random, on_retry=None)` with `resolve_act(spec)`, `fetch_tree(act_url)`, `fetch_rubriche(act_url)`, `fetch_fingerprints(act_url)`, `fetch_recitals(spec)`, `stream_articles(spec, numbers, annex, brocardi) -> list[ArticleResult]` (one batch; the pipeline slices batches).
  - `select_fingerprints(result: FingerprintsResult, numbers: Iterable[str]) -> dict[str, dict]` — the map (dominant or one of the parts) whose keys overlap the given article numbers most; `{}` when nothing overlaps.
- Test helpers (module `tests.archivio.fake_visualex`): `FakeVisuaLex` with `.acts` scenarios keyed by `FakeVisuaLex.key(act_type, date, act_number, celex_consolidated)`, `.calls`, `.fail[path] = [status, ...]`, `await start() -> base_url`, `await stop()`; conftest fixtures `fake_visualex`, `session`, `throttle` (a `Throttle(0)` — no pacing in tests).

- [ ] **Step 1: Write the fake server and conftest**

`tests/archivio/fake_visualex.py`:

```python
"""A scripted stand-in for the six VisuaLex endpoints the archive uses.

Shapes mirror the real API (root `app.py`): `norma_data` speaks Italian
(`tipo_atto`, `numero_articolo`, `allegato`, `urn`, `url`), the stream is
NDJSON and silently omits articles the act does not have, `fetch_rubriche`
and `fetch_act_fingerprints` always answer 200.
"""
from __future__ import annotations

import json

from aiohttp import web
from aiohttp.test_utils import TestServer


class FakeVisuaLex:
    def __init__(self):
        self.acts: dict[str, dict] = {}
        self.calls: list[tuple[str, dict]] = []
        self.fail: dict[str, list[int]] = {}
        self._server: TestServer | None = None

    @staticmethod
    def key(act_type, date=None, act_number=None, celex_consolidated=None) -> str:
        return "|".join(str(x or "").strip().lower() for x in (act_type, date, act_number, celex_consolidated))

    def add_act(self, *, act_type, date=None, act_number=None, celex_consolidated=None, url, annex=None,
                tree=(), annexes=None, rubriche=None, abrogati=(), fingerprints=None, recitals=(),
                articles=None, brocardi=None) -> dict:
        scenario = {
            "act_type": act_type, "date": date, "act_number": act_number,
            "celex_consolidated": celex_consolidated, "url": url, "annex": annex,
            "tree": list(tree), "annexes": annexes or [], "rubriche": rubriche or {},
            "abrogati": list(abrogati), "fingerprints": fingerprints, "recitals": list(recitals),
            "articles": dict(articles or {}), "brocardi": dict(brocardi or {}),
        }
        self.acts[self.key(act_type, date, act_number, celex_consolidated)] = scenario
        return scenario

    def _by_url(self, url: str) -> dict | None:
        url = str(url).split("~")[0]
        return next((s for s in self.acts.values() if s["url"] == url), None)

    def _scenario(self, body: dict) -> dict | None:
        return self.acts.get(self.key(body.get("act_type"), body.get("date"), body.get("act_number"),
                                      body.get("celex_consolidated")))

    async def _guard(self, request) -> tuple[dict, web.Response | None]:
        body = await request.json()
        self.calls.append((request.path, body))
        queue = self.fail.get(request.path) or []
        if queue:
            status = queue.pop(0)
            return body, web.json_response({"error": f"simulated {status}"}, status=status)
        return body, None

    @staticmethod
    def _norma_data(s: dict, number: str, annex) -> dict:
        data = {
            "tipo_atto": s["act_type"], "data": s["date"], "numero_atto": s["act_number"],
            "url": s["url"], "allegato": annex, "numero_articolo": number, "versione": "vigente",
            "data_versione": None, "urn": f"{s['url']}{':' + str(annex) if annex else ''}~art{number.replace('-', '')}",
        }
        if s["celex_consolidated"]:
            data["celex_consolidated"] = s["celex_consolidated"]
        return data

    async def fetch_norma_data(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._scenario(body)
        if s is None:
            return web.json_response({"error": f"Articolo {body.get('article')} non presente in {body.get('act_type')}"}, status=404)
        annex = body.get("annex") if body.get("annex") not in (None, "") else s["annex"]
        return web.json_response({"norma_data": [self._norma_data(s, str(body.get("article")), annex)]})

    async def fetch_tree(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._by_url(body.get("urn", ""))
        if s is None:
            return web.json_response({"error": "Div with id 'albero' not found"}, status=500)
        count = sum(1 for item in s["tree"] if isinstance(item, dict))
        return web.json_response({"articles": s["tree"], "count": count, "metadata": {"annexes": s["annexes"]}})

    async def fetch_rubriche(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._by_url(body.get("urn", ""))
        if s is None:
            return web.json_response({"rubriche": {}, "abrogati": [], "parts": [], "count": 0})
        return web.json_response({"rubriche": s["rubriche"], "abrogati": s["abrogati"], "parts": [],
                                  "count": len(s["rubriche"])})

    async def fetch_act_fingerprints(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        if "eur-lex" in str(body.get("urn", "")):
            return web.json_response({"error": "fetch_act_fingerprints accetta solo atti Normattiva"}, status=400)
        s = self._by_url(body.get("urn", ""))
        if s is None or s["fingerprints"] is None:
            return web.json_response({"available": False, "fingerprints": {}, "parts": [], "count": 0})
        fp = s["fingerprints"]
        if isinstance(fp, dict) and "parts" in fp:
            return web.json_response({"available": True, "fingerprints": fp.get("fingerprints", {}),
                                      "parts": fp["parts"], "count": len(fp.get("fingerprints", {}))})
        return web.json_response({"available": True, "fingerprints": fp, "parts": [], "count": len(fp)})

    async def fetch_recitals(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        if str(body.get("act_type", "")).lower() not in ("regolamento ue", "direttiva ue"):
            return web.json_response({"error": "fetch_recitals accetta solo atti EUR-Lex"}, status=400)
        s = self._scenario({**body, "celex_consolidated": None})
        if s is None:
            return web.json_response({"error": "EUR-Lex is down"}, status=500)
        return web.json_response({"recitals": s["recitals"], "count": len(s["recitals"]), "url": s["url"]})

    async def stream_article_text(self, request):
        body, fail = await self._guard(request)
        if fail:
            return fail
        s = self._scenario(body)
        if s is None:
            return web.json_response({"error": f"Articolo non presente in {body.get('act_type')}"}, status=404)
        annex = body.get("annex") if body.get("annex") not in (None, "") else s["annex"]
        lines = []
        for raw in str(body.get("article", "")).split(","):
            number = raw.strip().lower().replace(" ", "-")
            if number not in s["articles"]:
                continue  # the real API drops articles the act does not have
            entry = s["articles"][number]
            norma_data = self._norma_data(s, number, annex)
            if isinstance(entry, dict) and "error" in entry:
                lines.append({"error": entry["error"], "norma_data": norma_data})
                continue
            line = {"article_text": entry, "norma_data": norma_data, "url": norma_data["urn"]}
            if body.get("show_brocardi_info") and number in s["brocardi"]:
                line["brocardi_info"] = s["brocardi"][number]
            lines.append(line)
        payload = "".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines)
        return web.Response(text=payload, content_type="application/x-ndjson")

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/fetch_norma_data", self.fetch_norma_data)
        app.router.add_post("/fetch_tree", self.fetch_tree)
        app.router.add_post("/fetch_rubriche", self.fetch_rubriche)
        app.router.add_post("/fetch_act_fingerprints", self.fetch_act_fingerprints)
        app.router.add_post("/fetch_recitals", self.fetch_recitals)
        app.router.add_post("/stream_article_text", self.stream_article_text)
        return app

    async def start(self) -> str:
        self._server = TestServer(self.app())
        await self._server.start_server()
        return str(self._server.make_url("")).rstrip("/")

    async def stop(self) -> None:
        if self._server is not None:
            await self._server.close()
            self._server = None
```

`tests/archivio/conftest.py`:

```python
import aiohttp
import pytest

from archivio_normativo.throttle import Throttle
from tests.archivio.fake_visualex import FakeVisuaLex


@pytest.fixture
async def fake_visualex():
    fake = FakeVisuaLex()
    fake.base_url = await fake.start()
    try:
        yield fake
    finally:
        await fake.stop()


@pytest.fixture
async def session():
    async with aiohttp.ClientSession() as s:
        yield s


@pytest.fixture
def throttle():
    return Throttle(0)  # no pacing in tests
```

- [ ] **Step 2: Write the failing client tests**

`tests/archivio/test_visualex_client.py`:

```python
"""The client of the local VisuaLex API, against the scripted fake.

What matters: the request vocabulary (act_type/date/act_number/annex/article)
and the response vocabulary (norma_data in Italian) are mapped explicitly;
429/5xx/timeouts are retried, 4xx are not; a missing article in the stream
comes back as "not returned", never as a crash.
"""
import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.sources.visualex import (
    FingerprintsResult, VisuaLexClient, VisuaLexError, select_fingerprints,
)
from archivio_normativo.throttle import Throttle

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


def cc_spec(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                act_type="codice civile", cite="c.c.")
    base.update(kw)
    return ActSpec(**base)


def gdpr_spec(**kw):
    base = dict(id="gdpr", area="ue", label="GDPR", source="eurlex", act_type="regolamento ue",
                date="2016", act_number="679", celex="32016R0679", units=("articles", "recitals"), cite="GDPR")
    base.update(kw)
    return ActSpec(**base)


@pytest.fixture
def cc(fake_visualex):
    return fake_visualex.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["LIBRO QUARTO Delle obbligazioni", {"numero": "2043", "allegato": "2"},
              {"numero": "2044", "allegato": "2"}, {"numero": "2 bis", "allegato": "2"}],
        annexes=[{"number": None, "label": "Dispositivo", "article_count": 0, "article_numbers": []},
                 {"number": "2", "label": "CODICE CIVILE", "article_count": 3, "article_numbers": ["2043", "2044", "2 bis"]}],
        rubriche={"2043": "Risarcimento per fatto illecito"}, abrogati=[],
        fingerprints={"2043": {"fingerprint": "a" * 64, "date": "1942-04-21"}, "2044": {"fingerprint": "b" * 64, "date": None}},
        articles={"2043": "Qualunque fatto…", "2044": {"error": "ParsingError: selector"}, "2-bis": "Testo del 2-bis"},
        brocardi={"2043": {"Ratio": "…", "Massime": ["m1"]}},
    )


@pytest.fixture
def client(fake_visualex, session, throttle):
    return VisuaLexClient(fake_visualex.base_url, session, throttle, sleep=_no_sleep, jitter=lambda: 0.5)


async def _no_sleep(_seconds):
    return None


class TestResolve:
    async def test_resolve_act_reads_the_act_url_and_effective_annex(self, client, cc, fake_visualex):
        res = await client.resolve_act(cc_spec())
        assert res.act_url == CC_URL
        assert res.annex == "2"
        assert res.tipo_atto == "codice civile"
        path, body = fake_visualex.calls[-1]
        assert path == "/fetch_norma_data"
        assert body["article"] == "1" and body["act_type"] == "codice civile"
        assert "date" not in body and "annex" not in body

    async def test_resolve_sends_date_number_annex_and_consolidated(self, client, fake_visualex):
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              celex_consolidated="02002L0058-20091219",
                              url="https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219")
        spec = ActSpec(id="eprivacy", area="ue", label="e-privacy", source="eurlex", act_type="direttiva ue",
                       date="2002", act_number="58", celex="32002L0058", celex_consolidated="02002L0058-20091219",
                       units=("articles", "recitals"), cite="dir. 2002/58/CE", annex=None)
        res = await client.resolve_act(spec)
        assert "02002L0058-20091219" in res.act_url
        body = fake_visualex.calls[-1][1]
        assert body["date"] == "2002" and body["act_number"] == "58"
        assert body["celex_consolidated"] == "02002L0058-20091219"

    async def test_unknown_act_is_a_visualex_error_with_status(self, client):
        with pytest.raises(VisuaLexError) as info:
            await client.resolve_act(cc_spec(act_type="codice inesistente"))
        assert info.value.status == 404
        assert "non presente" in str(info.value)


class TestStructure:
    async def test_tree(self, client, cc):
        tree = await client.fetch_tree(CC_URL)
        assert tree.count == 3
        assert tree.items[0] == "LIBRO QUARTO Delle obbligazioni"
        assert tree.annexes[1]["number"] == "2"

    async def test_rubriche(self, client, cc):
        r = await client.fetch_rubriche(CC_URL)
        assert r.rubriche == {"2043": "Risarcimento per fatto illecito"}
        assert r.abrogati == []

    async def test_fingerprints_available(self, client, cc):
        fp = await client.fetch_fingerprints(CC_URL)
        assert fp.available is True
        assert fp.fingerprints["2043"]["date"] == "1942-04-21"

    async def test_fingerprints_unavailable(self, client, fake_visualex):
        fake_visualex.add_act(act_type="legge", date="1990-08-07", act_number="241",
                              url="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241",
                              fingerprints=None)
        fp = await client.fetch_fingerprints("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241")
        assert fp.available is False and fp.fingerprints == {}

    async def test_recitals(self, client, fake_visualex):
        fake_visualex.add_act(act_type="regolamento ue", date="2016", act_number="679", url=GDPR_URL,
                              recitals=[{"number": "1", "text": "La protezione…"}])
        recitals = await client.fetch_recitals(gdpr_spec())
        assert [(r.number, r.text) for r in recitals] == [("1", "La protezione…")]


class TestStream:
    async def test_texts_errors_and_missing_articles(self, client, cc, fake_visualex):
        results = await client.stream_articles(cc_spec(), ["2043", "2044", "2-bis", "9999"], annex="2", brocardi=True)
        by_number = {r.number: r for r in results}
        assert set(by_number) == {"2043", "2044", "2-bis"}, "9999 is not in the act: omitted, not invented"
        assert by_number["2043"].text == "Qualunque fatto…"
        assert by_number["2043"].urn.endswith(":2~art2043")
        assert by_number["2043"].annex == "2"
        assert by_number["2043"].brocardi == {"Ratio": "…", "Massime": ["m1"]}
        assert by_number["2044"].error == "ParsingError: selector" and by_number["2044"].text is None
        assert by_number["2-bis"].raw_number == "2-bis"
        body = fake_visualex.calls[-1][1]
        assert body["article"] == "2043,2044,2-bis,9999"
        assert body["annex"] == "2" and body["show_brocardi_info"] is True

    async def test_pacing_counts_articles_not_requests(self, fake_visualex, session, cc):
        paced = []

        class Recording(Throttle):
            async def pace(self, tokens):
                paced.append(tokens)

        client = VisuaLexClient(fake_visualex.base_url, session, Recording(1.0), sleep=_no_sleep)
        await client.stream_articles(cc_spec(), ["2043", "2044"], annex="2", brocardi=False)
        assert paced == [2]


class TestRetries:
    async def test_5xx_then_success_is_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_tree"] = [503, 502]
        tree = await client.fetch_tree(CC_URL)
        assert tree.count == 3
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 3

    async def test_429_is_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_rubriche"] = [429]
        r = await client.fetch_rubriche(CC_URL)
        assert "2043" in r.rubriche

    async def test_4xx_is_not_retried(self, client, cc, fake_visualex):
        fake_visualex.fail["/fetch_tree"] = [400]
        with pytest.raises(VisuaLexError) as info:
            await client.fetch_tree(CC_URL)
        assert info.value.status == 400
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 1

    async def test_gives_up_after_attempts(self, fake_visualex, session, throttle, cc):
        fake_visualex.fail["/fetch_tree"] = [500] * 10
        client = VisuaLexClient(fake_visualex.base_url, session, throttle, attempts=3, sleep=_no_sleep)
        with pytest.raises(VisuaLexError) as info:
            await client.fetch_tree(CC_URL)
        assert info.value.status == 500
        assert sum(1 for p, _ in fake_visualex.calls if p == "/fetch_tree") == 3


class TestSelectFingerprints:
    def test_picks_the_map_that_overlaps_most(self):
        result = FingerprintsResult(
            available=True,
            fingerprints={"1": {"fingerprint": "c1", "date": None}, "2": {"fingerprint": "c2", "date": None}},
            parts=[{"name": "Disposizioni sulla legge in generale",
                    "fingerprints": {"1": {"fingerprint": "p1", "date": None}, "31": {"fingerprint": "p31", "date": None}}}],
        )
        assert select_fingerprints(result, ["1", "31"])["1"]["fingerprint"] == "p1"
        assert select_fingerprints(result, ["1", "2"])["2"]["fingerprint"] == "c2"

    def test_no_overlap_means_nothing(self):
        result = FingerprintsResult(True, {"1": {"fingerprint": "x", "date": None}}, [])
        assert select_fingerprints(result, ["500"]) == {}
        assert select_fingerprints(FingerprintsResult(False, {}, []), ["1"]) == {}

    def test_keys_are_normalised(self):
        result = FingerprintsResult(True, {"2 bis": {"fingerprint": "x", "date": None}}, [])
        assert select_fingerprints(result, ["2-bis"]) == {"2-bis": {"fingerprint": "x", "date": None}}
```

- [ ] **Step 3: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_visualex_client.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.sources.visualex'`.

- [ ] **Step 4: Implement the client**

`archivio_normativo/sources/visualex.py`:

```python
"""Client of the local VisuaLex API — the archive's only source of text.

Six endpoints, all POST with JSON bodies (root `app.py`):
`/fetch_norma_data` (act resolution, probing article 1 the way the frontend's
`fetchActUrn` does), `/fetch_tree`, `/fetch_rubriche`,
`/fetch_act_fingerprints`, `/fetch_recitals`, `/stream_article_text`.

The request speaks the manifest's vocabulary (act_type/date/act_number/
annex/article); the response's `norma_data` speaks Italian (tipo_atto,
numero_articolo, allegato, urn). The mapping is explicit here and nowhere
else. 429, 5xx, timeouts and connection errors are retried with backoff;
any other 4xx is final.
"""
from __future__ import annotations

import asyncio
import json
import random
from dataclasses import dataclass
from typing import Callable, Iterable

import aiohttp

from ..hierarchy import normalize_number
from ..manifest import ActSpec
from ..throttle import RetryableError, Throttle, with_backoff


class VisuaLexError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class VisuaLexRetryable(VisuaLexError, RetryableError):
    """429, 5xx, timeouts, connection errors."""


@dataclass(frozen=True)
class ActResolution:
    act_url: str
    annex: str | None
    tipo_atto: str
    data: str | None
    numero_atto: str | None
    sample_urn: str


@dataclass(frozen=True)
class TreeResult:
    items: list
    count: int
    annexes: list[dict]


@dataclass(frozen=True)
class RubricheResult:
    rubriche: dict[str, str]
    abrogati: list[str]
    parts: list[dict]


@dataclass(frozen=True)
class FingerprintsResult:
    available: bool
    fingerprints: dict[str, dict]
    parts: list[dict]


@dataclass(frozen=True)
class Recital:
    number: str
    text: str


@dataclass(frozen=True)
class ArticleResult:
    number: str
    raw_number: str
    text: str | None
    urn: str | None
    url: str | None
    annex: str | None
    brocardi: dict | None
    brocardi_error: str | None
    error: str | None


def _normalise_map(fingerprints: dict) -> dict[str, dict]:
    return {normalize_number(k): v for k, v in (fingerprints or {}).items()}


def select_fingerprints(result: FingerprintsResult, numbers: Iterable[str]) -> dict[str, dict]:
    """The fingerprint map that describes THESE articles.

    A codice's export carries several parts (the code body, the preleggi, the
    enacting Dispositivo), each with its own article 1. The archive's act is
    one annex of it, so the map is chosen by overlap with the annex's own
    article numbers — never by name.
    """
    if not result.available:
        return {}
    wanted = {normalize_number(n) for n in numbers}
    candidates = [_normalise_map(result.fingerprints)] + [_normalise_map(p.get("fingerprints", {})) for p in result.parts]
    best: dict[str, dict] = {}
    best_overlap = 0
    for candidate in candidates:
        overlap = len(wanted & set(candidate))
        if overlap > best_overlap:
            best, best_overlap = candidate, overlap
    return best


class VisuaLexClient:
    def __init__(self, base_url: str, session: aiohttp.ClientSession, throttle: Throttle, *,
                 timeout: float = 120.0, attempts: int = 5, sleep=asyncio.sleep,
                 jitter: Callable[[], float] = random.random, on_retry=None):
        self.base_url = base_url.rstrip("/")
        self._session = session
        self._throttle = throttle
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._attempts = attempts
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry

    # -- request plumbing ---------------------------------------------------

    @staticmethod
    def act_body(spec: ActSpec, article: str, annex: str | None = None) -> dict:
        body: dict = {"act_type": spec.act_type, "article": article, "version": spec.version}
        if spec.date:
            body["date"] = spec.date
        if spec.act_number:
            body["act_number"] = spec.act_number
        if annex is not None:
            body["annex"] = str(annex)
        if spec.celex_consolidated:
            body["celex_consolidated"] = spec.celex_consolidated
        return body

    async def _retrying(self, path: str, attempt):
        return await with_backoff(attempt, attempts=self._attempts, sleep=self._sleep,
                                  jitter=self._jitter, on_retry=self._on_retry)

    @staticmethod
    async def _raise_for_status(path: str, resp: aiohttp.ClientResponse) -> None:
        if resp.status == 429 or resp.status >= 500:
            raise VisuaLexRetryable(f"{path}: HTTP {resp.status}", status=resp.status)
        if resp.status >= 400:
            try:
                detail = (await resp.json()).get("error")
            except Exception:  # noqa: BLE001 — any body shape
                detail = (await resp.text())[:200]
            raise VisuaLexError(f"{path}: HTTP {resp.status}: {detail}", status=resp.status)

    async def _post_json(self, path: str, body: dict) -> dict:
        async def attempt():
            try:
                async with self._session.post(self.base_url + path, json=body, timeout=self._timeout) as resp:
                    await self._raise_for_status(path, resp)
                    return await resp.json()
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                raise VisuaLexRetryable(f"{path}: {exc}") from exc
        return await self._retrying(path, attempt)

    async def _post_ndjson(self, path: str, body: dict) -> list[dict]:
        async def attempt():
            try:
                async with self._session.post(self.base_url + path, json=body, timeout=self._timeout) as resp:
                    await self._raise_for_status(path, resp)
                    lines: list[dict] = []
                    async for raw in resp.content:
                        raw = raw.strip()
                        if not raw:
                            continue
                        try:
                            lines.append(json.loads(raw))
                        except json.JSONDecodeError as exc:
                            raise VisuaLexError(f"{path}: malformed NDJSON line: {raw[:120]!r}") from exc
                    return lines
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                raise VisuaLexRetryable(f"{path}: {exc}") from exc
        return await self._retrying(path, attempt)

    # -- endpoints ----------------------------------------------------------

    async def resolve_act(self, spec: ActSpec) -> ActResolution:
        """The act's URL and effective annex, by probing article 1 (a probe,
        not a request for article 1 — the endpoint refuses to build a
        NormaVisitata without one)."""
        await self._throttle.acquire()
        data = await self._post_json("/fetch_norma_data", self.act_body(spec, "1", spec.annex))
        entries = data.get("norma_data") or []
        if not entries:
            raise VisuaLexError("/fetch_norma_data: empty norma_data")
        nd = entries[0]
        annex = nd.get("allegato")
        return ActResolution(
            act_url=nd["url"],
            annex=str(annex) if annex not in (None, "") else None,
            tipo_atto=nd.get("tipo_atto") or spec.act_type,
            data=nd.get("data"),
            numero_atto=nd.get("numero_atto"),
            sample_urn=nd.get("urn") or nd["url"],
        )

    async def fetch_tree(self, act_url: str) -> TreeResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_tree", {"urn": act_url, "link": False, "details": True,
                                                     "return_metadata": True})
        if "error" in data and "articles" not in data:
            raise VisuaLexError(f"/fetch_tree: {data['error']}")
        return TreeResult(items=list(data.get("articles") or []), count=int(data.get("count") or 0),
                          annexes=list((data.get("metadata") or {}).get("annexes") or []))

    async def fetch_rubriche(self, act_url: str) -> RubricheResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_rubriche", {"urn": act_url})
        return RubricheResult(rubriche=_normalise_map(data.get("rubriche") or {}),
                              abrogati=[normalize_number(a) for a in data.get("abrogati") or []],
                              parts=list(data.get("parts") or []))

    async def fetch_fingerprints(self, act_url: str) -> FingerprintsResult:
        await self._throttle.acquire()
        data = await self._post_json("/fetch_act_fingerprints", {"urn": act_url})
        return FingerprintsResult(available=bool(data.get("available")),
                                  fingerprints=dict(data.get("fingerprints") or {}),
                                  parts=list(data.get("parts") or []))

    async def fetch_recitals(self, spec: ActSpec) -> list[Recital]:
        await self._throttle.acquire()
        body = {"act_type": spec.act_type}
        if spec.date:
            body["date"] = spec.date
        if spec.act_number:
            body["act_number"] = spec.act_number
        data = await self._post_json("/fetch_recitals", body)
        return [Recital(number=str(r["number"]), text=str(r.get("text") or ""))
                for r in data.get("recitals") or []]

    async def stream_articles(self, spec: ActSpec, numbers: list[str], annex: str | None,
                              brocardi: bool) -> list[ArticleResult]:
        """One batch of articles. Missing ones are simply absent from the
        result (the API drops them); the caller decides what that means."""
        await self._throttle.pace(len(numbers))
        body = self.act_body(spec, ",".join(numbers), annex)
        body["show_brocardi_info"] = bool(brocardi)
        lines = await self._post_ndjson("/stream_article_text", body)
        results: list[ArticleResult] = []
        for line in lines:
            nd = line.get("norma_data") or {}
            raw = str(nd.get("numero_articolo") or "")
            annex_value = nd.get("allegato")
            results.append(ArticleResult(
                number=normalize_number(raw),
                raw_number=raw,
                text=line.get("article_text"),
                urn=nd.get("urn"),
                url=line.get("url"),
                annex=str(annex_value) if annex_value not in (None, "") else None,
                brocardi=line.get("brocardi_info"),
                brocardi_error=line.get("brocardi_error"),
                error=line.get("error"),
            ))
        return results
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_visualex_client.py -q`
Expected: 17 passed.

- [ ] **Step 6: Commit**

```bash
git add archivio_normativo/sources/visualex.py tests/archivio/fake_visualex.py tests/archivio/conftest.py tests/archivio/test_visualex_client.py
git commit -m "feat(archivio): VisuaLex client with retries, plus a scripted fake server for tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `sources/legalit.py` — the MCP client and the call builders

**Files:**
- Create: `archivio_normativo/sources/legalit.py`, `requirements-archivio.txt`
- Test: `tests/archivio/test_legalit.py`

**Interfaces:**
- Consumes: `Throttle`, `with_backoff`, `RetryableError` (Task 1); `ActSpec`, `KINDS` (Task 2).
- Produces:
  - `ToolCall(tool: str, args: dict)` (frozen).
  - `reference_for(spec, number) -> str` — `"art. 2043 c.c."`, `"art. 2-bis D.Lgs. 231/2001"`.
  - `unit_calls(kind, spec, number) -> list[ToolCall]`, `act_calls(kind, spec) -> list[ToolCall]`; `ValueError` for a kind of the wrong level; `brocardi` is not served here (it is VisuaLex's) and raises too.
  - `classify_result(text) -> "ok" | "empty" | "error"`.
  - `LegalItError(Exception)`, `LegalItTransportError(LegalItError, RetryableError)`.
  - `LegalItClient(command: Sequence[str], throttle, *, attempts=3, sleep, jitter, on_retry, session_factory=None)` — async context manager; `call(call: ToolCall) -> str` (text content of the tool result, joined). `session_factory` is a zero-argument callable returning an async context manager that yields an object with `async call_tool(name, arguments)`; the default one spawns the MCP server over stdio with the `mcp` SDK (imported lazily; a missing package is a `LegalItError` naming `requirements-archivio.txt`).

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_legalit.py`:

```python
"""The enrichment provider: legal-it tools over MCP stdio.

The SDK is never imported here — a fake session stands in — so the suite
runs without the `mcp` package, which is optional for the archive itself.
"""
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.sources.legalit import (
    LegalItClient, LegalItError, ToolCall, act_calls, classify_result, reference_for, unit_calls,
)
from archivio_normativo.throttle import Throttle


def spec(**kw):
    base = dict(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                act_type="decreto legislativo", date="2001-06-08", act_number="231", cite="D.Lgs. 231/2001")
    base.update(kw)
    return ActSpec(**base)


def eu_spec(**kw):
    base = dict(id="nis2", area="ue", label="NIS2", source="eurlex", act_type="direttiva ue",
                date="2022", act_number="2555", celex="32022L2555", units=("articles", "recitals"),
                cite="dir. (UE) 2022/2555")
    base.update(kw)
    return ActSpec(**base)


class TestCallBuilders:
    def test_reference_keeps_the_suffix_hyphenated(self):
        assert reference_for(spec(), "6") == "art. 6 D.Lgs. 231/2001"
        assert reference_for(spec(cite="c.c."), "2-bis") == "art. 2-bis c.c."

    @pytest.mark.parametrize("kind, tool, key", [
        ("cassazione", "giurisprudenza_su_norma", "riferimento"),
        ("cassazione_massime", "giurisprudenza_articolo", "riferimento"),
        ("amministrativa", "giurisprudenza_amm_su_norma", "riferimento"),
        ("tributaria", "cerca_giurisprudenza_tributaria", "query"),
        ("cgue", "giurisprudenza_cgue_su_norma", "riferimento"),
        ("costituzionale", "pronunce_cost_su_norma", "riferimento"),
        ("garante", "cerca_provvedimenti_garante", "query"),
    ])
    def test_unit_kinds_map_to_one_tool_with_the_reference(self, kind, tool, key):
        calls = unit_calls(kind, spec(), "6")
        assert len(calls) == 1
        assert calls[0].tool == tool
        assert calls[0].args[key] == "art. 6 D.Lgs. 231/2001"
        assert "max_risultati" in calls[0].args

    def test_attuazione_is_two_calls_on_the_celex(self):
        calls = act_calls("attuazione", eu_spec())
        assert [c.tool for c in calls] == ["get_italian_implementation", "elenco_misure_nazionali"]
        assert calls[0].args == {"direttiva": "32022L2555"}
        assert calls[1].args == {"direttiva": "32022L2555", "paese": "ITA"}

    def test_base_ue_uses_the_citation(self):
        assert act_calls("base_ue", spec()) == [ToolCall("get_eu_basis", {"atto": "D.Lgs. 231/2001"})]

    def test_wrong_level_or_brocardi_is_an_error(self):
        with pytest.raises(ValueError):
            unit_calls("attuazione", eu_spec(), "1")
        with pytest.raises(ValueError):
            act_calls("cassazione", spec())
        with pytest.raises(ValueError):
            unit_calls("brocardi", spec(), "6")


class TestClassify:
    def test_shapes(self):
        assert classify_result("**Errore**: italgiure non raggiungibile.") == "error"
        assert classify_result("Nessun risultato su italgiure.") == "empty"
        assert classify_result("") == "empty"
        assert classify_result("## Sentenze\n- Cass. civ. 123/2024 …") == "ok"


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text=item)])


def factory_for(session):
    @asynccontextmanager
    async def factory():
        yield session
    return factory


async def _no_sleep(_):
    return None


class TestClient:
    async def test_call_returns_the_text_content(self):
        session = FakeSession(["## Sentenze…"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session)) as client:
            text = await client.call(ToolCall("giurisprudenza_su_norma", {"riferimento": "art. 6 D.Lgs. 231/2001"}))
        assert text == "## Sentenze…"
        assert session.calls == [("giurisprudenza_su_norma", {"riferimento": "art. 6 D.Lgs. 231/2001"})]

    async def test_transport_errors_are_retried(self):
        session = FakeSession([ConnectionError("pipe"), "ok"])
        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(session),
                                 sleep=_no_sleep, jitter=lambda: 0.5) as client:
            assert await client.call(ToolCall("t", {})) == "ok"
        assert len(session.calls) == 2

    async def test_a_tool_error_result_is_a_legalit_error(self):
        class ErrSession:
            async def call_tool(self, name, arguments):
                return SimpleNamespace(isError=True, content=[SimpleNamespace(type="text", text="boom")])

        async with LegalItClient(("bash", "x.sh"), Throttle(0), session_factory=factory_for(ErrSession())) as client:
            with pytest.raises(LegalItError, match="boom"):
                await client.call(ToolCall("t", {}))

    async def test_calls_are_paced(self):
        paced = []

        class Recording(Throttle):
            async def acquire(self):
                paced.append(1)

        session = FakeSession(["a", "b"])
        async with LegalItClient(("bash", "x.sh"), Recording(0), session_factory=factory_for(session)) as client:
            await client.call(ToolCall("t", {}))
            await client.call(ToolCall("t", {}))
        assert paced == [1, 1]

    async def test_missing_sdk_is_a_clear_error(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "mcp", None)  # makes `import mcp` raise ImportError
        with pytest.raises(LegalItError, match="requirements-archivio.txt"):
            async with LegalItClient(("bash", "x.sh"), Throttle(0)):
                pass

    async def test_an_empty_command_is_refused(self):
        with pytest.raises(LegalItError, match="command"):
            async with LegalItClient((), Throttle(0)):
                pass
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_legalit.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`requirements-archivio.txt`:

```
# Optional extra for `python -m archivio_normativo`: enrichment through the
# legal-it MCP server. The archive's text path needs nothing beyond the API's
# own requirements.txt (aiohttp, pyyaml).
mcp>=1.2
```

`archivio_normativo/sources/legalit.py`:

```python
"""Enrichment through the `legal-it` MCP server (mcp-legal-it), over stdio.

Every kind beyond `brocardi` is one or two tool calls whose results are
markdown for a reader, not data: the archive stores the text as it came,
attributed and dated. The `mcp` SDK is imported only when a client is
opened, so the text-only path never needs it.
"""
from __future__ import annotations

import asyncio
import random
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Callable, Sequence

from ..manifest import KINDS, ActSpec
from ..throttle import RetryableError, Throttle, with_backoff


class LegalItError(Exception):
    """A tool answered with an error, or the server could not be reached."""


class LegalItTransportError(LegalItError, RetryableError):
    """The MCP transport failed; the call may be retried."""


@dataclass(frozen=True)
class ToolCall:
    tool: str
    args: dict


def reference_for(spec: ActSpec, number: str) -> str:
    """"art. 2043 c.c." — the form legal-it's reference parser reads."""
    return f"art. {number} {spec.cite}"


_UNIT_TOOLS: dict[str, tuple[str, str, int]] = {
    # kind: (tool, argument carrying the reference, max_risultati)
    "cassazione": ("giurisprudenza_su_norma", "riferimento", 5),
    "cassazione_massime": ("giurisprudenza_articolo", "riferimento", 5),
    "amministrativa": ("giurisprudenza_amm_su_norma", "riferimento", 10),
    "tributaria": ("cerca_giurisprudenza_tributaria", "query", 10),
    "cgue": ("giurisprudenza_cgue_su_norma", "riferimento", 10),
    "costituzionale": ("pronunce_cost_su_norma", "riferimento", 10),
    "garante": ("cerca_provvedimenti_garante", "query", 10),
}


def unit_calls(kind: str, spec: ActSpec, number: str) -> list[ToolCall]:
    if kind == "brocardi":
        raise ValueError("brocardi is served by VisuaLex (show_brocardi_info), not by legal-it")
    if kind not in KINDS or KINDS[kind].level != "unit":
        raise ValueError(f"{kind!r} is not a unit-level enrichment kind")
    tool, key, max_results = _UNIT_TOOLS[kind]
    return [ToolCall(tool, {key: reference_for(spec, number), "max_risultati": max_results})]


def act_calls(kind: str, spec: ActSpec) -> list[ToolCall]:
    if kind not in KINDS or KINDS[kind].level != "act":
        raise ValueError(f"{kind!r} is not an act-level enrichment kind")
    if kind == "attuazione":
        target = spec.celex or spec.cite
        return [ToolCall("get_italian_implementation", {"direttiva": target}),
                ToolCall("elenco_misure_nazionali", {"direttiva": target, "paese": "ITA"})]
    return [ToolCall("get_eu_basis", {"atto": spec.cite})]  # base_ue


def classify_result(text: str) -> str:
    head = (text or "").strip()
    if not head:
        return "empty"
    if head.startswith("**Errore**"):
        return "error"
    if head[:200].lower().startswith("nessun risultato") or "nessun risultato" in head[:200].lower():
        return "empty"
    return "ok"


def _default_session_factory(command: Sequence[str]) -> Callable:
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError as exc:
        raise LegalItError(
            "the `mcp` package is not installed: pip install -r requirements-archivio.txt"
        ) from exc
    params = StdioServerParameters(command=command[0], args=list(command[1:]))

    @asynccontextmanager
    async def factory():
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session

    return factory


class LegalItClient:
    def __init__(self, command: Sequence[str], throttle: Throttle, *, attempts: int = 3,
                 sleep=asyncio.sleep, jitter: Callable[[], float] = random.random, on_retry=None,
                 session_factory: Callable | None = None):
        self._command = tuple(command)
        self._throttle = throttle
        self._attempts = attempts
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry
        self._session_factory = session_factory
        self._stack: AsyncExitStack | None = None
        self._session = None

    async def __aenter__(self) -> "LegalItClient":
        if self._session_factory is None:
            if not self._command:
                raise LegalItError("no legal-it command configured (providers.legalit.command or LEGALIT_MCP_COMMAND)")
            self._session_factory = _default_session_factory(self._command)
        self._stack = AsyncExitStack()
        try:
            self._session = await self._stack.enter_async_context(self._session_factory())
        except LegalItError:
            raise
        except Exception as exc:  # noqa: BLE001 — spawn/handshake failures of any shape
            await self._stack.aclose()
            raise LegalItError(f"could not start the legal-it server: {exc}") from exc
        return self

    async def __aexit__(self, *exc) -> None:
        if self._stack is not None:
            await self._stack.aclose()
        self._stack = None
        self._session = None

    async def call(self, call: ToolCall) -> str:
        if self._session is None:
            raise LegalItError("LegalItClient is not open; use `async with`")
        await self._throttle.acquire()

        async def attempt():
            try:
                result = await self._session.call_tool(call.tool, arguments=dict(call.args))
            except LegalItError:
                raise
            except Exception as exc:  # noqa: BLE001 — transport errors of any shape
                raise LegalItTransportError(f"{call.tool}: {exc}") from exc
            text = "\n".join(
                getattr(item, "text", "") for item in (getattr(result, "content", None) or [])
                if getattr(item, "type", "text") == "text"
            ).strip()
            if getattr(result, "isError", False):
                raise LegalItError(f"{call.tool}: {text or 'tool error'}")
            return text

        return await with_backoff(attempt, attempts=self._attempts, sleep=self._sleep,
                                  jitter=self._jitter, on_retry=self._on_retry)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_legalit.py -q`
Expected: 18 passed.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/sources/legalit.py requirements-archivio.txt tests/archivio/test_legalit.py
git commit -m "feat(archivio): legal-it MCP client and the enrichment call builders

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `pipeline.py` — resolve, index, diff, fetch, store

**Files:**
- Create: `archivio_normativo/pipeline.py`
- Test: `tests/archivio/test_pipeline.py`

**Interfaces:**
- Consumes: `Store`, `UnitRecord`, `ActRecord` (Task 4); `VisuaLexClient`, `select_fingerprints`, `VisuaLexError` (Task 5); `walk_tree` (Task 3); `ActSpec`, `Manifest` (Task 2).
- Produces:
  - `unit_id(act_id, kind, number) -> str` — `kind` is `"article"` or `"recital"` → `"cc:art:2043"`, `"gdpr:rec:47"`.
  - `RunOptions(out_dir, dry_run=False, full=False, resume_run_id=None, enrich_override=None, refresh_enrich=False, batch_size=25, enrich_ttl_days=90)`.
  - `ActReport` with the counters the report prints: `total, new, updated, unchanged, failed, skipped, recitals, enrich_planned, enrich_ok, enrich_empty, enrich_error, enrich_kept, failures: list[tuple[str, str]], resolved, reason, fingerprints_available, text_status, changed, planned_new, planned_changed`.
  - `UnitOutcome(unit_id, number, outcome)` (frozen) — what the enricher receives per article.
  - `Enricher` protocol: `async enrich_act(spec, res: ActResolution, units: list[UnitOutcome], report: ActReport) -> None`. Task 8 implements it; `Pipeline(enricher=None)` runs without enrichment beyond `brocardi`.
  - `Pipeline(*, store, visualex, options, run_id, log, now, enricher=None)` with `async process_act(spec) -> ActReport` and `async run(specs) -> list[ActReport]`.
  - `today(now)` / `stamp(now)` helpers: `YYYY-MM-DD` and `YYYY-MM-DDTHH:MM:SS`.

Rules the tests pin down:
1. Only articles whose annex equals the resolved annex are the act's (`walk_tree` returns every annex of the tree).
2. Fingerprints decide: an article is fetched when `--full`, or fingerprints are unavailable, or the article has no fingerprint, or the stored fingerprint differs, or the unit is not in the store. Otherwise it is `unchanged` without a request (`touch_checked`).
3. `brocardi` in the act's kinds → `show_brocardi_info` on the stream; the structured payload is stored as an enrichment (`tool = "visualex.show_brocardi_info"`, `content_json`). An unchanged article whose brocardi is missing, older than the TTL, or forced by `--refresh-enrich` is streamed again for that alone.
4. An article the API does not return is `failed` with reason `not returned by VisuaLex`; a per-article error line is `failed` with that error. Neither is stored, so the next run retries it.
5. `--dry-run` makes the read-only calls only (resolve, tree, rubriche, fingerprints), never streams, never writes.
6. `--resume RUN` skips units already in that run's `unit_log`.
7. One act's failure never stops the run; it is a report line.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_pipeline.py`:

```python
"""The per-act pipeline against the fake VisuaLex and a real SQLite store."""
import logging
from datetime import datetime

import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.pipeline import Pipeline, RunOptions, unit_id
from archivio_normativo.sources.visualex import VisuaLexClient
from archivio_normativo.store import Store

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
NOW = datetime(2026, 9, 19, 21, 0, 0)


def cc_spec(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                act_type="codice civile", cite="c.c.")
    base.update(kw)
    return ActSpec(**base)


def gdpr_spec(**kw):
    base = dict(id="gdpr", area="ue", label="GDPR", source="eurlex", act_type="regolamento ue",
                date="2016", act_number="679", celex="32016R0679", units=("articles", "recitals"), cite="GDPR")
    base.update(kw)
    return ActSpec(**base)


def add_cc(fake, fingerprints="default", articles=None):
    if fingerprints == "default":
        fingerprints = {"2043": {"fingerprint": "a" * 64, "date": "1942-04-21"},
                        "2044": {"fingerprint": "b" * 64, "date": None},
                        "2-bis": {"fingerprint": "c" * 64, "date": None}}
    return fake.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["Disposizioni sulla legge in generale", {"numero": "1", "allegato": "1"},
              "CODICE CIVILE", "LIBRO QUARTO Delle obbligazioni", "TITOLO IX Dei fatti illeciti",
              {"numero": "2043", "allegato": "2"}, {"numero": "2044", "allegato": "2"},
              {"numero": "2 bis", "allegato": "2"}],
        annexes=[{"number": "1", "label": "Disposizioni sulla legge in generale", "article_count": 1, "article_numbers": ["1"]},
                 {"number": "2", "label": "CODICE CIVILE", "article_count": 3, "article_numbers": ["2043", "2044", "2 bis"]}],
        rubriche={"2043": "Risarcimento per fatto illecito", "2044": "Legittima difesa"}, abrogati=["2-bis"],
        fingerprints=fingerprints,
        articles=articles if articles is not None else {
            "1": "Le fonti del diritto…", "2043": "Qualunque fatto…", "2044": "Non è responsabile…",
            "2-bis": "(abrogato)"},
        brocardi={"2043": {"Ratio": "La ratio…", "Massime": ["Cass. 1/2024"]}},
    )


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "archivio.sqlite") as s:
        yield s


@pytest.fixture
def make_pipeline(fake_visualex, session, throttle, store, tmp_path):
    def factory(*, run_store=store, dry_run=False, full=False, resume=None, refresh_enrich=False,
                batch_size=25, enricher=None, enrich_override=None):
        client = VisuaLexClient(fake_visualex.base_url, session, throttle)
        options = RunOptions(out_dir=tmp_path / "out", dry_run=dry_run, full=full, resume_run_id=resume,
                             enrich_override=enrich_override, refresh_enrich=refresh_enrich,
                             batch_size=batch_size, enrich_ttl_days=90)
        run_id = None
        if run_store is not None and not dry_run:
            run_id = resume if resume is not None else run_store.start_run({}, NOW.isoformat())
        return Pipeline(store=run_store, visualex=client, options=options, run_id=run_id,
                        log=logging.getLogger("test"), now=lambda: NOW, enricher=enricher)
    return factory


def streamed_numbers(fake):
    out = []
    for path, body in fake.calls:
        if path == "/stream_article_text":
            out.extend(body["article"].split(","))
    return out


class TestFirstRun:
    async def test_everything_is_new_and_placed(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline().process_act(cc_spec())
        assert (report.total, report.new, report.updated, report.unchanged, report.failed) == (3, 3, 0, 0, 0)
        assert report.fingerprints_available is True
        units = {u.number: u for u in store.units_for_act("cc")}
        assert set(units) == {"2043", "2044", "2-bis"}, "annex 1 (preleggi) is not the codice civile"
        a = units["2043"]
        assert a.text == "Qualunque fatto…"
        assert a.rubrica == "Risarcimento per fatto illecito"
        assert (a.libro, a.titolo) == ("LIBRO QUARTO Delle obbligazioni", "TITOLO IX Dei fatti illeciti")
        assert a.identifier.endswith(":2~art2043")
        assert a.fingerprint == "a" * 64
        assert a.ultimo_aggiornamento == "1942-04-21"
        assert a.vigenza_al == "2026-09-19"
        assert a.fetched_at == "2026-09-19T21:00:00"
        assert a.abrogato is False and units["2-bis"].abrogato is True
        assert units["2-bis"].position == 2
        act = store.get_act("cc")
        assert act.annex == "2" and act.identifier == CC_URL and act.text_status == "consolidated"
        assert store.act_unit_count("cc") == 3
        assert report.changed is True

    async def test_batches_follow_batch_size(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline(batch_size=2).process_act(cc_spec())
        bodies = [b["article"] for p, b in fake_visualex.calls if p == "/stream_article_text"]
        assert bodies == ["2043,2044", "2-bis"]

    async def test_brocardi_kind_stores_the_structured_payload(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline().process_act(cc_spec(enrich=("brocardi",)))
        body = [b for p, b in fake_visualex.calls if p == "/stream_article_text"][0]
        assert body["show_brocardi_info"] is True
        got = store.get_enrichment("cc", "cc:art:2043", "brocardi")
        assert got["content_json"] == {"Ratio": "La ratio…", "Massime": ["Cass. 1/2024"]}
        assert got["tool"] == "visualex.show_brocardi_info" and got["status"] == "ok"
        assert store.get_enrichment("cc", "cc:art:2044", "brocardi") is None, "no payload, no row"
        assert report.enrich_ok == 1


class TestSecondRun:
    async def test_unchanged_fingerprints_mean_no_stream(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert (report.new, report.updated, report.unchanged) == (0, 0, 3)
        assert streamed_numbers(fake_visualex) == []
        assert report.changed is False
        first, changed, checked = store.unit_run_columns("cc:art:2043")
        assert first == changed == 1 and checked == 2

    async def test_a_moved_fingerprint_refetches_that_article_only(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        scenario["fingerprints"]["2044"] = {"fingerprint": "z" * 64, "date": "2026-01-01"}
        scenario["articles"]["2044"] = "Testo nuovo dell'art. 2044."
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert (report.updated, report.unchanged) == (1, 2)
        assert streamed_numbers(fake_visualex) == ["2044"]
        assert store.get_unit("cc:art:2044").text == "Testo nuovo dell'art. 2044."
        assert store.get_unit("cc:art:2044").ultimo_aggiornamento == "2026-01-01"

    async def test_full_refetches_everything(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        fake_visualex.calls.clear()
        report = await make_pipeline(full=True).process_act(cc_spec())
        assert report.unchanged == 3 and sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2043", "2044"]

    async def test_without_fingerprints_every_run_is_full(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex, fingerprints=None)
        r1 = await make_pipeline().process_act(cc_spec())
        assert r1.fingerprints_available is False and r1.new == 3
        fake_visualex.calls.clear()
        r2 = await make_pipeline().process_act(cc_spec())
        assert r2.unchanged == 3 and len(streamed_numbers(fake_visualex)) == 3

    async def test_stale_brocardi_is_refetched_alone(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec(enrich=("brocardi",)))
        fake_visualex.calls.clear()
        report = await make_pipeline(refresh_enrich=True).process_act(cc_spec(enrich=("brocardi",)))
        assert report.unchanged == 3
        assert sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2043", "2044"], "brocardi-only pass"
        assert report.enrich_ok == 1


class TestFailures:
    async def test_error_lines_and_missing_articles_fail_and_are_retried_next_run(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex, articles={"2043": "Qualunque fatto…", "2044": {"error": "ParsingError"}})
        report = await make_pipeline().process_act(cc_spec())
        assert report.new == 1 and report.failed == 2
        reasons = dict(report.failures)
        assert reasons["cc:art:2044"] == "ParsingError"
        assert "not returned" in reasons["cc:art:2-bis"]
        assert store.get_unit("cc:art:2044") is None
        scenario["articles"]["2044"] = "Ora c'è."
        scenario["articles"]["2-bis"] = "Anche questo."
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert report.new == 2 and report.unchanged == 1
        assert sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2044"]

    async def test_a_stream_failure_fails_the_batch_not_the_run(self, fake_visualex, session, throttle, store, tmp_path):
        add_cc(fake_visualex)
        fake_visualex.fail["/stream_article_text"] = [500] * 10
        client = VisuaLexClient(fake_visualex.base_url, session, throttle, attempts=2, sleep=_no_sleep)
        run_id = store.start_run({}, NOW.isoformat())
        pipeline = Pipeline(store=store, visualex=client,
                            options=RunOptions(out_dir=tmp_path / "out", batch_size=2),
                            run_id=run_id, log=logging.getLogger("t"), now=lambda: NOW)
        report = await pipeline.process_act(cc_spec())
        assert report.failed == 3 and all("HTTP 500" in reason for _, reason in report.failures)

    async def test_unresolvable_act_is_reported_not_raised(self, fake_visualex, make_pipeline):
        report = await make_pipeline().process_act(cc_spec(act_type="codice inesistente"))
        assert report.resolved is False
        assert "404" in report.reason

    async def test_run_continues_past_a_broken_act(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        reports = await make_pipeline().run([cc_spec(act_type="codice inesistente", id="x"), cc_spec()])
        assert [r.resolved for r in reports] == [False, True]


async def _no_sleep(_):
    return None


class TestDryRunAndResume:
    async def test_dry_run_reads_but_never_writes_or_streams(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline(dry_run=True).process_act(cc_spec())
        assert (report.planned_new, report.planned_changed, report.unchanged) == (3, 0, 0)
        assert streamed_numbers(fake_visualex) == []
        assert store.units_for_act("cc") == [] and store.get_act("cc") is None
        paths = {p for p, _ in fake_visualex.calls}
        assert paths == {"/fetch_norma_data", "/fetch_tree", "/fetch_rubriche", "/fetch_act_fingerprints"}

    async def test_dry_run_after_a_run_reports_the_changes(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        scenario["fingerprints"]["2043"] = {"fingerprint": "n" * 64, "date": None}
        report = await make_pipeline(dry_run=True).process_act(cc_spec())
        assert (report.planned_new, report.planned_changed, report.unchanged) == (0, 1, 2)

    async def test_resume_skips_units_already_logged(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        run_id = store.start_run({}, NOW.isoformat())
        store.log_unit(run_id, unit_id("cc", "article", "2043"), "new")
        report = await make_pipeline(resume=run_id).process_act(cc_spec())
        assert report.skipped == 1 and report.new == 2
        assert "2043" not in streamed_numbers(fake_visualex)


class TestEuActs:
    async def test_recitals_and_no_fingerprints(self, fake_visualex, store, make_pipeline):
        fake_visualex.add_act(
            act_type="regolamento ue", date="2016", act_number="679", url=GDPR_URL,
            tree=["CAPO I", {"numero": "1"}, {"numero": "2"}],
            rubriche={"1": "Oggetto e finalità"},
            recitals=[{"number": "1", "text": "La protezione…"}, {"number": "2", "text": "I principi…"}],
            articles={"1": "Il presente regolamento…", "2": "Ambito…"},
        )
        report = await make_pipeline().process_act(gdpr_spec())
        assert report.fingerprints_available is None
        assert report.new == 2 and report.recitals == 2
        assert "/fetch_act_fingerprints" not in {p for p, _ in fake_visualex.calls}
        units = store.units_for_act("gdpr")
        assert [(u.kind, u.number) for u in units] == [("article", "1"), ("article", "2"), ("recital", "1"), ("recital", "2")]
        assert units[0].identifier == "32016R0679#art_1" and units[0].capo == "CAPO I"
        assert units[2].identifier == "32016R0679#rct_1" and units[2].text == "La protezione…"
        assert store.get_act("gdpr").text_status == "oj"

    async def test_consolidated_articles_and_oj_recitals(self, fake_visualex, store, make_pipeline):
        cons = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              celex_consolidated="02002L0058-20091219", url=cons,
                              tree=[{"numero": "5"}, {"numero": "14 bis"}],
                              articles={"5": "Riservatezza…", "14-bis": "Comitato…"})
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              url="https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita",
                              recitals=[{"number": "1", "text": "La direttiva 95/46/CE…"}])
        spec = ActSpec(id="eprivacy", area="ue", label="e-privacy", source="eurlex", act_type="direttiva ue",
                       date="2002", act_number="58", celex="32002L0058", celex_consolidated="02002L0058-20091219",
                       units=("articles", "recitals"), cite="dir. 2002/58/CE")
        report = await make_pipeline().process_act(spec)
        assert report.new == 2 and report.recitals == 1
        assert store.get_act("eprivacy").text_status == "consolidated"
        assert store.get_act("eprivacy").consolidated_celex == "02002L0058-20091219"
        assert store.get_unit("eprivacy:art:14-bis").text == "Comitato…"
        recital_body = [b for p, b in fake_visualex.calls if p == "/fetch_recitals"][0]
        assert "celex_consolidated" not in recital_body
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_pipeline.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.pipeline'`.

- [ ] **Step 3: Implement**

`archivio_normativo/pipeline.py`:

```python
"""One act at a time: resolve → index → diff → fetch what changed → store.

The diff is what makes an update run cheap. `/fetch_act_fingerprints` gives a
hash per article from one download; an article whose hash equals the stored
one is "unchanged" without a request. Everything else — first run, `--full`,
no fingerprints, a moved hash, a unit missing from the store — is fetched
through `/stream_article_text` in batches. Nothing is written in
`--dry-run`; every write is committed per unit so a killed run loses
nothing and `--resume` continues it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Protocol

from .hierarchy import IndexedArticle, walk_tree
from .manifest import ActSpec
from .sources.visualex import (
    ActResolution, ArticleResult, VisuaLexClient, VisuaLexError, select_fingerprints,
)
from .store import ActRecord, Store, UnitRecord

BROCARDI_TOOL = "visualex.show_brocardi_info"


def unit_id(act_id: str, kind: str, number: str) -> str:
    return f"{act_id}:{'art' if kind == 'article' else 'rec'}:{number}"


def today(now: Callable[[], datetime]) -> str:
    return now().date().isoformat()


def stamp(now: Callable[[], datetime]) -> str:
    return now().replace(microsecond=0).isoformat()


@dataclass
class RunOptions:
    out_dir: Path
    dry_run: bool = False
    full: bool = False
    resume_run_id: int | None = None
    enrich_override: tuple[str, ...] | None = None
    refresh_enrich: bool = False
    batch_size: int = 25
    enrich_ttl_days: int = 90


@dataclass
class ActReport:
    act_id: str
    label: str
    resolved: bool = True
    reason: str | None = None
    text_status: str = "consolidated"
    fingerprints_available: bool | None = None
    total: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    skipped: int = 0
    recitals: int = 0
    planned_new: int = 0
    planned_changed: int = 0
    enrich_planned: int = 0
    enrich_ok: int = 0
    enrich_empty: int = 0
    enrich_error: int = 0
    enrich_kept: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)
    changed: bool = False

    def count(self, outcome: str) -> None:
        setattr(self, outcome, getattr(self, outcome) + 1)

    def fail(self, uid: str, reason: str) -> None:
        self.failed += 1
        self.failures.append((uid, reason))


@dataclass(frozen=True)
class UnitOutcome:
    unit_id: str
    number: str
    outcome: str  # new | updated | unchanged


class Enricher(Protocol):
    async def enrich_act(self, spec: ActSpec, res: ActResolution, units: list[UnitOutcome],
                         report: ActReport) -> None: ...


def _chunks(items: list, size: int) -> Iterable[list]:
    size = max(1, int(size))
    for start in range(0, len(items), size):
        yield items[start:start + size]


class Pipeline:
    def __init__(self, *, store: Store | None, visualex: VisuaLexClient, options: RunOptions,
                 run_id: int | None, log: logging.Logger, now: Callable[[], datetime],
                 enricher: Enricher | None = None):
        self.store = store
        self.visualex = visualex
        self.options = options
        self.run_id = run_id
        self.log = log
        self.now = now
        self.enricher = enricher
        if not options.dry_run and (store is None or run_id is None):
            raise ValueError("a store and a run id are required unless dry_run")

    # -- driver --------------------------------------------------------------

    async def run(self, specs: Iterable[ActSpec]) -> list[ActReport]:
        reports = []
        for spec in specs:
            try:
                reports.append(await self.process_act(spec))
            except Exception as exc:  # noqa: BLE001 — one act must not end the run
                self.log.exception("act=%s crashed: %s", spec.id, exc)
                reports.append(ActReport(spec.id, spec.label, resolved=False,
                                         reason=f"unexpected error: {exc}", text_status=spec.text_status()))
        return reports

    # -- one act -------------------------------------------------------------

    def _kinds(self, spec: ActSpec) -> tuple[str, ...]:
        return self.options.enrich_override if self.options.enrich_override is not None else spec.enrich

    async def process_act(self, spec: ActSpec) -> ActReport:
        report = ActReport(spec.id, spec.label, text_status=spec.text_status())
        self.log.info("ACT %s (%s) start", spec.id, spec.label)
        try:
            res = await self.visualex.resolve_act(spec)
        except VisuaLexError as exc:
            report.resolved = False
            report.reason = str(exc)
            self.log.error("ACT %s unresolved: %s", spec.id, exc)
            return report

        tree = await self.visualex.fetch_tree(res.act_url)
        # The tree lists every annex; the act is one of them. Positions are
        # re-counted within the annex so the archive's order starts at 0.
        indexed = [replace(a, position=i)
                   for i, a in enumerate(a for a in walk_tree(tree.items) if a.annex == res.annex)]
        if not indexed and tree.count:
            report.resolved = False
            report.reason = (f"no article in annex {res.annex!r}; the tree has "
                             f"{[x.get('number') for x in tree.annexes]}")
            self.log.error("ACT %s: %s", spec.id, report.reason)
            return report
        rubriche = await self.visualex.fetch_rubriche(res.act_url)

        fingerprints: dict[str, dict] = {}
        if not spec.is_eu():
            fp = await self.visualex.fetch_fingerprints(res.act_url)
            report.fingerprints_available = fp.available
            fingerprints = select_fingerprints(fp, [a.number for a in indexed])
            if fp.available and not fingerprints:
                self.log.warning("ACT %s: fingerprints answer overlaps no article of annex %r; full fetch",
                                 spec.id, res.annex)
        report.total = len(indexed)

        kinds = self._kinds(spec)
        brocardi = "brocardi" in kinds and not spec.is_eu()
        to_fetch, unchanged, brocardi_only = self._plan(spec, indexed, fingerprints, kinds, report)

        if self.options.dry_run:
            report.enrich_planned = len(brocardi_only) + (len(to_fetch) if brocardi else 0)
            self.log.info("DRY-RUN act=%s new=%d changed=%d unchanged=%d brocardi=%d",
                          spec.id, report.planned_new, report.planned_changed, report.unchanged,
                          report.enrich_planned)
            return report

        assert self.store is not None and self.run_id is not None
        # The act row first: units reference it (FOREIGN KEY), and a run killed
        # mid-act must still leave a coherent archive.
        self._upsert_act(spec, res)
        outcomes: list[UnitOutcome] = []
        for a in unchanged:
            uid = unit_id(spec.id, "article", a.number)
            self.store.touch_checked(uid, self.run_id, today(self.now))
            self.store.log_unit(self.run_id, uid, "unchanged", "fingerprint")
            report.count("unchanged")
            outcomes.append(UnitOutcome(uid, a.number, "unchanged"))
            self.log.info("UNCHANGED act=%s art=%s (fingerprint)", spec.id, a.number)

        outcomes += await self._fetch(spec, res, to_fetch, rubriche, fingerprints, brocardi, report)
        if brocardi_only:
            await self._fetch(spec, res, brocardi_only, rubriche, fingerprints, True, report,
                              brocardi_pass=True)

        if spec.wants_recitals():
            await self._recitals(spec, report)

        self._upsert_act(spec, res)  # again, with the final unit count

        if self.enricher is not None:
            await self.enricher.enrich_act(spec, res, outcomes, report)

        report.changed = self.store.act_changed_in_run(spec.id, self.run_id)
        self.log.info("ACT %s done: new=%d updated=%d unchanged=%d failed=%d skipped=%d",
                      spec.id, report.new, report.updated, report.unchanged, report.failed, report.skipped)
        return report

    @staticmethod
    def _act_identifier(spec: ActSpec, res: ActResolution) -> str:
        return spec.celex if (spec.is_eu() and spec.celex) else res.act_url

    def _upsert_act(self, spec: ActSpec, res: ActResolution) -> None:
        assert self.store is not None
        self.store.upsert_act(ActRecord(
            id=spec.id, area=spec.area, label=spec.label, source=spec.source,
            identifier=self._act_identifier(spec, res), act_type=spec.act_type,
            date=spec.date or res.data, act_number=spec.act_number or res.numero_atto,
            annex=res.annex, source_url=res.act_url, text_status=spec.text_status(),
            consolidated_celex=spec.celex_consolidated,
        ), unit_count=len(self.store.units_for_act(spec.id)), updated_at=stamp(self.now))

    def _plan(self, spec: ActSpec, indexed: list[IndexedArticle], fingerprints: dict[str, dict],
              kinds: tuple[str, ...], report: ActReport):
        """Split the index into (to_fetch, unchanged, brocardi_only)."""
        stored_fp = self.store.fingerprints_for_act(spec.id) if self.store else {}
        skip = set()
        if self.store and self.options.resume_run_id is not None and self.run_id == self.options.resume_run_id:
            skip = self.store.logged_unit_ids(self.run_id)
        to_fetch: list[IndexedArticle] = []
        unchanged: list[IndexedArticle] = []
        brocardi_only: list[IndexedArticle] = []
        want_brocardi = "brocardi" in kinds and not spec.is_eu()
        for a in indexed:
            uid = unit_id(spec.id, "article", a.number)
            if uid in skip:
                report.count("skipped")
                continue
            known = self.store.get_unit(uid) is not None if self.store else False
            same = (fingerprints.get(a.number) is not None and known
                    and stored_fp.get(a.number) == fingerprints[a.number]["fingerprint"])
            if self.options.full or not same:
                to_fetch.append(a)
                if known:
                    report.planned_changed += 1
                else:
                    report.planned_new += 1
                continue
            if want_brocardi and self._brocardi_due(spec, uid):
                brocardi_only.append(a)
            unchanged.append(a)
        if self.options.dry_run:
            report.unchanged = len(unchanged)
        return to_fetch, unchanged, brocardi_only

    def _brocardi_due(self, spec: ActSpec, uid: str) -> bool:
        if self.options.refresh_enrich:
            return True
        existing = self.store.get_enrichment(spec.id, uid, "brocardi") if self.store else None
        if existing is None:
            return True
        return self._older_than_ttl(existing["fetched_at"])

    def _older_than_ttl(self, fetched_at: str) -> bool:
        try:
            age = self.now() - datetime.fromisoformat(fetched_at)
        except ValueError:
            return True
        return age.days >= self.options.enrich_ttl_days

    async def _fetch(self, spec: ActSpec, res: ActResolution, targets: list[IndexedArticle],
                     rubriche, fingerprints: dict[str, dict], brocardi: bool, report: ActReport,
                     brocardi_pass: bool = False) -> list[UnitOutcome]:
        assert self.store is not None and self.run_id is not None
        outcomes: list[UnitOutcome] = []
        by_number_index = {a.number: a for a in targets}
        for batch in _chunks(targets, self.options.batch_size):
            numbers = [a.number for a in batch]
            try:
                results = await self.visualex.stream_articles(spec, numbers, res.annex, brocardi)
            except VisuaLexError as exc:
                for a in batch:
                    self._fail(spec, a.number, str(exc), report)
                continue
            answered = {r.number: r for r in results}
            for a in batch:
                r = answered.get(a.number)
                if r is None:
                    self._fail(spec, a.number, "not returned by VisuaLex (not in the act?)", report)
                    continue
                if r.error or r.text is None:
                    self._fail(spec, a.number, r.error or "empty text", report)
                    continue
                uid = unit_id(spec.id, "article", a.number)
                record = self._record(spec, res, by_number_index[a.number], r, rubriche, fingerprints)
                outcome = self.store.upsert_unit(record, self.run_id)
                if brocardi_pass:
                    # The text came along, but this pass was for the annotations:
                    # the unit was already counted as unchanged.
                    self.store.log_unit(self.run_id, uid, "unchanged", "brocardi refresh")
                else:
                    self.store.log_unit(self.run_id, uid, outcome)
                    report.count(outcome)
                    outcomes.append(UnitOutcome(uid, a.number, outcome))
                    self.log.info("%s act=%s art=%s hash=%s", outcome.upper(), spec.id, a.number,
                                  record.text_hash[:12])
                if brocardi:
                    self._store_brocardi(spec, uid, r, report)
        return outcomes

    def _fail(self, spec: ActSpec, number: str, reason: str, report: ActReport) -> None:
        uid = unit_id(spec.id, "article", number)
        report.fail(uid, reason)
        if self.store is not None and self.run_id is not None:
            self.store.log_unit(self.run_id, uid, "failed", reason)
        self.log.error("FAILED act=%s art=%s reason=%s", spec.id, number, reason)

    def _record(self, spec: ActSpec, res: ActResolution, a: IndexedArticle, r: ArticleResult,
                rubriche, fingerprints: dict[str, dict]) -> UnitRecord:
        fp = fingerprints.get(a.number) or {}
        if spec.is_eu() and spec.celex:
            identifier = f"{spec.celex}#art_{a.number}"
        else:
            identifier = r.urn or f"{res.act_url}~art{a.number}"
        return UnitRecord(
            id=unit_id(spec.id, "article", a.number), act_id=spec.id, kind="article", number=a.number,
            position=a.position, identifier=identifier, rubrica=rubriche.rubriche.get(a.number),
            parte=a.parte, libro=a.libro, titolo=a.titolo, capo=a.capo, sezione=a.sezione,
            text=r.text, fingerprint=fp.get("fingerprint"), abrogato=a.number in rubriche.abrogati,
            version=spec.version, vigenza_al=today(self.now), ultimo_aggiornamento=fp.get("date"),
            source_url=r.url or r.urn, fetched_at=stamp(self.now),
        )

    def _store_brocardi(self, spec: ActSpec, uid: str, r: ArticleResult, report: ActReport) -> None:
        assert self.store is not None and self.run_id is not None
        if r.brocardi:
            self.store.upsert_enrichment(spec.id, uid, "brocardi", BROCARDI_TOOL, {}, None, r.brocardi,
                                         "ok", None, stamp(self.now), self.run_id)
            report.enrich_ok += 1
        elif r.brocardi_error:
            self.store.upsert_enrichment(spec.id, uid, "brocardi", BROCARDI_TOOL, {}, None, None,
                                         "error", r.brocardi_error, stamp(self.now), self.run_id)
            report.enrich_error += 1
            self.log.warning("ENRICH brocardi act=%s unit=%s error=%s", spec.id, uid, r.brocardi_error)

    async def _recitals(self, spec: ActSpec, report: ActReport) -> None:
        assert self.store is not None and self.run_id is not None
        try:
            recitals = await self.visualex.fetch_recitals(spec)
        except VisuaLexError as exc:
            self.log.error("FAILED act=%s recitals reason=%s", spec.id, exc)
            report.fail(unit_id(spec.id, "recital", "*"), f"recitals: {exc}")
            return
        for position, rec in enumerate(recitals):
            uid = unit_id(spec.id, "recital", rec.number)
            record = UnitRecord(
                id=uid, act_id=spec.id, kind="recital", number=rec.number, position=position,
                identifier=f"{spec.celex}#rct_{rec.number}" if spec.celex else None, rubrica=None,
                parte=None, libro=None, titolo=None, capo=None, sezione=None, text=rec.text,
                fingerprint=None, abrogato=False, version=spec.version, vigenza_al=today(self.now),
                ultimo_aggiornamento=None, source_url=None, fetched_at=stamp(self.now),
            )
            outcome = self.store.upsert_unit(record, self.run_id)
            self.store.log_unit(self.run_id, uid, outcome)
            report.recitals += 1
            self.log.info("%s act=%s rec=%s", outcome.upper(), spec.id, rec.number)
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_pipeline.py -q`
Expected: 17 passed.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/pipeline.py tests/archivio/test_pipeline.py
git commit -m "feat(archivio): per-act pipeline — fingerprint diff, batched fetch, recitals, dry-run, resume

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `enrich.py` — the refresh policy and the legal-it calls

**Files:**
- Create: `archivio_normativo/enrich.py`
- Modify: `archivio_normativo/pipeline.py` (dry-run branch asks the enricher for its plan)
- Test: `tests/archivio/test_enrich.py`

**Interfaces:**
- Consumes: `UnitOutcome`, `ActReport`, `RunOptions`, `stamp` (Task 7); `unit_calls`, `act_calls`, `classify_result`, `ToolCall`, `LegalItError` (Task 6); `KINDS`, `ActSpec` (Task 2); `Store` (Task 4).
- Produces: `Enricher(*, store, legalit, options, run_id, log, now)` implementing the `Enricher` protocol of Task 7 (`enrich_act`) plus `plan_act(spec, numbers: list[str]) -> int` (calls a full pass would make). `legalit` is any object with `async call(ToolCall) -> str`.
- Pipeline change: in the `dry_run` branch, `if self.enricher is not None: report.enrich_planned += self.enricher.plan_act(spec, [a.number for a in indexed])`.

Refresh policy (spec §"Enrichment kinds"): an enrichment is (re)fetched when the unit has none, the unit's text is `new`/`updated` this run, the stored one is older than `enrich_ttl_days`, its status is `error` (a failure is retried next time), or `--refresh-enrich` is set. Otherwise it is kept and counted in `enrich_kept`. Act-level kinds follow the same rule with `unit_id = ""` and no text-change trigger.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_enrich.py`:

```python
"""Enrichment beyond Brocardi: what gets asked of legal-it, and when."""
import logging
from datetime import datetime

import pytest

from archivio_normativo.enrich import Enricher
from archivio_normativo.manifest import ActSpec
from archivio_normativo.pipeline import ActReport, RunOptions, UnitOutcome
from archivio_normativo.sources.legalit import LegalItError, ToolCall
from archivio_normativo.sources.visualex import ActResolution
from archivio_normativo.store import ActRecord, Store

NOW = datetime(2026, 9, 19, 21, 0, 0)
RES = ActResolution(act_url="https://www.normattiva.it/x", annex=None, tipo_atto="decreto legislativo",
                    data="2001-06-08", numero_atto="231", sample_urn="https://www.normattiva.it/x~art1")


def spec(**kw):
    base = dict(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                act_type="decreto legislativo", date="2001-06-08", act_number="231", cite="D.Lgs. 231/2001",
                enrich=("cassazione", "costituzionale"))
    base.update(kw)
    return ActSpec(**base)


class FakeLegalIt:
    def __init__(self, responses=None):
        self.responses = dict(responses or {})
        self.calls: list[ToolCall] = []

    async def call(self, call: ToolCall) -> str:
        self.calls.append(call)
        answer = self.responses.get(call.tool, f"## {call.tool}\n- risultato per {call.args}")
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "a.sqlite") as s:
        s.upsert_act(ActRecord(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                               identifier="x", act_type="decreto legislativo", date="2001-06-08", act_number="231",
                               annex=None, source_url="x", text_status="consolidated", consolidated_celex=None),
                     unit_count=0, updated_at="t")
        yield s


def make(store, legalit, *, run_id=None, refresh=False, ttl=90, override=None, now=NOW):
    run_id = run_id or store.start_run({}, NOW.isoformat())
    options = RunOptions(out_dir=store.path.parent, refresh_enrich=refresh, enrich_ttl_days=ttl,
                         enrich_override=override)
    return Enricher(store=store, legalit=legalit, options=options, run_id=run_id,
                    log=logging.getLogger("t"), now=lambda: now), run_id


def units(*numbers, outcome="new"):
    return [UnitOutcome(f"dlgs-231-2001:art:{n}", n, outcome) for n in numbers]


class TestUnitLevel:
    async def test_new_units_get_every_unit_kind(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        report = ActReport("dlgs-231-2001", "x")
        await enricher.enrich_act(spec(), RES, units("6", "7"), report)
        tools = [(c.tool, c.args["riferimento"]) for c in legalit.calls]
        assert tools == [("giurisprudenza_su_norma", "art. 6 D.Lgs. 231/2001"),
                         ("pronunce_cost_su_norma", "art. 6 D.Lgs. 231/2001"),
                         ("giurisprudenza_su_norma", "art. 7 D.Lgs. 231/2001"),
                         ("pronunce_cost_su_norma", "art. 7 D.Lgs. 231/2001")]
        row = store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")
        assert row["status"] == "ok" and row["tool"] == "giurisprudenza_su_norma"
        assert row["params"]["riferimento"] == "art. 6 D.Lgs. 231/2001"
        assert row["content_md"].startswith("## giurisprudenza_su_norma")
        assert row["fetched_at"] == "2026-09-19T21:00:00"
        assert (report.enrich_ok, report.enrich_kept) == (4, 0)

    async def test_selection_restricts_the_articles(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich_articles="6-7"), RES, units("5", "6", "7", "25-bis"), ActReport("a", "b"))
        assert {c.args["riferimento"] for c in legalit.calls} == {"art. 6 D.Lgs. 231/2001", "art. 7 D.Lgs. 231/2001"}

    async def test_fresh_enrichment_on_an_unchanged_unit_is_kept(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        report = ActReport("a", "b")
        enricher2, _ = make(store, legalit, now=datetime(2026, 10, 1))
        await enricher2.enrich_act(spec(), RES, units("6", outcome="unchanged"), report)
        assert legalit.calls == [] and report.enrich_kept == 2

    async def test_updated_text_refreshes(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        enricher2, _ = make(store, legalit)
        await enricher2.enrich_act(spec(), RES, units("6", outcome="updated"), ActReport("a", "b"))
        assert len(legalit.calls) == 2

    async def test_ttl_and_refresh_flag(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        old, _ = make(store, legalit, now=datetime(2027, 1, 1))  # > 90 days later
        await old.enrich_act(spec(), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 2
        legalit.calls.clear()
        forced, _ = make(store, legalit, refresh=True)
        await forced.enrich_act(spec(), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 2

    async def test_override_replaces_the_manifest_kinds(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit, override=("garante",))
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["cerca_provvedimenti_garante"]

    async def test_brocardi_is_never_asked_of_legalit(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit, override=("brocardi", "cassazione"))
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["giurisprudenza_su_norma"]


class TestResults:
    async def test_empty_and_error_texts_are_classified(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": "Nessun risultato su italgiure.",
                               "pronunce_cost_su_norma": "**Errore**: Consulta non raggiungibile."})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(spec(), RES, units("6"), report)
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["status"] == "empty"
        err = store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "costituzionale")
        assert err["status"] == "error" and "non raggiungibile" in err["error"]
        assert (report.enrich_ok, report.enrich_empty, report.enrich_error) == (0, 1, 1)

    async def test_an_exception_is_an_error_row_and_the_pass_goes_on(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": LegalItError("server gone")})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(spec(), RES, units("6", "7"), report)
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["error"] == "server gone"
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:7", "costituzionale")["status"] == "ok"
        assert report.enrich_error == 2 and report.enrich_ok == 2

    async def test_error_rows_are_retried_next_run(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": LegalItError("gone")})
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich=("cassazione",)), RES, units("6"), ActReport("a", "b"))
        legalit.responses.clear()
        legalit.calls.clear()
        again, _ = make(store, legalit)
        await again.enrich_act(spec(enrich=("cassazione",)), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 1
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["status"] == "ok"


class TestActLevel:
    async def test_attuazione_joins_two_tools(self, store):
        eu = ActSpec(id="dlgs-231-2001", area="ue", label="NIS2", source="eurlex", act_type="direttiva ue",
                     date="2022", act_number="2555", celex="32022L2555", units=("articles", "recitals"),
                     cite="dir. (UE) 2022/2555", enrich=("attuazione",))
        legalit = FakeLegalIt({"get_italian_implementation": "D.Lgs. 138/2024", "elenco_misure_nazionali": "- ITA: D.Lgs. 138/2024"})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(eu, RES, units("1"), report)
        assert [c.tool for c in legalit.calls] == ["get_italian_implementation", "elenco_misure_nazionali"]
        row = store.get_enrichment("dlgs-231-2001", "", "attuazione")
        assert row["tool"] == "get_italian_implementation+elenco_misure_nazionali"
        assert "### get_italian_implementation\n\nD.Lgs. 138/2024" in row["content_md"]
        assert "### elenco_misure_nazionali\n\n- ITA: D.Lgs. 138/2024" in row["content_md"]
        assert row["status"] == "ok" and report.enrich_ok == 1

    async def test_base_ue_once_per_act_and_kept_when_fresh(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich=("base_ue",)), RES, units("6", "7"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["get_eu_basis"]
        legalit.calls.clear()
        report = ActReport("a", "b")
        again, _ = make(store, legalit)
        await again.enrich_act(spec(enrich=("base_ue",)), RES, units("6", outcome="unchanged"), report)
        assert legalit.calls == [] and report.enrich_kept == 1


class TestPlan:
    def test_counts_the_calls_of_a_full_pass(self, store):
        enricher, _ = make(store, FakeLegalIt())
        assert enricher.plan_act(spec(), ["6", "7", "8"]) == 6
        assert enricher.plan_act(spec(enrich=("attuazione", "cassazione"), enrich_articles="6"), ["6", "7"]) == 3
        assert enricher.plan_act(spec(enrich=()), ["6"]) == 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_enrich.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.enrich'`.

- [ ] **Step 3: Implement**

`archivio_normativo/enrich.py`:

```python
"""Enrichment beyond Brocardi: case law, the Consulta, the Garante, EU↔IT.

Every kind is one or two legal-it tool calls per article (or per act). The
answers are markdown for a reader and are stored verbatim, attributed to the
tool and dated. The refresh policy keeps the sources' load proportional to
what changed: a fresh answer on an unchanged article is kept; a changed
text, an aged answer, a past failure or `--refresh-enrich` asks again.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable

from .manifest import KINDS, ActSpec
from .pipeline import ActReport, RunOptions, UnitOutcome, stamp
from .sources.legalit import LegalItError, ToolCall, act_calls, classify_result, unit_calls
from .sources.visualex import ActResolution
from .store import Store


class Enricher:
    def __init__(self, *, store: Store, legalit, options: RunOptions, run_id: int,
                 log: logging.Logger, now: Callable[[], datetime]):
        self.store = store
        self.legalit = legalit
        self.options = options
        self.run_id = run_id
        self.log = log
        self.now = now

    # -- what applies -------------------------------------------------------

    def _kinds(self, spec: ActSpec) -> tuple[list[str], list[str]]:
        kinds = self.options.enrich_override if self.options.enrich_override is not None else spec.enrich
        unit_kinds = [k for k in kinds if KINDS[k].level == "unit" and k != "brocardi"]
        act_kinds = [k for k in kinds if KINDS[k].level == "act"]
        return unit_kinds, act_kinds

    def plan_act(self, spec: ActSpec, numbers: list[str]) -> int:
        unit_kinds, act_kinds = self._kinds(spec)
        selection = spec.enrich_selection()
        chosen = [n for n in numbers if selection is None or selection.contains(n)]
        calls = sum(len(unit_calls(kind, spec, n)) for kind in unit_kinds for n in chosen)
        calls += sum(len(act_calls(kind, spec)) for kind in act_kinds)
        return calls

    def _due(self, act_id: str, uid: str, kind: str, outcome: str | None) -> bool:
        if self.options.refresh_enrich or outcome in ("new", "updated"):
            return True
        existing = self.store.get_enrichment(act_id, uid, kind)
        if existing is None or existing["status"] == "error":
            return True
        try:
            age = self.now() - datetime.fromisoformat(existing["fetched_at"])
        except ValueError:
            return True
        return age.days >= self.options.enrich_ttl_days

    # -- the pass -----------------------------------------------------------

    async def enrich_act(self, spec: ActSpec, res: ActResolution, units: list[UnitOutcome],
                         report: ActReport) -> None:
        unit_kinds, act_kinds = self._kinds(spec)
        if not unit_kinds and not act_kinds:
            return
        for kind in act_kinds:
            if self._due(spec.id, "", kind, None):
                await self._execute(spec, "", kind, act_calls(kind, spec), report)
            else:
                report.enrich_kept += 1
        selection = spec.enrich_selection()
        for unit in units:
            if selection is not None and not selection.contains(unit.number):
                continue
            for kind in unit_kinds:
                if self._due(spec.id, unit.unit_id, kind, unit.outcome):
                    await self._execute(spec, unit.unit_id, kind, unit_calls(kind, spec, unit.number), report)
                else:
                    report.enrich_kept += 1

    async def _execute(self, spec: ActSpec, uid: str, kind: str, calls: list[ToolCall],
                       report: ActReport) -> None:
        sections: list[str] = []
        statuses: list[str] = []
        error: str | None = None
        for call in calls:
            try:
                text = await self.legalit.call(call)
            except LegalItError as exc:
                error = str(exc)
                self.log.warning("ENRICH %s act=%s unit=%s tool=%s error=%s", kind, spec.id, uid or "-", call.tool, exc)
                break
            statuses.append(classify_result(text))
            if statuses[-1] == "error":
                error = text.strip()
            sections.append(text if len(calls) == 1 else f"### {call.tool}\n\n{text}")
        if error is not None:
            status = "error"
        elif "ok" in statuses:
            status = "ok"
        else:
            status = "empty"
        content_md = "\n\n".join(sections) if sections else None
        self.store.upsert_enrichment(
            spec.id, uid, kind, "+".join(c.tool for c in calls),
            {c.tool: c.args for c in calls} if len(calls) > 1 else dict(calls[0].args),
            content_md, None, status, error, stamp(self.now), self.run_id,
        )
        report.count(f"enrich_{status}")
        self.log.info("ENRICH %s act=%s unit=%s status=%s", kind, spec.id, uid or "-", status)
```

Pipeline change (`archivio_normativo/pipeline.py`, the dry-run branch in `process_act`):

```python
        if self.options.dry_run:
            report.enrich_planned = len(brocardi_only) + (len(to_fetch) if brocardi else 0)
            if self.enricher is not None:
                report.enrich_planned += self.enricher.plan_act(spec, [a.number for a in indexed])
            self.log.info("DRY-RUN act=%s new=%d changed=%d unchanged=%d enrichment_calls=%d",
                          spec.id, report.planned_new, report.planned_changed, report.unchanged,
                          report.enrich_planned)
            return report
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_enrich.py tests/archivio/test_pipeline.py -q`
Expected: all passed (13 + 17).

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/enrich.py archivio_normativo/pipeline.py tests/archivio/test_enrich.py
git commit -m "feat(archivio): enrichment pass with refresh policy over legal-it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `render_md.py` — one Markdown per act, plus the root index

**Files:**
- Create: `archivio_normativo/render_md.py`
- Create: `tests/archivio/golden/cc.md`
- Test: `tests/archivio/test_render_md.py`

**Interfaces:**
- Consumes: `Store`, `ActRecord`, `UnitRecord` (Task 4); `LEVELS` (Task 3).
- Produces: `anchor_for(kind, number)`, `heading_for(unit)`, `escape_md(text)`, `demote_headings(text)`, `render_act(act, units, enrichments, rendered_at) -> str`, `render_index(acts, unit_counts, vigenza, last_run, rendered_at) -> str`, `act_path(out_dir, act) -> Path`, `write_outputs(store, out_dir, act_ids | None, rendered_at) -> list[Path]` (renders the given acts — all when `None` — and always `INDICE.md`).

Design points: the front matter carries the act's identity and counts; the index nests by parte/libro/titolo/capo/sezione; every unit gets an explicit `<a id="art-2043"></a>` anchor before its `##` heading so `[…](#art-2043)` links work in every renderer (GitHub-style heading slugs would differ); enrichment blocks name their tool and the day they were asked, escape `<`, and demote the source's own headings below the article's `##`; an `empty`/`error` enrichment renders a one-line note rather than disappearing; an `oj` act opens with a warning line.

- [ ] **Step 1: Write the failing tests and the golden file**

`tests/archivio/test_render_md.py`:

```python
"""Markdown for reading, rendered from the store and nothing else."""
from pathlib import Path

from archivio_normativo.render_md import (
    anchor_for, demote_headings, escape_md, heading_for, render_act, render_index, write_outputs,
)
from archivio_normativo.store import ActRecord, Store, UnitRecord

GOLDEN = Path(__file__).parent / "golden"
RENDERED_AT = "2026-09-19T21:00:00"


def act():
    return ActRecord(id="cc", area="civile", label="Codice civile", source="normattiva",
                     identifier="urn:nir:stato:regio.decreto:1942-03-16;262", act_type="codice civile",
                     date="1942-03-16", act_number="262", annex="2", source_url="https://www.normattiva.it/x",
                     text_status="consolidated", consolidated_celex=None)


def article(number, position, rubrica, text, **kw):
    base = dict(id=f"cc:art:{number}", act_id="cc", kind="article", number=number, position=position,
                identifier=f"urn:nir:stato:regio.decreto:1942-03-16;262:2~art{number.replace('-', '')}",
                rubrica=rubrica, parte=None, libro="LIBRO QUARTO Delle obbligazioni",
                titolo="TITOLO IX Dei fatti illeciti", capo=None, sezione=None, text=text, fingerprint=None,
                abrogato=False, version="vigente", vigenza_al="2026-09-19", ultimo_aggiornamento="1942-04-21",
                source_url=f"https://www.normattiva.it/art{number}", fetched_at=RENDERED_AT)
    base.update(kw)
    return UnitRecord(**base)


def units():
    return [
        article("2043", 0, "Risarcimento per fatto illecito",
                "Qualunque fatto doloso o colposo che cagiona ad altri un danno ingiusto, "
                "obbliga colui che ha commesso il fatto a risarcire il danno."),
        article("2043-bis", 1, None, "(abrogato)", abrogato=True, ultimo_aggiornamento=None,
                titolo="TITOLO X Nuovo titolo"),
        UnitRecord(id="cc:rec:1", act_id="cc", kind="recital", number="1", position=0, identifier="X#rct_1",
                   rubrica=None, parte=None, libro=None, titolo=None, capo=None, sezione=None,
                   text="Considerando uno.", fingerprint=None, abrogato=False, version="vigente",
                   vigenza_al="2026-09-19", ultimo_aggiornamento=None, source_url=None, fetched_at="t"),
    ]


def enrichment(unit_id, kind, tool, *, content_md=None, content_json=None, status="ok", error=None):
    return {"act_id": "cc", "unit_id": unit_id, "kind": kind, "tool": tool, "params": {},
            "content_md": content_md, "content_json": content_json, "content_hash": "h",
            "fetched_at": RENDERED_AT, "run_id": 1, "status": status, "error": error}


def enrichments():
    return [
        enrichment("cc:art:2043", "brocardi", "visualex.show_brocardi_info", content_json={
            "Ratio": "La ratio <b>x</b>.", "Massime": ["Cass. 1/2024"],
            "Glossario": [{"termine": "Danno", "url": "https://brocardi.it/d"}], "link": "https://brocardi.it/2043"}),
        enrichment("cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                   content_md="## Sentenze\n- Cass. <script>x</script> 5/2025"),
        enrichment("cc:art:2043-bis", "cassazione", "giurisprudenza_su_norma", status="empty"),
        enrichment("", "base_ue", "get_eu_basis", status="error", error="non raggiungibile"),
    ]


class TestPieces:
    def test_anchors_and_headings(self):
        assert anchor_for("article", "2-bis") == "art-2-bis"
        assert anchor_for("recital", "47") == "considerando-47"
        assert heading_for(units()[0]) == "Art. 2043 — Risarcimento per fatto illecito"
        assert heading_for(units()[1]) == "Art. 2043 bis"
        assert heading_for(units()[2]) == "Considerando 1"

    def test_escape_and_demote(self):
        assert escape_md("<script>") == "&lt;script>"
        assert demote_headings("## Sentenze\n# Top\ntesto\n####### no") == "##### Sentenze\n#### Top\ntesto\n####### no"


class TestGolden:
    def test_matches_the_golden_file(self):
        rendered = render_act(act(), units(), enrichments(), RENDERED_AT)
        expected = (GOLDEN / "cc.md").read_text(encoding="utf-8")
        assert rendered == expected

    def test_rendering_is_deterministic(self):
        assert render_act(act(), units(), enrichments(), RENDERED_AT) == render_act(act(), units(), enrichments(), RENDERED_AT)

    def test_oj_acts_carry_a_warning(self):
        oj = ActRecord(id="gdpr", area="ue", label="GDPR", source="eurlex", identifier="32016R0679",
                       act_type="regolamento ue", date="2016", act_number="679", annex=None, source_url="x",
                       text_status="oj", consolidated_celex=None)
        assert "non consolidato" in render_act(oj, [], [], RENDERED_AT)


class TestIndexAndFiles:
    def test_index_lists_acts_by_area(self):
        text = render_index([act()], {"cc": 3}, {"cc": "2026-09-19"},
                            {"started_at": RENDERED_AT, "status": "done"}, RENDERED_AT)
        assert "## civile" in text
        assert "- [Codice civile](civile/cc.md) — 3 unità, vigente al 2026-09-19" in text

    def test_write_outputs_builds_the_tree(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            store.upsert_act(act(), unit_count=3, updated_at="t")
            run = store.start_run({}, RENDERED_AT)
            for u in units():
                store.upsert_unit(u, run)
            written = write_outputs(store, tmp_path / "out", None, RENDERED_AT)
        assert (tmp_path / "out" / "civile" / "cc.md").exists()
        assert (tmp_path / "out" / "INDICE.md").exists()
        assert [p.name for p in written] == ["cc.md", "INDICE.md"]

    def test_write_outputs_can_limit_to_changed_acts_but_always_refreshes_the_index(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            store.upsert_act(act(), unit_count=0, updated_at="t")
            written = write_outputs(store, tmp_path / "out", [], RENDERED_AT)
        assert [p.name for p in written] == ["INDICE.md"]
```

`tests/archivio/golden/cc.md` — exactly this content (a trailing newline, no trailing spaces):

~~~markdown
---
id: cc
label: "Codice civile"
identifier: "urn:nir:stato:regio.decreto:1942-03-16;262"
source: normattiva
text_status: consolidated
vigenza_al: "2026-09-19"
units: 3
articles: 2
recitals: 1
rendered_at: "2026-09-19T21:00:00"
---

# Codice civile

## Indice

- **LIBRO QUARTO Delle obbligazioni**
  - **TITOLO IX Dei fatti illeciti**
    - [Art. 2043 — Risarcimento per fatto illecito](#art-2043)
  - **TITOLO X Nuovo titolo**
    - [Art. 2043 bis](#art-2043-bis)

### Considerando

[1](#considerando-1)

## Note sull'atto

### Base giuridica UE (EUR-Lex)

*get_eu_basis — interrogato il 2026-09-19*

_Errore: non raggiungibile_


<a id="art-2043"></a>

## Art. 2043 — Risarcimento per fatto illecito

`urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043` · [fonte](https://www.normattiva.it/art2043) · vigente al 2026-09-19 · ultimo aggiornamento 1942-04-21

Qualunque fatto doloso o colposo che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.

### Annotazioni (Brocardi)

*visualex.show_brocardi_info — interrogato il 2026-09-19*

**Ratio**

La ratio &lt;b>x&lt;/b>.

**Massime**

- Cass. 1/2024

**Glossario**

- Danno (https://brocardi.it/d)

Fonte: https://brocardi.it/2043

### Cassazione (Italgiure)

*giurisprudenza_su_norma — interrogato il 2026-09-19*

##### Sentenze
- Cass. &lt;script>x&lt;/script> 5/2025


<a id="art-2043-bis"></a>

## Art. 2043 bis

`urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043bis` · [fonte](https://www.normattiva.it/art2043-bis) · vigente al 2026-09-19 · **abrogato**

(abrogato)

### Cassazione (Italgiure)

*giurisprudenza_su_norma — interrogato il 2026-09-19*

_Nessun risultato._


<a id="considerando-1"></a>

## Considerando 1

`X#rct_1` · vigente al 2026-09-19

Considerando uno.
~~~

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_render_md.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.render_md'`.

- [ ] **Step 3: Implement**

`archivio_normativo/render_md.py`:

```python
"""One Markdown file per act, rendered from the store — deterministic.

The file is for reading: a front matter with the act's identity, an index
grouped by the act's own divisions, then one section per article with its
text verbatim and, below it, whatever enrichment the archive holds, each
block headed by its source and the day it was asked. Third-party markdown
is escaped (`<` → `&lt;`) so nothing a source emits can act in a viewer;
the article text is plain text from VisuaLex and is written as it is.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .hierarchy import LEVELS
from .store import ActRecord, Store, UnitRecord

KIND_TITLES: dict[str, str] = {
    "brocardi": "Annotazioni (Brocardi)",
    "cassazione": "Cassazione (Italgiure)",
    "cassazione_massime": "Cassazione dalle massime (Brocardi → Italgiure)",
    "amministrativa": "Giurisprudenza amministrativa (TAR / Consiglio di Stato)",
    "tributaria": "Giurisprudenza tributaria (CeRDEF)",
    "cgue": "Corte di giustizia UE",
    "costituzionale": "Corte costituzionale",
    "garante": "Garante privacy",
    "attuazione": "Attuazione nazionale (EUR-Lex)",
    "base_ue": "Base giuridica UE (EUR-Lex)",
}
_BROCARDI_ORDER = ("Brocardi", "Ratio", "Spiegazione", "Massime", "Relazioni", "RelazioneCostituzione",
                   "Footnotes", "RelatedArticles", "CrossReferences", "Glossario")


def anchor_for(kind: str, number: str) -> str:
    return f"{'art' if kind == 'article' else 'considerando'}-{number}"


def heading_for(unit: UnitRecord) -> str:
    if unit.kind == "recital":
        return f"Considerando {unit.number}"
    label = f"Art. {unit.number.replace('-', ' ')}"
    return f"{label} — {unit.rubrica}" if unit.rubrica else label


def escape_md(text: str) -> str:
    return (text or "").replace("<", "&lt;")


def demote_headings(text: str) -> str:
    """Push a source's own headings below the article's H2 (## → #####)."""
    out = []
    for line in (text or "").splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            hashes = len(stripped) - len(stripped.lstrip("#"))
            if 0 < hashes <= 6 and stripped[hashes:hashes + 1] in (" ", ""):
                line = "#" * min(6, hashes + 3) + stripped[hashes:]
        out.append(line)
    return "\n".join(out)


def _yaml_str(value) -> str:
    return json.dumps("" if value is None else str(value), ensure_ascii=False)


def _front_matter(act: ActRecord, units: list[UnitRecord], rendered_at: str) -> str:
    articles = [u for u in units if u.kind == "article"]
    recitals = [u for u in units if u.kind == "recital"]
    vigenza = max((u.vigenza_al for u in units), default="")
    lines = [
        "---",
        f"id: {act.id}",
        f"label: {_yaml_str(act.label)}",
        f"identifier: {_yaml_str(act.identifier)}",
        f"source: {act.source}",
        f"text_status: {act.text_status}",
    ]
    if act.consolidated_celex:
        lines.append(f"consolidated_celex: {act.consolidated_celex}")
    lines += [
        f"vigenza_al: {_yaml_str(vigenza)}",
        f"units: {len(units)}",
        f"articles: {len(articles)}",
        f"recitals: {len(recitals)}",
        f"rendered_at: {_yaml_str(rendered_at)}",
        "---",
    ]
    return "\n".join(lines)


def _index(units: list[UnitRecord]) -> list[str]:
    lines: list[str] = ["## Indice", ""]
    current: dict[str, str | None] = {level: None for level in LEVELS}
    for unit in units:
        if unit.kind != "article":
            continue
        depth = 0
        changed = False
        for level in LEVELS:
            value = getattr(unit, level)
            if value is None:
                continue
            if changed or value != current[level]:
                changed = True
                current[level] = value
                lines.append(f"{'  ' * depth}- **{value}**")
            depth += 1
        if changed:
            for level in LEVELS:
                if getattr(unit, level) is None:
                    current[level] = None
        lines.append(f"{'  ' * depth}- [{heading_for(unit)}](#{anchor_for(unit.kind, unit.number)})")
    recitals = [u for u in units if u.kind == "recital"]
    if recitals:
        lines += ["", "### Considerando", ""]
        lines.append(", ".join(f"[{u.number}](#{anchor_for(u.kind, u.number)})" for u in recitals))
    return lines


def _render_json_value(value, depth: int = 0) -> list[str]:
    pad = "  " * depth
    if isinstance(value, dict):
        out = []
        for key, inner in value.items():
            if inner in (None, "", [], {}):
                continue
            if isinstance(inner, (dict, list)):
                out.append(f"{pad}- **{escape_md(str(key))}**")
                out += _render_json_value(inner, depth + 1)
            else:
                out.append(f"{pad}- **{escape_md(str(key))}**: {escape_md(str(inner))}")
        return out
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, dict) and "termine" in item:
                url = item.get("url")
                out.append(f"{pad}- {escape_md(str(item['termine']))}" + (f" ({url})" if url else ""))
            elif isinstance(item, (dict, list)):
                out += _render_json_value(item, depth)
            else:
                out.append(f"{pad}- {escape_md(str(item))}")
        return out
    return [f"{pad}{escape_md(str(value))}"]


def _render_brocardi(payload: dict) -> list[str]:
    lines: list[str] = []
    keys = [k for k in _BROCARDI_ORDER if k in payload] + [k for k in payload if k not in _BROCARDI_ORDER]
    for key in keys:
        value = payload.get(key)
        if value in (None, "", [], {}) or key in ("position", "link"):
            continue
        lines.append(f"**{key}**")
        lines.append("")
        if isinstance(value, str):
            lines.append(escape_md(value))
        else:
            lines += _render_json_value(value)
        lines.append("")
    if payload.get("link"):
        lines.append(f"Fonte: {payload['link']}")
        lines.append("")
    return lines


def _render_enrichment(row: dict) -> list[str]:
    title = KIND_TITLES.get(row["kind"], row["kind"])
    day = (row.get("fetched_at") or "")[:10]
    lines = [f"### {title}", "", f"*{row['tool']} — interrogato il {day}*", ""]
    if row["status"] == "empty":
        lines += ["_Nessun risultato._", ""]
    elif row["status"] == "error":
        lines += [f"_Errore: {escape_md(row.get('error') or 'sconosciuto')}_", ""]
    elif row.get("content_json") is not None:
        lines += _render_brocardi(row["content_json"])
    else:
        lines += [demote_headings(escape_md(row.get("content_md") or "")), ""]
    return lines


def _meta_line(unit: UnitRecord) -> str:
    parts = []
    if unit.identifier:
        parts.append(f"`{unit.identifier}`")
    if unit.source_url:
        parts.append(f"[fonte]({unit.source_url})")
    parts.append(f"vigente al {unit.vigenza_al}")
    if unit.ultimo_aggiornamento:
        parts.append(f"ultimo aggiornamento {unit.ultimo_aggiornamento}")
    if unit.abrogato:
        parts.append("**abrogato**")
    return " · ".join(parts)


def render_act(act: ActRecord, units: list[UnitRecord], enrichments: list[dict], rendered_at: str) -> str:
    by_unit: dict[str, list[dict]] = {}
    for row in enrichments:
        by_unit.setdefault(row["unit_id"], []).append(row)
    lines: list[str] = [_front_matter(act, units, rendered_at), "", f"# {act.label}", ""]
    if act.text_status == "oj":
        lines += ["> Testo della Gazzetta ufficiale (versione pubblicata), non consolidato.", ""]
    lines += _index(units)
    act_level = by_unit.get("", [])
    if act_level:
        lines += ["", "## Note sull'atto", ""]
        for row in sorted(act_level, key=lambda r: r["kind"]):
            lines += _render_enrichment(row)
    for unit in units:
        lines += ["", f'<a id="{anchor_for(unit.kind, unit.number)}"></a>', "",
                  f"## {heading_for(unit)}", "", _meta_line(unit), "", unit.text, ""]
        for row in sorted(by_unit.get(unit.id, []), key=lambda r: r["kind"]):
            lines += _render_enrichment(row)
    return "\n".join(lines).rstrip("\n") + "\n"


def render_index(acts: list[ActRecord], unit_counts: dict[str, int], vigenza: dict[str, str],
                 last_run: dict | None, rendered_at: str) -> str:
    lines = ["# Archivio normativo", ""]
    if last_run:
        lines.append(f"Ultimo run: {last_run.get('started_at', '')} ({last_run.get('status', '')})")
    lines.append(f"Generato: {rendered_at}")
    lines.append("")
    by_area: dict[str, list[ActRecord]] = {}
    for act in acts:
        by_area.setdefault(act.area, []).append(act)
    for area in sorted(by_area):
        lines += [f"## {area}", ""]
        for act in sorted(by_area[area], key=lambda a: a.id):
            status = "" if act.text_status == "consolidated" else " · testo GU non consolidato"
            lines.append(f"- [{act.label}]({area}/{act.id}.md) — {unit_counts.get(act.id, 0)} unità, "
                         f"vigente al {vigenza.get(act.id, '')}{status}")
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def act_path(out_dir: Path, act: ActRecord) -> Path:
    return Path(out_dir) / act.area / f"{act.id}.md"


def write_outputs(store: Store, out_dir: Path, act_ids: Iterable[str] | None, rendered_at: str) -> list[Path]:
    """Render the given acts (all when None) and always the root index."""
    out_dir = Path(out_dir)
    acts = store.acts()
    wanted = set(act_ids) if act_ids is not None else None
    written: list[Path] = []
    counts: dict[str, int] = {}
    vigenza: dict[str, str] = {}
    for act in acts:
        units = store.units_for_act(act.id)
        counts[act.id] = len(units)
        vigenza[act.id] = max((u.vigenza_al for u in units), default="")
        if wanted is not None and act.id not in wanted:
            continue
        path = act_path(out_dir, act)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_act(act, units, store.enrichments_for_act(act.id), rendered_at), encoding="utf-8")
        written.append(path)
    index = out_dir / "INDICE.md"
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(render_index(acts, counts, vigenza, store.latest_run(), rendered_at), encoding="utf-8")
    written.append(index)
    return written
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_render_md.py -q`
Expected: 8 passed. If the golden comparison fails, diff the two texts (`print(rendered)`) — the golden above was produced by this exact code; a difference means a transcription slip in one of the two.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/render_md.py tests/archivio/test_render_md.py tests/archivio/golden/cc.md
git commit -m "feat(archivio): deterministic Markdown per act and root index

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `verify.py` and `report.py`

**Files:**
- Create: `archivio_normativo/verify.py`, `archivio_normativo/report.py`
- Test: `tests/archivio/test_verify_report.py`

**Interfaces:**
- Consumes: `Store`, `UnitRecord` (Task 4); `ActReport` (Task 7).
- Produces: `Finding(act_id, kind, detail, unit_ids)` with `kind` in `gap | empty | short | identical`; `verify_act(act_id, units) -> list[Finding]`; `verify_store(store, act_ids=None) -> list[Finding]`; `format_findings(findings) -> str`; `format_report(reports, findings, *, duration_s, base_url, run_id, dry_run) -> str`.

Duplicate numbers cannot exist in the store (the unit id embeds the number), so the check the spec calls "duplicati" lives where duplicates can appear — the tree: Task 11 makes the pipeline log a warning when `walk_tree` yields the same number twice for an act. `verify` covers the store: gaps, empty, short, identical texts.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_verify_report.py`:

```python
"""Integrity findings and the terminal summary."""
from archivio_normativo.pipeline import ActReport
from archivio_normativo.report import format_report
from archivio_normativo.store import ActRecord, Store, UnitRecord
from archivio_normativo.verify import Finding, format_findings, verify_act, verify_store


def unit(number, text, *, kind="article", abrogato=False, position=0):
    return UnitRecord(id=f"a:{'art' if kind == 'article' else 'rec'}:{number}", act_id="a", kind=kind,
                      number=number, position=position, identifier=None, rubrica=None, parte=None,
                      libro=None, titolo=None, capo=None, sezione=None, text=text, fingerprint=None,
                      abrogato=abrogato, version="vigente", vigenza_al="d", ultimo_aggiornamento=None,
                      source_url=None, fetched_at="t")


LONG = "Testo di un articolo abbastanza lungo da non essere sospetto, davvero."


class TestVerifyAct:
    def test_clean_act_has_no_findings(self):
        assert verify_act("a", [unit("1", LONG), unit("2", LONG + " Bis."), unit("2-bis", LONG + " Ter.")]) == []

    def test_gap_lists_the_missing_numbers(self):
        findings = verify_act("a", [unit("1", LONG), unit("4", LONG + "x"), unit("5", LONG + "y")])
        assert [f.kind for f in findings] == ["gap"]
        assert "2, 3" in findings[0].detail

    def test_empty_and_short_texts(self):
        findings = verify_act("a", [unit("1", ""), unit("2", "Breve."), unit("3", "(abrogato)"),
                                    unit("4", "Breve ma abrogato", abrogato=True)])
        kinds = {(f.kind, f.unit_ids[0]) for f in findings}
        assert ("empty", "a:art:1") in kinds
        assert ("short", "a:art:2") in kinds
        assert not any(f.unit_ids == ("a:art:3",) for f in findings), "a repeal notice is legitimately short"
        assert not any(f.unit_ids == ("a:art:4",) for f in findings)

    def test_identical_texts_are_flagged(self):
        findings = verify_act("a", [unit("1", LONG), unit("2", LONG), unit("3", LONG + "!")])
        identical = [f for f in findings if f.kind == "identical"]
        assert len(identical) == 1
        assert identical[0].unit_ids == ("a:art:1", "a:art:2")
        assert "2 articoli con testo identico: 1, 2" in identical[0].detail

    def test_recitals_are_not_part_of_the_numeric_sequence(self):
        findings = verify_act("a", [unit("1", LONG), unit("2", LONG + "x"), unit("9", LONG + "z", kind="recital")])
        assert findings == []


class TestVerifyStore:
    def test_walks_every_act(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            for act_id in ("a", "b"):
                store.upsert_act(ActRecord(id=act_id, area="civile", label=act_id, source="normattiva", identifier="x",
                                           act_type="legge", date=None, act_number=None, annex=None, source_url="x",
                                           text_status="consolidated", consolidated_celex=None), 0, "t")
            run = store.start_run({}, "t")
            store.upsert_unit(unit("1", LONG), run)
            u = unit("1", "")
            u.id, u.act_id = "b:art:1", "b"
            store.upsert_unit(u, run)
            findings = verify_store(store)
            assert [(f.act_id, f.kind) for f in findings] == [("b", "empty")]
            assert verify_store(store, act_ids={"a"}) == []

    def test_format(self):
        assert format_findings([]) == "Verifica: nessuna anomalia."
        text = format_findings([Finding("cc", "gap", "3 numeri assenti", ())])
        assert "[gap] cc: 3 numeri assenti" in text


class TestReport:
    def test_run_report_has_table_totals_failures_and_findings(self):
        ok = ActReport("cc", "Codice civile", total=3, new=1, updated=1, unchanged=1, enrich_ok=2, enrich_kept=1)
        bad = ActReport("cpp", "c.p.p.", total=2, failed=1, failures=[("cpp:art:415-bis", "404 non presente")],
                        fingerprints_available=False)
        gone = ActReport("x", "X", resolved=False, reason="HTTP 404: Articolo 1 non presente")
        text = format_report([ok, bad, gone], [Finding("cc", "gap", "2 numeri assenti: 5, 6", ())],
                             duration_s=12.4, base_url="http://localhost:5000", run_id=7, dry_run=False)
        assert "Run 7" in text and "http://localhost:5000" in text
        assert "cc " in text and "2/0/0/1" in text
        assert "senza impronte (fetch completo)" in text
        assert "NON RISOLTO" in text and "HTTP 404" in text
        assert "cpp:art:415-bis: 404 non presente" in text
        assert "Totali: atti 3, risolti 2, unità 5, nuovi 1, aggiornati 1, invariati 1, falliti 1, saltati 0" in text
        assert "[gap] cc: 2 numeri assenti: 5, 6" in text

    def test_dry_run_report_speaks_of_plans(self):
        r = ActReport("cc", "Codice civile", total=3, planned_new=2, planned_changed=1, enrich_planned=6)
        text = format_report([r], [], duration_s=1, base_url="u", run_id=None, dry_run=True)
        assert "PROVA (dry-run)" in text
        assert "6 previste" in text
        assert "da scaricare 3" in text and "chiamate arricchimento previste 6" in text
        assert "Verifica" not in text
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_verify_report.py -q`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`archivio_normativo/verify.py`:

```python
"""Integrity checks over the store, so a bad download shows itself.

Per act: gaps in the numeric sequence (a signal, not an error — real acts
have holes), empty texts, texts too short to be an article unless the act
says the article is repealed, and two units with identical text — the
signature of "nonexistent article → Normattiva answered with art. 1"
(CLAUDE.md gotcha 24), which VisuaLex intercepts today and which costs
nothing to keep watching.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from .store import Store, UnitRecord

SHORT_TEXT_CHARS = 40
_ABROGATO = re.compile(r"^\(?\s*(?:articolo\s+)?(?:abrogat|soppress)", re.IGNORECASE)
_NUMERIC_HEAD = re.compile(r"^(\d+)")


@dataclass(frozen=True)
class Finding:
    act_id: str
    kind: str  # gap | empty | short | identical
    detail: str
    unit_ids: tuple[str, ...]


def _looks_repealed(unit: UnitRecord) -> bool:
    return unit.abrogato or bool(_ABROGATO.match((unit.text or "").strip()))


def verify_act(act_id: str, units: list[UnitRecord]) -> list[Finding]:
    findings: list[Finding] = []
    articles = [u for u in units if u.kind == "article"]

    heads = []
    for u in articles:
        match = _NUMERIC_HEAD.match(u.number)
        if match:
            heads.append(int(match.group(1)))
    if heads:
        present = set(heads)
        missing = [n for n in range(min(heads), max(heads) + 1) if n not in present]
        if missing:
            shown = ", ".join(str(n) for n in missing[:20]) + (" …" if len(missing) > 20 else "")
            findings.append(Finding(act_id, "gap", f"{len(missing)} numeri assenti fra {min(heads)} e {max(heads)}: {shown}", ()))

    for u in units:
        text = (u.text or "").strip()
        if not text:
            findings.append(Finding(act_id, "empty", f"{u.number}: testo vuoto", (u.id,)))
        elif len(text) < SHORT_TEXT_CHARS and not _looks_repealed(u):
            findings.append(Finding(act_id, "short", f"{u.number}: {len(text)} caratteri: {text!r}", (u.id,)))

    by_hash: dict[str, list[UnitRecord]] = defaultdict(list)
    for u in articles:
        if (u.text or "").strip() and not _looks_repealed(u):
            by_hash[u.text_hash].append(u)
    for group in by_hash.values():
        if len(group) > 1:
            numbers = ", ".join(u.number for u in group[:10]) + (" …" if len(group) > 10 else "")
            findings.append(Finding(act_id, "identical",
                                    f"{len(group)} articoli con testo identico: {numbers}",
                                    tuple(u.id for u in group)))
    return findings


def verify_store(store: Store, act_ids=None) -> list[Finding]:
    findings: list[Finding] = []
    for act in store.acts():
        if act_ids is not None and act.id not in act_ids:
            continue
        findings += verify_act(act.id, store.units_for_act(act.id))
    return findings


def format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "Verifica: nessuna anomalia."
    lines = [f"Verifica: {len(findings)} segnalazioni"]
    for f in findings:
        lines.append(f"  [{f.kind}] {f.act_id}: {f.detail}")
    return "\n".join(lines)
```

`archivio_normativo/report.py`:

```python
"""The end-of-run summary printed to the terminal."""
from __future__ import annotations

from .pipeline import ActReport
from .verify import Finding, format_findings

_COLUMNS = ("atto", "unità", "nuovi", "aggiorn.", "invariati", "falliti", "saltati", "arricch. ok/vuoti/err/tenuti", "note")


def _notes(r: ActReport) -> str:
    notes = []
    if not r.resolved:
        notes.append("NON RISOLTO")
    if r.fingerprints_available is False:
        notes.append("senza impronte (fetch completo)")
    if r.text_status == "oj":
        notes.append("testo GU non consolidato")
    if r.recitals:
        notes.append(f"{r.recitals} considerando")
    return "; ".join(notes)


def _row(r: ActReport, dry_run: bool) -> tuple[str, ...]:
    if dry_run:
        return (r.act_id, str(r.total), str(r.planned_new), str(r.planned_changed), str(r.unchanged), "-", "-",
                f"{r.enrich_planned} previste", _notes(r))
    return (r.act_id, str(r.total), str(r.new), str(r.updated), str(r.unchanged), str(r.failed), str(r.skipped),
            f"{r.enrich_ok}/{r.enrich_empty}/{r.enrich_error}/{r.enrich_kept}", _notes(r))


def _table(rows: list[tuple[str, ...]]) -> list[str]:
    widths = [max(len(str(row[i])) for row in [_COLUMNS] + rows) for i in range(len(_COLUMNS))]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    lines = [fmt.format(*_COLUMNS), fmt.format(*["-" * w for w in widths])]
    lines += [fmt.format(*row) for row in rows]
    return lines


def format_report(reports: list[ActReport], findings: list[Finding], *, duration_s: float, base_url: str,
                  run_id: int | None, dry_run: bool) -> str:
    title = "PROVA (dry-run): cosa farebbe" if dry_run else f"Run {run_id}"
    lines = [f"=== Archivio normativo — {title} — VisuaLex {base_url} — {duration_s:.0f} s ===", ""]
    lines += _table([_row(r, dry_run) for r in reports])
    totals = {
        "atti": len(reports), "risolti": sum(1 for r in reports if r.resolved),
        "unità": sum(r.total for r in reports), "nuovi": sum(r.new for r in reports),
        "aggiornati": sum(r.updated for r in reports), "invariati": sum(r.unchanged for r in reports),
        "falliti": sum(r.failed for r in reports), "saltati": sum(r.skipped for r in reports),
    }
    if dry_run:
        totals["da scaricare"] = sum(r.planned_new + r.planned_changed for r in reports)
        totals["chiamate arricchimento previste"] = sum(r.enrich_planned for r in reports)
    lines += ["", "Totali: " + ", ".join(f"{k} {v}" for k, v in totals.items())]
    unresolved = [r for r in reports if not r.resolved]
    if unresolved:
        lines += ["", "Atti non risolti:"]
        lines += [f"  - {r.act_id}: {r.reason}" for r in unresolved]
    failures = [(r.act_id, uid, reason) for r in reports for uid, reason in r.failures]
    if failures:
        lines += ["", f"Fallimenti ({len(failures)}):"]
        lines += [f"  - {uid}: {reason}" for _, uid, reason in failures[:200]]
        if len(failures) > 200:
            lines.append(f"  … e altri {len(failures) - 200}")
    if not dry_run:
        lines += ["", format_findings(findings)]
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/archivio/test_verify_report.py -q`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add archivio_normativo/verify.py archivio_normativo/report.py tests/archivio/test_verify_report.py
git commit -m "feat(archivio): integrity checks and the end-of-run report

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: `cli.py`, `__main__.py`, docs — the command

**Files:**
- Create: `archivio_normativo/cli.py`, `archivio_normativo/__main__.py`, `archivio_normativo/README.md`
- Modify: `archivio_normativo/pipeline.py` (duplicate numbers in the index → warning + `ActReport.duplicates`), `archivio_normativo/report.py` (note for duplicates), `archivio_normativo/store.py` (`reopen_run`), `CLAUDE.md`
- Test: `tests/archivio/test_cli.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `async_main(argv) -> int` (what tests call), `main(argv) -> int` (what `__main__` calls; wraps `asyncio.run`), `build_parser()`. Subcommands `build | verify | render | report | export`. `Store.reopen_run(run_id)`. `ActReport.duplicates: list[str]`.

- [ ] **Step 1: Write the failing tests**

`tests/archivio/test_cli.py`:

```python
"""The command line, end to end against the fake VisuaLex.

`--rate 0` disables pacing: without it every call waits its second."""
import yaml

from archivio_normativo.cli import async_main
from tests.archivio.fake_visualex import FakeVisuaLex

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"


def write_manifest(tmp_path, base_url, acts=None):
    data = {
        "version": 1,
        "providers": {"visualex": {"base_url": base_url}},
        "acts": acts or [{
            "id": "cc", "area": "civile", "label": "Codice civile", "source": "normattiva",
            "act_type": "codice civile", "cite": "c.c.",
        }],
    }
    path = tmp_path / "manifest.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def add_cc(fake: FakeVisuaLex):
    fake.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["LIBRO QUARTO Delle obbligazioni", {"numero": "2043", "allegato": "2"}, {"numero": "2044", "allegato": "2"}],
        rubriche={"2043": "Risarcimento per fatto illecito"},
        fingerprints={"2043": {"fingerprint": "a" * 64, "date": None}, "2044": {"fingerprint": "b" * 64, "date": None}},
        articles={"2043": "Qualunque fatto doloso o colposo che cagiona ad altri un danno ingiusto…",
                  "2044": "Non è responsabile chi ha commesso il fatto per esservi stato costretto…"},
    )


async def test_dry_run_prints_the_plan_and_writes_nothing(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--dry-run", "--rate", "0"])
    assert code == 0
    assert "PROVA (dry-run)" in capsys.readouterr().out
    assert not out.exists()


async def test_build_then_rebuild(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    assert code == 0
    text = capsys.readouterr().out
    assert "Run 1" in text and "nuovi 2" in text and "Verifica: nessuna anomalia." in text
    assert (out / "archivio.sqlite").exists()
    assert (out / "civile" / "cc.md").exists() and (out / "INDICE.md").exists()
    assert list((out / "logs").glob("build-*.log"))
    md = (out / "civile" / "cc.md").read_text(encoding="utf-8")
    assert "## Art. 2043 — Risarcimento per fatto illecito" in md

    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    assert code == 0
    assert "invariati 2" in capsys.readouterr().out


async def test_verify_report_and_export(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    capsys.readouterr()
    assert await async_main(["verify", "--manifest", str(manifest), "--out", str(out)]) == 0
    assert "Verifica" in capsys.readouterr().out
    assert await async_main(["report", "--manifest", str(manifest), "--out", str(out)]) == 0
    assert "run 1: done" in capsys.readouterr().out
    target = tmp_path / "units.jsonl"
    assert await async_main(["export", "--manifest", str(manifest), "--out", str(out), "--jsonl", str(target)]) == 0
    lines = target.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2 and '"id": "cc:art:2043"' in lines[0]
    assert await async_main(["render", "--manifest", str(manifest), "--out", str(out)]) == 0


async def test_failures_make_the_exit_code_one(fake_visualex, tmp_path, capsys):
    fake_visualex.add_act(act_type="codice civile", url=CC_URL, annex="2",
                          tree=[{"numero": "2043", "allegato": "2"}], fingerprints=None,
                          articles={"2043": {"error": "ParsingError"}})
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(tmp_path / "out"), "--rate", "0"])
    assert code == 1
    assert "ParsingError" in capsys.readouterr().out


async def test_bad_kind_and_missing_resume_are_usage_errors(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    assert await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0", "--enrich", "oracolo"]) == 2
    assert "oracolo" in capsys.readouterr().err
    assert await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0", "--resume"]) == 2


async def test_commands_without_an_archive_say_so(fake_visualex, tmp_path, capsys):
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    assert await async_main(["verify", "--manifest", str(manifest), "--out", str(tmp_path / "nowhere")]) == 2
    assert "run `build` first" in capsys.readouterr().err
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/archivio/test_cli.py -q`
Expected: `ModuleNotFoundError: No module named 'archivio_normativo.cli'`.

- [ ] **Step 3: The three small changes to existing modules**

`archivio_normativo/store.py` — add above `latest_interrupted_run`:

```python
    def reopen_run(self, run_id: int) -> None:
        """`--resume`: the interrupted run continues under its own id."""
        self._db.execute("UPDATE runs SET status = 'running', finished_at = NULL WHERE id = ?", (run_id,))
```

`archivio_normativo/pipeline.py` — `from collections import Counter` next to the other imports; in `ActReport`, after `failures`:

```python
    duplicates: list[str] = field(default_factory=list)
```

and in `process_act`, right before `rubriche = await self.visualex.fetch_rubriche(res.act_url)`:

```python
        duplicates = sorted(n for n, c in Counter(a.number for a in indexed).items() if c > 1)
        if duplicates:
            # The store keys units by number, so the later listing wins; say so.
            report.duplicates = duplicates
            self.log.warning("ACT %s: the index lists %s more than once", spec.id, ", ".join(duplicates))
```

`archivio_normativo/report.py` — in `_notes`, before `return`:

```python
    if r.duplicates:
        notes.append("numeri duplicati nell'indice: " + ", ".join(r.duplicates[:5]))
```

- [ ] **Step 4: The command**

`archivio_normativo/__main__.py`:

```python
from .cli import main

raise SystemExit(main())
```

`archivio_normativo/cli.py`:

```python
"""`python -m archivio_normativo` — build, verify, render, report, export.

`build` is the run: manifest → acts → pipeline → Markdown of what changed →
integrity check → report. Everything else reads the store. Exit codes: 0
clean, 1 when an act did not resolve or a unit failed (so a cron job can
tell), 2 for a usage or manifest error, 130 on Ctrl-C after the partial
report.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import aiohttp

from . import __version__
from .enrich import Enricher
from .manifest import KINDS, Manifest, ManifestError, expand_kinds, load_manifest
from .pipeline import Pipeline, RunOptions, stamp
from .render_md import write_outputs
from .report import format_report
from .sources.legalit import LegalItClient, LegalItError
from .sources.visualex import VisuaLexClient
from .store import Store
from .throttle import Throttle
from .verify import format_findings, verify_store

DEFAULT_MANIFEST = Path(__file__).with_name("manifest.yaml")
DEFAULT_OUT = Path("archivio_out")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="archivio_normativo",
                                     description="Local legal archive built on the VisuaLex API.")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
        p.add_argument("--out", type=Path, default=DEFAULT_OUT)
        p.add_argument("--only", help="comma-separated act ids")
        p.add_argument("--area", help="one of the manifest areas")
        p.add_argument("--log-level", default="INFO")

    build = sub.add_parser("build", help="fetch what changed and update the archive")
    common(build)
    build.add_argument("--enrich", help="comma-separated kinds; replaces the manifest's for this run")
    build.add_argument("--refresh-enrich", action="store_true")
    build.add_argument("--full", action="store_true", help="ignore fingerprints, refetch everything")
    build.add_argument("--resume", nargs="?", const=-1, type=int, metavar="RUN_ID",
                       help="continue an interrupted run (the latest when no id is given)")
    build.add_argument("--dry-run", action="store_true")
    build.add_argument("--rate", type=float, help="articles per second towards VisuaLex")
    build.add_argument("--enrich-rate", type=float, help="calls per second towards legal-it")
    build.add_argument("--batch-size", type=int)
    build.add_argument("--visualex-url", help="override providers.visualex.base_url")

    common(sub.add_parser("verify", help="integrity checks over the store"))
    common(sub.add_parser("render", help="rewrite the Markdown from the store, no network"))
    common(sub.add_parser("report", help="summary of the last run"))
    export = sub.add_parser("export", help="one JSON object per unit")
    common(export)
    export.add_argument("--jsonl", type=Path, required=True)
    return parser


def _setup_logging(level: str, out_dir: Path | None) -> logging.Logger:
    log = logging.getLogger("archivio")
    log.setLevel(getattr(logging, level.upper(), logging.INFO))
    log.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(fmt)
    log.addHandler(stream)
    if out_dir is not None:
        logs = out_dir / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(logs / f"build-{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.log", encoding="utf-8")
        handler.setFormatter(fmt)
        log.addHandler(handler)
    return log


def _select(manifest: Manifest, args) -> tuple:
    only = args.only.split(",") if args.only else None
    return manifest.select(only, args.area)


def _needs_legalit(specs, override) -> bool:
    for spec in specs:
        kinds = override if override is not None else spec.enrich
        if any(k != "brocardi" for k in kinds):
            return True
    return False


async def run_build(args, manifest: Manifest) -> int:
    started = time.monotonic()
    specs = _select(manifest, args)
    override = tuple(expand_kinds(args.enrich.split(","))) if args.enrich else None
    base_url = args.visualex_url or manifest.providers.visualex_base_url
    out_dir: Path = args.out
    log = _setup_logging(args.log_level, None if args.dry_run else out_dir)
    log.info("archivio_normativo %s — %d acts — VisuaLex %s%s", __version__, len(specs), base_url,
             " — DRY RUN" if args.dry_run else "")

    store: Store | None = None
    run_id: int | None = None
    db_path = out_dir / "archivio.sqlite"
    if args.dry_run:
        store = Store(db_path) if db_path.exists() else None
    else:
        store = Store(db_path)
        interrupted = store.mark_running_as_interrupted()
        for rid in interrupted:
            log.warning("run %d was left running (killed?) — marked interrupted; `--resume %d` continues it", rid, rid)
        if args.resume is not None:
            run_id = args.resume if args.resume > 0 else store.latest_interrupted_run()
            if run_id is None or store.get_run(run_id) is None:
                log.error("no interrupted run to resume")
                return 2
            store.reopen_run(run_id)
            log.info("resuming run %d", run_id)
        else:
            run_id = store.start_run({k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items()},
                                     stamp(datetime.now))

    options = RunOptions(
        out_dir=out_dir, dry_run=args.dry_run, full=args.full, resume_run_id=run_id if args.resume is not None else None,
        enrich_override=override, refresh_enrich=args.refresh_enrich,
        batch_size=args.batch_size or manifest.defaults.batch_size, enrich_ttl_days=manifest.defaults.enrich_ttl_days,
    )
    throttle = Throttle(args.rate if args.rate is not None else manifest.defaults.rate_per_second)
    enrich_throttle = Throttle(args.enrich_rate if args.enrich_rate is not None else manifest.defaults.enrich_rate_per_second)

    def on_retry(attempt, delay, error):
        log.warning("retry %d in %.1fs: %s", attempt, delay, error)

    reports = []
    status = "done"
    try:
        async with aiohttp.ClientSession() as session:
            visualex = VisuaLexClient(base_url, session, throttle, on_retry=on_retry)
            if not args.dry_run and _needs_legalit(specs, override):
                async with LegalItClient(manifest.providers.legalit_command, enrich_throttle, on_retry=on_retry) as legalit:
                    enricher = Enricher(store=store, legalit=legalit, options=options, run_id=run_id,
                                        log=log, now=datetime.now)
                    pipeline = Pipeline(store=store, visualex=visualex, options=options, run_id=run_id,
                                        log=log, now=datetime.now, enricher=enricher)
                    reports = await pipeline.run(specs)
            else:
                enricher = None
                if args.dry_run and _needs_legalit(specs, override) and store is not None:
                    enricher = Enricher(store=store, legalit=None, options=options, run_id=0, log=log, now=datetime.now)
                pipeline = Pipeline(store=store, visualex=visualex, options=options, run_id=run_id,
                                    log=log, now=datetime.now, enricher=enricher)
                reports = await pipeline.run(specs)
    except LegalItError as exc:
        log.error("legal-it: %s", exc)
        if store is not None and run_id is not None:
            store.finish_run(run_id, "interrupted", stamp(datetime.now), {"error": str(exc)})
        return 2
    except (KeyboardInterrupt, asyncio.CancelledError):
        status = "interrupted"
        log.warning("interrupted — the archive holds everything committed so far; `--resume` continues")

    findings = []
    if store is not None and not args.dry_run and run_id is not None:
        changed = [r.act_id for r in reports if r.changed]
        if changed:
            written = write_outputs(store, out_dir, changed, stamp(datetime.now))
            log.info("rendered %d files", len(written))
        else:
            write_outputs(store, out_dir, [], stamp(datetime.now))
        findings = verify_store(store, act_ids={s.id for s in specs})
        stats = {
            "acts": len(reports), "unresolved": sum(1 for r in reports if not r.resolved),
            "new": sum(r.new for r in reports), "updated": sum(r.updated for r in reports),
            "unchanged": sum(r.unchanged for r in reports), "failed": sum(r.failed for r in reports),
            "skipped": sum(r.skipped for r in reports), "findings": len(findings),
        }
        store.finish_run(run_id, status, stamp(datetime.now), stats)
    print(format_report(reports, findings, duration_s=time.monotonic() - started, base_url=base_url,
                        run_id=run_id, dry_run=args.dry_run))
    if store is not None:
        store.close()
    if status == "interrupted":
        return 130
    if any(not r.resolved for r in reports) or any(r.failed for r in reports):
        return 1
    return 0


def _open_store(args) -> Store | None:
    path = args.out / "archivio.sqlite"
    if not path.exists():
        print(f"no archive at {path}; run `build` first", file=sys.stderr)
        return None
    return Store(path)


def run_verify(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        findings = verify_store(store, act_ids={s.id for s in _select(manifest, args)})
    print(format_findings(findings))
    return 0


def run_render(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        ids = [s.id for s in _select(manifest, args)] if (args.only or args.area) else None
        written = write_outputs(store, args.out, ids, stamp(datetime.now))
    print(f"rendered {len(written)} files under {args.out}")
    return 0


def run_report(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    with store:
        run = store.latest_run()
    if run is None:
        print("no run yet")
        return 0
    print(f"run {run['id']}: {run['status']} — started {run['started_at']} — finished {run['finished_at'] or '-'}")
    print(json.dumps(run["stats"] or {}, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def run_export(args, manifest: Manifest) -> int:
    store = _open_store(args)
    if store is None:
        return 2
    wanted = {s.id for s in _select(manifest, args)} if (args.only or args.area) else None
    count = 0
    with store, open(args.jsonl, "w", encoding="utf-8") as fh:
        for row in store.iter_units():
            if wanted is not None and row["act_id"] not in wanted:
                continue
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    print(f"exported {count} units to {args.jsonl}")
    return 0


async def async_main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        if getattr(args, "enrich", None):
            expand_kinds(args.enrich.split(","))
        if args.command == "build":
            return await run_build(args, manifest)
        if args.command == "verify":
            return run_verify(args, manifest)
        if args.command == "render":
            return run_render(args, manifest)
        if args.command == "report":
            return run_report(args, manifest)
        if args.command == "export":
            return run_export(args, manifest)
    except ManifestError as exc:
        print(f"manifest: {exc}", file=sys.stderr)
        return 2
    parser.error(f"unknown command {args.command}")
    return 2


def main(argv: list[str] | None = None) -> int:
    try:
        return asyncio.run(async_main(argv))
    except KeyboardInterrupt:
        return 130
```

- [ ] **Step 5: Run the tests, then the whole archive suite**

Run: `.venv/bin/python -m pytest tests/archivio/test_cli.py -q`
Expected: 6 passed, in well under 5 s (the tests pass `--rate 0`; a slow run means pacing leaked in).

Run: `.venv/bin/python -m pytest tests/archivio -q`
Expected: all passed (about 150 tests).

- [ ] **Step 6: Documentation**

`archivio_normativo/README.md`:

~~~markdown
# Archivio normativo

A local, updatable archive of the acts listed in `manifest.yaml`: one SQLite
record per article (or recital, for EU acts) and one Markdown file per act,
built on the VisuaLex API. Design and rationale:
`docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`.

## Prerequisites

- The VisuaLex Python API running locally (`source .venv/bin/activate && python app.py`,
  port 5000). The archive never starts it.
- For enrichment beyond Brocardi (case law, Consulta, Garante, EU↔IT): the
  `legal-it` MCP server, reachable through the command in
  `providers.legalit.command` (or `LEGALIT_MCP_COMMAND`, a JSON list), and
  `pip install -r requirements-archivio.txt` in the project venv.

## Commands

```bash
python -m archivio_normativo build --dry-run                 # what would happen, no writes
python -m archivio_normativo build                           # everything in the manifest
python -m archivio_normativo build --only cc,gdpr            # some acts
python -m archivio_normativo build --area privacy-digitale
python -m archivio_normativo build --only dlgs-231-2001 --enrich brocardi,giurisprudenza
python -m archivio_normativo build --full                    # ignore fingerprints (monthly)
python -m archivio_normativo build --resume                  # continue the interrupted run
python -m archivio_normativo verify                          # integrity checks over the store
python -m archivio_normativo render                          # rewrite the Markdown, no network
python -m archivio_normativo report                          # last run
python -m archivio_normativo export --jsonl units.jsonl
```

Output goes to `--out` (default `archivio_out/`, gitignored):
`archivio.sqlite`, `INDICE.md`, one `<area>/<id>.md` per act, `logs/`.

## How an update run stays cheap

For Normattiva acts, `/fetch_act_fingerprints` gives a hash per article from
one download of the act; only articles whose hash moved are fetched again.
EU acts are one page each and are re-read on every run. Run `--full` now and
then: fingerprints see content changes, not changes in Normattiva's HTML
rendering.

## Editing the manifest

Every act is an entry under `acts:`; unknown keys are errors. Codici need only
`act_type` (the names VisuaLex knows, see `visualex_api/tools/map.py`);
other acts carry `date` and `act_number`; EU acts carry `celex` and may name a
consolidated version with `celex_consolidated`. `cite` is how you would write
the act in a citation — it composes the references sent to legal-it. Run
`build --dry-run` after editing: an act that does not resolve is listed in
the report, never silently skipped.

## Exit codes

0 clean · 1 an act did not resolve or a unit failed · 2 usage or manifest
error · 130 interrupted (use `--resume`).
~~~

`CLAUDE.md` — add this section after "Development Commands":

~~~markdown

## Archivio normativo (`archivio_normativo/`)

A CLI that builds a local archive of the acts in `archivio_normativo/manifest.yaml`
through this API: `python -m archivio_normativo build [--dry-run] [--only …]
[--enrich …]`. One SQLite record per article/recital plus one Markdown per act,
in `archivio_out/` (gitignored). Update runs refetch only the articles whose AKN
fingerprint moved. Text and structure come from VisuaLex; case law and authority
practice from the `legal-it` MCP server (optional, `requirements-archivio.txt`).
Spec: `docs/superpowers/specs/2026-09-19-archivio-normativo-design.md`; how to
run: `archivio_normativo/README.md`. Tests: `tests/archivio/`.
~~~

- [ ] **Step 7: Full repo suite and commit**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: all green.

```bash
git add archivio_normativo/cli.py archivio_normativo/__main__.py archivio_normativo/README.md archivio_normativo/pipeline.py archivio_normativo/report.py archivio_normativo/store.py CLAUDE.md tests/archivio/test_cli.py
git commit -m "feat(archivio): the command — build, verify, render, report, export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: First real run (collaudo)

**Files:**
- Modify: `archivio_normativo/manifest.yaml` (whatever the dry-run proves wrong)

**Interfaces:** none new. This task needs Plan 1 merged into the branch and the VisuaLex API running locally.

- [ ] **Step 1: Start the API and probe the manifest**

In one terminal, from the repo root:

```bash
source .venv/bin/activate && python app.py
```

In another:

```bash
.venv/bin/python -m archivio_normativo build --dry-run
```

Expected: the "PROVA (dry-run)" table with one row per act (41). Read the "Atti non risolti" list: every entry is a manifest error (a wrong `act_type` spelling, a wrong date, an annex that does not exist). For each, open the act on Normattiva or EUR-Lex, correct the entry, rerun the dry-run for that act (`--only <id>`) until it resolves. Known candidates: `cpa-disp-att` (the annex number — the dry-run log line `no article in annex` prints the annexes the tree has), the `d.p.r.` spelling for the three tax decrees, `dlgs-23-2025`.

- [ ] **Step 2: A small act, for real**

```bash
.venv/bin/python -m archivio_normativo build --only l-241-1990
```

Expected: exit 0; `archivio_out/amministrativo/l-241-1990.md` opens as a readable file with an index and the articles; `Verifica` lists at most a `gap` (L. 241/1990 has real holes); `report` says `done`. Rerun the same command: every unit `invariati`, no `/stream_article_text` in the log.

- [ ] **Step 3: A codice and an EU act**

```bash
.venv/bin/python -m archivio_normativo build --only cp
.venv/bin/python -m archivio_normativo build --only gdpr
```

Expected: `cp` ≈ 900+ units with `ultimo_aggiornamento` populated (open the .md: art. 3 bis shows 2018-04-06); `gdpr` 99 articles and 173 recitals, `text_status: oj` warning line present in the Markdown. Check `archivio_out/ue/gdpr.md` shows `## Considerando 1` after the articles.

- [ ] **Step 4: Enrichment, once, on a small act**

```bash
.venv/bin/pip install -r requirements-archivio.txt
.venv/bin/python -m archivio_normativo build --only dlgs-231-2001 --enrich brocardi,cassazione,costituzionale
```

Expected: the legal-it server starts (first start compiles a venv through `uv`: allow a minute); the report's enrichment column shows ok/empty counts; `archivio_out/penale/dlgs-231-2001.md` carries `### Cassazione (Italgiure)` blocks under the articles.

- [ ] **Step 5: The whole corpus, overnight**

```bash
nohup .venv/bin/python -m archivio_normativo build > archivio_out/first-run.txt 2>&1 &
```

Expected: 3–4 hours; then `report` says `done`, `verify` lists the gaps and any `identical` finding (investigate each `identical`: it is either a genuinely repeated text — rare but real — or the wrong-article symptom). If the run dies, `--resume`.

- [ ] **Step 6: Commit the manifest corrections**

```bash
git add archivio_normativo/manifest.yaml
git commit -m "fix(archivio): manifest entries corrected against the live sources

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Manifest external and strict (Task 2). Unit granularity with identifier / number / rubrica / text / parte-libro-titolo-capo-sezione / vigenza / ultimo aggiornamento / URL (Tasks 3, 4, 7). Enrichment kinds, per-corpus switch, refresh policy (Tasks 6, 8; `brocardi` in Task 7). Double output SQLite + Markdown in the eight area folders (Tasks 4, 9, 11). Idempotence by hash, fingerprints, resume, rate limiting with backoff, file logging, final report, dry-run (Tasks 1, 4, 5, 7, 11). Integrity check (Task 10; duplicate numbers detected on the index in Task 11). Security rules: slugs and areas validated (Task 2), legal-it command from the local manifest or env only (Task 2, 6), `<` escaped in third-party markdown (Task 9), parametrised SQL (Task 4). Not in this plan, by the spec's own "out of scope": citation links, structured case-law records, `--since`.

**Placeholders.** None: every module and test is given in full, and every piece of code in this plan was executed against its tests while the plan was written (151 tests green in a scratch copy).

**Type consistency.** `ActSpec` field names (Task 2) are the ones `VisuaLexClient.act_body` and `reference_for` read (Tasks 5, 6). `UnitRecord`/`ActRecord` (Task 4) are what `Pipeline._record`/`_upsert_act` build (Task 7) and `render_md`/`verify` read (Tasks 9, 10). `ActReport` counters (Task 7, plus `duplicates` in Task 11) are the ones `format_report` prints (Task 10). `UnitOutcome` and the `Enricher` protocol (Task 7) are what `enrich.Enricher` implements (Task 8). `Store.reopen_run` is added in Task 11 before `cli.py` calls it.
