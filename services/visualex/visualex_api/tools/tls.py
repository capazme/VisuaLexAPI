"""A verifying SSL context for www.italgiure.giustizia.it, which serves an incomplete chain.

The site's leaf is issued by "TI Trust Technologies OV CA", itself issued by "USERTrust RSA
Certification Authority" (in certifi). The server omits the intermediate, so a default
context fails with "unable to get local issuer certificate". The fix is to supply the
missing link, never to stop checking: the intermediate ships with this package
(certs/titrust_ov_ca.der) and is trusted only when its SHA-256 is the one pinned below.

  subject: CN=TI Trust Technologies OV CA, O=TI Trust Technologies S.R.L., IT
  issuer:  CN=USERTrust RSA Certification Authority (in certifi)
  valid:   2019-07-30 .. 2029-07-29

To rotate, at the latest before 2029-07-29: download the intermediate from the AIA URI in
the site's leaf (http://titrust.crt.sectigo.com/TITrustTechnologiesOVCA.crt), then
  openssl x509 -inform DER -in ti.der -noout -subject -issuer -dates
  openssl x509 -inform DER -in ti.der -out ti.pem
  openssl verify -CAfile "$(python -c 'import certifi;print(certifi.where())')" ti.pem
and only when the names match and verify says OK, replace the file and the pin. Never pin
whatever a server happens to send.

Do not "simplify" this into disabling verification: tests/test_tls_italgiure.py fails.
"""
from __future__ import annotations

import hashlib
import ssl
from pathlib import Path

import certifi

INTERMEDIATE = Path(__file__).resolve().parent / "certs" / "titrust_ov_ca.der"
EXPECTED_SHA256 = "1bfd8702d8f9bb340f353820330c0bba7e522c63164c91f295414dac797f0863"

_context: ssl.SSLContext | None = None


class IntermediateCertificateMismatch(Exception):
    """The intermediate on disk is not the pinned one: refused, never trusted."""


def _pinned_pem(der: bytes) -> str:
    digest = hashlib.sha256(der).hexdigest()
    if digest != EXPECTED_SHA256:
        raise IntermediateCertificateMismatch(
            f"{INTERMEDIATE.name} is not the pinned intermediate: sha256={digest}, "
            f"expected {EXPECTED_SHA256}. Follow the rotation procedure in "
            "visualex_api/tools/tls.py.")
    return ssl.DER_cert_to_PEM_cert(der)


def italgiure_ssl_context() -> ssl.SSLContext:
    """Built once per process; raises rather than fall back to not verifying."""
    global _context
    if _context is None:
        ctx = ssl.create_default_context(cafile=certifi.where())
        ctx.load_verify_locations(cadata=_pinned_pem(INTERMEDIATE.read_bytes()))
        _context = ctx
    return _context
