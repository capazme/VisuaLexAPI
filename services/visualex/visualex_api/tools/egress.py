"""The complete list of hosts this server may contact, and who operates each one.

Answering "where does my data go" by reading the code is days of work, and
answering it with a promise in a README is worth nothing. So the answer lives
here as data, `tests/test_egress_allowlist.py` fails the build if a URL literal
appears for a host not listed, and `is_allowed()` is checked at request time in
ThrottledHttpClient.

That runtime check covers the `ThrottledHttpClient` instances (the shared one
and the decision readers' own), which carry the Normattiva tree too, and
treextractor checks it before it starts a browser. Playwright's `page.goto()` in
the EUR-Lex scraper and the PDF export never consults this module, no browser
re-checks what a page loads, and the client does not re-check a redirect target.
SECURITY.md ("Not yet covered") lists those gaps; do not describe this list as an
enforced boundary until they are closed.

The server sends no telemetry and has no analytics endpoint. Every host below is
a source consulted to answer a legal question, or fetched for MERL-T's ingestion
of the Massimario's reviews.
"""
from __future__ import annotations

from urllib.parse import urlparse

#: Hosts the running server may contact, mapped to who operates them.
ALLOWED_HOSTS: dict[str, str] = {
    # --- Italian State: legislation ---
    "www.normattiva.it": "Normattiva — Istituto Poligrafico e Zecca dello Stato",
    # --- Italian State: case law ---
    # The annual reviews of the Corte di cassazione's Ufficio del Massimario,
    # fetched for MERL-T's ingestion through the internal /fetch_massimario route.
    "www.portaledelmassimario.ipzs.it": "Portale del Massimario — Corte di cassazione (realizzazione IPZS)",
    # --- European Union ---
    "eur-lex.europa.eu": "EUR-Lex — Ufficio delle pubblicazioni UE",
    # The same Office's repository behind EUR-Lex (CELLAR): the CGUE's judgments by CELEX and its
    # SPARQL endpoint (design 2026-10-12 §4), since EUR-Lex's page answers a server with a challenge.
    "publications.europa.eu": "Ufficio delle pubblicazioni UE — archivio CELLAR (EUR-Lex)",
    # --- Italian State: courts (decision pages, design 2026-10-01) ---
    "www.italgiure.giustizia.it": "Ministero della Giustizia — CED, Corte di cassazione (SentenzeWeb)",
    "dati.cortecostituzionale.it": "Corte costituzionale — dati aperti (CC BY-SA 3.0)",
    # The administrative courts: the decisions search and the documents (CdS/TAR design note, 2026-10-12).
    "www.giustizia-amministrativa.it": "Giustizia amministrativa — Consiglio di Stato e TAR (ricerca dei provvedimenti)",
    "mdp.giustizia-amministrativa.it": "Giustizia amministrativa — Consiglio di Stato e TAR (testi dei provvedimenti)",
}

#: Strings that look like hosts but are never fetched.
NON_NETWORK_HOSTS: dict[str, str] = {
    "localhost": "default CORS origins and the frontend link in a JSON response",
    # Brocardi is no longer a source (D-078): no route calls the scraper, and
    # ThrottledHttpClient refuses these hosts. The scraper and its tables still
    # name them until they are deleted.
    "brocardi.it": "the switched-off Brocardi scraper (services/brocardi_scraper.py); never fetched",
    "www.brocardi.it": "the switched-off Brocardi tables (tools/map.py); never fetched",
    "www.normattiva.it.evil.com": (
        "appears only inside the comment in services/pdfextractor.py explaining "
        "why the SSRF guard compares hosts exactly"
    ),
    "docs.oasis-open.org": (
        "the Akoma Ntoso 3.0 XML namespace URI, named in the akn_parser "
        "docstring; the parser resolves nothing (no_network=True)"
    ),
    "visualex.org": (
        "the contact URL in the decision readers' User-Agent; sent as a header value, "
        "never fetched"
    ),
    "titrust.crt.sectigo.com": (
        "the AIA URI named in tools/tls.py's rotation procedure; read by hand, never "
        "fetched at run time"
    ),
    "www.cortecostituzionale.it": (
        "the page of a Corte costituzionale decision: a link the reader's browser opens; "
        "never fetched by the server"
    ),
    "github.com": "appears only in massimario_portal.USER_AGENT, which names the project; never fetched",
    "www.w3.org": (
        "XML names, never fetched: the XML Schema datatype IRIs (xsd:gYear, xsd:string) inside the "
        "CGUE reader's SPARQL query (decisions/curia.py), the OWL namespace of the query that lists the "
        "Union's decisions citing an article (decisions/eu_case_law.py) and the HTML namespace of the administrative "
        "courts' documents (decisions/giustizia_amministrativa.py)"
    ),
}


def is_allowed(url: str) -> bool:
    """True when `url`'s host is one the running server may contact."""
    try:
        return (urlparse(url).hostname or "") in ALLOWED_HOSTS
    except ValueError:
        return False
