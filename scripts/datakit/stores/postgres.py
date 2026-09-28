"""Postgres: pg_dump -Fc per database, pg_restore into an empty database."""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from datakit.sh import image_of, run
from datakit.target import DB_OWNERS, Target


def _psql(t: Target, db: str, sql: str) -> str:
    return run(["docker", "exec", t.pg_container, "psql", "-U", t.pg_user, "-d", db,
                "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", sql])


# Migration bookkeeping: a freshly migrated database has rows here and nowhere else.
BOOKKEEPING = ("_prisma_migrations", "alembic_version")


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


def schema_level(t: Target, db: str) -> str | None:
    """The migration a database is at: Prisma's last applied one, or Alembic's revision."""
    names = set(tables(t, db))
    if "_prisma_migrations" in names:
        sql = ("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL "
               "ORDER BY migration_name DESC LIMIT 1")
        return _psql(t, db, sql).strip() or None
    if "alembic_version" in names:
        return _psql(t, db, "SELECT version_num FROM alembic_version LIMIT 1").strip() or None
    return None


def backup(t: Target, out: Path) -> dict:
    folder = out / "postgres"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for db in t.databases:
        with (folder / f"{db}.dump").open("wb") as handle:
            run(["docker", "exec", t.pg_container, "pg_dump", "-U", t.pg_user, "-Fc", db], stdout=handle)
    return {"image": image_of(t.pg_container), "databases": list(t.databases), "counts": counts,
            "schema": {db: schema_level(t, db) for db in t.databases}}


def is_empty(t: Target, db: str) -> bool:
    """No user rows: tables may exist (start.sh migrates) as long as they are empty."""
    counts = count(replace(t, databases=(db,)))[db]
    return not any(rows for name, rows in counts.items() if name not in BOOKKEEPING)


def check(t: Target, entry: dict, force: bool) -> None:
    for db in entry["databases"]:
        if not force and not is_empty(t, db):
            raise RuntimeError(f"postgres/{db} is not empty: pass --force to replace it")


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    check(t, entry, force)
    for db in entry["databases"]:
        # One transaction: a failure leaves the database as it was, not half loaded.
        args = ["docker", "exec", "-i", t.pg_container, "pg_restore", "-U", t.pg_user, "-d", db,
                "--no-owner", "--no-privileges", f"--role={DB_OWNERS.get(db, t.pg_user)}", "--exit-on-error",
                "--single-transaction"]
        if tables(t, db):
            # Empty tables left by a migration, or --force: replace what the dump holds.
            args += ["--clean", "--if-exists"]
        with (src / "postgres" / f"{db}.dump").open("rb") as handle:
            run(args, stdin=handle)
