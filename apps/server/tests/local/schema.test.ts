import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCAL_CHECKS, LOCAL_INIT, LOCAL_SCHEMA, SOURCE, deriveLocalSchema, diffFromEmpty } from '../../scripts/local-schema';
import { localSql, parseChecks } from '../../scripts/localSql';

/** The desktop app's local schema (G-612, spec §2): derived from the server's, never written by hand. */
describe('the local schema', () => {
  const source = readFileSync(SOURCE, 'utf8');
  const local = readFileSync(LOCAL_SCHEMA, 'utf8');
  const names = (text: string, kind: 'model' | 'enum') => [...text.matchAll(new RegExp(`^${kind} (\\w+) \\{`, 'gm'))].map((m) => m[1]).sort();
  const maps = (text: string) => [...text.matchAll(/@@?map\("([^"]+)"\)/g)].map((m) => m[1]).sort();

  it('is what scripts/local-schema.ts derives from schema.prisma (npm run local:schema)', () => {
    expect(local).toBe(deriveLocalSchema(source));
  });

  it('has every model and enum of schema.prisma, with the same @map names', () => {
    expect(names(local, 'model')).toEqual(names(source, 'model'));
    expect(names(local, 'enum')).toEqual(names(source, 'enum'));
    expect(maps(local)).toEqual(maps(source));
  });

  it('keeps no native type, no scalar list, and a "[]" default for every list, with one or not in the source', () => {
    expect(local).not.toMatch(/@db\./);
    const models = new Set(names(source, 'model'));
    const lists = [...local.matchAll(/^\s+\w+\s+(\w+)\[\]/gm)].filter((m) => !models.has(m[1]));
    expect(lists).toEqual([]);
    // Every scalar list now defaults to "[]" (Prisma reads a list without a default as [] on Postgres), beside the
    // Json fields that already did.
    const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
    const sourceLists = [...source.matchAll(/^\s+\w+\s+(\w+)\[\]/gm)].filter((m) => !models.has(m[1])).length;
    expect(count(local, /@default\("\[\]"\)/g)).toBe(sourceLists + count(source, /@default\("\[\]"\)/g));
  });

  it('writes the local client to src/generated/prisma-local with the small query compiler, on SQLite', () => {
    expect(local).toMatch(/output\s+=\s+"\.\.\/\.\.\/src\/generated\/prisma-local"/);
    expect(local).toMatch(/compilerBuild\s+=\s+"small"/);
    expect(local).toMatch(/datasource db \{\s*provider = "sqlite"/);
  });

  it('init.sql leaves no JSON default unquoted', () => {
    expect(readFileSync(LOCAL_INIT, 'utf8')).not.toMatch(/ DEFAULT [[{]/);
  });

  it("init.sql is the local schema's migrate diff, post-processed (npm run local:schema)", () => {
    const expected = localSql(diffFromEmpty(), parseChecks(readFileSync(LOCAL_CHECKS, 'utf8')));
    expect(readFileSync(LOCAL_INIT, 'utf8')).toBe(expected);
  }, 60_000);
});
