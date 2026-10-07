"""Corte di cassazione decisions from Italgiure's public archive (SentenzeWeb).

Recovered from the 2026-08-29 round (reverted for priorities, not for a defect) and fixed for
the lookup of one decision:
- the archive is a filter: civil and penal decisions are numbered in two series that overlap
  (n. 10787/2024 is Sez. III civile and Sez. VII penale);
- the number is queried zero-padded to five digits, as the index stores it: the bare form
  never matched (measured on 2026-10-02), so a lookup is one query per archive;
- the text comes back whole: `ocr` is the reasons and already ends with the dispositivo, which
  `ocrdis` repeats when the source has one (36 of the 36 sampled texts that have one, measured
  on 2026-10-04): `split_dispositivo` cuts it off the end of the reasons, so the decision reads
  once. A dispositivo that the text holds elsewhere, or only inside a word, is dropped, one it
  does not hold stays as the source gave it, and without an `ocrdis` the dispositivo stays at
  the end of the reasons.
- a decision whose text the source withholds comes back with the source's own notice as its
  text, while personal data are being removed: "La sentenza richiesta è in fase di
  oscuramento" (`testo_assente` "oscuramento"), "in fase di valutazione oscuramento"
  (`testo_assente` "valutazione_oscuramento"), and rarely a stub such as "Oscuramento disposto
  Numero registro generale …" (no cause). A text of at most 300 characters that mentions
  "oscuramento" is never the court's text: the decision is returned without one. A record with
  neither a text nor a notice is returned without a text and without a cause, and logged: the
  source said nothing about why.
- the text comes from the court's original PDF (`pdf_text`) when the record has one and the PDF
  can be had: the field is cut short at the source in about a third of the records. When it
  cannot (no `filename`, a request that fails, a PDF refused, a text that is not the field's
  decision), the field's text stands, `testo_origine` says "archivio" and the resolver says so.
- the field's text arrives as one line (measured on 2026-10-04: 45 of 45 sampled texts, up to 82,322
  characters). `paragraphs` restores the paragraphs by inserting blank lines before the
  headings, "P.Q.M." and the numbered points, and changes nothing else: a note anchored to the
  text never moves.

- no homepage first: a cold Solr select answers by itself and sets the session cookie, while
  the homepage timed out for 20-25 s about one time in two (measured on 2026-10-07). The
  homepage is fetched only after an answer that is not JSON, and the query is sent once more.

The archive is a moving window (in 2026 it starts in 2021); its start is read from the
archive, never written here.
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass

import aiohttp
import structlog

from ...tools.exceptions import DocumentNotFoundError, NetworkError
from ...tools.tls import italgiure_ssl_context
from .http import decisions_http_client, http_headers
from .model import Decision, Identity
from .pdf_text import MAX_BYTES, PdfRefused, read_decision_pdf_async
from .search import IndexCoordinates, cites

log = structlog.get_logger()

BASE = "https://www.italgiure.giustizia.it/sncass"
SELECT = f"{BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
KINDS = {"civile": "snciv", "penale": "snpen"}
FIELDS = "id,numdec,anno,datdep,szdec,materia,tipoprov,ocr,ocrdis,relatore,presidente,kind,filename"
ATTACH = "https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll"
SOURCE = {"nome": "Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)"}
# `tipoprov` holds a code or a label, depending on the record
TIPI = {"s": "sentenza", "sentenza": "sentenza", "o": "ordinanza", "ordinanza": "ordinanza",
        "ordinanza interlocutoria": "ordinanza interlocutoria", "d": "decreto",
        "decreto": "decreto"}
# Italgiure's stand-ins for a text it withholds while personal data are removed (counted on
# 2026-10-04, archive-wide): «La sentenza richiesta è in fase di oscuramento» (10,789 civil and
# 32,898 penal records), «in fase di valutazione oscuramento» (21,168 civil and 17,175 penal),
# and rarely a stub such as «Oscuramento disposto Numero registro generale …». A real text is
# never this short; the bound keeps a real text that discusses obscuring.
_WITHHELD_MAX = 300
_WITHHELD_CAUSES = (("in fase di valutazione oscuramento", "valutazione_oscuramento"),
                    ("in fase di oscuramento", "oscuramento"))

# The fallback checks (plan Task 2 amendment, measured on 36 decisions, all of which pass): the
# PDF's text is at least this share of the field's length (the field keeps every page's running
# header and footer, so a long decision's PDF text is shorter: 0.761 at 27 pages), and the field's
# first words share a longest common subsequence of this many with the PDF's first words (the
# field is cut at its front too, so a greedy in-order scan would miss).
# The PDF step has a budget of its own, so a slow PDF falls back to the field instead of using up
# the resolver's ITALGIURE_TIMEOUT (25 s) and turning a decision the record already gave into
# "source unreachable": request (one try) + parse fit in PDF_STEP_TIMEOUT, which leaves at least
# 10 s of the 25 for the Solr query.
PDF_REQUEST_TIMEOUT, PDF_RETRIES, PDF_PARSE_TIMEOUT, PDF_STEP_TIMEOUT = 8.0, 0, 6.0, 15.0
MIN_LENGTH_RATIO = 0.70
FIELD_WORDS, PDF_WORDS, MIN_COMMON_WORDS = 20, 250, 10

# Italgiure's text arrives as one line (measured on 2026-10-04: 45 of 45 sampled texts, up to
# 82,322 characters). Paragraphs are restored by inserting blank lines and nothing else: a note
# anchored to the text never moves (line breaks are invisible to anchors, gotcha 23), and the
# rule can be refined later without moving one.
_HEADINGS = ("RITENUTO IN FATTO", "CONSIDERATO IN DIRITTO", "FATTI DI CAUSA", "RAGIONI DELLA DECISIONE",
             "MOTIVI DELLA DECISIONE", "SVOLGIMENTO DEL PROCESSO", "RILEVATO CHE", "CONSIDERATO CHE",
             "RITENUTO CHE", "PREMESSO CHE", "OSSERVA")
# «RITENUTO IN FATTO E CONSIDERATO IN DIRITTO» is one heading: no break after its «E» (or «e»)
_HEADING = re.compile(r"(?<![A-Za-zÀ-ÿ])(?<!\b[Ee] )(?:" + "|".join(re.escape(h) for h in _HEADINGS)
                      + r")(?![A-Za-zÀ-ÿ])")
_LEAD = re.compile(r"(?<=[.;:!?»”\"] )(?:Rilevato che|Considerato che|Ritenuto che|Premesso che|"
                   r"Osserva|Rileva)\s?[:,]")
_PQM = re.compile(r"(?<![A-Za-z])P\.\s?Q\.\s?M\.?")
_POINT = re.compile(r"(?<=[.;:!?»”\"] )\d{1,2}(?:\.\d{1,2}){0,3}\.?\s?(?:[-–]\s?)?(?=[A-ZÀ-Ý«])")
# words after which a number is part of a citation, not a numbered point
_BEFORE_NUMBER = frozenset({"art", "artt", "n", "nn", "co", "comma", "lett", "pag", "pagg", "par",
                            "cap", "sez", "cfr", "v", "vol", "p", "pp", "nota", "tab", "all", "doc"})


def paragraphs(text: str) -> str:
    """The text with a blank line before each heading, «P.Q.M.» and numbered point that starts a
    sentence; nothing else changes: without its line breaks it is the text without its line
    breaks. A combined heading («… E CONSIDERATO IN DIRITTO») stays one, and a numbered point
    keeps the words it opens: no break between «3.» and the «P.Q.M.» or heading right after it."""
    cuts = {m.start() for regex in (_HEADING, _LEAD, _PQM) for m in regex.finditer(text)}
    points = []
    for m in _POINT.finditer(text):
        # only the last word before the number matters, so look back over a window: copying all
        # the text before each candidate was quadratic (1 MB of candidates took about 4 s)
        word = text[max(0, m.start() - 60):m.start()].rstrip().rsplit(" ", 1)[-1].rstrip(".").lower()
        if re.split(r"['’]", word)[-1] not in _BEFORE_NUMBER:  # «dell'art.» is «art.»
            points.append(m)
    cuts |= {m.start() for m in points}
    cuts -= {m.end() for m in points}  # a point's label stays with its words: «3. P.Q.M.»
    cuts.discard(0)
    pieces, last = [], 0
    for cut in sorted(cuts):
        pieces += [text[last:cut], "\n\n"]
        last = cut
    pieces.append(text[last:])
    return "".join(pieces)


def split_dispositivo(text: str, dispositivo: str) -> tuple[str, str]:
    """`ocr` already ends with the dispositivo that `ocrdis` repeats: it is cut off the text, so
    the decision reads once. Whitespace aside, the end of the text must equal the dispositivo and
    start a word (a cut never falls inside one); the dispositivo returned is that end of the text,
    so every character comes from one source. A dispositivo the text holds elsewhere, or only
    inside a word, is dropped; one it does not hold stays as given."""
    tail = "".join(dispositivo.split())
    if not tail:
        return text, ""
    flat = "".join(text.split())
    if flat.endswith(tail) and len(flat) > len(tail):
        left, cut = len(tail), len(text)
        while left:
            cut -= 1
            if not text[cut].isspace():
                left -= 1
        if cut == 0 or text[cut - 1].isspace():  # a cut never falls inside a word
            return text[:cut].rstrip(), text[cut:]
    return (text, "") if tail in flat else (text, dispositivo)


def pdf_url(doc: dict) -> str | None:
    """The court's PDF of a record, in the form the archive serves within its session (the plain
    `.pdf` name answers 500, measured on 2026-10-05). A name that carries the number and the year
    (`@n26034`, `@a2026`) must carry the record's own, else there is no PDF."""
    name = _scalar(doc.get("filename")).strip()
    kind = _scalar(doc.get("kind")).strip()
    if (not re.fullmatch(r"\./[0-9]{8}/sn(?:civ|pen)@[A-Za-z0-9_@]+\.pdf", name)
            or kind not in KINDS.values()):
        return None
    for tag, field in (("n", "numdec"), ("a", "anno")):
        m = re.search(rf"@{tag}([0-9]+)(?=@|\.)", name)
        value = _scalar(doc.get(field)).strip()
        if m and (not value.isascii() or not value.isdigit() or int(m.group(1)) != int(value)):
            return None
    return f"{ATTACH}?verbo=attach&db={kind}&id={name[:-4]}.clean.pdf"


def _words(text: dict[str, str]) -> list[str]:
    return " ".join(text.values()).split()


def _common_words(a: list[str], b: list[str]) -> int:
    """Length of the longest common subsequence of two word lists, case aside."""
    row = [0] * (len(b) + 1)
    for x in a:
        prev, row[0] = 0, 0
        for j, y in enumerate(b, 1):
            prev, row[j] = row[j], (prev + 1 if x.casefold() == y.casefold() else max(row[j], row[j - 1]))
    return row[-1]


def _plausible(pdf: dict[str, str], field: dict[str, str]) -> str | None:
    """None when the PDF's text is the field's decision, else which check failed."""
    pdf_words, field_words = _words(pdf), _words(field)
    if len(" ".join(pdf_words)) < MIN_LENGTH_RATIO * len(" ".join(field_words)):
        return "text shorter than the archive's"
    if _common_words(field_words[:FIELD_WORDS], pdf_words[:PDF_WORDS]) < MIN_COMMON_WORDS:
        return "opening words differ from the archive's"
    return None


class SourceAnswerError(Exception):
    """Italgiure answered with something that is not its JSON (an anti-bot or error page)."""


def _scalar(value: object) -> str:
    # Solr answers some single-valued fields as one-element lists (`datdep`, measured)
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return "" if value is None else str(value)


def _text(value: object) -> str:
    # never cut: a multi-valued text field is joined, not reduced to its first value
    if isinstance(value, list):
        return "\n".join(str(v) for v in value)
    return "" if value is None else str(value)


def _iso(raw: str) -> str | None:
    m = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})", raw.strip())
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def to_summary(doc: dict, archivio: str) -> tuple[Identity, dict]:
    """The identity and the attributes a record carries without its text, read once for the
    lookup and for the search. ValueError for a record without a readable number or year."""
    identity = Identity("cassazione", int(_scalar(doc.get("numdec"))),
                        int(_scalar(doc.get("anno"))), archivio)
    attributes = {
        "sezione": _scalar(doc.get("szdec")).strip().upper() or None,
        "tipo": TIPI.get(_scalar(doc.get("tipoprov")).strip().lower()),
        "data_deposito": _iso(_scalar(doc.get("datdep"))),
        "relatore": _scalar(doc.get("relatore")).strip() or None,
        "presidente": _scalar(doc.get("presidente")).strip() or None,
        "materia": _scalar(doc.get("materia")).strip() or None,
    }
    return identity, attributes


def to_decision(doc: dict, archivio: str) -> Decision:
    identity, attributes = to_summary(doc, archivio)
    motivazione = _text(doc.get("ocr")).strip()
    flat = " ".join(motivazione.lower().split())
    testo_assente = None
    if len(flat) <= _WITHHELD_MAX and "oscuramento" in flat:
        testo: dict[str, str] = {}  # the source's notice, not the court's text
        testo_assente = next((cause for phrase, cause in _WITHHELD_CAUSES if phrase in flat), None)
    else:
        motivazione, dispositivo = split_dispositivo(motivazione, _text(doc.get("ocrdis")).strip())
        testo = {key: paragraphs(value) for key, value in (
            ("motivazione", motivazione), ("dispositivo", dispositivo)) if value}
    decision = Decision(
        identita=identity,
        **attributes,
        testo_assente=testo_assente,
        testo=testo,
        fonte=dict(SOURCE),
    )
    if not testo and not flat:
        # no text and no notice (a missing `ocr`, a renamed field): never presented as the
        # source's anonymisation
        log.warning("Italgiure record without text", id=_scalar(doc.get("id")))
    return decision


SEARCH_FIELDS = "id,numdec,anno,datdep,szdec,tipoprov,kind"
INDEX_FIELDS = ",rnc-gen,rnc-art,rnc-sp,rnc-num,rnc-dat"
_KIND_ARCHIVE = {kind: archivio for archivio, kind in KINDS.items()}
_EM_SPLIT = re.compile(r"(</?em>)", re.IGNORECASE)


@dataclass(frozen=True)
class SearchHit:
    identita: Identity
    attributi: dict
    trovata: str          # "indice" | "testo"
    frammento: dict | None


@dataclass(frozen=True)
class SearchPage:
    """One page of a search. `totale` is Solr's `numFound`: in index mode it counts records the
    re-check of the citation (`cites`) may still drop from the page (about 2% measured), so it can
    exceed the decisions the pages hold in all; a client ends the list by `totale`, not by rows."""
    totale: int
    decisioni: list[SearchHit]


def fragment_ranges(snippet: str) -> dict:
    """Solr's highlighted fragment as plain text and the ranges to emphasise: the client never
    receives markup from the source (design 2026-10-05 §5.1). Only <em> marks a range; any other
    markup stays as literal characters. Offsets count Python code points: the web client must
    convert them for characters outside the BMP (JavaScript counts UTF-16 units). Empty ranges
    and a marker with no partner are dropped."""
    text, ranges, start, pos = [], [], None, 0
    for piece in _EM_SPLIT.split(snippet):
        if piece.lower() == "<em>":
            start = pos
        elif piece.lower() == "</em>":
            if start is not None and pos > start:
                ranges.append([start, pos])
            start = None
        else:
            text.append(piece)
            pos += len(piece)
    return {"testo": "".join(text), "evidenziati": ranges}


class ItalgiureReader:
    def __init__(self) -> None:
        # No homepage GET in the normal path: measured on 2026-10-07 the homepage times out for
        # 20-25 s about one time in two, a cold Solr select answers in about 1.2 s and sets the
        # session cookie itself, and a PDF fetched in the same client session answers in 0.1 s.
        # The homepage is fetched only after an answer that is not JSON (an anti-bot page), once
        # for all the requests that met it: the generation counts the reopenings.
        self._reopen_lock = asyncio.Lock()
        self._generation = 0

    async def _reopen_session(self, generation: int, ctx) -> None:
        async with self._reopen_lock:
            if self._generation != generation:
                return  # another request reopened the session after this one was sent
            try:
                await decisions_http_client.request("GET", f"{BASE}/", source="italgiure", ssl=ctx,
                                                    headers=http_headers())
            except (NetworkError, DocumentNotFoundError, OSError, asyncio.TimeoutError,
                    aiohttp.ClientError) as exc:
                # the homepage often times out (2026-10-07) and the select sets the cookie
                # itself: the retry goes ahead, and the attempt counts for the requests queued
                log.warning("Italgiure homepage not fetched", error=type(exc).__name__)
            finally:
                self._generation += 1

    async def _post(self, params: dict[str, str], ctx) -> dict | None:
        """Solr's answer, None when the body is not JSON; SourceAnswerError for JSON of another shape."""
        result = await decisions_http_client.request(
            "POST", SELECT, source="italgiure", ssl=ctx, data={**params, "wt": "json"},
            headers=http_headers({"Referer": f"{BASE}/", "X-Requested-With": "XMLHttpRequest"}))
        try:
            data = json.loads(result.text)
        except json.JSONDecodeError:
            return None
        response = data.get("response") if isinstance(data, dict) else None
        docs = response.get("docs") if isinstance(response, dict) else None
        if not isinstance(docs, list) or not all(isinstance(doc, dict) for doc in docs):
            # a 200 that is not Solr's answer (an error object, null, a list): never "absent"
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati")
        return data

    async def _select(self, params: dict[str, str]) -> dict:
        ctx = italgiure_ssl_context()
        generation = self._generation
        data = await self._post(params, ctx)
        if data is None:  # an anti-bot page: reopen the session once and ask again once
            await self._reopen_session(generation, ctx)
            data = await self._post(params, ctx)
            if data is None:
                raise SourceAnswerError("Italgiure non ha risposto con i suoi dati")
        return data

    async def record(self, archivio: str, numero: int, anno: int) -> dict | None:
        """The archive's record of one decision (one Solr query), None if it has none."""
        data = await self._select({
            "q": f'kind:"{KINDS[archivio]}" AND numdec:{numero:05d} AND anno:{anno}',
            "rows": "1", "fl": FIELDS})
        docs = data.get("response", {}).get("docs", [])
        return docs[0] if docs else None

    async def fetch_pdf(self, url: str) -> bytes:
        """The bytes of a PDF at `pdf_url`'s address, in the client session the record's query
        opened (the archive refuses the attachment outside it). One try, within its own budget.
        PdfRefused for an answer that is not a 200; network errors propagate."""
        result = await decisions_http_client.request(
            "GET", url, source="italgiure", ssl=italgiure_ssl_context(),
            headers=http_headers({"Referer": f"{BASE}/"}), text_encoding="latin-1",
            max_retries=PDF_RETRIES, timeout=aiohttp.ClientTimeout(total=PDF_REQUEST_TIMEOUT))
        if result.status != 200:
            raise PdfRefused(f"PDF request answered {result.status}")
        return result.text.encode("latin-1")

    async def original_pdf(self, archivio: str, numero: int, anno: int) -> bytes | None:
        """The court's own PDF of a decision, for the user to download; None when there is none
        to give: no record, a text the source withholds, no usable filename, an answer that is
        not a PDF (or is over MAX_BYTES), or a PDF whose header names another decision. The
        record is read first because the archive serves the attachment only within the session
        its query opens. Source errors propagate (an unreachable court is not "no PDF")."""
        doc = await self.record(archivio, numero, anno)
        if doc is None:
            return None
        try:
            decision = to_decision(doc, archivio)
        except ValueError as exc:
            raise SourceAnswerError(
                "Italgiure ha risposto con una decisione illeggibile") from exc
        ident = decision.identita
        if (ident.numero, ident.anno) != (numero, anno) or not decision.testo:
            return None  # another decision, or withheld: there is no PDF to give
        url = pdf_url(doc)
        if url is None:
            return None
        try:
            data = await self.fetch_pdf(url)
        except (PdfRefused, DocumentNotFoundError):
            return None
        if not data.startswith(b"%PDF-") or len(data) > MAX_BYTES:
            return None
        try:
            _, header = await read_decision_pdf_async(data, PDF_PARSE_TIMEOUT)
        except PdfRefused as exc:
            if exc.kind != "unreadable":
                # a damaged file (cut short, corrupt): never served as the court's
                log.warning("Original PDF damaged", key=ident.key(), reason=str(exc))
                return None
            # a file with nothing to read the header from (no text layer, too many pages, too
            # slow): nothing contradicts the record and the filename, which were checked
            log.warning("Original PDF header not read", key=ident.key(), reason=str(exc))
            header = None
        if header is not None and header != (numero, anno):
            log.warning("Original PDF names another decision", key=ident.key())
            return None
        return data

    async def lookup(self, archivio: str, numero: int, anno: int) -> Decision | None:
        found = await self.lookup_with_pdf(archivio, numero, anno)
        return found[0] if found else None

    async def lookup_with_pdf(self, archivio: str, numero: int, anno: int,
                              with_pdf: bool = True) -> tuple[Decision, bytes | None] | None:
        """The decision and, when its text was read from it, the court's PDF. `with_pdf=False`
        reads the record only (a suggestion shows an identity, not a text)."""
        # a cold lookup is one Solr query and the PDF: a search stays within the owner's 10
        # requests (2026-10-04)
        doc = await self.record(archivio, numero, anno)
        if doc is None:
            return None
        try:
            decision = to_decision(doc, archivio)
        except ValueError as exc:  # a record without a readable number or year
            raise SourceAnswerError(
                "Italgiure ha risposto con una decisione illeggibile") from exc
        if not with_pdf:
            return decision, None
        if not decision.testo:  # withheld, or no text: there is no PDF to read
            return decision, None
        try:
            data_pdf, reason = await asyncio.wait_for(
                self._read_pdf(doc, decision), PDF_STEP_TIMEOUT)
        except asyncio.TimeoutError:
            data_pdf, reason = None, "PDF step timed out"
        if data_pdf is None:
            log.warning("Decision read from the archive's text, not the PDF",
                        key=decision.identita.key(), reason=reason)
            decision.testo_origine = "archivio"
            return decision, None
        return decision, data_pdf

    async def _read_pdf(self, doc: dict, decision: Decision) -> tuple[bytes | None, str]:
        """The PDF's bytes once its text is in `decision`, else (None, why not)."""
        url = pdf_url(doc)
        if url is None:
            return None, "no usable filename"
        try:
            data = await self.fetch_pdf(url)
            text, header = await read_decision_pdf_async(data, PDF_PARSE_TIMEOUT)
        except PdfRefused as exc:
            return None, f"PDF refused: {exc}"
        except (NetworkError, DocumentNotFoundError, OSError) as exc:
            return None, f"PDF request failed: {type(exc).__name__}"
        ident = decision.identita
        if header is not None and header != (ident.numero, ident.anno):
            return None, "header names another decision"
        failed = _plausible(text, decision.testo)
        if failed:
            return None, failed
        decision.testo, decision.testo_origine = text, "pdf"
        return data, ""

    async def archive_start(self, archivio: str) -> tuple[int, str] | None:
        data = await self._select({"q": f'kind:"{KINDS[archivio]}"', "rows": "1",
                                   "sort": "pd asc", "fl": "id,anno,datdep,kind"})
        docs = data.get("response", {}).get("docs", [])
        iso = _iso(_scalar(docs[0].get("datdep"))) if docs else None
        return (int(iso[:4]), iso) if iso else None

    async def search(self, q: str, pagina: int, rows: int = 20, *,
                     coords: IndexCoordinates | None = None, hl_query: str | None = None) -> SearchPage:
        """One Solr query for a page, sorted by deposit; the fragments are highlighted from the
        text. With `coords` the records are index matches and each is re-checked with `cites`."""
        params = {
            "q": q, "rows": str(rows), "start": str((pagina - 1) * rows),
            "fl": SEARCH_FIELDS + (INDEX_FIELDS if coords else ""),
            "sort": "pd desc", "hl": "true", "hl.fl": "ocr", "hl.snippets": "1",
            "hl.fragsize": "200"}
        if hl_query:
            params["hl.q"] = hl_query
        data = await self._select(params)
        highlights = data.get("highlighting") or {}
        hits = []
        for doc in data["response"]["docs"]:
            archivio = _KIND_ARCHIVE.get(_scalar(doc.get("kind")))
            if archivio is None:
                continue
            try:
                identity, attributes = to_summary(doc, archivio)
            except ValueError:
                continue  # a record without a readable number or year is skipped, as a lookup refuses it
            if coords is not None and not cites(doc, coords):
                continue  # matched two different citations of the record (design §5.2)
            snippet = (highlights.get(_scalar(doc.get("id"))) or {}).get("ocr")
            hits.append(SearchHit(identity, {k: v for k, v in attributes.items() if v},
                                  "indice" if coords else "testo",
                                  fragment_ranges(_scalar(snippet)) if snippet else None))
        return SearchPage(int(data["response"].get("numFound") or 0), hits)
