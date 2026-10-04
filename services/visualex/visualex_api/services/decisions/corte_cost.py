"""Corte costituzionale decisions from the court's open data (design 2026-10-01 §3).

There is no per-decision route: www.cortecostituzionale.it is bot-protected and this server
never contacts it. Each decision links to its page there (scheda-pronuncia/<anno>/<numero>),
which the reader's browser opens. The complete source is the open-data distribution of
dati.cortecostituzionale.it: three range bundles of per-year JSON (latin-1), the last one
regenerated daily. A bundle is kept on disk (closed ranges for 30 days, the current one for 24
hours: D3 of the 2026-08-29 design) and only the requested year is read out of it. When a
refresh fails, the copy on disk still confirms a decision it holds for a year before the
current one, however old; a number it does not hold may have been deposited after the copy was
written, so it cannot be verified: `lookup` raises ValueError (the resolver answers 503), never
"not found". The current year is never read from such a copy. A failed refresh of the
2001-today bundle hides no closed year.

Ported from mcp-legal-it 2.15's open-data client (same author, relicensed MIT): the bundle
names and the nested layout are its findings. Here the text is never cut.
Most ordinanze (3,592 of 4,056 in 2001-2026) leave `testo` empty and carry their reasoning in
the epigrafe: `split_epigrafe` splits it where the reasoning starts (the owner's rule of
2026-10-04). The open data break lines two ways (a paragraph or a heading per line since about
2001, a typewriter wrap before), so `line_paragraphs` turns each line break into a paragraph
break unless it is such a wrap; it runs on each block after the split.
"""
from __future__ import annotations

import asyncio
import html
import io
import json
import os
import re
import tempfile
import time
import unicodedata
import zipfile
import zlib
from collections import OrderedDict
from collections.abc import Callable
from datetime import date
from pathlib import Path

import aiohttp
import structlog

from .http import decisions_http_client, http_headers
from .model import Decision, Identity

log = structlog.get_logger()

BASE_URL = "https://dati.cortecostituzionale.it/opendata/distribuzione/pronunce"
# opened by the reader's browser, never fetched
PAGE_URL = "https://www.cortecostituzionale.it/scheda-pronuncia"
BUNDLES: list[tuple[int, int, str]] = [
    (1956, 1980, "P_json1956_1980.zip"),
    (1981, 2000, "P_json1981_2000.zip"),
    (2001, 9999, "P_json2001_oggi.zip"),
]
_YEAR_ZIP = "Cc_Opendata_Pronunce_{year}_json.zip"
_YEAR_JSON = "Cc_Opendata_Pronunce_{year}.json"
_ROOT_KEY = "elenco_pronunce"
CLOSED_TTL = 30 * 24 * 3600
OPEN_TTL = 24 * 3600
_DOWNLOAD_TIMEOUT = aiohttp.ClientTimeout(total=180)
_TIPI = {"S": "sentenza", "O": "ordinanza"}
SOURCE = {"nome": "Corte costituzionale — dati aperti", "licenza": "CC BY-SA 3.0"}


# Windows-1252 characters that the latin-1 decoding turned into C1 controls (measured: "Š"
# and "š" in nine records). Same length, so no offset moves.
_CP1252 = {cp: bytes([cp]).decode("cp1252") for cp in range(0x80, 0xA0)
           if cp not in (0x81, 0x8D, 0x8F, 0x90, 0x9D)}
_REFERENCE = re.compile(r"&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);")


def clean(text: object) -> str:
    """The upstream text as the page receives it: `&#13;` and carriage returns become line
    breaks, the other character references are decoded (only the ones closed by ";") and
    composed (NFC), C1 controls left by the latin-1 decoding become their Windows-1252
    characters, runs of spaces collapse, spaces before a line break go, and longer blank runs
    shrink to one empty line. Once notes on decisions exist this output is a data contract
    (gotcha 23): change it and they move."""
    if not text:
        return ""
    s = str(text).replace("&#13;", "\n")
    s = _REFERENCE.sub(lambda m: html.unescape(m.group(0)), s).translate(_CP1252)
    s = unicodedata.normalize("NFC", s.replace("\r\n", "\n").replace("\r", "\n"))
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _iso(value: object) -> str | None:
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", str(value or "").strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


# The owner's rule of 2026-10-04 for a decision whose `testo` the open data leave empty: its
# reasoning sits in the epigrafe and starts at a line whose first word is "Ritenuto" or
# "Considerato", in any case, after the header phrase.
_HEADER_END = re.compile(r"ha\s+pronunciato\s+la\s+seguente", re.IGNORECASE)
_REASONING_START = re.compile(r"^[ \t]*(ritenuto|considerato)\b", re.IGNORECASE | re.MULTILINE)


def split_epigrafe(epigrafe: str) -> tuple[str, str]:
    """(epigrafe, motivazione) out of an epigrafe that holds the reasoning too. The split point
    is the first line whose first word is "Ritenuto" or "Considerato", in any case, searched
    after the phrase "ha pronunciato la seguente" when the epigrafe has it, so that a line of
    the header never splits it, and from the start otherwise. The epigrafe keeps what comes
    before, without its trailing whitespace ("" when nothing else comes before); the
    motivazione starts at the word. Without such a line the epigrafe stays whole and the
    motivazione is "". Only the whitespace at the boundary is dropped: once notes on decisions
    exist, this split is a data contract like `clean` (gotcha 23)."""
    header = _HEADER_END.search(epigrafe)
    match = _REASONING_START.search(epigrafe, header.end() if header else 0)
    if match is None:
        return epigrafe, ""
    return epigrafe[:match.start()].rstrip(), epigrafe[match.start(1):]


# The open data break lines two ways (measured on 2026-10-04 over the three bundles): since about
# 2001 each line is a paragraph or a heading; before, a typewriter wrap at a measure of at most 80
# characters, a paragraph ending where a line stops short. A line break becomes a paragraph break
# (a blank line) unless it is such a wrap: the block's lines fill a measure of at most 80, the
# line before fills at least three quarters of it, and it does not end a sentence where the next
# word would still have fit. Only line breaks are added: a note anchored to the text never moves
# (gotcha 23), and the rule can be refined later.
_TYPEWRITER_MEASURE = 80


def line_paragraphs(text: str) -> str:
    lines = text.split("\n")
    lengths = sorted(len(line) for line in lines if line.strip())
    if len(lengths) < 2:
        return text
    width = lengths[int(0.9 * (len(lengths) - 1))]
    typewritten = width <= _TYPEWRITER_MEASURE
    out = [lines[0]]
    for before, line in zip(lines, lines[1:]):
        if not before.strip() or not line.strip():
            out.append("\n" + line)  # an existing blank line stays as it is
            continue
        filled = len(before) >= 0.75 * width
        ends_sentence = before[-1] in ".:;" and len(before) + 1 + len(line.split()[0]) <= width
        out.append(("\n" if typewritten and filled and not ends_sentence else "\n\n") + line)
    return "".join(out)


def to_decision(rec: dict) -> Decision:
    numero = int(str(rec["numero_pronuncia"]).strip())
    anno = int(str(rec["anno_pronuncia"]).strip())
    epigrafe, motivazione = clean(rec.get("epigrafe")), clean(rec.get("testo"))
    if epigrafe and not motivazione:
        # most ordinanze: the open data leave `testo` empty and the reasoning in the epigrafe
        epigrafe, motivazione = split_epigrafe(epigrafe)
    testo = {key: line_paragraphs(value) for key, value in (
        ("epigrafe", epigrafe), ("motivazione", motivazione),
        ("dispositivo", clean(rec.get("dispositivo")))) if value}
    return Decision(
        identita=Identity("corte_costituzionale", numero, anno),
        tipo=_TIPI.get(str(rec.get("tipologia_pronuncia", "")).strip().upper()),
        data_deposito=_iso(rec.get("data_deposito")),
        data_decisione=_iso(rec.get("data_decisione")),
        ecli=str(rec.get("ecli") or "").strip() or None,
        relatore=str(rec.get("relatore_pronuncia") or "").strip() or None,
        presidente=str(rec.get("presidente") or "").strip() or None,
        testo=testo,
        fonte={**SOURCE, "url": f"{PAGE_URL}/{anno}/{numero}"},
    )


def read_year(bundle: Path, year: int) -> list[dict] | None:
    """The records of one year, read out of a range bundle (two nested zips, JSON in latin-1,
    or in UTF-8 should the court switch); None when the bundle has no entry for that year. A
    year whose layout is not the court's raises ValueError: a changed layout is never read as
    "no such decision"."""
    with zipfile.ZipFile(bundle) as outer:
        names = [n for n in outer.namelist() if n.endswith(_YEAR_ZIP.format(year=year))]
        if not names:
            return None
        inner_bytes = outer.read(names[0])
    target = _YEAR_JSON.format(year=year)
    with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
        if target not in inner.namelist():
            raise ValueError(f"{bundle.name}: manca {target}")
        raw = inner.read(target)
    try:
        # UTF-8 first: latin-1 decodes any byte, so it would turn a UTF-8 file into mojibake
        # without a sign, while latin-1 text with accents is almost never valid UTF-8
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")  # the court's encoding, as measured
    obj = json.loads(text)
    records = obj.get(_ROOT_KEY) if isinstance(obj, dict) else None
    if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
        raise ValueError(f"{bundle.name}: {target} non ha la forma attesa")
    return records


def _store_bundle(path: Path, text: str) -> None:
    """A downloaded bundle, checked and put in place of the copy on disk. Synchronous and heavy
    (the 2001-today bundle is about 56 MB): called through asyncio.to_thread, never on the
    event loop."""
    data = text.encode("latin-1")  # the bytes as served: latin-1 maps 0-255 one to one
    if data[:2] != b"PK":
        raise ValueError(f"{path.name}: la risposta non è un archivio zip")
    try:
        zipfile.ZipFile(io.BytesIO(data)).close()  # reads the end record: a cut file fails
    except zipfile.BadZipFile as exc:
        raise ValueError(f"{path.name}: l'archivio zip è incompleto") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    # a name of its own: a write left running by a cancelled request never meets another
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)  # already gone once the replace succeeded


class CorteCostReader:
    def __init__(self, cache_dir: Path, today: Callable[[], date] = date.today,
                 years_in_memory: int = 2):
        self.cache_dir = cache_dir
        self.today = today
        self._locks: dict[str, asyncio.Lock] = {}
        self._years: OrderedDict[tuple[str, float, int], list[dict]] = OrderedDict()
        self._max_years = years_in_memory

    def _bundle(self, year: int) -> tuple[str, int] | None:
        for low, high, name in BUNDLES:
            if low <= year <= high:
                return name, (OPEN_TTL if high >= self.today().year else CLOSED_TTL)
        return None

    async def _bundle_path(self, name: str, ttl: int,
                           allow_stale: bool = False) -> tuple[Path, bool]:
        """The bundle on disk, downloaded again once older than `ttl`, and whether it is a
        stale copy. When that refresh fails and an older copy will do (`allow_stale`: a year
        before the current one), the copy on disk is served and `stale` is True; otherwise the
        failure propagates. A stale copy was written at some earlier time, so it can hold the
        decisions deposited by then and no others: it confirms, it never denies."""
        path = self.cache_dir / name
        lock = self._locks.setdefault(name, asyncio.Lock())
        async with lock:  # concurrent misses wait for the same download
            if path.exists() and time.time() - path.stat().st_mtime < ttl:
                return path, False
            try:
                result = await decisions_http_client.request(
                    "GET", f"{BASE_URL}/{name}", source="corte_cost", text_encoding="latin-1",
                    timeout=_DOWNLOAD_TIMEOUT, headers=http_headers({"Accept": "application/zip"}))
                await asyncio.to_thread(_store_bundle, path, result.text)
            except Exception as exc:  # a cancellation is not an Exception: it propagates
                if not (allow_stale and path.exists()):
                    raise
                log.warning("Corte costituzionale bundle refresh failed; serving the copy on disk",
                            bundle=name, error=str(exc))
                return path, True
            return path, False

    async def _records(self, year: int) -> tuple[list[dict], bool]:
        """The records of one year and whether they come from a stale copy of its bundle. The
        parsed years kept in memory hold records only: whether the copy is stale is decided
        again at every call, since the same copy goes stale while the process runs."""
        found = self._bundle(year)
        if found is None:
            return [], False
        path, stale = await self._bundle_path(*found, allow_stale=year < self.today().year)
        key = (found[0], path.stat().st_mtime, year)
        if key not in self._years:
            try:
                records = await asyncio.to_thread(read_year, path, year)
            except (zipfile.BadZipFile, zlib.error, EOFError):
                async with self._locks.setdefault(found[0], asyncio.Lock()):
                    path.unlink(missing_ok=True)  # a damaged copy: fetched again next time
                raise
            if records is None:
                if year < self.today().year:  # a past year its bundle should hold
                    raise ValueError(f"{found[0]}: manca l'anno {year}")
                records = []  # the current year before its first decision
            self._years[key] = records
            while len(self._years) > self._max_years:
                self._years.popitem(last=False)
        self._years.move_to_end(key)
        return self._years[key], stale

    async def lookup(self, numero: int, anno: int) -> Decision | None:
        records, stale = await self._records(anno)
        for rec in records:
            if (str(rec.get("numero_pronuncia", "")).strip() == str(numero)
                    and str(rec.get("anno_pronuncia", "")).strip() == str(anno)):
                return to_decision(rec)
        if stale:
            # a copy that could not be refreshed confirms what it holds, never denies the rest
            raise ValueError(f"{anno}: dati aperti non aggiornabili, n. {numero} non verificabile")
        return None
