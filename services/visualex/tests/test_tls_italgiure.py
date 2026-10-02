"""Italgiure is reached with verification on and the missing intermediate pinned
(design 2026-10-01 §3; the TLS finding of the 2026-08-29 design)."""
import asyncio
import hashlib
import inspect
import pathlib
import ssl

import pytest

from visualex_api.services.decisions import http as decisions_http
from visualex_api.tools import tls

_SUBSTITUTED = pathlib.Path(__file__).parent / "fixtures" / "tls" / "substituted_ca.der"


@pytest.fixture(autouse=True)
def _fresh_context():
    tls._context = None
    yield
    tls._context = None


def test_verification_is_never_switched_off():
    source = inspect.getsource(tls) + inspect.getsource(decisions_http)
    for forbidden in ("CERT_NONE", "check_hostname = False", "ssl=False", "verify=False"):
        assert forbidden not in source


def test_the_shipped_intermediate_is_the_pinned_one():
    assert hashlib.sha256(tls.INTERMEDIATE.read_bytes()).hexdigest() == tls.EXPECTED_SHA256


def test_the_context_verifies_hostnames_and_chains():
    ctx = tls.italgiure_ssl_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
    assert tls.italgiure_ssl_context() is ctx  # built once


def test_a_substituted_certificate_is_refused(monkeypatch):
    monkeypatch.setattr(tls, "INTERMEDIATE", _SUBSTITUTED)
    with pytest.raises(tls.IntermediateCertificateMismatch):
        tls.italgiure_ssl_context()
    assert tls._context is None


def test_the_readers_say_who_they_are():
    assert decisions_http.USER_AGENT.startswith("VisuaLex/")
    assert "+https://visualex.org" in decisions_http.USER_AGENT
    assert decisions_http.http_headers({"Referer": "r"}) == {
        "User-Agent": decisions_http.USER_AGENT, "Referer": "r"}


async def test_text_encoding_round_trips_a_binary_body():
    from unittest.mock import AsyncMock

    from visualex_api.services.http_client import ThrottledHttpClient

    body = b"PK\x03\x04\xff\xfe"

    class Response:
        status = 200
        headers = {"Content-Type": "application/zip"}

        async def text(self, encoding=None, errors="strict"):
            return body.decode(encoding or "utf-8", errors=errors)

        def raise_for_status(self):
            return None

    class Request:
        async def __aenter__(self):
            return Response()

        async def __aexit__(self, *exc):
            return False

    class Session:
        def request(self, method, url, **kwargs):
            return Request()

    client = ThrottledHttpClient()
    client._get_session = AsyncMock(return_value=Session())
    result = await client.request("GET", "https://dati.cortecostituzionale.it/x.zip",
                                  source="test", text_encoding="latin-1")
    assert result.text.encode("latin-1") == body


@pytest.mark.live
async def test_the_context_verifies_italgiure_for_real():
    ctx = tls.italgiure_ssl_context()
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(
            "www.italgiure.giustizia.it", 443, ssl=ctx,
            server_hostname="www.italgiure.giustizia.it"), 15)
    except (OSError, asyncio.TimeoutError) as exc:
        if isinstance(exc, ssl.SSLError):
            raise
        pytest.skip(f"italgiure unreachable: {exc}")
    writer.close()
    await writer.wait_closed()
