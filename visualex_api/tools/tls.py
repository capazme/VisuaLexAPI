"""A verifying SSL context for a host that serves an incomplete chain.

`www.italgiure.giustizia.it` presents a leaf issued by "TI Trust Technologies
OV CA", which is itself issued by "USERTrust RSA Certification Authority" —
present in certifi. The server omits the intermediate, so a default context
cannot build the chain and fails with "unable to get local issuer certificate".

The fix is to supply the missing link, not to stop checking. The intermediate
is downloaded from the URI the leaf certificate advertises (Authority
Information Access) — over plaintext HTTP, so the transport authenticates
nothing: whoever answers that request decides what we load. And
`ssl.SSLContext.load_verify_locations` makes whatever it is given a *trust
anchor*; it checks the encoding and nothing else. It does not verify a
signature, a chain, or a name.

What makes that download safe is `_EXPECTED_SHA256` below, and nothing else.
The DER bytes are hashed and compared against the pin before they go anywhere
near the context; a mismatch raises `IntermediateCertificateMismatch` and no
context is built, so the caller fails rather than talking to italgiure over a
connection an attacker chose the trust anchor for. Without that check, anyone
on the path to titrust.crt.sectigo.com — or able to poison its DNS — could
have a CA of their own trusted and then serve forged Corte di cassazione
decisions to a lawyer over a connection that still looks verified.

Do not "simplify" this into disabling verification, and do not downgrade the
pin mismatch into a warning that loads the certificate anyway.
tests/test_tls_italgiure.py fails if anyone does.
"""
from __future__ import annotations

import asyncio
import hashlib
import ssl

import certifi
import structlog

log = structlog.get_logger()

_AIA_URI = "http://titrust.crt.sectigo.com/TITrustTechnologiesOVCA.crt"

#: SHA-256 of the DER encoding of the intermediate
#: `www.italgiure.giustizia.it` omits from its chain:
#:
#:   subject: CN=TI Trust Technologies OV CA, O=TI Trust Technologies S.R.L., IT
#:   issuer:  CN=USERTrust RSA Certification Authority (in certifi)
#:   valid:   2019-07-30 .. 2029-07-29
#:
#: Recorded on 2026-08-29 by downloading `_AIA_URI` and, before trusting it,
#: confirming it chains to a root already in the certifi bundle:
#:
#:   curl -s http://titrust.crt.sectigo.com/TITrustTechnologiesOVCA.crt -o ti.der
#:   openssl x509 -inform DER -in ti.der -noout -subject -issuer -dates
#:   openssl x509 -inform DER -in ti.der -out ti.pem
#:   openssl verify -CAfile "$(python -c 'import certifi;print(certifi.where())')" ti.pem
#:   shasum -a 256 ti.der
#:
#: When the CA rotates — at the latest when this certificate expires on
#: 2029-07-29 — every italgiure request starts failing with
#: `IntermediateCertificateMismatch`, naming the digest that was served.
#: To rotate: run the five commands above again, check that the subject and
#: issuer are still the two names printed here and that `openssl verify` says
#: "OK", and only then replace the digest below. Never paste in the hash of
#: whatever the endpoint happens to be serving without that check — a pin
#: updated to match an attacker's certificate is worse than no pin, because it
#: looks like one.
_EXPECTED_SHA256 = "1bfd8702d8f9bb340f353820330c0bba7e522c63164c91f295414dac797f0863"

_context: ssl.SSLContext | None = None
_lock = asyncio.Lock()


class IntermediateCertificateMismatch(Exception):
    """The AIA endpoint served something other than the pinned intermediate.

    Raised, never logged-and-continued: the whole point of the pin is that an
    unrecognised certificate is refused rather than trusted.
    """


def _pinned_pem(der: bytes) -> str:
    """Return the PEM form of `der`, but only if it is the pinned certificate.

    The pin is checked on the raw DER bytes, before any parsing, so nothing
    derived from an unverified certificate is ever used —
    `ssl.DER_cert_to_PEM_cert` only ever runs on bytes already known to be the
    exact certificate recorded above.
    """
    digest = hashlib.sha256(der).hexdigest()
    if digest != _EXPECTED_SHA256:
        raise IntermediateCertificateMismatch(
            f"{_AIA_URI} served a certificate that is not the pinned "
            f"intermediate: got sha256={digest}, expected "
            f"sha256={_EXPECTED_SHA256}. Refusing to trust it. If the CA has "
            f"rotated, follow the rotation procedure in "
            f"visualex_api/tools/tls.py before changing the pin."
        )
    return ssl.DER_cert_to_PEM_cert(der)


async def italgiure_ssl_context() -> ssl.SSLContext:
    """Built once per process. Raises if the intermediate cannot be fetched or
    does not match the pin — a caller that cannot verify must fail, not fall
    back to not verifying. Nothing is cached on failure, so a transient network
    error is retried on the next call."""
    global _context
    async with _lock:
        if _context is not None:
            return _context

        # The case-law client, not the shared one: this function's only
        # caller is `services/case_law/italgiure.py` (verified — nothing
        # else imports `italgiure_ssl_context`), so the AIA fetch belongs to
        # the case-law package's traffic, not article reading's. It is a
        # one-time, memoised call (see `_context` above), so the choice only
        # matters for the first case-law request in a process's lifetime —
        # but even then there is no reason for it to queue behind, or make
        # Normattiva/EUR-Lex/Brocardi queue behind, a bootstrap request that
        # has nothing to do with reading an article.
        from ..services.case_law.http_client import case_law_http_client as http_client

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
        der = result.text.encode("latin-1")
        try:
            pem = _pinned_pem(der)
        except IntermediateCertificateMismatch:
            log.error("Italgiure AIA certificate failed the pin check",
                      uri=_AIA_URI, sha256=hashlib.sha256(der).hexdigest(),
                      expected=_EXPECTED_SHA256)
            raise

        ctx = ssl.create_default_context(cafile=certifi.where())
        ctx.load_verify_locations(cadata=pem)
        _context = ctx
        log.info("Italgiure TLS context built with the pinned AIA intermediate",
                 sha256=_EXPECTED_SHA256)
        return ctx
