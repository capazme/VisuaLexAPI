import pytest

pytest_plugins = ("pytest_asyncio",)


@pytest.fixture(autouse=True)
def _isolate_shared_http_client():
    """Give every test a shared HTTP client that is not bound to a dead loop.

    `visualex_api.services.http_client.http_client` is a process-wide singleton
    that memoises an `aiohttp.ClientSession`, an `asyncio.Semaphore` and two
    `asyncio.Lock`s. pytest-asyncio runs each test in its own event loop, and
    all four of those objects bind to the loop that first used them — the
    session's connector to its transports, the locks and the semaphore through
    `_LoopBoundMixin`. The second test in a process to make a real request
    therefore failed with "Event loop is closed" no matter what it asked for.

    That never showed while each live test file held exactly one live test.
    Adding a second one to `test_tls_italgiure.py` and `test_case_law_cellar.py`
    surfaced it, and the failure looked exactly like the source being down —
    which is the worst possible disguise for a harness problem in a suite whose
    live tests exist to tell us when a source really has changed.

    Resetting the instance's attributes in place (rather than rebinding the
    module global) is what makes this work: every adapter did
    `from ..http_client import http_client` at import time, so they all hold the
    same object and a rebind would not reach them.
    """
    yield
    from visualex_api.services.http_client import ThrottledHttpClient, http_client
    from visualex_api.services.case_law.http_client import case_law_http_client

    # Constructing these outside a running loop is safe: since 3.10 asyncio
    # primitives capture their loop on first use, not at construction.
    #
    # The case-law package holds a second module-level `ThrottledHttpClient`
    # instance (`services/case_law/http_client.py`, deliberately independent
    # of the shared one — see its own docstring). It memoises its own
    # `aiohttp.ClientSession` bound to whichever loop first used it, so it
    # needs the exact same reset or the second live test to touch it fails
    # with "Event loop is closed", indistinguishable from the source being
    # down.
    http_client.__dict__.update(ThrottledHttpClient().__dict__)
    case_law_http_client.__dict__.update(ThrottledHttpClient().__dict__)
