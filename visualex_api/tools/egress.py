"""The complete list of hosts this server may contact, and who operates each one.

Answering "where does my data go" by reading the code is days of work, and
answering it with a promise in a README is worth nothing. So the answer lives
here as data, `tests/test_egress_allowlist.py` fails the build if a URL literal
appears for a host not listed, and `is_allowed()` is checked at request time in
ThrottledHttpClient.

That runtime check covers the shared HTTP client only. `POST /fetch_tree` reaches
the network through treextractor's own aiohttp session, Playwright's
`page.goto()` never consults this module, and the client does not re-check a
redirect target. SECURITY.md ("Not yet covered") lists those three gaps; do not
describe this list as an enforced boundary until they are closed.

The server sends no telemetry and has no analytics endpoint. Every host below is
a source consulted to answer a specific legal question.
"""
from __future__ import annotations

from urllib.parse import urlparse

#: Hosts the running server may contact, mapped to who operates them.
ALLOWED_HOSTS: dict[str, str] = {
    # --- Italian State: legislation ---
    "www.normattiva.it": "Normattiva — Istituto Poligrafico e Zecca dello Stato",
    # --- European Union ---
    "eur-lex.europa.eu": "EUR-Lex — Ufficio delle pubblicazioni UE",
    # --- Private ---
    # The only non-institutional source. Brocardi supplies doctrinal notes and
    # case-law abstracts, never the text of a norm: that always comes from
    # Normattiva or EUR-Lex. Two spellings are in use across the codebase
    # (services/brocardi_scraper.py uses the bare form, tools/map.py the www one),
    # so both are declared.
    "brocardi.it": "Brocardi.it — annotazioni dottrinali (fonte privata)",
    "www.brocardi.it": "Brocardi.it — annotazioni dottrinali (fonte privata)",
    # --- Case law ---
    "publications.europa.eu": "Publications Office of the EU — CELLAR, CJEU case law",
    "www.italgiure.giustizia.it": "Ministero della Giustizia — CED, Corte di cassazione",
    "def.finanze.it": "MEF — Documentazione economica e finanziaria, giurisprudenza",
    "www.giustizia-amministrativa.it": "Giustizia amministrativa — Consiglio di Stato e TAR",
    "mdp.giustizia-amministrativa.it": "Giustizia amministrativa — testi dei provvedimenti",
    "titrust.crt.sectigo.com": "Sectigo — intermediate CA for italgiure.giustizia.it (Task 2)",
}

#: Strings that look like hosts but are never fetched.
NON_NETWORK_HOSTS: dict[str, str] = {
    "localhost": "default CORS origins and the frontend link in a JSON response",
    "www.normattiva.it.evil.com": (
        "appears only inside the comment in services/pdfextractor.py explaining "
        "why the SSRF guard compares hosts exactly"
    ),
    "docs.oasis-open.org": (
        "the Akoma Ntoso 3.0 XML namespace URI, named in the akn_parser "
        "docstring; the parser resolves nothing (no_network=True)"
    ),
    "visualex.org": (
        "the contact URL inside services/case_law/base.py's USER_AGENT "
        "string; sent to case-law sources as a header value, never fetched"
    ),
    "www.w3.org": (
        "the XSD string-datatype namespace URI inside the SPARQL query "
        "literal in services/case_law/cellar.py; part of the query text sent "
        "to CELLAR, never itself contacted"
    ),
}


def is_allowed(url: str) -> bool:
    """True when `url`'s host is one the running server may contact."""
    try:
        return (urlparse(url).hostname or "") in ALLOWED_HOSTS
    except ValueError:
        return False
