import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decisionKey, identityFromKey, isDecisionKey } from '../decisionLinks';

const NOW = new Date('2026-10-07T12:00:00Z');

// The cases the web and the server share (conventions/sources/decision-keys.json): the server's
// readDecisionKey is pinned to the same file, so the two cannot drift.
interface KeyCase { key: string; identity: Record<string, unknown> | null }
function fixture(): KeyCase[] {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'decision-keys.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).cases;
    if (dirname(dir) === dir) throw new Error('conventions/sources/decision-keys.json not found');
  }
}
const year = (s: string) => s.replace('{currentYear}', String(NOW.getFullYear())).replace('{nextYear}', String(NOW.getFullYear() + 1));

describe('identityFromKey, the shared cases', () => {
  for (const c of fixture()) {
    const key = year(c.key);
    const identity = c.identity && { ...c.identity, anno: typeof c.identity.anno === 'string' ? Number(year(c.identity.anno)) : c.identity.anno };
    it(`${c.identity ? 'reads' : 'refuses'} ${JSON.stringify(key)}`, () => {
      expect(identityFromKey(key, NOW)).toEqual(identity);
    });
  }
});

describe('identityFromKey', () => {
  it('round-trips with decisionKey', () => {
    for (const key of ['cassazione:civile:99999:2024', 'cassazione:penale:99999:1900', 'corte_costituzionale:99999:2020']) {
      expect(decisionKey(identityFromKey(key, NOW)!), key).toBe(key);
    }
  });

  it('tells a decision key from a norm key', () => {
    expect(isDecisionKey('cassazione:civile:99999:2024')).toBe(true);
    expect(isDecisionKey('codice-civile--2043')).toBe(false);
  });
});
