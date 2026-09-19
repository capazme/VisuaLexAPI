"""The archive: one SQLite file, one transaction per write.

`text_hash` is the change registry — a unit is "updated" only when the sha256
of its text moves. Everything else on the row (rubrica, position, headings,
fingerprint, dates) is refreshed silently, because none of it is what the
owner reads — on a fetch through `upsert_unit`, and on an unchanged article
through `refresh_structure`, so an insertion before it still moves it. Time
never comes from here: callers pass ISO strings, so tests are exact and a
run's timestamps are consistent.

Act-level enrichments (attuazione, base_ue) use `unit_id = ""` rather than
NULL so the (act_id, unit_id, kind) key stays a plain UNIQUE.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Iterator


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


@dataclass
class ActRecord:
    id: str
    area: str
    label: str
    source: str
    identifier: str | None
    act_type: str
    date: str | None
    act_number: str | None
    annex: str | None
    source_url: str | None
    text_status: str
    consolidated_celex: str | None


@dataclass
class UnitRecord:
    id: str
    act_id: str
    kind: str
    number: str
    position: int
    identifier: str | None
    rubrica: str | None
    parte: str | None
    libro: str | None
    titolo: str | None
    capo: str | None
    sezione: str | None
    text: str
    fingerprint: str | None
    abrogato: bool
    version: str
    vigenza_al: str
    ultimo_aggiornamento: str | None
    source_url: str | None
    fetched_at: str

    @property
    def text_hash(self) -> str:
        return text_hash(self.text)


_UNIT_COLUMNS = [f.name for f in fields(UnitRecord)]
_ACT_COLUMNS = [f.name for f in fields(ActRecord)]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS acts (
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    identifier TEXT,
    act_type TEXT NOT NULL,
    date TEXT,
    act_number TEXT,
    annex TEXT,
    source_url TEXT,
    text_status TEXT NOT NULL,
    consolidated_celex TEXT,
    unit_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    act_id TEXT NOT NULL REFERENCES acts(id),
    kind TEXT NOT NULL,
    number TEXT NOT NULL,
    position INTEGER NOT NULL,
    identifier TEXT,
    rubrica TEXT,
    parte TEXT,
    libro TEXT,
    titolo TEXT,
    capo TEXT,
    sezione TEXT,
    text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    fingerprint TEXT,
    abrogato INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL,
    vigenza_al TEXT NOT NULL,
    ultimo_aggiornamento TEXT,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    first_seen_run INTEGER NOT NULL,
    last_changed_run INTEGER NOT NULL,
    last_checked_run INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS units_by_act ON units(act_id, kind, position);
CREATE TABLE IF NOT EXISTS enrichments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    act_id TEXT NOT NULL,
    unit_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    tool TEXT NOT NULL,
    params_json TEXT NOT NULL,
    content_md TEXT,
    content_json TEXT,
    content_hash TEXT,
    fetched_at TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    UNIQUE (act_id, unit_id, kind)
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    args_json TEXT NOT NULL,
    status TEXT NOT NULL,
    stats_json TEXT
);
CREATE TABLE IF NOT EXISTS unit_log (
    run_id INTEGER NOT NULL,
    unit_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    reason TEXT,
    PRIMARY KEY (run_id, unit_id)
);
"""


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(self.path), isolation_level=None)  # autocommit; explicit BEGIN below
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode = WAL")
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.executescript(_SCHEMA)

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- runs ---------------------------------------------------------------

    def start_run(self, args: dict, started_at: str) -> int:
        cur = self._db.execute(
            "INSERT INTO runs (started_at, args_json, status) VALUES (?, ?, 'running')",
            (started_at, json.dumps(args, ensure_ascii=False, sort_keys=True)),
        )
        return int(cur.lastrowid)

    def finish_run(self, run_id: int, status: str, finished_at: str, stats: dict) -> None:
        self._db.execute(
            "UPDATE runs SET status = ?, finished_at = ?, stats_json = ? WHERE id = ?",
            (status, finished_at, json.dumps(stats, ensure_ascii=False, sort_keys=True), run_id),
        )

    def mark_running_as_interrupted(self) -> list[int]:
        rows = self._db.execute("SELECT id FROM runs WHERE status = 'running' ORDER BY id").fetchall()
        ids = [int(r["id"]) for r in rows]
        if ids:
            self._db.execute("UPDATE runs SET status = 'interrupted' WHERE status = 'running'")
        return ids

    def reopen_run(self, run_id: int) -> None:
        """`--resume`: the interrupted run continues under its own id."""
        self._db.execute("UPDATE runs SET status = 'running', finished_at = NULL WHERE id = ?", (run_id,))

    def latest_interrupted_run(self) -> int | None:
        row = self._db.execute(
            "SELECT id FROM runs WHERE status = 'interrupted' ORDER BY id DESC LIMIT 1").fetchone()
        return int(row["id"]) if row else None

    def get_run(self, run_id: int) -> dict | None:
        row = self._db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return self._run_dict(row) if row else None

    def latest_run(self) -> dict | None:
        row = self._db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        return self._run_dict(row) if row else None

    @staticmethod
    def _run_dict(row) -> dict:
        return {
            "id": int(row["id"]),
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "status": row["status"],
            "args": json.loads(row["args_json"] or "{}"),
            "stats": json.loads(row["stats_json"]) if row["stats_json"] else None,
        }

    # -- acts ---------------------------------------------------------------

    def upsert_act(self, record: ActRecord, unit_count: int, updated_at: str) -> None:
        values = asdict(record)
        values["unit_count"] = unit_count
        values["updated_at"] = updated_at
        columns = list(values)
        placeholders = ", ".join("?" for _ in columns)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "id")
        self._db.execute(
            f"INSERT INTO acts ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}",
            [values[c] for c in columns],
        )

    def acts(self) -> list[ActRecord]:
        rows = self._db.execute("SELECT * FROM acts ORDER BY area, id").fetchall()
        return [ActRecord(**{c: row[c] for c in _ACT_COLUMNS}) for row in rows]

    def get_act(self, act_id: str) -> ActRecord | None:
        row = self._db.execute("SELECT * FROM acts WHERE id = ?", (act_id,)).fetchone()
        return ActRecord(**{c: row[c] for c in _ACT_COLUMNS}) if row else None

    def act_unit_count(self, act_id: str) -> int:
        row = self._db.execute("SELECT unit_count FROM acts WHERE id = ?", (act_id,)).fetchone()
        return int(row["unit_count"]) if row else 0

    # -- units --------------------------------------------------------------

    def get_unit(self, unit_id: str) -> UnitRecord | None:
        row = self._db.execute("SELECT * FROM units WHERE id = ?", (unit_id,)).fetchone()
        return self._unit_from_row(row) if row else None

    @staticmethod
    def _unit_from_row(row) -> UnitRecord:
        values = {c: row[c] for c in _UNIT_COLUMNS}
        values["abrogato"] = bool(values["abrogato"])
        return UnitRecord(**values)

    def upsert_unit(self, record: UnitRecord, run_id: int) -> str:
        values = asdict(record)
        values["abrogato"] = int(record.abrogato)
        values["text_hash"] = record.text_hash
        existing = self._db.execute(
            "SELECT text_hash FROM units WHERE id = ?", (record.id,)).fetchone()
        self._db.execute("BEGIN")
        try:
            if existing is None:
                columns = list(values) + ["first_seen_run", "last_changed_run", "last_checked_run"]
                params = [values[c] for c in values] + [run_id, run_id, run_id]
                self._db.execute(
                    f"INSERT INTO units ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                    params,
                )
                outcome = "new"
            else:
                changed = existing["text_hash"] != values["text_hash"]
                columns = [c for c in values if c != "id"]
                sets = ", ".join(f"{c} = ?" for c in columns) + ", last_checked_run = ?"
                params = [values[c] for c in columns] + [run_id]
                if changed:
                    sets += ", last_changed_run = ?"
                    params.append(run_id)
                params.append(record.id)
                self._db.execute(f"UPDATE units SET {sets} WHERE id = ?", params)
                outcome = "updated" if changed else "unchanged"
            self._db.execute("COMMIT")
        except Exception:
            self._db.execute("ROLLBACK")
            raise
        return outcome

    def touch_checked(self, unit_id: str, run_id: int, vigenza_al: str) -> None:
        self._db.execute(
            "UPDATE units SET last_checked_run = ?, vigenza_al = ? WHERE id = ?",
            (run_id, vigenza_al, unit_id),
        )

    def refresh_structure(self, unit_id: str, *, position: int, parte: str | None, libro: str | None,
                          titolo: str | None, capo: str | None, sezione: str | None, rubrica: str | None,
                          abrogato: bool, fingerprint: str | None, ultimo_aggiornamento: str | None,
                          run_id: int, vigenza_al: str) -> None:
        """An unchanged article's place in the act, re-read from this run's
        index: position, headings, rubrica, repeal flag, fingerprint and the
        dates of the check. `text`, `text_hash` and `last_changed_run` are
        deliberately not here — nothing was fetched, so nothing changed."""
        self._db.execute(
            "UPDATE units SET position = ?, parte = ?, libro = ?, titolo = ?, capo = ?, sezione = ?, "
            "rubrica = ?, abrogato = ?, fingerprint = ?, ultimo_aggiornamento = ?, "
            "last_checked_run = ?, vigenza_al = ? WHERE id = ?",
            (position, parte, libro, titolo, capo, sezione, rubrica, int(bool(abrogato)), fingerprint,
             ultimo_aggiornamento, run_id, vigenza_al, unit_id),
        )

    def unit_run_columns(self, unit_id: str) -> tuple[int, int, int]:
        row = self._db.execute(
            "SELECT first_seen_run, last_changed_run, last_checked_run FROM units WHERE id = ?",
            (unit_id,)).fetchone()
        return (int(row["first_seen_run"]), int(row["last_changed_run"]), int(row["last_checked_run"]))

    def units_for_act(self, act_id: str) -> list[UnitRecord]:
        rows = self._db.execute(
            "SELECT * FROM units WHERE act_id = ? ORDER BY CASE kind WHEN 'article' THEN 0 ELSE 1 END, position",
            (act_id,)).fetchall()
        return [self._unit_from_row(r) for r in rows]

    def unit_ids_for_act(self, act_id: str) -> set[str]:
        rows = self._db.execute("SELECT id FROM units WHERE act_id = ?", (act_id,)).fetchall()
        return {r["id"] for r in rows}

    def fingerprints_for_act(self, act_id: str) -> dict[str, str]:
        rows = self._db.execute(
            "SELECT number, fingerprint FROM units WHERE act_id = ? AND kind = 'article' AND fingerprint IS NOT NULL",
            (act_id,)).fetchall()
        return {r["number"]: r["fingerprint"] for r in rows}

    # -- enrichments ---------------------------------------------------------

    def get_enrichment(self, act_id: str, unit_id: str, kind: str) -> dict | None:
        row = self._db.execute(
            "SELECT * FROM enrichments WHERE act_id = ? AND unit_id = ? AND kind = ?",
            (act_id, unit_id or "", kind)).fetchone()
        return self._enrichment_dict(row) if row else None

    def upsert_enrichment(self, act_id: str, unit_id: str, kind: str, tool: str, params: dict,
                          content_md: str | None, content_json, status: str, error: str | None,
                          fetched_at: str, run_id: int) -> None:
        content_hash = text_hash(content_md) if content_md else (
            text_hash(json.dumps(content_json, ensure_ascii=False, sort_keys=True)) if content_json is not None else None)
        self._db.execute(
            "INSERT INTO enrichments (act_id, unit_id, kind, tool, params_json, content_md, content_json, "
            "content_hash, fetched_at, run_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(act_id, unit_id, kind) DO UPDATE SET tool = excluded.tool, "
            "params_json = excluded.params_json, content_md = excluded.content_md, "
            "content_json = excluded.content_json, content_hash = excluded.content_hash, "
            "fetched_at = excluded.fetched_at, run_id = excluded.run_id, status = excluded.status, "
            "error = excluded.error",
            (act_id, unit_id or "", kind, tool, json.dumps(params, ensure_ascii=False, sort_keys=True),
             content_md, json.dumps(content_json, ensure_ascii=False) if content_json is not None else None,
             content_hash, fetched_at, run_id, status, error),
        )

    def enrichments_for_act(self, act_id: str) -> list[dict]:
        rows = self._db.execute(
            "SELECT * FROM enrichments WHERE act_id = ? ORDER BY unit_id, kind", (act_id,)).fetchall()
        return [self._enrichment_dict(r) for r in rows]

    @staticmethod
    def _enrichment_dict(row) -> dict:
        return {
            "act_id": row["act_id"],
            "unit_id": row["unit_id"],
            "kind": row["kind"],
            "tool": row["tool"],
            "params": json.loads(row["params_json"] or "{}"),
            "content_md": row["content_md"],
            "content_json": json.loads(row["content_json"]) if row["content_json"] else None,
            "content_hash": row["content_hash"],
            "fetched_at": row["fetched_at"],
            "run_id": int(row["run_id"]),
            "status": row["status"],
            "error": row["error"],
        }

    # -- log ----------------------------------------------------------------

    def log_unit(self, run_id: int, unit_id: str, outcome: str, reason: str | None = None) -> None:
        self._db.execute(
            "INSERT INTO unit_log (run_id, unit_id, outcome, reason) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(run_id, unit_id) DO UPDATE SET outcome = excluded.outcome, reason = excluded.reason",
            (run_id, unit_id, outcome, reason),
        )

    def logged_unit_ids(self, run_id: int) -> set[str]:
        rows = self._db.execute("SELECT unit_id FROM unit_log WHERE run_id = ?", (run_id,)).fetchall()
        return {r["unit_id"] for r in rows}

    def act_changed_in_run(self, act_id: str, run_id: int) -> bool:
        row = self._db.execute(
            "SELECT 1 FROM unit_log l JOIN units u ON u.id = l.unit_id "
            "WHERE l.run_id = ? AND u.act_id = ? AND l.outcome IN ('new', 'updated') LIMIT 1",
            (run_id, act_id)).fetchone()
        if row:
            return True
        row = self._db.execute(
            "SELECT 1 FROM enrichments WHERE act_id = ? AND run_id = ? LIMIT 1", (act_id, run_id)).fetchone()
        return row is not None

    # -- export -------------------------------------------------------------

    def iter_units(self) -> Iterator[dict]:
        rows = self._db.execute(
            "SELECT u.*, a.area, a.label AS act_label FROM units u JOIN acts a ON a.id = u.act_id "
            "ORDER BY a.area, a.id, CASE u.kind WHEN 'article' THEN 0 ELSE 1 END, u.position").fetchall()
        for row in rows:
            record = dict(row)
            record["abrogato"] = bool(record["abrogato"])
            record["enrichments"] = [
                self._enrichment_dict(e) for e in self._db.execute(
                    "SELECT * FROM enrichments WHERE unit_id = ? ORDER BY kind", (row["id"],)).fetchall()
            ]
            yield record
