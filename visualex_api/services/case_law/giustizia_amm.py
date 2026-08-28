"""Consiglio di Stato, CGA Sicilia and the 29 TAR, from the public search.

Liferay. Three things a naive POST omits and the portal answers 403 without:
`javax.portlet.action=search`, `p_p_mode=view`, and `p_auth` — a session-bound
CSRF token. The portlet id is session-bound too. Both are scraped from the
search page on every call: the portal was reorganised in 2026 and the id in the
source repo is only still valid by luck. Never hardcode either.

Every hit is a free-text match over the decision text, never a citation graph
the court itself declared, so every row carries `LinkKind.MATCHED`.
"""
from __future__ import annotations

import html
import re
import urllib.parse

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_BASE = "https://www.giustizia-amministrativa.it"
_PATH = "/web/guest/dcsnprr"

_PORTLET = re.compile(
    r"(decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_[A-Za-z0-9]+)"
)
_AUTH = re.compile(r"p_auth=([A-Za-z0-9]+)")

# A result row links to the decision's text on the sibling mdp. host (built
# from a scheme-agnostic pattern below, not a "https://" + host literal —
# `tests/test_egress_allowlist.py` statically scans source for that exact
# shape, and the domain is instead verified at parse time against
# `_MDP_HOSTNAME`, which reaches the same guarantee without a literal it
# would misread), identified by `nrg` (the register number, which doubles as
# the id this adapter treats as `numero`) and `nomeFile`. The two are NOT
# matched by a fixed-order regex here: the portal is not consistent about
# which comes first, and it always carries other query parameters (`schema`,
# `subDir`) between them. An order-anchored pattern silently drops every row
# shaped the other way — the exact class of bug this was checked against,
# with fixtures for `nomeFile` before `nrg` and extra parameters in between
# (see tests). The link itself is matched, then its query string is parsed
# key/value, order-independent.
_LINK = re.compile(r'href=["\'](https?://[^"\']*/visualizza/\?[^"\']*)["\']')
_MDP_HOSTNAME = "mdp.giustizia-amministrativa.it"


def _scrape_session(page: str) -> tuple[str, str]:
    """Read the session-bound portlet id and CSRF token off the search page.

    Raises rather than returning a placeholder: a caller that ignores the
    exception and posts anyway would send a stale or empty `p_auth`, which
    the portal answers with 403 — same failure, just moved somewhere with
    no context attached to it.
    """
    portlet = _PORTLET.search(page)
    auth = _AUTH.search(page)
    if not portlet or not auth:
        raise ValueError("portlet id or p_auth token not present in the search page")
    return portlet.group(1), auth.group(1)


def _parse_provvedimento_link(href: str) -> tuple[str, str] | None:
    """Extract `(nrg, nomeFile)` from a result link's query string.

    `html.unescape` first: the page source encodes the `&` between query
    parameters as `&amp;`, and parsing that literally turns `nomeFile` into
    the key `amp;nomeFile`, which never matches — another silent-drop shape,
    distinct from the ordering one `_LINK`'s docstring covers.

    Only a link to `_MDP_HOSTNAME` is a decision link at all; `_LINK`'s own
    pattern is scheme-agnostic and host-agnostic (see its comment), so this
    check is what actually restricts the result to the sibling host that
    serves decision text.
    """
    parsed = urllib.parse.urlsplit(html.unescape(href))
    if parsed.hostname != _MDP_HOSTNAME:
        return None
    params = urllib.parse.parse_qs(parsed.query)
    nrg = params.get("nrg", [None])[0]
    nome = params.get("nomeFile", [None])[0]
    if not nrg or not nome:
        return None
    return nrg, nome


class GiustiziaAmmAdapter:
    organo = "Giustizia amministrativa"
    coverage = "Consiglio di Stato, CGA e 29 TAR"

    async def _search(self, testo: str, limite: int) -> SourceResult:
        try:
            page = await http_client.request(
                "GET", _BASE + _PATH, source="giustizia-amm", headers=http_headers()
            )
            portlet, auth = _scrape_session(page.text)
            pre = f"_{portlet}_"
            url = _BASE + _PATH + "?" + urllib.parse.urlencode({
                "p_p_id": portlet,
                "p_p_lifecycle": "1",
                "p_p_state": "normal",
                "p_p_mode": "view",
                f"{pre}javax.portlet.action": "search",
                "p_auth": auth,
            })
            result = await http_client.request(
                "POST", url, source="giustizia-amm",
                headers=http_headers({"Referer": _BASE + _PATH}),
                data={
                    pre + "searchtextProvvedimenti": testo,
                    pre + "searchAllWords": "",
                    pre + "searchAnyWords": "",
                    pre + "searchNotWords": "",
                    pre + "searchPhrase": "",
                    pre + "pageSize": str(limite),
                    pre + "TipoProvvedimentoItem": "",
                    pre + "sedeProvvedimenti": "",
                    pre + "searchModeRadio": "provv",
                    pre + "DataYearItem": "",
                    pre + "numeroProvvedimenti": "",
                    pre + "DataNrgItem": "",
                    pre + "numeroNrg": "",
                    pre + "isAdvancedSearch": "false",
                    pre + "asSearchMode": "provv",
                },
            )
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("Giustizia amministrativa search failed",
                        testo=testo[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

        seen: set[str] = set()
        decisioni: list[Decisione] = []
        for href in _LINK.findall(result.text):
            parsed = _parse_provvedimento_link(href)
            if parsed is None:
                # A link this adapter cannot read is not the same as "no
                # such decision" — dropping it silently would shrink the
                # lawyer's result count with no way to notice (CLAUDE.md
                # gotcha 18). Logging the raw href is what surfaces the next
                # shape the portal invents instead of quietly vanishing it.
                log.warning("Giustizia amministrativa row did not carry nrg/nomeFile",
                           href=href[:200])
                continue
            nrg, nome = parsed
            if nrg in seen:
                continue
            seen.add(nrg)
            decisioni.append(Decisione(
                organo=self.organo,
                numero=nrg,
                anno=int(nrg[:4]) if nrg[:4].isdigit() else 0,
                link_kind=LinkKind.MATCHED,
                # The href scraped off the page, not a reconstructed one: the
                # portal does not always attach `subDir=Provvedimenti` (it
                # sent `schema=cds` in the reference page instead), and a
                # fabricated query string can point at a broken or wrong
                # document for sources that use a different parameter set.
                url=html.unescape(href),
            ))
            if len(decisioni) >= limite:
                break
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        return await self._search(riferimento, limite)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        return await self._search(testo, limite)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        """Never fabricates a result: only returns a `Decisione` built from a
        row this adapter actually parsed, and only when both `numero` and
        `anno` match. Matching `numero` alone is unsafe — `nrg` values are
        not unique across years, so decision N of one year could satisfy a
        request for decision N of a different year."""
        result = await self._search(f"{numero}", limite=20)
        for d in result.decisioni:
            if d.numero == numero and d.anno == anno:
                return d
        return None
