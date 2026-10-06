import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rebuildNormEntry } from '../../src/schemas/normEntry';

// The cases the server and the web app share (conventions/sources/norm-entries.json): the web's
// copy of rebuildNormEntry is pinned to the same file, so the two cannot drift.
function fixture(): { cases: { id: string; input: unknown; entry?: unknown; reason?: string }[] } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'norm-entries.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/norm-entries.json not found');
  }
}

describe('rebuildNormEntry, the shared cases', () => {
  for (const c of fixture().cases) {
    it(c.id, () => expect(rebuildNormEntry(c.input)).toEqual(c.reason ? { ok: false, reason: c.reason } : { ok: true, entry: c.entry }));
  }
});
