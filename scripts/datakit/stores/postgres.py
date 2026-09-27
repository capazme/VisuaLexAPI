"""Postgres: pg_dump -Fc per database, pg_restore into an empty database."""
from __future__ import annotations

from pathlib import Path

from datakit.sh import image_of, run
from datakit.target import DB_OWNERS, Target


def _psql(t: Target, db: str, sql: str) -> str:
    return run(["docker", "exec", t.pg_container, "psql", "-U", t.pg_user, "-d", db,
                "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", sql])


def tables(t: Target, db: str) -> list[str]:
    out = _psql(t, db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
    return [line for line in out.splitlines() if line]


def count(t: Target) -> dict:
    counts = {}
    for db in t.databases:
        names = tables(t, db)
        if not names:
            counts[db] = {}
            continue
        union = " UNION ALL ".join(
            "SELECT '{0}', count(*) FROM public.\"{1}\"".format(n.replace("'", "''"), n.replace('"', '""'))
            for n in names
        )
        rows = [row.split("|") for row in _psql(t, db, union).splitlines() if row]
        counts[db] = {name: int(n) for name, n in rows}
    return counts


def backup(t: Target, out: Path) -> dict:
    folder = out / "postgres"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for db in t.databases:
        with (folder / f"{db}.dump").open("wb") as handle:
            run(["docker", "exec", t.pg_container, "pg_dump", "-U", t.pg_user, "-Fc", db], stdout=handle)
    return {"image": image_of(t.pg_container), "databases": list(t.databases), "counts": counts}


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    for db in entry["databases"]:
        if tables(t, db) and not force:
            raise RuntimeError(f"postgres/{db} is not empty: pass --force to replace it")
        args = ["docker", "exec", "-i", t.pg_container, "pg_restore", "-U", t.pg_user, "-d", db,
                "--no-owner", "--no-privileges", f"--role={DB_OWNERS.get(db, t.pg_user)}", "--exit-on-error"]
        if force:
            args += ["--clean", "--if-exists"]
        with (src / "postgres" / f"{db}.dump").open("rb") as handle:
            run(args, stdin=handle)
