"""No URL may appear in the code for a host this project has not declared.

A lawyer evaluating this server has to answer one question before running it on
client matters: where does my data go. A prose list drifts the first time
someone adds a scraper; this fails the build instead.

The guarantee is STATIC — it checks URL literals in the source, not what happens
at runtime. It would not catch a URL assembled from fragments, and nothing here
claims otherwise. The runtime half is `is_allowed()`, wired into
ThrottledHttpClient.request.
"""
import re
from pathlib import Path

import pytest

from visualex_api.tools.egress import ALLOWED_HOSTS, NON_NETWORK_HOSTS, is_allowed

ROOT = Path(__file__).resolve().parents[1]
URL = re.compile(r"https?://([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])")


def hosts_in_sources() -> dict[str, list[str]]:
    """Every host in a URL literal across the server's own source."""
    found: dict[str, list[str]] = {}
    targets = list((ROOT / "visualex_api").rglob("*.py")) + [ROOT / "app.py"]
    for path in sorted(targets):
        for host in set(URL.findall(path.read_text(encoding="utf-8"))):
            found.setdefault(host, []).append(str(path.relative_to(ROOT)))
    return found


SERVER_HOSTS = sorted(hosts_in_sources())


@pytest.mark.parametrize("host", SERVER_HOSTS)
def test_server_contacts_only_declared_hosts(host):
    allowed = ALLOWED_HOSTS | NON_NETWORK_HOSTS
    assert host in allowed, (
        f"'{host}' appears in a URL literal but is not declared.\n"
        "If the server really contacts it, add it to ALLOWED_HOSTS in "
        "visualex_api/tools/egress.py and to SECURITY.md. If it is a namespace, "
        "a comment or a placeholder, add it to NON_NETWORK_HOSTS."
    )


@pytest.mark.parametrize("host", sorted(ALLOWED_HOSTS))
def test_every_allowed_host_is_documented(host):
    assert host in (ROOT / "SECURITY.md").read_text(encoding="utf-8"), (
        f"'{host}' is allowed in code but absent from SECURITY.md"
    )


def test_the_allowlist_is_not_vacuous():
    assert "www.normattiva.it" in ALLOWED_HOSTS
    assert len(ALLOWED_HOSTS) >= 4


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge", True),
        ("https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita", True),
        ("https://www.normattiva.it.evil.test/phish", False),
        ("http://169.254.169.254/latest/meta-data/", False),
        ("not-a-url", False),
    ],
)
def test_is_allowed(url, expected):
    assert is_allowed(url) is expected
