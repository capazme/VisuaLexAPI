"""Corte costituzionale decisions from the court's open data (design 2026-10-01 §3).

There is no per-decision route: www.cortecostituzionale.it is bot-protected and this server
never contacts it. Each decision links to its page there (scheda-pronuncia/<anno>/<numero>),
which the reader's browser opens. The complete source is the open-data distribution of
dati.cortecostituzionale.it: three range bundles of per-year JSON (latin-1), the last one
regenerated daily. A bundle is kept on disk (closed ranges for 30 days, the current one for 24
hours: D3 of the 2026-08-29 design) and only the requested year is read out of it.

Ported from mcp-legal-it 2.15's open-data client (same author, relicensed MIT): the bundle
names and the nested layout are its findings. Here the text is never cut.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import time
import zipfile
from collections import OrderedDict
from collections.abc import Callable
from datetime import date
from pathlib import Path

import aiohttp

from .http import decisions_http_client, http_headers
from .model import Decision, Identity

BASE_URL = "https://dati.cortecostituzionale.it/opendata/distribuzione/pronunce"
PAGE_URL = "https://www.cortecostituzionale.it/scheda-pronuncia"  # opened by the reader's browser, never fetched
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


def clean(text: object) -> str:
    """The upstream text as the page receives it: `&#13;` and carriage returns become line
    breaks, runs of spaces collapse, longer blank runs shrink to one empty line. Once notes on
    decisions exist this output is a data contract (gotcha 23): change it and they move."""
    if not text:
        return ""
    s = str(text).replace("&#13;", "\n").replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]{2,}", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _iso(value: object) -> str | None:
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", str(value or "").strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def to_decision(rec: dict) -> Decision:
    numero = int(str(rec["numero_pronuncia"]).strip())
    anno = int(str(rec["anno_pronuncia"]).strip())
    testo = {key: value for key, value in (("epigrafe", clean(rec.get("epigrafe"))),
                                            ("motivazione", clean(rec.get("testo"))),
                                            ("dispositivo", clean(rec.get("dispositivo"))))
             if value}
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


def read_year(bundle: Path, year: int) -> list[dict]:
    """The records of one year, read out of a range bundle (two nested zips, latin-1 JSON)."""
    with zipfile.ZipFile(bundle) as outer:
        names = [n for n in outer.namelist() if n.endswith(_YEAR_ZIP.format(year=year))]
        if not names:
            return []
        inner_bytes = outer.read(names[0])
    with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
        members = inner.namelist()
        target = _YEAR_JSON.format(year=year)
        target = target if target in members else (members[0] if members else None)
        if target is None:
            return []
        obj = json.loads(inner.read(target).decode("latin-1"))
    records = obj.get(_ROOT_KEY, []) if isinstance(obj, dict) else obj
    return records if isinstance(records, list) else []


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

    async def _bundle_path(self, name: str, ttl: int) -> Path:
        path = self.cache_dir / name
        lock = self._locks.setdefault(name, asyncio.Lock())
        async with lock:  # concurrent misses wait for the same download
            if path.exists() and time.time() - path.stat().st_mtime < ttl:
                return path
            result = await decisions_http_client.request(
                "GET", f"{BASE_URL}/{name}", source="corte_cost", text_encoding="latin-1",
                timeout=_DOWNLOAD_TIMEOUT, headers=http_headers({"Accept": "application/zip"}))
            data = result.text.encode("latin-1")
            if data[:2] != b"PK":
                raise ValueError(f"{name}: la risposta non è un archivio zip")
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{name}.{os.getpid()}.tmp")
            tmp.write_bytes(data)
            os.replace(tmp, path)
            return path

    async def _records(self, year: int) -> list[dict]:
        found = self._bundle(year)
        if found is None:
            return []
        path = await self._bundle_path(*found)
        key = (found[0], path.stat().st_mtime, year)
        if key not in self._years:
            self._years[key] = await asyncio.to_thread(read_year, path, year)
            while len(self._years) > self._max_years:
                self._years.popitem(last=False)
        self._years.move_to_end(key)
        return self._years[key]

    async def lookup(self, numero: int, anno: int) -> Decision | None:
        for rec in await self._records(anno):
            if (str(rec.get("numero_pronuncia", "")).strip() == str(numero)
                    and str(rec.get("anno_pronuncia", "")).strip() == str(anno)):
                return to_decision(rec)
        return None
