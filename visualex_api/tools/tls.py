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

Do not "simplify" this into disabling verification.
tests/test_tls_italgiure.py fails if anyone does.
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

        # The AIA endpoint serves a DER-encoded binary certificate
        # (Content-Type: application/pkix-cert, no charset). aiohttp's
        # response.text() falls back to a hardcoded "utf-8" when no charset is
        # advertised, which raises UnicodeDecodeError on binary bytes. Latin-1
        # is a bijective mapping over the full byte range 0-255, so decoding
        # with it and re-encoding with it losslessly round-trips the original
        # bytes — unlike utf-8, which would corrupt or reject them outright.
        result = await http_client.request(
            "GET", _AIA_URI, source="sectigo-aia", text_encoding="latin-1",
        )
        pem = await asyncio.to_thread(_der_to_pem, result.text.encode("latin-1"))

        ctx = ssl.create_default_context(cafile=certifi.where())
        ctx.load_verify_locations(cadata=pem)
        _context = ctx
        log.info("Italgiure TLS context built with the AIA intermediate")
        return ctx
