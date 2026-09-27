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
