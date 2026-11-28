"""What a stored Normattiva page says is computed once per page, not at every read (T133).

A warm read of an article of a code took its 2.6 MB page from the disk cache three times and
parsed it again for the validity, the update notes and the parts: 36 of its 73 ms (measured with
scripts/replay_load.py and cProfile, docs/superpowers/specs/2026-11-28-collectors-speed-design.md).
The answers are kept under the page's write time: the same answer as before, computed once.
"""
import os
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import app as app_module
from app import NormaController
from visualex_api.services import normattiva_validity as validity_module
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.normattiva_validity import extract_validity, read_validity
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.page_memo import PAGE_MEMO, PageMemo

pytestmark = pytest.mark.asyncio

PAGES = Path(__file__).parent / "fixtures" / "normattiva"
URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284"


def page(name: str) -> str:
    return (PAGES / name).read_text(encoding="utf-8")


@pytest.fixture
def cache(tmp_path):
    store = PersistentCache("normattiva")
    store.directory = tmp_path / "normattiva"
    store.directory.mkdir(parents=True, exist_ok=True)
    PAGE_MEMO.clear()
    yield store
    PAGE_MEMO.clear()


class NoStampCache:
    """A backend without stamps (Redis): the page is read every time."""

    def __init__(self, data):
        self.data = data

    async def get(self, key):
        return self.data.get(key)


# --- the stamp ---------------------------------------------------------------------------------

async def test_a_stamp_is_the_entrys_write_time_and_changes_when_it_is_written_again(cache):
    assert await cache.stamp(URL) is None
    await cache.set(URL, "<html>one</html>")
    first = await cache.stamp(URL)
    assert first is not None and abs(first - time.time()) < 5
    assert await cache.stamp(URL) == first
    time.sleep(0.002)
    await cache.set(URL, "<html>two</html>")
    assert await cache.stamp(URL) not in (None, first)


async def test_an_expired_entry_has_no_stamp(cache):
    await cache.set(URL, "<html>old</html>")
    cache.ttl = -1
    assert await cache.stamp(URL) is None


async def test_a_stamp_counts_as_a_use_for_the_prune(cache):
    await cache.set(URL, "<html>page</html>")
    path = cache._path_for_key(URL)
    os.utime(path, (time.time() - 10 * 86400,) * 2)
    await cache.stamp(URL)
    assert time.time() - path.stat().st_mtime < 60


# --- the memo ----------------------------------------------------------------------------------

async def test_an_answer_is_computed_once_per_page(cache):
    memo, runs = PageMemo(), []
    await cache.set(URL, "<html>page</html>")

    def compute(raw):
        runs.append(raw)
        return {"length": len(raw)}

    answers = [await memo.derive(cache, URL, "facts", ("1284",), compute) for _ in range(5)]
    assert answers == [{"length": 17}] * 5
    assert len(runs) == 1


async def test_a_page_written_again_is_read_again(cache):
    memo, runs = PageMemo(), []
    await cache.set(URL, "<html>one</html>")
    await memo.derive(cache, URL, "facts", (), lambda raw: runs.append(raw) or raw)
    time.sleep(0.002)
    await cache.set(URL, "<html>two, longer</html>")
    assert await memo.derive(cache, URL, "facts", (), lambda raw: runs.append(raw) or raw) == "<html>two, longer</html>"
    assert runs == ["<html>one</html>", "<html>two, longer</html>"]


async def test_the_arguments_name_the_answer(cache):
    memo = PageMemo()
    await cache.set(URL, "<html>page</html>")
    assert await memo.derive(cache, URL, "facts", ("a",), lambda raw: "a") == "a"
    assert await memo.derive(cache, URL, "facts", ("b",), lambda raw: "b") == "b"
    assert await memo.derive(cache, URL, "other", ("a",), lambda raw: "other") == "other"


async def test_no_page_is_no_answer_and_nothing_is_kept(cache):
    memo = PageMemo()
    assert await memo.derive(cache, URL, "facts", (), lambda raw: "never") is None
    assert len(memo) == 0


async def test_a_caller_changing_its_answer_changes_no_other(cache):
    memo = PageMemo()
    await cache.set(URL, "<html>page</html>")
    first = await memo.derive(cache, URL, "facts", (), lambda raw: {"notes": [1]})
    first["notes"].append(2)
    second = await memo.derive(cache, URL, "facts", (), lambda raw: {"notes": [1]})
    second["notes"].append(3)
    assert await memo.derive(cache, URL, "facts", (), lambda raw: None) == {"notes": [1]}


async def test_a_backend_without_stamps_reads_the_page_every_time():
    memo, runs = PageMemo(), []
    store = NoStampCache({URL: "<html>page</html>"})
    for _ in range(3):
        assert await memo.derive(store, URL, "facts", (), lambda raw: runs.append(1) or "x") == "x"
    assert len(runs) == 3
    assert len(memo) == 0


async def test_the_memo_is_bounded(cache):
    memo = PageMemo(max_entries=3)
    await cache.set(URL, "<html>page</html>")
    for n in range(10):
        await memo.derive(cache, URL, "facts", (n,), lambda raw: n)
    assert len(memo) == 3


# --- the validity --------------------------------------------------------------------------------

async def test_the_validity_is_the_extractors_answer_on_the_page(cache):
    raw = page("art1284_cc_at_2007-12-29_trimmed.html")
    await cache.set(URL, raw)
    expected = extract_validity(raw, article="1284", requested_date="2007-12-29")
    assert expected is not None
    for _ in range(3):
        assert await read_validity(cache, URL, article="1284", requested_date="2007-12-29") == expected


async def test_the_validity_is_read_once_per_page_and_day(cache):
    raw = page("art1284_cc_in_force_update_notes_trimmed.html")
    await cache.set(URL, raw)
    calls = []
    original = validity_module.extract_validity

    def counting(*args, **kwargs):
        calls.append(kwargs.get("today"))
        return original(*args, **kwargs)

    with patch.object(validity_module, "extract_validity", counting):
        with patch.object(validity_module, "_today_in_rome", return_value=date(2026, 11, 28)):
            for _ in range(4):
                await read_validity(cache, URL, article="1284")
        with patch.object(validity_module, "_today_in_rome", return_value=date(2026, 11, 29)):
            await read_validity(cache, URL, article="1284")
    # the state is judged against today: a new day is a new answer
    assert calls == [date(2026, 11, 28), date(2026, 11, 29)]


# --- the update notes and the parts ---------------------------------------------------------------

async def test_the_page_extras_are_those_of_the_page_read_once(cache, monkeypatch):
    raw = page("art1284_cc_in_force_update_notes_trimmed.html")
    await cache.set(URL, raw)
    scraper = NormattivaScraper.__new__(NormattivaScraper)
    scraper.cache = cache
    nv = SimpleNamespace(numero_articolo="1284", parte=None)
    notes, parts = app_module._read_page_extras(raw, "1284")
    expected = {**app_module.update_notes_fields(notes), **app_module.parts_fields(parts)}

    runs = []
    original = app_module._read_page_extras

    def counting(*args, **kwargs):
        runs.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(app_module, "_read_page_extras", counting)
    for _ in range(4):
        assert await NormaController._page_extras_for(scraper, nv, URL, "testo") == expected
    assert runs == [1]


async def test_a_parts_page_is_read_the_old_way(cache, monkeypatch):
    """A part's key holds PART_KEY_MARK: its notes come from its page and its parts from the
    article's page, so it is not kept under one page's stamp."""
    article = page("art1284_cc_in_force_update_notes_trimmed.html")
    await cache.set(URL, article)
    part_url = URL + app_module.PART_KEY_MARK + "701-800"
    await cache.set(part_url, article)
    scraper = NormattivaScraper.__new__(NormattivaScraper)
    scraper.cache = cache
    nv = SimpleNamespace(numero_articolo="1284", parte="701-800")
    runs = []
    original = app_module._read_page_extras

    def counting(*args, **kwargs):
        runs.append(args)
        return original(*args, **kwargs)

    monkeypatch.setattr(app_module, "_read_page_extras", counting)
    for _ in range(2):
        fields = await NormaController._page_extras_for(scraper, nv, part_url, "testo")
        assert fields["testo_parziale"] is True
    assert len(runs) == 2
    assert runs[0][2] == article  # the article's page, for the parts
    assert len(PAGE_MEMO) == 0
