/**
 * The SQL the desktop app's local database is made of, post-processed (spec §2,
 * docs/superpowers/specs/2026-11-26-desktop-local-mode-design.md). `prisma migrate diff` writes SQLite DDL from
 * the derived schema; two things are added here, for `prisma/local/init.sql` and for every later local migration:
 *
 * - every datetime default becomes the driver adapter's own format, `2026-11-26T21:23:56.349+00:00`. SQLite's
 *   `CURRENT_TIMESTAMP` writes `2026-11-26 21:23:56`, which compares wrongly as text against the adapter's values
 *   and reads back an hour off through raw SQL (measured);
 * - each table named in `prisma/local/checks.sql` gets its CHECK constraints inside its `CREATE TABLE`, since
 *   SQLite cannot add one to an existing table and the Postgres ones live in hand-written migration SQL.
 */

export const ADAPTER_NOW = "(strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))";

export type CheckClause = { table: string; name: string; clause: string };

/**
 * `checks.sql`: a `-- table: <name>` line opens a table; each other non-empty line that is not a comment is one
 * `CONSTRAINT "<name>" CHECK (...)` clause of that table, on one line.
 */
export function parseChecks(text: string): CheckClause[] {
  const out: CheckClause[] = [];
  let table: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const opens = /^--\s*table:\s*([a-z0-9_]+)\s*$/i.exec(line);
    if (opens) { table = opens[1]; continue; }
    if (line.startsWith('--')) continue;
    const named = /^CONSTRAINT\s+"([a-z0-9_]+)"\s+CHECK\s*\(.*\)$/i.exec(line);
    if (!table || !named) throw new Error(`checks.sql: not a CHECK clause under a "-- table:" line: ${line}`);
    out.push({ table, name: named[1], clause: line });
  }
  return out;
}

/** The DDL with the adapter's datetime default and each table's CHECKs; refuses a CHECK whose table is not there. */
export function localSql(diffSql: string, checks: CheckClause[]): string {
  let sql = diffSql.replace(/DEFAULT CURRENT_TIMESTAMP/g, `DEFAULT ${ADAPTER_NOW}`);
  const byTable = new Map<string, CheckClause[]>();
  for (const check of checks) byTable.set(check.table, [...(byTable.get(check.table) ?? []), check]);
  for (const [table, clauses] of byTable) {
    const start = sql.indexOf(`CREATE TABLE "${table}" (`);
    if (start < 0) throw new Error(`checks.sql names table "${table}", which the local schema does not create`);
    const end = sql.indexOf('\n);', start);
    if (end < 0) throw new Error(`no end of CREATE TABLE "${table}"`);
    const added = clauses.map((c) => `,\n    ${c.clause}`).join('');
    sql = sql.slice(0, end) + added + sql.slice(end);
  }
  return sql;
}
