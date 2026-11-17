import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isRecitalContent, rebuildRecitalEntry } from '../../src/schemas/recitalEntry';

// The cases the server and the web share (conventions/sources/recital-entries.json; spec
// docs/superpowers/specs/2026-11-17-eu-recitals-design.md §2.4): the web's copy is pinned to the same file.
interface Case { id: string; input: unknown; entry?: unknown; star?: unknown; reason?: string }
function fixture(): { cases: Case[] } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'recital-entries.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/recital-entries.json not found');
  }
}

describe('rebuildRecitalEntry, the shared cases', () => {
  for (const c of fixture().cases) {
    const expected = c.reason
      ? { ok: false, reason: c.reason }
      : { ok: true, entry: c.entry, ...(c.star !== undefined ? { star: c.star } : {}) };
    it(c.id, () => expect(rebuildRecitalEntry(c.input)).toEqual(expected));
  }
});

describe('isRecitalContent: the key decides', () => {
  it('is a recital whatever the value', () => {
    expect(isRecitalContent({ considerando: null })).toBe(true);
    expect(isRecitalContent({ considerando: '', _dossierMeta: { important: true } })).toBe(true);
  });
  it('is an article without the key', () => {
    expect(isRecitalContent({ tipo_atto: 'regolamento ue', numero_articolo: '5' })).toBe(false);
    expect(isRecitalContent(null)).toBe(false);
    expect(isRecitalContent(['considerando'])).toBe(false);
  });
});
