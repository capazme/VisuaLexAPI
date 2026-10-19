import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rebuildNormEntry } from '../normEntry';

// The web's copy of the server's rebuildNormEntry, against the cases both copies share
// (conventions/sources/norm-entries.json): the same norm kept, the same refusal.
function fixture(): { cases: { id: string; input: unknown; entry?: unknown; reason?: string }[] } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'norm-entries.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/norm-entries.json not found');
  }
}

describe('rebuildNormEntry, the cases the server shares', () => {
  const { cases } = fixture();
  it('has kept and refused cases', () => {
    expect(cases.filter((c) => c.entry).length).toBeGreaterThan(5);
    expect(cases.filter((c) => c.reason).length).toBeGreaterThan(5);
  });
  for (const c of cases) {
    it(c.id, () => expect(rebuildNormEntry(c.input)).toEqual(c.reason ? { ok: false, reason: c.reason } : { ok: true, entry: c.entry }));
  }
});
