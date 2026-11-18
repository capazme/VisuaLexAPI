"""At most two browsers at once for EUR-Lex (item 14 of the security inventory).

Each call that CELLAR could not serve opened its own Chromium: hundreds of MB each, so a burst of
them could exhaust the memory of the Python service for every reader. Now a third call waits for a
free browser, and after a short wait it is told to retry; a browser that fails frees its place.
"""
import asyncio

import pytest

from visualex_api.services import eurlex_fetch
from visualex_api.tools.exceptions import NetworkError

URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


class FakeBrowsers:
    """Stands in for Playwright: counts the browsers open at once and holds them until `release`."""

    def __init__(self, fail: bool = False):
        self.open = 0
        self.most = 0
        self.launched = 0
        self.fail = fail
        self.release = asyncio.Event()

    def __call__(self):
        fake = self

        class Browser:
            async def new_context(self, **_):
                class Context:
                    async def new_page(self):
                        class Page:
                            async def goto(self, *_a, **_k):
                                if fake.fail:
                                    raise RuntimeError("Chromium crashed")
                                await fake.release.wait()

                            async def content(self):
                                return "<html>atto</html>"
                        return Page()

                    async def close(self):
                        pass
                return Context()

            async def close(self):
                fake.open -= 1

        class Chromium:
            async def launch(self, **_):
                fake.open += 1
                fake.launched += 1
                fake.most = max(fake.most, fake.open)
                return Browser()

        class Manager:
            async def __aenter__(self):
                class P:
                    chromium = Chromium()
                return P()

            async def __aexit__(self, *_):
                return False

        return Manager()


@pytest.fixture
def browsers(monkeypatch):
    fake = FakeBrowsers()
    monkeypatch.setattr(eurlex_fetch, "async_playwright", fake)
    monkeypatch.setattr(eurlex_fetch, "is_allowed", lambda _url: True)
    return fake


async def test_no_more_than_two_browsers_at_once(browsers, monkeypatch):
    monkeypatch.setattr(eurlex_fetch, "BROWSER_WAIT_SECONDS", 5.0)
    calls = [asyncio.create_task(eurlex_fetch.fetch_with_playwright(URL)) for _ in range(4)]
    await asyncio.sleep(0.05)
    assert browsers.open == 2
    browsers.release.set()
    pages = await asyncio.gather(*calls)
    assert pages == ["<html>atto</html>"] * 4
    assert browsers.most == 2
    assert browsers.launched == 4


async def test_a_call_that_waits_too_long_is_told_to_retry(browsers, monkeypatch):
    monkeypatch.setattr(eurlex_fetch, "BROWSER_WAIT_SECONDS", 0.05)
    holding = [asyncio.create_task(eurlex_fetch.fetch_with_playwright(URL)) for _ in range(2)]
    await asyncio.sleep(0.01)
    with pytest.raises(NetworkError) as refused:
        await eurlex_fetch.fetch_with_playwright(URL)
    assert refused.value.status_code == 503
    assert "riprova" in str(refused.value)
    assert browsers.launched == 2
    browsers.release.set()
    await asyncio.gather(*holding)


async def test_a_browser_that_fails_frees_its_place(monkeypatch):
    fake = FakeBrowsers(fail=True)
    monkeypatch.setattr(eurlex_fetch, "async_playwright", fake)
    monkeypatch.setattr(eurlex_fetch, "is_allowed", lambda _url: True)
    monkeypatch.setattr(eurlex_fetch, "BROWSER_WAIT_SECONDS", 0.05)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            await eurlex_fetch.fetch_with_playwright(URL)
    assert fake.launched == 3
    assert fake.open == 0


async def test_a_refused_host_takes_no_place(monkeypatch):
    fake = FakeBrowsers()
    monkeypatch.setattr(eurlex_fetch, "async_playwright", fake)
    with pytest.raises(NetworkError):
        await eurlex_fetch.fetch_with_playwright("https://example.org/")
    assert fake.launched == 0
