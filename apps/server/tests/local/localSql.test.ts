import { describe, it, expect } from 'vitest';
import { ADAPTER_NOW, localSql, parseChecks } from '../../scripts/localSql';

/** The post-processing of local SQL (spec §2, §4): init.sql and every later local migration. */
const checks = parseChecks(`-- table: tasks
CONSTRAINT "tasks_priority_check" CHECK ("priority" >= 1 AND "priority" <= 4)
-- table: highlights
CONSTRAINT "highlights_review_comment_check" CHECK ("review_comment" IS NULL OR length("review_comment") <= 500)`);

const table = (name: string) => `CREATE TABLE "${name}" (\n    "id" TEXT NOT NULL PRIMARY KEY,\n    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);`;

describe('localSql', () => {
  it('gives every datetime default the adapter format and puts each CHECK inside its table', () => {
    const out = localSql(`${table('tasks')}\n${table('highlights')}`, checks);
    expect(out).not.toContain('CURRENT_TIMESTAMP');
    expect(out).toContain(`DEFAULT ${ADAPTER_NOW}`);
    expect(out).toMatch(/CREATE TABLE "tasks" \([^;]*CONSTRAINT "tasks_priority_check"[^;]*\n\);/);
    expect(out).toMatch(/CREATE TABLE "highlights" \([^;]*CONSTRAINT "highlights_review_comment_check"[^;]*\n\);/);
  });

  it('refuses init SQL that lacks a table checks.sql names', () => {
    expect(() => localSql(table('tasks'), checks)).toThrow(/checks.sql names table "highlights"/);
  });

  it('in a migration, gives a rebuilt table (new_<table>) its CHECKs and leaves the tables it does not touch', () => {
    const rebuild = [
      'PRAGMA foreign_keys=OFF;',
      table('new_tasks'),
      'INSERT INTO "new_tasks" SELECT * FROM "tasks";',
      'DROP TABLE "tasks";',
      'ALTER TABLE "new_tasks" RENAME TO "tasks";',
    ].join('\n');
    const out = localSql(rebuild, checks, { migration: true });
    expect(out).toMatch(/CREATE TABLE "new_tasks" \([^;]*CONSTRAINT "tasks_priority_check"[^;]*\n\);/);
    expect(out).not.toContain('highlights_review_comment_check');
    expect(localSql('ALTER TABLE "users" ADD COLUMN "x" TEXT;', checks, { migration: true })).toBe('ALTER TABLE "users" ADD COLUMN "x" TEXT;');
  });

  it('refuses a checks.sql line that is not a CHECK under a table', () => {
    expect(() => parseChecks('CONSTRAINT "x" CHECK (1)')).toThrow(/not a CHECK clause under a "-- table:" line/);
    expect(() => parseChecks('-- table: tasks\nALTER TABLE x')).toThrow();
  });
});
