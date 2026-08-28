import inspect
import ssl
from unittest.mock import AsyncMock

import pytest

from visualex_api.services.http_client import ThrottledHttpClient
from visualex_api.tools import tls


def test_module_never_disables_verification():
    """The previous round re-enabled TLS verification repo-wide. This module
    exists to KEEP it on for a host with an incomplete chain — the opposite of
    turning it off. If someone ever reaches for the easy fix, this fails."""
    src = inspect.getsource(tls)
    assert "CERT_NONE" not in src
    assert "check_hostname = False" not in src
    assert "ssl=False" not in src


class _FakeResponse:
    """Mirrors the one aiohttp behaviour this test exists to guard against:
    with no charset in the headers and no explicit encoding, real aiohttp
    falls back to utf-8 (see `ClientResponse._resolve_charset` /
    `get_encoding`). `text_encoding` exists precisely so a caller can override
    that fallback for a body — like the AIA endpoint's DER certificate — that
    has no charset because it isn't text at all.
    """

    def __init__(self, body: bytes):
        self._body = body
        self.status = 200
        self.headers = {"Content-Type": "application/pkix-cert"}

    async def text(self, encoding=None, errors="strict"):
        return self._body.decode(encoding or "utf-8", errors=errors)

    def raise_for_status(self):
        return None


class _FakeRequestCM:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *exc_info):
        return False


class _FakeSession:
    def __init__(self, response):
        self._response = response

    def request(self, method, url, **kwargs):
        return _FakeRequestCM(self._response)


async def test_text_encoding_round_trips_binary_body():
    """Pins the exact bug this task exists to fix, offline: a binary body with
    no charset must come back byte-identical from http_client.request when
    text_encoding="latin-1" is supplied, instead of being corrupted or raising
    UnicodeDecodeError the way aiohttp's utf-8 fallback does. This is the CI
    regression net for what the live TLS test can only prove against the real
    italgiure host (pytest.ini deselects `live` by default)."""
    binary_body = b"\x30\x82\x01\xff\xfe"  # not valid UTF-8 (0xff is not a start byte)
    with pytest.raises(UnicodeDecodeError):
        binary_body.decode("utf-8")

    client = ThrottledHttpClient()
    client._get_session = AsyncMock(return_value=_FakeSession(_FakeResponse(binary_body)))

    result = await client.request(
        "GET", tls._AIA_URI, source="test", text_encoding="latin-1",
    )

    assert result.text.encode("latin-1") == binary_body


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
