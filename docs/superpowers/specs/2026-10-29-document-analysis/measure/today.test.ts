// Measuring sketch for the spec (not product code): today's matcher over the corpus.
// Copy into apps/web/src/ and run there — see README.md. MEASURE_DIR is the folder corpus.py wrote.
import { it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extractCitations } from './utils/citationMatcher';

it('measure today', () => {
  const dir = process.env.MEASURE_DIR as string;
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(`${dir}/plain`).filter((n) => n.endsWith('.txt'))) {
    const text = readFileSync(`${dir}/plain/${f}`, 'utf8');
    // As the page calls it: no norm in reading, so bare articles are never matched.
    out[f] = extractCitations(text).map((c) => ({ start: c.startIndex, end: c.endIndex, text: c.text, ...c.parsed }));
  }
  writeFileSync(`${dir}/today.json`, JSON.stringify(out, null, 1));
});
