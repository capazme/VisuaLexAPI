"""Decisions of the Consiglio di Stato, the C.G.A.R.S. and the TAR from giustizia-amministrativa.it:
the search and the text only (design note of 12 October 2026, waiting for the owner's D1–D5).

Nothing here is an identity or a route yet: the identity of these decisions (kind, number, year,
and the seat for a TAR) waits for the owner's answers, and no route reads them.

- **The search** is the portal's «Decisioni e pareri» form (a Liferay portlet). A server can post
  it: one `GET` of the page gives the session cookie and the form, with its anti-forgery token in
  the action and its fields named after a portlet instance. Both are read from the page every
  time, never written here: the site can change them, and a page where the form is not found is
  an error (`fonte_non_raggiungibile` for a route), never «not found».
- **The answer** lists every measure with that number and year at that seat: the Consiglio di
  Stato numbers each kind in its own series (n. 2270/2019 is a sentenza, an ordinanza cautelare
  and a parere), so a row carries its kind, section, case number (NRG), ECLI and document link.
- **The document** is XML (the court's own `GA` schema): `epigrafe`, `premessa`, `motivazione`,
  `dispositivo`, `sottoscrizioni`, each of `h:div` lines, plus `…Ted` twins for the German
  version of the Bolzano section, left out. Read with the network off and no DTD: the document
  names one on a private address.

Text contract (root rule 23), from the day notes can be stored on it: each `h:div` is a line, runs
of ASCII whitespace become one space, nothing else changes; the metadata block is not text.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup
from lxml import etree

from .http import decisions_http_client, http_headers

SEARCH_PAGE = "https://www.giustizia-amministrativa.it/web/guest/dcsnprr"
_SEARCH_HOST = "www.giustizia-amministrativa.it"
_DOCUMENT_HOST = "mdp.giustizia-amministrativa.it"
_TIMEOUT = 20

_FIELD = re.compile(r'name="(_decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_[A-Za-z0-9]{1,40}_)numeroProvvedimenti"')
_NUMBER = re.compile(r"^(\d{4})(\d{5})$")
_HTML_NS = "http://www.w3.org/HTML/1998/html4"
_WS = re.compile(r"[ \t\r\n\f\v]+")


class SourceChanged(ValueError):
    """The page is not what the reader knows: never read as «nothing found»."""


@dataclass(frozen=True)
class SearchForm:
    action: str
    prefix: str


@dataclass(frozen=True)
class Result:
    """One measure the search lists."""
    kind: str            # as the portal writes it: «SENTENZA», «ORDINANZA CAUTELARE», …
    sede: str            # «CONSIGLIO DI STATO», a TAR's seat
    sezione: str | None  # «SEZIONE 6»
    anno: int
    numero: int
    nrg: str | None      # the case's general register number
    ecli: str | None
    url: str             # the document, on mdp.giustizia-amministrativa.it


def read_search_form(page: str) -> SearchForm:
    """The form's action (with its token) and its fields' prefix, from the search page."""
    soup = BeautifulSoup(page, "lxml")
    form = soup.find("form", class_="form-provvedimenti")
    field = _FIELD.search(page)
    if form is None or not form.get("action") or field is None:
        raise SourceChanged("giustizia-amministrativa: modulo di ricerca non trovato")
    action = html.unescape(form["action"])
    parsed = urlparse(action)
    if parsed.scheme != "https" or parsed.hostname != _SEARCH_HOST or "p_auth=" not in parsed.query:
        raise SourceChanged("giustizia-amministrativa: azione del modulo inattesa")
    return SearchForm(action, field.group(1))


def search_fields(form: SearchForm, sede: str, numero: int, anno: int) -> dict[str, str]:
    """The fields of a search by seat, number and year (the mode «provv»: without it the year is
    ignored and every year's measure with that number comes back)."""
    p = form.prefix
    return {
        f"{p}sedeProvvedimenti": sede,
        f"{p}numeroProvvedimenti": str(int(numero)),
        f"{p}DataYearItem": str(int(anno)),
        f"{p}isAdvancedSearch": "false",
        f"{p}asSearchMode": "provv",
        f"{p}searchModeRadio": "provv",
        f"{p}pageSize": "60",
        f"{p}findBtn": "true",
    }


def _bold(text: str, label: str) -> str | None:
    m = re.search(re.escape(label) + r"\s*<b>([^<]{1,80})</b>", text)
    return html.unescape(m.group(1)).strip() if m else None


def read_results(page: str) -> list[Result]:
    """Every measure the answer lists. A page with no result list at all is a changed source."""
    if "ricerca--item" not in page and "Nessun risultato" not in page and "nessun risultato" not in page:
        raise SourceChanged("giustizia-amministrativa: pagina dei risultati non riconosciuta")
    results = []
    for article in BeautifulSoup(page, "lxml").find_all("article", class_="ricerca--item"):
        link = next((a["href"] for a in article.find_all("a", href=True)
                     if urlparse(a["href"]).hostname == _DOCUMENT_HOST), None)
        markup = str(article)
        first = article.find("b")
        number = _bold(markup, "numero provv.:")
        m = _NUMBER.match(number or "")
        if link is None or first is None or m is None:
            continue
        ecli = next((b.get_text(strip=True) for b in article.find_all("b")
                     if b.get_text(strip=True).startswith("ECLI:")), None)
        results.append(Result(
            kind=first.get_text(" ", strip=True),
            sede=_bold(markup, "sede di") or "",
            sezione=_bold(markup, "sezione"),
            anno=int(m.group(1)), numero=int(m.group(2)),
            nrg=_bold(markup, "Numero ricorso:"),
            ecli=ecli,
            url=html.unescape(link),
        ))
    return results


def document_format(url: str) -> str | None:
    """«html» or «pdf», from the document link's file name."""
    name = parse_qs(urlparse(url).query).get("nomeFile", [""])[0]
    return name.rsplit(".", 1)[-1].lower() if "." in name else None


def _lines(element: etree._Element) -> list[str]:
    out = []
    for div in element.iter(f"{{{_HTML_NS}}}div"):
        if any(isinstance(a.tag, str) and a.tag.endswith("Ted") for a in div.iterancestors()):
            continue  # the German twin of the Bolzano section
        line = _WS.sub(" ", "".join(div.itertext())).strip()
        if line:
            out.append(line)
    return out


_BLOCKS = (("epigrafe", ("epigrafe",)), ("motivazione", ("premessa", "motivazione")),
           ("dispositivo", ("dispositivo", "sottoscrizioni")))


def text_from_document(document: bytes | str) -> dict[str, str]:
    """The decision's blocks from the court's XML; the German twins (`…Ted`) and the metadata left out."""
    data = document.encode("utf-8") if isinstance(document, str) else document
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, recover=True, huge_tree=False)
    root = etree.fromstring(data, parser)
    if root is None:
        raise SourceChanged("giustizia-amministrativa: documento non leggibile")
    provvedimento = root.find("Provvedimento")
    if provvedimento is None:
        raise SourceChanged("giustizia-amministrativa: documento senza provvedimento")
    blocks = {}
    for block, tags in _BLOCKS:
        lines = [line for tag in tags for element in provvedimento.findall(tag) for line in _lines(element)]
        if lines:
            blocks[block] = "\n\n".join(lines)
    return blocks


class GiustiziaAmministrativaReader:
    """Three requests a lookup: the search page, the search, the document."""

    async def search(self, sede: str, numero: int, anno: int) -> list[Result]:
        page = await decisions_http_client.request(
            "GET", SEARCH_PAGE, source="giustizia_amministrativa", timeout=_TIMEOUT, max_retries=1,
            headers=http_headers())
        form = read_search_form(page.text)
        answer = await decisions_http_client.request(
            "POST", form.action, source="giustizia_amministrativa", timeout=_TIMEOUT, max_retries=1,
            data=search_fields(form, sede, numero, anno), headers=http_headers())
        return read_results(answer.text)

    async def text(self, result: Result) -> dict[str, str]:
        """The decision's text; {} for a document that is not HTML (the newest are PDFs)."""
        if urlparse(result.url).hostname != _DOCUMENT_HOST or document_format(result.url) != "html":
            return {}
        answer = await decisions_http_client.request(
            "GET", result.url, source="giustizia_amministrativa", timeout=_TIMEOUT, max_retries=1,
            headers=http_headers({"Accept": "text/xml, application/xml"}))
        return text_from_document(answer.text)
