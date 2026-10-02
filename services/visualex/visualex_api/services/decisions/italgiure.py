"""Corte di cassazione decisions from Italgiure's public archive (SentenzeWeb).

Recovered from the 2026-08-29 round (reverted for priorities, not for a defect) and fixed for
the lookup of one decision:
- the archive is a filter: civil and penal decisions are numbered in two series that overlap
  (n. 10787/2024 is Sez. III civile and Sez. VII penale);
- the number is tried zero-padded, as the index stores it, then bare;
- the text comes back whole: `ocr` is the reasons, `ocrdis` the dispositivo (often empty at the
  source, which then leaves it at the end of the reasons).
- a decision the source has not released yet comes back with the source's own notice as its
  text ("La sentenza richiesta è in fase di oscuramento": personal data are being removed).
  The notice is not the court's text: the decision is returned without one.

The archive is a moving window (in 2026 it starts in 2021); its start is read from the
archive, never written here.
"""
from __future__ import annotations

import json
import re

from ...tools.tls import italgiure_ssl_context
from .http import decisions_http_client, http_headers
from .model import Decision, Identity

BASE = "https://www.italgiure.giustizia.it/sncass"
SELECT = f"{BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
KINDS = {"civile": "snciv", "penale": "snpen"}
FIELDS = "id,numdec,anno,datdep,szdec,materia,tipoprov,ocr,ocrdis,relatore,presidente,kind"
SOURCE = {"nome": "Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)"}
# `tipoprov` holds a code or a label, depending on the record
TIPI = {"s": "sentenza", "sentenza": "sentenza", "o": "ordinanza", "ordinanza": "ordinanza",
        "ordinanza interlocutoria": "ordinanza interlocutoria", "d": "decreto",
        "decreto": "decreto"}
# Italgiure's stand-in for a text it withholds while personal data are removed (measured on
# 2026-10-02: about 6% of civil records and 33,000 penal ones, in every year). A real text is
# never this short; the length bound keeps a real text that quotes the phrase.
_WITHHELD = "in fase di oscuramento"
_WITHHELD_MAX = 300


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
    if len(motivazione) <= _WITHHELD_MAX and _WITHHELD in motivazione.lower():
        testo: dict[str, str] = {}  # the source's notice, not the court's text
    else:
        testo = {key: value for key, value in (("motivazione", motivazione),
                                                ("dispositivo", _text(doc.get("ocrdis")).strip()))
                 if value}
    return Decision(
        identita=Identity("cassazione", int(_scalar(doc.get("numdec"))),
                          int(_scalar(doc.get("anno"))), archivio),
        sezione=_scalar(doc.get("szdec")).strip().upper() or None,
        tipo=TIPI.get(_scalar(doc.get("tipoprov")).strip().lower()),
        data_deposito=_iso(_scalar(doc.get("datdep"))),
        relatore=_scalar(doc.get("relatore")).strip() or None,
        presidente=_scalar(doc.get("presidente")).strip() or None,
        materia=_scalar(doc.get("materia")).strip() or None,
        testo=testo,
        fonte=dict(SOURCE),
    )


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
            return json.loads(result.text)
        except json.JSONDecodeError as exc:
            raise SourceAnswerError("Italgiure non ha risposto con i suoi dati") from exc

    async def lookup(self, archivio: str, numero: int, anno: int) -> Decision | None:
        kind = KINDS[archivio]
        forms = [f"{numero:05d}"] + ([str(numero)] if numero < 10000 else [])
        for numdec in forms:
            data = await self._select({
                "q": f'kind:"{kind}" AND numdec:{numdec} AND anno:{anno}',
                "rows": "1", "fl": FIELDS})
            docs = data.get("response", {}).get("docs", [])
            if docs:
                return to_decision(docs[0], archivio)
        return None

    async def archive_start(self, archivio: str) -> tuple[int, str] | None:
        data = await self._select({"q": f'kind:"{KINDS[archivio]}"', "rows": "1",
                                   "sort": "pd asc", "fl": "id,anno,datdep,kind"})
        docs = data.get("response", {}).get("docs", [])
        iso = _iso(_scalar(docs[0].get("datdep"))) if docs else None
        return (int(iso[:4]), iso) if iso else None
