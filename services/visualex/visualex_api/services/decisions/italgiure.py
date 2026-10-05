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

The archive is a moving window (in 2026 it starts in 2021); its start is read from the
archive, never written here.
"""
from __future__ import annotations

import json
import re

import structlog

from ...tools.exceptions import DocumentNotFoundError, NetworkError
from ...tools.tls import italgiure_ssl_context
from .http import decisions_http_client, http_headers
from .model import Decision, Identity
from .pdf_text import PdfRefused, text_from_pdf_async

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
    `.pdf` name answers 500, measured on 2026-10-05)."""
    name = _scalar(doc.get("filename")).strip()
    kind = _scalar(doc.get("kind")).strip()
    if not re.fullmatch(r"\./\d{8}/sn(?:civ|pen)@[\w@]+\.pdf", name) or kind not in KINDS.values():
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


def to_decision(doc: dict, archivio: str) -> Decision:
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
        identita=Identity("cassazione", int(_scalar(doc.get("numdec"))),
                          int(_scalar(doc.get("anno"))), archivio),
        sezione=_scalar(doc.get("szdec")).strip().upper() or None,
        tipo=TIPI.get(_scalar(doc.get("tipoprov")).strip().lower()),
        data_deposito=_iso(_scalar(doc.get("datdep"))),
        relatore=_scalar(doc.get("relatore")).strip() or None,
        presidente=_scalar(doc.get("presidente")).strip() or None,
        materia=_scalar(doc.get("materia")).strip() or None,
        testo_assente=testo_assente,
        testo=testo,
        fonte=dict(SOURCE),
    )
    if not testo and not flat:
        # no text and no notice (a missing `ocr`, a renamed field): never presented as the
        # source's anonymisation
        log.warning("Italgiure record without text", id=_scalar(doc.get("id")))
    return decision


class ItalgiureReader:
    async def _select(self, params: dict[str, str]) -> dict:
        ctx = italgiure_ssl_context()
        # The endpoint refuses a cold session: the homepage sets the cookie the client keeps.
        await decisions_http_client.request("GET", f"{BASE}/", source="italgiure", ssl=ctx,
                                            headers=http_headers())
        result = await decisions_http_client.request(
            "POST", SELECT, source="italgiure", ssl=ctx, data={**params, "wt": "json"},
            headers=http_headers({"Referer": f"{BASE}/", "X-Requested-With": "XMLHttpRequest"}))
        try:
            data = json.loads(result.text)
        except json.JSONDecodeError as exc:
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati") from exc
        response = data.get("response") if isinstance(data, dict) else None
        docs = response.get("docs") if isinstance(response, dict) else None
        if not isinstance(docs, list) or not all(isinstance(doc, dict) for doc in docs):
            # a 200 that is not Solr's answer (an error object, null, a list): never "absent"
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati")
        return data

    async def lookup(self, archivio: str, numero: int, anno: int) -> Decision | None:
        found = await self.lookup_with_pdf(archivio, numero, anno)
        return found[0] if found else None

    async def lookup_with_pdf(self, archivio: str, numero: int,
                              anno: int) -> tuple[Decision, bytes | None] | None:
        """The decision and, when its text was read from it, the court's PDF."""
        # a cold lookup is the homepage, one Solr query and the PDF: a search stays within the
        # owner's 10 requests (2026-10-04)
        data = await self._select({
            "q": f'kind:"{KINDS[archivio]}" AND numdec:{numero:05d} AND anno:{anno}',
            "rows": "1", "fl": FIELDS})
        docs = data.get("response", {}).get("docs", [])
        if not docs:
            return None
        try:
            decision = to_decision(docs[0], archivio)
        except ValueError as exc:  # a record without a readable number or year
            raise SourceAnswerError(
                "Italgiure ha risposto con una decisione illeggibile") from exc
        if not decision.testo:  # withheld, or no text: there is no PDF to read
            return decision, None
        data_pdf, reason = await self._read_pdf(docs[0], decision)
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
            result = await decisions_http_client.request(
                "GET", url, source="italgiure", ssl=italgiure_ssl_context(),
                headers=http_headers({"Referer": f"{BASE}/"}), text_encoding="latin-1")
            if result.status != 200:
                return None, f"PDF request answered {result.status}"
            data = result.text.encode("latin-1")
            text = await text_from_pdf_async(data)
        except PdfRefused as exc:
            return None, f"PDF refused: {exc}"
        except (NetworkError, DocumentNotFoundError, OSError) as exc:
            return None, f"PDF request failed: {type(exc).__name__}"
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
