# services/visualex/visualex_api/services/massimario/store.py
"""The reviews' store: one SQLite file keyed by norm URN (design 2026-10-30-rassegne-without-merlt
§3 (a)).

The file name carries the schema version (`rassegne-v1.sqlite3`, in the API's data directory,
which git ignores). Every build writes a temporary file beside it and puts it in place whole
(`os.replace`), so a reader never sees half a store: a build of some volumes copies the other
volumes' rows from the current store, `remove_volumes` copies all but the ones named, and a
build deletes the files of older schema versions. Two builds never run at once (a lock file).

Reading is one indexed query per summary or page, on a read-only connection opened per call:
a missing store answers like a store with no paragraph for the norm (the panel draws nothing),
a store that exists but cannot be read, or whose schema version this code does not know, is
`StoreUnavailable` (a 503 at the route; design §2.5, §8: never a guess at an older layout).

The store is derived: deleting it costs one rebuild, and it is not in `scripts/datakit`.
"""
from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Optional

from ...tools.config import BASE_PATH
from .records import VolumeRecords, volume_dict

SCHEMA_VERSION = 1
STORE_NAME = f"rassegne-v{SCHEMA_VERSION}.sqlite3"
_OLDER = re.compile(r"rassegne-v(\d+)\.sqlite3")

# A record is a JSON text of 1-2 KB, so most rows overflow a 4 KB page: 16 KB pages hold the
# corpus in about 225 MB instead of 270 (measured on the 63 volumes, 31 October 2026).
_SCHEMA = """
PRAGMA page_size = 16384;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE volumes (
  id INTEGER PRIMARY KEY, titolo TEXT NOT NULL, anno INTEGER NOT NULL, archivio TEXT NOT NULL,
  numero INTEGER, parser_version INTEGER NOT NULL, built_at TEXT NOT NULL, source TEXT NOT NULL,
  report TEXT NOT NULL
);
CREATE TABLE sections (
  id INTEGER NOT NULL, volume_id INTEGER NOT NULL, numero TEXT NOT NULL, titolo TEXT NOT NULL,
  PRIMARY KEY (volume_id, id)
);
CREATE TABLE paragraphs (
  key TEXT PRIMARY KEY, volume_id INTEGER NOT NULL, section_id INTEGER NOT NULL,
  ordine INTEGER NOT NULL, anno INTEGER NOT NULL, archivio TEXT NOT NULL, record TEXT NOT NULL
);
CREATE INDEX paragraphs_by_volume ON paragraphs (volume_id, ordine);
CREATE TABLE norm_links (
  urn TEXT NOT NULL, paragraph_key TEXT NOT NULL, volume_id INTEGER NOT NULL,
  anno INTEGER NOT NULL, archivio TEXT NOT NULL, ordine INTEGER NOT NULL,
  PRIMARY KEY (urn, paragraph_key)
);
CREATE INDEX norm_links_by_urn ON norm_links (urn, anno, archivio, ordine);
CREATE TABLE decision_links (
  decision_key TEXT NOT NULL, paragraph_key TEXT NOT NULL, volume_id INTEGER NOT NULL,
  PRIMARY KEY (decision_key, paragraph_key)
);
CREATE TABLE resolved_acts (year_only_urn TEXT PRIMARY KEY, full_urn TEXT NOT NULL, resolved_at TEXT NOT NULL);
"""
_VOLUME_TABLES = ("volumes", "sections", "paragraphs", "norm_links", "decision_links")
_VOLUME_COLUMN = {"volumes": "id", "sections": "volume_id", "paragraphs": "volume_id",
                  "norm_links": "volume_id", "decision_links": "volume_id"}


class StoreUnavailable(Exception):
    """The store exists but cannot be read, or its schema version is not this code's."""


class StoreBusy(Exception):
    """Another build holds the store."""


def default_path() -> Path:
    """`RASSEGNE_STORE` when set (a file path), else the API's data directory."""
    override = os.getenv("RASSEGNE_STORE", "").strip()
    return Path(override) if override else BASE_PATH / "data" / STORE_NAME


# --- Reading --------------------------------------------------------------------------------

@contextlib.contextmanager
def _read(path: Path) -> Iterator[Optional[sqlite3.Connection]]:
    """A read-only connection to the store, or None when there is no store."""
    if not path.is_file():
        yield None
        return
    try:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        raise StoreUnavailable(str(exc)) from exc
    try:
        try:
            row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        except sqlite3.Error as exc:
            raise StoreUnavailable(str(exc)) from exc
        if row is None or row[0] != str(SCHEMA_VERSION):
            raise StoreUnavailable(f"schema del deposito sconosciuto: {row[0] if row else None!r}")
        yield conn
    except sqlite3.Error as exc:
        raise StoreUnavailable(str(exc)) from exc
    finally:
        conn.close()


def _record(text: str) -> dict:
    """A stored JSON value; one that does not parse is a store that cannot be read (a 503)."""
    try:
        return json.loads(text)
    except (TypeError, ValueError) as exc:
        raise StoreUnavailable(f"record illeggibile: {exc}") from exc


def _empty(urn: str) -> dict:
    return {"urn": urn, "total": 0, "anni": [], "archivi": [], "anno": None, "items": [], "next_cursor": None}


_PRONUNCIA_FIELDS = ("key", "corte", "archivio", "numero", "anno", "sezione", "rv")


def _item(record: dict, urn: str) -> dict:
    """A record as the panel reads it (`RassegnePasso`); no `label` on a decision: the web
    writes it from the fields (design §5)."""
    capitolo = record.get("capitolo")
    return {
        "id": record["paragraph_key"], "anno": record["anno"], "archivio": record["archivio"],
        "volume": record["volume"], "parte": record.get("parte"),
        "capitolo": {"nome": capitolo["nome"], "titolo": capitolo["titolo"]} if capitolo else None,
        "sezione": record["sezione"], "autori": capitolo["autori"] if capitolo else [],
        "url": record["url"], "testo": record["text"],
        "evidenziazioni": [
            {"start": n["start"], "end": n["end"], "citazione": n["citazione"], "comma": n.get("comma")}
            for n in record.get("norme", []) if n["urn"] == urn
        ],
        "pronunce": [{k: d.get(k) for k in _PRONUNCIA_FIELDS} for d in record.get("decisioni", [])],
        "fonte": record["fonte"],
    }


def by_norma(path: Path, urn: str, *, anno: Optional[int], archivio: Optional[str],
             offset: int, limit: int) -> dict:
    """The paragraphs citing `urn` (already the norm's identity), grouped by year, newest year
    first: the page of `anno` when it has paragraphs, else of the newest year."""
    with _read(path) as conn:
        if conn is None:
            return _empty(urn)
        where, params = "n.urn = ?", [urn]
        if archivio:
            where, params = where + " AND n.archivio = ?", params + [archivio]
        counts = dict(conn.execute(
            f"SELECT n.anno, COUNT(*) FROM norm_links n WHERE {where} GROUP BY n.anno", params).fetchall())
        if not counts:
            return _empty(urn)
        archivi = sorted(r[0] for r in conn.execute(
            "SELECT DISTINCT archivio FROM norm_links WHERE urn = ?", (urn,)).fetchall() if r[0])
        years = sorted(counts, reverse=True)
        target = anno if anno in counts else years[0]
        rows = conn.execute(
            f"SELECT p.record FROM norm_links n JOIN paragraphs p ON p.key = n.paragraph_key "
            f"WHERE {where} AND n.anno = ? ORDER BY n.ordine LIMIT ? OFFSET ?",
            params + [target, limit + 1, offset]).fetchall()
    page = [_record(r[0]) for r in rows[:limit]]
    return {
        "urn": urn,
        "total": sum(counts.values()),
        "anni": [{"anno": y, "passi": counts[y]} for y in years],
        "archivi": archivi,
        "anno": target,
        "items": [_item(record, urn) for record in page],
        "next_cursor": str(offset + limit) if len(rows) > limit else None,
    }


def volume_records(path: Path, volume_id: int) -> Optional[dict]:
    """A volume's records in reading order, with its parse report; None when the store does not
    hold it (or there is no store)."""
    with _read(path) as conn:
        if conn is None:
            return None
        row = conn.execute(
            "SELECT id, titolo, anno, archivio, numero, parser_version, built_at, source, report "
            "FROM volumes WHERE id = ?", (volume_id,)).fetchone()
        if row is None:
            return None
        records = [_record(r[0]) for r in conn.execute(
            "SELECT record FROM paragraphs WHERE volume_id = ? ORDER BY ordine", (volume_id,))]
        report = _record(row[8])
    return {
        "volume": {"id": row[0], "titolo": row[1], "anno": row[2], "archivio": row[3], "numero": row[4]},
        "parser_version": row[5], "built_at": row[6], "source": row[7],
        "report": report, "records": records,
    }


def list_volumes(path: Path) -> list[dict]:
    with _read(path) as conn:
        if conn is None:
            return []
        return [
            {"id": r[0], "titolo": r[1], "anno": r[2], "archivio": r[3], "numero": r[4],
             "parser_version": r[5], "built_at": r[6], "source": r[7], "paragrafi": r[8]}
            for r in conn.execute(
                "SELECT v.id, v.titolo, v.anno, v.archivio, v.numero, v.parser_version, v.built_at, v.source, "
                "(SELECT COUNT(*) FROM paragraphs p WHERE p.volume_id = v.id) FROM volumes v ORDER BY v.id")
        ]


def known_resolutions(path: Path) -> dict[str, str]:
    """Year-only URNs the store has already resolved: a rebuild does not ask Normattiva again."""
    with _read(path) as conn:
        if conn is None:
            return {}
        return dict(conn.execute("SELECT year_only_urn, full_urn FROM resolved_acts").fetchall())


# --- Writing --------------------------------------------------------------------------------

@contextlib.contextmanager
def _build_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_name(path.name + ".lock"), "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise StoreBusy(f"un'altra costruzione del deposito è in corso: {path}") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _insert_volume(conn: sqlite3.Connection, volume: VolumeRecords, source: str, built_at: str) -> None:
    meta = volume.meta
    v = volume_dict(meta)
    conn.execute("INSERT INTO volumes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 (v["id"], v["titolo"], v["anno"], v["archivio"], v["numero"],
                  volume.report["parser_version"], built_at, source,
                  json.dumps(volume.report, ensure_ascii=False, sort_keys=True)))
    sections: dict[int, tuple] = {}
    for record in volume.records:
        section = record["sezione"]
        sections.setdefault(section["id"], (section["id"], meta.volume_id, section["numero"], section["titolo"]))
        key = record["paragraph_key"]
        conn.execute("INSERT INTO paragraphs VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (key, meta.volume_id, section["id"], record["ordine"], record["anno"], record["archivio"],
                      json.dumps(record, ensure_ascii=False, separators=(",", ":"))))
        conn.executemany("INSERT INTO norm_links VALUES (?, ?, ?, ?, ?, ?)",
                         [(urn, key, meta.volume_id, record["anno"], record["archivio"], record["ordine"])
                          for urn in sorted({n["urn"] for n in record["norme"]})])
        conn.executemany("INSERT INTO decision_links VALUES (?, ?, ?)",
                         [(k, key, meta.volume_id)
                          for k in dict.fromkeys(d["key"] for d in record["decisioni"] if d["key"])])
    conn.executemany("INSERT INTO sections VALUES (?, ?, ?, ?)", list(sections.values()))


class Rewrite:
    """A new store being written beside the current one: `add` volumes and `remember`
    resolutions, then `rewrite`'s exit puts it in place whole; on an error nothing changes."""

    def __init__(self, conn: sqlite3.Connection, built_at: str, replacing: set[int]) -> None:
        self._conn, self._built_at, self._replacing = conn, built_at, replacing
        self._added: set[int] = set()

    def add(self, volume: VolumeRecords, source: str) -> None:
        volume_id = volume.meta.volume_id
        if volume_id not in self._replacing or volume_id in self._added:
            raise ValueError(f"volume {volume_id} non annunciato, o già aggiunto")
        _insert_volume(self._conn, volume, source, self._built_at)
        self._added.add(volume_id)

    def remember(self, resolved: dict[str, Optional[str]]) -> None:
        self._conn.executemany("INSERT OR REPLACE INTO resolved_acts VALUES (?, ?, ?)",
                               [(k, v, self._built_at) for k, v in sorted(resolved.items()) if v])


@contextlib.contextmanager
def rewrite(path: Path, replacing: Iterable[int]) -> Iterator[Rewrite]:
    """Copy the current store without the volumes in `replacing` into a temporary file beside
    it, let the caller add volumes, then put the file in place whole and delete the stores of
    older schema versions. A current store that cannot be read stops the build (its volumes
    would be lost): delete it, or move it away, and build again."""
    replacing = set(replacing)
    with _build_lock(path):
        built_at = _now()
        fd, tmp_name = tempfile.mkstemp(prefix=".rassegne-", suffix=".sqlite3.tmp", dir=path.parent)
        os.close(fd)
        tmp = Path(tmp_name)
        try:
            conn = sqlite3.connect(tmp.as_uri(), uri=True)
            try:
                conn.executescript(_SCHEMA)
                conn.execute("INSERT INTO meta VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
                conn.commit()
                with _read(path) as current:  # refuses a store it cannot read
                    readable = current is not None
                if readable:
                    _copy(path, conn, replacing)
                yield Rewrite(conn, built_at, replacing)
                conn.commit()
            finally:
                conn.close()
            os.chmod(tmp, 0o644)
            os.replace(tmp, path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    for older in path.parent.iterdir():
        found = _OLDER.fullmatch(older.name)
        if found and int(found.group(1)) < SCHEMA_VERSION:  # a newer release's store is left alone
            older.unlink(missing_ok=True)


def _copy(path: Path, conn: sqlite3.Connection, replacing: set[int]) -> None:
    """The current store's volumes but `replacing`, and every known resolution, copied inside
    SQLite (the corpus never passes through Python's memory)."""
    conn.execute("ATTACH DATABASE ? AS cur", (f"{path.resolve().as_uri()}?mode=ro",))
    try:
        # ints only, so the list is safe to write into the statement; with none to drop there is no
        # WHERE at all (`NOT IN (NULL)` would keep nothing)
        dropped = ",".join(str(int(v)) for v in sorted(replacing))
        for table in _VOLUME_TABLES:
            where = f" WHERE {_VOLUME_COLUMN[table]} NOT IN ({dropped})" if dropped else ""
            conn.execute(f"INSERT INTO main.{table} SELECT * FROM cur.{table}{where}")
        conn.execute("INSERT INTO main.resolved_acts SELECT * FROM cur.resolved_acts")
        conn.commit()
    finally:
        conn.execute("DETACH DATABASE cur")


def write_volumes(path: Path, volumes: list[tuple[VolumeRecords, str]],
                  resolved: Optional[dict[str, Optional[str]]] = None) -> None:
    """Put `volumes` (each with the source it was read from) in the store, replacing those
    volumes if present and keeping every other one; `resolved` joins the known resolutions."""
    ids = [v.meta.volume_id for v, _ in volumes]
    if len(set(ids)) != len(ids):
        raise ValueError("lo stesso volume due volte")
    with rewrite(path, ids) as new:
        for volume, source in volumes:
            new.add(volume, source)
        new.remember(resolved or {})


def remove_volumes(path: Path, volume_ids: Iterable[int]) -> None:
    """Take volumes out of the store (all their paragraphs and links), keeping the others."""
    if not path.is_file():
        return
    with rewrite(path, volume_ids):
        pass
