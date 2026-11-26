import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { LOCAL_CHECKS } from '../../scripts/local-schema';
import { parseChecks } from '../../scripts/localSql';
import { prisma } from '../helpers';
import { newLocalFile, openLocalFile } from './sqlite';

/**
 * The CHECK constraints of the tables the local mode writes (spec §2): every one Postgres enforces on those
 * tables has a twin in prisma/local/checks.sql, by name, and the local file refuses a row that breaks it.
 */
const checks = parseChecks(readFileSync(LOCAL_CHECKS, 'utf8'));
const tables = [...new Set(checks.map((c) => c.table))];

describe('the local tables keep the CHECK constraints of Postgres', () => {
  it('every CHECK live on these tables after the Postgres migrations has a twin in checks.sql', async () => {
    const live = await prisma.$queryRaw<{ name: string }[]>`
      SELECT con.conname::text AS name FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE con.contype = 'c' AND c.relnamespace = 'public'::regnamespace AND c.relname = ANY(${tables})`;
    expect(checks.map((c) => c.name).sort()).toEqual(live.map((r) => r.name).sort());
  });
});

// A row that satisfies every constraint of its table, then one change per constraint that breaks it alone.
const VALID: Record<string, Record<string, unknown>> = {
  tasks: {},
  highlights: { kind: 'mark', color: 'yellow' },
  dossier_items: { item_type: 'norm' },
  search_history: { act_type: 'codice civile', decision_key: null },
  assistant_note_versions: { highlight_id: 'h-1', dossier_item_id: null },
};
// One row per constraint that breaks it alone (the names must cover checks.sql), and below the boundaries.
const BREAKS: Record<string, Record<string, unknown>> = {
  tasks_priority_check: { priority: 5 },
  tasks_planned_time_check: { planned_time: '10:00', planned_date: null },
  tasks_due_time_check: { due_time: '10:00', due_date: null },
  tasks_duration_minutes_check: { duration_minutes: 0 },
  tasks_recurrence_day_check: { recurrence_day: 32 },
  tasks_parent_not_self_check: { id: 'same', parent_id: 'same' },
  highlights_assistant_mark_check: { created_by_client_id: 'client-1', dossier_item_id: null },
  highlights_assistant_note_check: { assistant_note: 'nota', created_by_client_id: null },
  highlights_gloss_colour_check: { kind: 'mark', color: null },
  highlights_gloss_note_check: { kind: 'gloss', color: null, created_by_client_id: null },
  highlights_review_comment_check: { review_comment: 'x'.repeat(501) },
  dossier_items_assistant_note_check: { note_state: 'proposed', assistant_note: null },
  dossier_items_review_comment_check: { review_comment: 'x'.repeat(501) },
  search_history_one_kind: { act_type: null, decision_key: null },
  assistant_note_versions_target_check: { highlight_id: null, dossier_item_id: null },
};

/** Every NOT NULL column without a default gets a value of its declared type (foreign keys are off here). */
function baseRow(db: Database.Database, table: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]) {
    if (!(col.notnull || col.pk) || col.dflt_value !== null) continue;
    const type = col.type.toUpperCase();
    row[col.name] = col.pk ? randomUUID()
      : type === 'INTEGER' || type === 'BIGINT' ? 1
      : type === 'BOOLEAN' ? 0
      : type === 'REAL' || type === 'DECIMAL' ? 1.5
      : type === 'DATETIME' ? new Date().toISOString().replace('Z', '+00:00')
      : type === 'JSONB' ? '{}'
      : type === 'BLOB' ? Buffer.from([0])
      : 'x';
  }
  return row;
}

function insert(db: Database.Database, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

describe('the local file refuses a row that breaks a CHECK', () => {
  const local = newLocalFile();
  const db = openLocalFile(local);
  afterAll(() => {
    db.close();
    local.remove();
  });

  it('covers every constraint of checks.sql here', () => {
    expect(Object.keys(BREAKS).sort()).toEqual(checks.map((c) => c.name).sort());
  });

  it.each(tables)('accepts a valid row in %s', (table) => {
    expect(() => insert(db, table, { ...baseRow(db, table), ...VALID[table] })).not.toThrow();
  });

  it.each(checks.map((c) => [c.name, c.table]))('refuses a row that breaks %s', (name, table) => {
    const row = { ...baseRow(db, table), ...VALID[table], ...BREAKS[name] };
    expect(() => insert(db, table, row)).toThrow(new RegExp(`CHECK constraint failed: ${name}`));
  });

  // The edges of each rule, both sides, so a twin that drops half a condition fails here too.
  const EDGES: Array<[string, string, Record<string, unknown>, string | null]> = [
    ['priority 0', 'tasks', { priority: 0 }, 'tasks_priority_check'],
    ['priority 1', 'tasks', { priority: 1 }, null],
    ['priority 4', 'tasks', { priority: 4 }, null],
    ['recurrence day 0', 'tasks', { recurrence_day: 0 }, 'tasks_recurrence_day_check'],
    ['recurrence day 1', 'tasks', { recurrence_day: 1 }, null],
    ['recurrence day 31', 'tasks', { recurrence_day: 31 }, null],
    ['duration 1', 'tasks', { duration_minutes: 1 }, null],
    ['a planned time with its date', 'tasks', { planned_time: '10:00', planned_date: '2026-11-26T00:00:00.000+00:00' }, null],
    ['a review comment of 500 characters', 'highlights', { review_comment: 'x'.repeat(500) }, null],
    ['a review comment with a NUL', 'highlights', { review_comment: 'a\u0000b' }, 'highlights_review_comment_check'],
    ['an assistant mark without its text', 'highlights', { created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: null, assistant_start_offset: 3 }, 'highlights_assistant_mark_check'],
    ['an assistant mark without its offset', 'highlights', { created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: 'passo', assistant_start_offset: null }, 'highlights_assistant_mark_check'],
    ['a whole assistant mark', 'highlights', { created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: 'passo', assistant_start_offset: 3 }, null],
    ['an assistant note without its state', 'highlights', { created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: 'passo', assistant_start_offset: 3, assistant_note: 'nota', note_state: null }, 'highlights_assistant_note_check'],
    ['a gloss with a blank note', 'highlights', { kind: 'gloss', color: null, created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: 'passo', assistant_start_offset: 3, note_state: 'proposed', assistant_note: 'n', note: '   ' }, 'highlights_gloss_note_check'],
    ['a whole gloss', 'highlights', { kind: 'gloss', color: null, created_by_client_id: 'client-1', dossier_item_id: 'item-1', assistant_text: 'passo', assistant_start_offset: 3, note_state: 'proposed', assistant_note: 'n', note: 'glossa' }, null],
    ['an assistant note on a norm entry', 'dossier_items', { item_type: 'norm', note_state: 'proposed', assistant_note: 'n', created_by_client_id: 'client-1' }, 'dossier_items_assistant_note_check'],
    ['an assistant note on a note entry, from a client', 'dossier_items', { item_type: 'note', note_state: 'proposed', assistant_note: 'n', created_by_client_id: 'client-1' }, null],
    ['an assistant note on a note entry, from no client', 'dossier_items', { item_type: 'note', note_state: 'proposed', assistant_note: 'n', created_by_client_id: null }, 'dossier_items_assistant_note_check'],
    ['a search of both kinds', 'search_history', { act_type: 'codice civile', decision_key: 'cass-1' }, 'search_history_one_kind'],
    ['a version of both targets', 'assistant_note_versions', { highlight_id: 'h-1', dossier_item_id: 'item-1' }, 'assistant_note_versions_target_check'],
  ];
  it.each(EDGES)('%s', (_label, table, change, refusedBy) => {
    const row = { ...baseRow(db, table), ...VALID[table], ...change };
    if (refusedBy) expect(() => insert(db, table, row)).toThrow(new RegExp(`CHECK constraint failed: ${refusedBy}`));
    else expect(() => insert(db, table, row)).not.toThrow();
  });
});
