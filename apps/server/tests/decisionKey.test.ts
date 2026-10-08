import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inDecisionKeySpace, readDecisionKey } from '../src/norms/decisionKey';

const NOW = new Date('2026-10-08T00:00:00Z');

// The cases the server and the web share (conventions/sources/decision-keys.json): the web's
// identityFromKey is pinned to the same file, so the two cannot drift.
interface KeyCase { key: string; identity: Record<string, unknown> | null }
function fixture(): KeyCase[] {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'decision-keys.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).cases;
    if (dirname(dir) === dir) throw new Error('conventions/sources/decision-keys.json not found');
  }
}
const year = (s: string) => s.replace('{currentYear}', String(NOW.getFullYear())).replace('{nextYear}', String(NOW.getFullYear() + 1));

describe('readDecisionKey, the shared cases', () => {
  for (const c of fixture()) {
    const key = year(c.key);
    const identity = c.identity && { ...c.identity, anno: typeof c.identity.anno === 'string' ? Number(year(c.identity.anno)) : c.identity.anno };
    it(`${c.identity ? 'reads' : 'refuses'} ${JSON.stringify(key)}`, () => {
      expect(readDecisionKey(key, NOW)).toEqual(identity);
    });
  }
});

describe('inDecisionKeySpace', () => {
  it('knows the key space apart from validity', () => {
    expect(inDecisionKeySpace('cassazione:civile:007:2024')).toBe(true);
    expect(inDecisionKeySpace('corte_costituzionale:x')).toBe(true);
    expect(inDecisionKeySpace('codice-civile--art-2043')).toBe(false);
  });
});
