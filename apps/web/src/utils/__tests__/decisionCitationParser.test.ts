import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDecisionCitation } from '../decisionCitationParser';

// The words and what they read as live in the convention's golden file (decision_citations), which
// the Python API's /parse_decision will assert too (design 2026-10-12, Part A): the two parsers
// cannot drift apart.
function findGolden(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'conventions', 'sources', 'golden.json');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('conventions/sources/golden.json not found above ' + from);
  }
}

interface Expected { value: unknown; status: string }
interface CitationCase { input: string; reference: Expected; unsupported_court?: Expected }
const { today, cases } = (JSON.parse(readFileSync(findGolden(__dirname), 'utf8')) as {
  decision_citations: { today: string; cases: CitationCase[] };
}).decision_citations;
const NOW = new Date(`${today}T12:00:00Z`);
const ASSERTED = new Set(['decided', 'current', 'proposed']);
const asserted = cases.filter((c) => ASSERTED.has(c.reference.status));
const open = cases.filter((c) => !ASSERTED.has(c.reference.status));

describe('parseDecisionCitation', () => {
  it('reads the cases of the golden file', () => expect(asserted.length).toBeGreaterThan(30));

  for (const c of asserted) {
    // a court without a reader is the API's to name: the palette leaves those words to the norm parser
    it(c.input, () => expect(parseDecisionCitation(c.input, { now: NOW })).toEqual(c.reference.value));
  }

  // Waiting for the owner (the courts of the Union, design 2026-10-12 §8): listed, not asserted.
  it.skip.each(open.map((c) => [c.reference.status, c.input]))('%s: %s', () => {});

  it("leaves the input to the user's alias that starts it", () => {
    expect(parseDecisionCitation('cass 99999/2024', { aliasTriggers: ['cass'], now: NOW })).toBeNull();
  });

  it('compares alias triggers without dots, on both sides', () => {
    expect(parseDecisionCitation('cass 99999/2024', { aliasTriggers: ['cass.'], now: NOW })).toBeNull();
    expect(parseDecisionCitation('cass. 99999/2024', { aliasTriggers: ['cass'], now: NOW })).toBeNull();
  });

  it('returns quickly on a long hostile paste', () => {
    const hostile = 'Cass. ' + 'n. 1 '.repeat(5000);
    const start = performance.now();
    expect(parseDecisionCitation(hostile, { now: NOW })).toBeNull();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
