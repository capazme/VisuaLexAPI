"""What the decision readers share: an HTTP client of their own and an honest identity.

The client is a `ThrottledHttpClient` instance separate from the shared one: its semaphore
and minimum interval are its own, so a slow court source never makes the reading of an
article wait (measured in the 2026-08-29 round). The egress allowlist and the retries are
the same, because they live in `ThrottledHttpClient.request`.
"""
from __future__ import annotations

from pathlib import Path

from ..http_client import ThrottledHttpClient

decisions_http_client = ThrottledHttpClient()


def _version() -> str:
    # version.txt sits at the repository root, also in the image (/repo/version.txt)
    path = Path(__file__).resolve().parents[5] / "version.txt"
    try:
        return path.read_text().strip() or "0"
    except OSError:
        return "0"


#: D5 of the 2026-08-29 design: names the product, carries a contact, impersonates nothing.
USER_AGENT = f"VisuaLex/{_version()} (ricerca giuridica; +https://visualex.org)"


def http_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT}
    if extra:
        headers.update(extra)
    return headers
