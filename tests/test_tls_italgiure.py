import hashlib
import inspect
import pathlib
import ssl
from unittest.mock import AsyncMock

import pytest

from visualex_api.services.http_client import ThrottledHttpClient
from visualex_api.tools import tls

#: The real intermediate `www.italgiure.giustizia.it` omits from its chain,
#: captured from `tls._AIA_URI` on 2026-08-29 after checking with
#: `openssl verify -CAfile "$(python -c 'import certifi;print(certifi.where())')"`
#: that it chains to a root already in certifi. It is the only certificate the
#: module is allowed to load, so it is what the happy-path test must feed it.
_REAL = pathlib.Path(__file__).parent / "fixtures" / "tls" / "titrust_ov_ca.der"

#: A self-signed CA generated for this suite, standing in for whatever an
#: on-path attacker (or a poisoned DNS answer for titrust.crt.sectigo.com)
#: would serve from that plaintext HTTP endpoint. Valid DER, correct encoding,
#: entirely unrelated to italgiure — exactly the input the pin exists to refuse.
_SUBSTITUTED = pathlib.Path(__file__).parent / "fixtures" / "tls" / "substituted_ca.der"


@pytest.fixture(autouse=True)
def _no_cached_context():
    """`italgiure_ssl_context` memoises into a module global; without this
    every test after the first would silently assert on the first one's
    context."""
    tls._context = None
    yield
    tls._context = None


def _serve(der: bytes, monkeypatch):
    """Make the AIA fetch return `der`, the way the endpoint would."""
    async def fake_request(method, url, **kwargs):
        class R:
            # latin-1 is how the module round-trips binary bodies; see the
            # comment in italgiure_ssl_context.
            text = der.decode("latin-1")
        return R()

    from visualex_api.services import http_client as http_client_module
    monkeypatch.setattr(http_client_module.http_client, "request", fake_request)


def test_module_never_disables_verification():
    """The previous round re-enabled TLS verification repo-wide. This module
    exists to KEEP it on for a host with an incomplete chain — the opposite of
    turning it off. If someone ever reaches for the easy fix, this fails."""
    src = inspect.getsource(tls)
    assert "CERT_NONE" not in src
    assert "check_hostname = False" not in src
    assert "ssl=False" not in src


def test_der_to_pem_conversion_is_stdlib():
    """The conversion used to shell out to `openssl`, which put a process
    spawn on the request path and an undeclared binary dependency in the
    runtime — deploy.sh never installs openssl. `ssl.DER_cert_to_PEM_cert`
    does the same job in-process."""
    src = inspect.getsource(tls)
    assert "subprocess" not in src
    assert "ssl.DER_cert_to_PEM_cert" in src


def test_the_pin_matches_the_real_intermediate():
    """If the fixture and the constant ever disagree, one of them was updated
    without the other and every assertion below stops meaning anything."""
    assert hashlib.sha256(_REAL.read_bytes()).hexdigest() == tls._EXPECTED_SHA256


async def test_a_substituted_certificate_is_refused(monkeypatch):
    """The finding this test exists for: the AIA fetch is plaintext HTTP and
    `load_verify_locations` verifies nothing about what it loads, so before the
    pin an attacker who answered that request got their own CA installed as a
    trust anchor and could then MITM www.italgiure.giustizia.it and serve
    forged Corte di cassazione decisions. A wrong certificate must raise, and
    no context may survive the attempt."""
    _serve(_SUBSTITUTED.read_bytes(), monkeypatch)

    with pytest.raises(tls.IntermediateCertificateMismatch) as excinfo:
        await tls.italgiure_ssl_context()

    # The message has to be actionable when the real CA rotates.
    assert hashlib.sha256(_SUBSTITUTED.read_bytes()).hexdigest() in str(excinfo.value)
    assert tls._EXPECTED_SHA256 in str(excinfo.value)
    # Fail closed: nothing cached, so the next call re-checks rather than
    # handing out a context built from a refused certificate.
    assert tls._context is None


async def test_a_substituted_certificate_never_becomes_a_trust_anchor(monkeypatch):
    """Same defect, asserted on the outcome rather than on the exception:
    before the fix "Evil Substituted CA" ended up in `ctx.get_ca_certs()` of
    the very context used to talk to italgiure. It must not appear in any
    context the module hands out, including after a rejected attempt."""
    _serve(_SUBSTITUTED.read_bytes(), monkeypatch)
    with pytest.raises(tls.IntermediateCertificateMismatch):
        await tls.italgiure_ssl_context()

    _serve(_REAL.read_bytes(), monkeypatch)
    ctx = await tls.italgiure_ssl_context()

    subjects = [
        dict(pair for rdn in cert["subject"] for pair in rdn).get("commonName")
        for cert in ctx.get_ca_certs()
    ]
    assert "Evil Substituted CA" not in subjects


async def test_a_truncated_certificate_is_refused(monkeypatch):
    """A body that is neither the pinned certificate nor a valid certificate
    at all — a captive portal's HTML, a partial response — must be refused by
    the pin before anything tries to parse it."""
    _serve(_REAL.read_bytes()[:-40], monkeypatch)

    with pytest.raises(tls.IntermediateCertificateMismatch):
        await tls.italgiure_ssl_context()


async def test_the_pinned_certificate_is_accepted(monkeypatch):
    """The pin must not be so strict it breaks the working path: the real
    intermediate loads, and the context it produces still verifies."""
    _serve(_REAL.read_bytes(), monkeypatch)

    ctx = await tls.italgiure_ssl_context()

    assert ctx.verify_mode is ssl.CERT_REQUIRED
    assert ctx.check_hostname is True
    subjects = [
        dict(pair for rdn in cert["subject"] for pair in rdn).get("commonName")
        for cert in ctx.get_ca_certs()
    ]
    assert "TI Trust Technologies OV CA" in subjects


async def test_the_context_is_built_once(monkeypatch):
    """Memoised per process: a second call must not re-fetch the AIA endpoint."""
    calls = []

    async def counting_request(method, url, **kwargs):
        calls.append(url)
        class R:
            text = _REAL.read_bytes().decode("latin-1")
        return R()

    from visualex_api.services import http_client as http_client_module
    monkeypatch.setattr(http_client_module.http_client, "request", counting_request)

    first = await tls.italgiure_ssl_context()
    second = await tls.italgiure_ssl_context()

    assert first is second
    assert len(calls) == 1


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
async def test_the_aia_endpoint_still_serves_the_pinned_certificate():
    """The rotation canary. When TI Trust rotates its CA this fails here
    first, in a test that names the procedure, rather than in production as an
    unexplained italgiure outage."""
    from visualex_api.services.http_client import http_client

    result = await http_client.request(
        "GET", tls._AIA_URI, source="sectigo-aia", text_encoding="latin-1",
    )
    served = hashlib.sha256(result.text.encode("latin-1")).hexdigest()
    assert served == tls._EXPECTED_SHA256, (
        "The AIA endpoint no longer serves the pinned intermediate. Follow the "
        "rotation procedure in visualex_api/tools/tls.py — verify the new "
        "certificate chains to a certifi root BEFORE changing the pin."
    )


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
