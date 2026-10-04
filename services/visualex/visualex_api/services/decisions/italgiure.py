"""Corte di cassazione decisions from Italgiure's public archive (SentenzeWeb).

Recovered from the 2026-08-29 round (reverted for priorities, not for a defect) and fixed for
the lookup of one decision:
- the archive is a filter: civil and penal decisions are numbered in two series that overlap
  (n. 10787/2024 is Sez. III civile and Sez. VII penale);
- the number is queried zero-padded to five digits, as the index stores it: the bare form
  never matched (measured on 2026-10-02), so a lookup is one query per archive;
- the text comes back whole: `ocr` is the reasons, `ocrdis` the dispositivo (often empty at the
  source, which then leaves it at the end of the reasons).
- a decision whose text the source withholds comes back with the source's own notice as its
  text, while personal data are being removed: "La sentenza richiesta è in fase di
  oscuramento" (`testo_assente` "oscuramento"), "in fase di valutazione oscuramento"
  (`testo_assente` "valutazione_oscuramento"), and rarely a stub such as "Oscuramento disposto
  Numero registro generale …" (no cause). A text of at most 300 characters that mentions
  "oscuramento" is never the court's text: the decision is returned without one. A record with
  neither a text nor a notice is returned without a text and without a cause, and logged: the
  source said nothing about why.
- the text arrives as one line (measured on 2026-10-04: 45 of 45 sampled texts, up to 82,322
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

from ...tools.tls import italgiure_ssl_context
from .http import decisions_http_client, http_headers
from .model import Decision, Identity

log = structlog.get_logger()

BASE = "https://www.italgiure.giustizia.it/sncass"
SELECT = f"{BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
KINDS = {"civile": "snciv", "penale": "snpen"}
FIELDS = "id,numdec,anno,datdep,szdec,materia,tipoprov,ocr,ocrdis,relatore,presidente,kind"
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
        word = text[:m.start()].rstrip().rsplit(" ", 1)[-1].rstrip(".").lower()
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
        testo = {key: paragraphs(value) for key, value in (
            ("motivazione", motivazione), ("dispositivo", _text(doc.get("ocrdis")).strip()))
            if value}
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
        # one query: with a homepage GET and a Solr POST per query, a search stays within the
        # owner's 10 requests (2026-10-04)
        data = await self._select({
            "q": f'kind:"{KINDS[archivio]}" AND numdec:{numero:05d} AND anno:{anno}',
            "rows": "1", "fl": FIELDS})
        docs = data.get("response", {}).get("docs", [])
        if not docs:
            return None
        try:
            return to_decision(docs[0], archivio)
        except ValueError as exc:  # a record without a readable number or year
            raise SourceAnswerError(
                "Italgiure ha risposto con una decisione illeggibile") from exc

    async def archive_start(self, archivio: str) -> tuple[int, str] | None:
        data = await self._select({"q": f'kind:"{KINDS[archivio]}"', "rows": "1",
                                   "sort": "pd asc", "fl": "id,anno,datdep,kind"})
        docs = data.get("response", {}).get("docs", [])
        iso = _iso(_scalar(docs[0].get("datdep"))) if docs else None
        return (int(iso[:4]), iso) if iso else None
