"""The Corte costituzionale's massime under each article, from the court's open data (G-281).

The massime are the Servizio studi's, published by dati.cortecostituzionale.it as three range
bundles of per-year JSON (latin-1), like the pronunce `corte_cost.py` reads; the last bundle is
still named `CC_M_2001_2015_json.zip` and holds every year from 2001 to today (mcp-legal-it's
finding, checked on 2026-10-19: 26 years, the last one 2026). Each massima carries two
machine-readable lists of provisions, `norme` (the provisions at issue) and `parametri` (what
they were measured against, mostly the Costituzione), with the act's description, number,
date, article and suffix. `reference_identity` maps one entry onto VisuaLex's identity of an
article (the source convention, `tools/sources.py`), and the index keeps, for each identity,
the massime that name it and in which role.

The source is asked gently: the three bundles (about 24 MB) are downloaded in bulk and kept on
disk, the closed ranges for 30 days, the current one for 24 hours, never one request per
massima. The index is a SQLite file next to them, rebuilt when a bundle changes, built in a
temporary file and put in place whole, so a reader never sees half of it. It is a cache: it
can be deleted at any time and is built again from the bundles. When a refresh fails, the
index on disk is still served: a massima, once published, does not change, so an older index
lacks the newest massime and nothing else.

The massime are shown verbatim, as a separate collection with the source and the licence line
(CC BY-SA 3.0). Only the encoding is repaired (line endings, the Windows-1252 characters the
latin-1 decoding turns into C1 controls) and the whitespace at the edges dropped. They are not
anchors: should notes on massime ever exist, this text becomes a data contract (root rule 23).
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import sqlite3
import tempfile
import time
import unicodedata
import zipfile
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import Any

import aiohttp
import structlog

from ...tools.article_suffixes import ARTICLE_ORDINAL_SUFFIXES
from ...tools.config import PERSISTENT_CACHE_DIR
from ...tools.map import NORMATTIVA_URN_CODICI, act_default_annex, codice_urn
from ...tools.sources import NORMATTIVA_RESOLVER, normalize_norm_urn
from .corte_cost import _CP1252, _TIPI, PAGE_URL, _iso, _store_bundle
from .http import decisions_http_client, http_headers

log = structlog.get_logger()

BASE_URL = "https://dati.cortecostituzionale.it/opendata/distribuzione/massime"
DOWNLOAD_PAGE = "https://dati.cortecostituzionale.it/Scarica_i_dati/Scarica_i_dati"
BUNDLES: list[tuple[int, int, str]] = [
    (1956, 1980, "CC_M_1956_1980_json.zip"),
    (1981, 2000, "CC_M_1981_2000_json.zip"),
    (2001, 9999, "CC_M_2001_2015_json.zip"),  # the court never renamed it: 2001 to today
]
_YEAR_ZIP = re.compile(r"Cc_OpenData_Massime_(\d{4})_json\.zip$")
_YEAR_JSON = "Cc_OpenData_Massime_{year}.json"
_ROOT_KEY = "corte_costituzionale_archiviomassime"
CLOSED_TTL = 30 * 24 * 3600
OPEN_TTL = 24 * 3600
# after a failed refresh the source is not asked again for an hour
RETRY_AFTER = 3600
PAGE_SIZE = 20  # art. 3 Cost. is named by some 17,600 massime: the route answers a page
# the first build waits this long for an answer; past it the route says the index is being made
FIRST_BUILD_WAIT = 25.0
_DOWNLOAD_TIMEOUT = aiohttp.ClientTimeout(total=180)
INDEX_NAME = "massime-v2.sqlite3"  # raise the version when the index's shape or mapping changes
SOURCE = {"nome": "Corte costituzionale — dati aperti", "licenza": "CC BY-SA 3.0",
          "url": DOWNLOAD_PAGE}
ATTRIBUTION = "Massime: Corte costituzionale — dati aperti, CC BY-SA 3.0"
ROLES = ("norma", "parametro")  # how a massima names an article: at issue, or as the measure


# --- From an entry of `norme` or `parametri` to an article's identity ----------------------

def _label(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


# The open data's descriptions of a code → the name VisuaLex keys it by (NORMATTIVA_URN_CODICI,
# through `codice_urn`), measured on 2026-10-19 over the three bundles. Left out on purpose:
# the codes no longer in force ("codice di procedura penale 1930", "codice civile anteriore
# (25 luglio 1865)", "codice della strada (d.p.r. 15.6.1959, n. 393)"), whose articles are not
# the ones VisuaLex reads under the same number, and the military penal codes, which
# Normattiva holds as one act with two codes.
_CODES = {
    "costituzione": "costituzione",
    "codice civile": "codice civile",
    "disposizioni sulla legge in generale": "preleggi",
    "disposizioni preliminari al codice civile": "preleggi",
    "codice civile (disposizioni di attuazione del)":
        "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
    "codice penale": "codice penale",
    "codice di procedura civile": "codice di procedura civile",
    "codice di procedura civile (disp. att.)":
        "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    "codice di procedura penale": "codice di procedura penale",
    "codice di procedura penale (nuovo)": "codice di procedura penale",
    "codice di procedura penale 1988 (disp. att.)":
        "norme di attuazione, di coordinamento e transitorie del codice di procedura penale",
    "codice della navigazione": "codice della navigazione",
    "codice della strada (d.lgs. 30.4.1992, n. 285)": "codice della strada",
    "codice della strada (d.lgs. 30-4-1992, n. 285)": "codice della strada",
}
# The descriptions of a State act named by number and date → the type's token in its URN.
# Regional acts, statutes, treaties and the court's own rules are not read by VisuaLex as
# norms, and are left out.
_TYPES = {
    "legge": "legge",
    "legge di conversione": "legge",
    "legge costituzionale": "legge.costituzionale",
    "decreto legislativo": "decreto.legislativo",
    "decreto-legge": "decreto.legge",
    "decreto legge": "decreto.legge",
    "decreto del presidente della repubblica": "decreto.del.presidente.della.repubblica",
    "regio decreto": "regio.decreto",
    "regio decreto legge": "regio.decreto.legge",
    "decreto legislativo luogotenenziale": "decreto.legislativo.luogotenenziale",
    "decreto ministeriale": "decreto.ministeriale",
    "decreto del presidente del consiglio dei ministri":
        "decreto.del.presidente.del.consiglio.dei.ministri",
}
_SUFFIXES = frozenset(ARTICLE_ORDINAL_SUFFIXES)


def _annexed_codes() -> dict[str, str | None]:
    """An enacting act whose articles VisuaLex reads in an annex → that annex's URN: the open
    data cite the c.p.a. as «decreto legislativo» n. 104 of 2 July 2010 with the code's article
    and no annex (142 entries), which would otherwise land on the decree's own articles. An act
    with two coded annexes (R.D. 262/1942: the preleggi and the codice civile) cannot be told
    and names nothing."""
    found: dict[str, set[str]] = {}
    for urn in NORMATTIVA_URN_CODICI.values():
        parts = urn.split(":")
        if len(parts) == 3 and ";" in parts[1]:
            found.setdefault(":".join(parts[:2]), set()).add(urn)
    return {head: (urns.pop() if len(urns) == 1 else None) for head, urns in found.items()}


_ANNEXED = _annexed_codes()
_DAY = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def _act_head(entry: dict) -> str | None:
    """`stato:<type>:<date>;<number>` (or a code's URN) for the act an entry names, or None."""
    description = _label(entry.get("descrizione"))
    if description in _CODES:
        urn = codice_urn(_CODES[description])
        return f"stato:{urn}" if urn else None
    token = _TYPES.get(description)
    if token is None:
        return None
    numero = str(entry.get("numero") or "").strip()
    day = _DAY.fullmatch(str(entry.get("data") or "").strip())
    if not numero.isdigit() or day is None:
        return None
    d, m, y = day.groups()
    act = f"{token}:{y}-{int(m):02d}-{int(d):02d};{int(numero)}"
    if act in _ANNEXED:
        annexed = _ANNEXED[act]
        return f"stato:{annexed}" if annexed else None
    # an act whose text is its annex (the TULPS, annex 1 of r.d. 773/1931: G-351)
    annex = act_default_annex(act)
    return f"stato:{act}:{annex}" if annex else f"stato:{act}"


def reference_identity(entry: dict) -> str | None:
    """The identity of the article an entry of `norme` or `parametri` names, as
    `normalize_norm_urn` writes it (`https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:
    regio.decreto:1942-03-16;262:2~art2043`); the act's identity when it names no article;
    None for an act VisuaLex does not read (a regional law, a treaty, a repealed code) or an
    entry it cannot tell (no number or date). The suffix counts only when it is an ordinal of
    the table (`bis`, `ter` …); anything else in that field («n. 1», «lett. a», «e segg.»)
    is a part of the article, and the article is the identity."""
    head = _act_head(entry)
    if head is None:
        return None
    articolo = str(entry.get("articolo") or "").strip()
    suffix = _label(entry.get("specificazione_articolo")).replace("-", "").replace(" ", "")
    if not articolo and suffix.isdigit():
        # the number written in the suffix's field, the article's left empty (seen in 2020's
        # s. 156: «d.lgs. n. 28 del 2015», article "", suffix "1")
        articolo, suffix = suffix, ""
    if not articolo:
        return normalize_norm_urn(f"urn:nir:{head}")
    if not articolo.isdigit():
        return None
    article = f"{int(articolo)}{suffix if suffix in _SUFFIXES else ''}"
    return normalize_norm_urn(f"urn:nir:{head}~art{article}")


# --- The bundles ----------------------------------------------------------------------------

def massima_text(text: object) -> str:
    """The massima as the court wrote it: line endings normalised, the Windows-1252 characters
    the latin-1 decoding turned into C1 controls given back, composed (NFC), the edges
    stripped. Nothing else changes, not even a double space."""
    s = str(text or "").replace("\r\n", "\n").replace("\r", "\n").translate(_CP1252)
    return unicodedata.normalize("NFC", s).strip()


def iter_bundle(bundle: Path) -> Iterator[tuple[int, dict]]:
    """(year, record) for every decision of a range bundle: two nested zips, JSON in latin-1,
    or in UTF-8 should the court switch. A year whose layout is not the court's raises
    ValueError: a changed layout is never read as "no massime"."""
    with zipfile.ZipFile(bundle) as outer:
        for name in sorted(outer.namelist()):
            found = _YEAR_ZIP.search(name)
            if not found:
                continue
            year = int(found.group(1))
            target = _YEAR_JSON.format(year=year)
            with zipfile.ZipFile(io.BytesIO(outer.read(name))) as inner:
                if target not in inner.namelist():
                    raise ValueError(f"{bundle.name}: manca {target}")
                raw = inner.read(target)
            try:
                text = raw.decode("utf-8")  # see corte_cost.read_year: UTF-8 first
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            obj = json.loads(text)
            records = obj.get(_ROOT_KEY) if isinstance(obj, dict) else None
            if not isinstance(records, list) or not all(isinstance(r, dict) for r in records):
                raise ValueError(f"{bundle.name}: {target} non ha la forma attesa")
            for record in records:
                yield year, record


_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE massime (
    id INTEGER PRIMARY KEY,
    numero TEXT NOT NULL,
    anno INTEGER NOT NULL,
    numero_pronuncia INTEGER NOT NULL,
    tipo TEXT,
    data_decisione TEXT,
    data_deposito TEXT,
    titolo TEXT NOT NULL,
    testo TEXT NOT NULL
);
CREATE TABLE refs (key TEXT NOT NULL, massima INTEGER NOT NULL, ruolo TEXT NOT NULL,
                   PRIMARY KEY (key, massima, ruolo)) WITHOUT ROWID;
"""


def build_index(bundles: Iterable[Path], target: Path, signature: str) -> dict[str, int]:
    """Writes the index of every massima in `bundles` to `target`, whole or not at all, and
    returns what it counted. Synchronous and heavy (some 47,000 massime): called through
    asyncio.to_thread, never on the event loop."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=f"{target.name}.", suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    counts = {"massime": 0, "senza_testo": 0, "riferimenti": 0, "non_mappati": 0}
    try:
        db = sqlite3.connect(tmp)
        try:
            db.executescript(_SCHEMA)
            for path in bundles:
                for year, record in iter_bundle(path):
                    _index_record(db, year, record, counts)
            db.executemany("INSERT INTO meta VALUES (?, ?)", [
                ("signature", signature), ("built_at", str(int(time.time()))),
                *((key, str(value)) for key, value in counts.items())])
            db.commit()
        finally:
            db.close()
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)  # already gone once the replace succeeded
    return counts


def _index_record(db: sqlite3.Connection, year: int, record: dict, counts: dict[str, int]) -> None:
    numero_pronuncia = str(record.get("numero_pronuncia") or "").strip()
    anno = str(record.get("anno_pronuncia") or year).strip()
    if not (numero_pronuncia.isdigit() and anno.isdigit()):
        return
    for massima in record.get("massime") or []:
        if not isinstance(massima, dict):
            continue
        testo = massima_text(massima.get("testo"))
        if not testo:
            counts["senza_testo"] += 1
            continue
        cursor = db.execute(
            "INSERT INTO massime (numero, anno, numero_pronuncia, tipo, data_decisione,"
            " data_deposito, titolo, testo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (str(massima.get("numero") or "").strip(), int(anno), int(numero_pronuncia),
             _TIPI.get(str(record.get("tipologia_pronuncia") or "").strip().upper()),
             _iso(record.get("data_decisione")), _iso(record.get("data_deposito")),
             massima_text(massima.get("titolo")), testo))
        counts["massime"] += 1
        refs = set()
        for ruolo, field in (("norma", "norme"), ("parametro", "parametri")):
            for entry in massima.get(field) or []:
                identity = reference_identity(entry) if isinstance(entry, dict) else None
                if identity is None:
                    counts["non_mappati"] += 1
                else:
                    refs.add((_key(identity), cursor.lastrowid, ruolo))
        db.executemany("INSERT INTO refs VALUES (?, ?, ?)", sorted(refs))
        counts["riferimenti"] += len(refs)


_PREFIX = f"{NORMATTIVA_RESOLVER}urn:nir:"


def _key(identity: str) -> str:
    """An identity as the index keeps it: without the resolver's prefix, which every one shares
    (a third of the index's size)."""
    return identity[len(_PREFIX):] if identity.startswith(_PREFIX) else identity


def query_index(index: Path, identity: str, page: int = 1, size: int = PAGE_SIZE,
                ruolo: str | None = None) -> tuple[list[dict], dict[str, int]]:
    """One page of the massime that name `identity`, newest decision first, and how many name
    it in each role (`norma`, `parametro`, and `totale`: a massima can hold both). With a
    `ruolo`, the page holds only the massime that name it in that role (each still with all
    its `ruoli`); the counts stay those of every role. Read-only, synchronous."""
    key = _key(identity)
    db = sqlite3.connect(f"file:{index}?mode=ro", uri=True)
    try:
        counts = {"totale": db.execute(
            "SELECT count(DISTINCT massima) FROM refs WHERE key = ?", (key,)).fetchone()[0]}
        counts.update(db.execute(
            "SELECT ruolo, count(*) FROM refs WHERE key = ? GROUP BY ruolo", (key,)).fetchall())
        rows = db.execute(
            "SELECT m.numero, m.anno, m.numero_pronuncia, m.tipo, m.data_decisione,"
            " m.data_deposito, m.titolo, m.testo, group_concat(r.ruolo)"
            " FROM refs r JOIN massime m ON m.id = r.massima WHERE r.key = :key"
            " GROUP BY m.id HAVING :ruolo IS NULL OR sum(r.ruolo = :ruolo) > 0"
            " ORDER BY m.anno DESC, m.numero_pronuncia DESC, m.id"
            " LIMIT :size OFFSET :offset",
            {"key": key, "ruolo": ruolo, "size": size, "offset": (page - 1) * size}).fetchall()
    finally:
        db.close()
    return [{
        "numero": numero, "titolo": titolo, "testo": testo,
        "ruoli": sorted(set(ruoli.split(","))),
        "pronuncia": {
            "identita": {"corte": "corte_costituzionale", "numero": numero_pronuncia, "anno": anno},
            "tipo": tipo, "data_decisione": data_decisione, "data_deposito": data_deposito,
            "url": f"{PAGE_URL}/{anno}/{numero_pronuncia}",
        },
    } for (numero, anno, numero_pronuncia, tipo, data_decisione, data_deposito, titolo, testo,
           ruoli) in rows], counts


def index_built_at(index: Path) -> int | None:
    db = sqlite3.connect(f"file:{index}?mode=ro", uri=True)
    try:
        row = db.execute("SELECT value FROM meta WHERE key = 'built_at'").fetchone()
    finally:
        db.close()
    return int(row[0]) if row else None


# --- The reader -----------------------------------------------------------------------------

class MassimeUnavailable(Exception):
    """No index on disk to answer from: `in_preparazione` while the first one is being made,
    or the source could not be read."""

    def __init__(self, preparing: bool):
        super().__init__("in preparazione" if preparing else "fonte non raggiungibile")
        self.preparing = preparing


class CorteCostMassime:
    def __init__(self, cache_dir: Path, clock: Callable[[], float] = time.time,
                 first_build_wait: float = FIRST_BUILD_WAIT):
        self.cache_dir = cache_dir
        self.index = cache_dir / INDEX_NAME
        self.clock = clock
        self.first_build_wait = first_build_wait
        self._task: asyncio.Task | None = None
        self._checked_at: float | None = None
        self._failed_at: float | None = None

    async def _bundle(self, name: str, ttl: int) -> Path:
        path = self.cache_dir / name
        if path.exists() and self.clock() - path.stat().st_mtime < ttl:
            return path
        result = await decisions_http_client.request(
            "GET", f"{BASE_URL}/{name}", source="corte_cost", text_encoding="latin-1",
            timeout=_DOWNLOAD_TIMEOUT, headers=http_headers({"Accept": "application/zip"}))
        await asyncio.to_thread(_store_bundle, path, result.text)
        return path

    async def _refresh(self) -> None:
        """The bundles brought up to date (only the stale ones are downloaded), then the index
        rebuilt when one of them changed."""
        try:
            paths = [await self._bundle(name, OPEN_TTL if high == 9999 else CLOSED_TTL)
                     for _low, high, name in BUNDLES]
            signature = json.dumps([[p.name, int(p.stat().st_mtime), p.stat().st_size]
                                    for p in paths])
            if not self.index.exists() or await asyncio.to_thread(_signature, self.index) != signature:
                counts = await asyncio.to_thread(build_index, paths, self.index, signature)
                log.info("Corte costituzionale massime indexed", **counts)
                await asyncio.to_thread(_drop_old_indexes, self.cache_dir)
            self._checked_at, self._failed_at = self.clock(), None
        except Exception as exc:  # a cancellation is not an Exception: it propagates
            self._failed_at = self.clock()
            log.warning("Corte costituzionale massime not refreshed", error=str(exc),
                        error_type=type(exc).__name__)
            raise

    def _start_refresh(self) -> asyncio.Task:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._refresh())
            # read the outcome so a background failure is never "never retrieved"
            self._task.add_done_callback(lambda t: t.cancelled() or t.exception())
        return self._task

    async def _ready(self) -> Path:
        now = self.clock()
        if self.index.exists():
            if self._checked_at is None:
                self._checked_at = self.index.stat().st_mtime
            due = now - self._checked_at >= OPEN_TTL
            resting = self._failed_at is not None and now - self._failed_at < RETRY_AFTER
            if due and not resting:
                self._start_refresh()  # in the background: the index on disk answers now
            return self.index
        if self._failed_at is not None and now - self._failed_at < RETRY_AFTER \
                and (self._task is None or self._task.done()):
            raise MassimeUnavailable(preparing=False)
        task = self._start_refresh()
        try:
            await asyncio.wait_for(asyncio.shield(task), self.first_build_wait)
        except asyncio.TimeoutError:
            raise MassimeUnavailable(preparing=True) from None
        except Exception:
            raise MassimeUnavailable(preparing=False) from None
        return self.index

    async def massime_for(self, identity: str, page: int = 1, ruolo: str | None = None,
                          ) -> tuple[list[dict], dict[str, int], int | None]:
        """A page of the massime that name an article (or an act), in one role or in any, the
        counts by role, and when the index was built."""
        index = await self._ready()
        try:
            rows, counts = await asyncio.to_thread(query_index, index, identity, page,
                                                   PAGE_SIZE, ruolo)
            built_at = await asyncio.to_thread(index_built_at, index)
        except sqlite3.DatabaseError as exc:
            # a damaged index: dropped, so the next request builds it again from the bundles
            log.warning("Corte costituzionale massime index unreadable; dropped", error=str(exc))
            index.unlink(missing_ok=True)
            self._checked_at = self._failed_at = None
            raise MassimeUnavailable(preparing=True) from None
        return rows, counts, built_at


def _drop_old_indexes(cache_dir: Path) -> None:
    """The indexes of an earlier `INDEX_NAME` (about 110 MB each): no reader opens them again."""
    for old in cache_dir.glob("massime-v*.sqlite3"):
        if old.name != INDEX_NAME:
            old.unlink(missing_ok=True)


def _signature(index: Path) -> str | None:
    try:
        db = sqlite3.connect(f"file:{index}?mode=ro", uri=True)
        try:
            row = db.execute("SELECT value FROM meta WHERE key = 'signature'").fetchone()
        finally:
            db.close()
    except sqlite3.Error:
        return None  # a damaged index is built again
    return row[0] if row else None


# --- The route ------------------------------------------------------------------------------

_reader: CorteCostMassime | None = None


def get_massime_reader() -> CorteCostMassime:
    global _reader
    if _reader is None:
        _reader = CorteCostMassime(Path(PERSISTENT_CACHE_DIR) / "corte_cost" / "massime")
    return _reader


def article_identity(urn: Any) -> str | None:
    """The identity of the article a request names (`norma_data.urn`, any spelling the source
    convention reads), or None when it is not a State article of a NIR URN."""
    if not isinstance(urn, str) or len(urn) > 500:
        return None
    identity = normalize_norm_urn(urn)
    if not identity or not identity.startswith(f"{NORMATTIVA_RESOLVER}urn:nir:stato:") \
            or "~art" not in identity:
        return None
    return identity


async def search_massime(urn: Any, pagina: Any = 1, ruolo: Any = None,
                         reader: CorteCostMassime | None = None) -> tuple[dict, int]:
    """(the answer, the status): `risultati` 200 (a page of `PAGE_SIZE`, newest first),
    `richiesta_non_valida` 400, `fonte_non_raggiungibile` 503 (with `in_preparazione` while
    the first index is made). A `ruolo` (`norma` or `parametro`) keeps the massime that name the
    article in that role, and `totale` counts those; `per_ruolo` always counts both (G-289: on
    the Costituzione the web asks for `norma` first, and offers the rest)."""
    errors = {}
    identity = article_identity(urn)
    if identity is None:
        errors["urn"] = "atteso l'URN di un articolo di un atto dello Stato"
    if pagina is None:
        pagina = 1
    if isinstance(pagina, bool) or not isinstance(pagina, int) or not 1 <= pagina <= 10_000:
        errors["pagina"] = "atteso un intero da 1 a 10000"
    if ruolo is not None and ruolo not in ROLES:
        errors["ruolo"] = "atteso «norma» o «parametro»"
    if errors:
        return {"esito": "richiesta_non_valida", "errori": errors}, 400
    try:
        massime, counts, built_at = await (reader or get_massime_reader()).massime_for(
            identity, pagina, ruolo)
    except MassimeUnavailable as exc:
        return {"esito": "fonte_non_raggiungibile", "fonte": "corte_costituzionale",
                "in_preparazione": exc.preparing}, 503
    per_ruolo = {role: counts.get(role, 0) for role in ROLES}
    return {"esito": "risultati", "urn": identity, "pagina": pagina, "ruolo": ruolo,
            "per_pagina": PAGE_SIZE,
            "totale": per_ruolo[ruolo] if ruolo else counts["totale"],
            "per_ruolo": per_ruolo,
            "massime": massime,
            "fonte": SOURCE, "attribuzione": ATTRIBUTION,
            "aggiornato_al": (time.strftime("%Y-%m-%d", time.localtime(built_at))
                              if built_at else None)}, 200
