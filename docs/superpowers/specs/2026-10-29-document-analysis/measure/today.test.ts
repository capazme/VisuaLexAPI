// Measuring sketch for the spec (not product code): today's matcher over the corpus, and the client parser's reading
// of the proposed path's query strings. Copy into apps/web/src/ and run there — see README.md. MEASURE_DIR is the
// folder corpus.py and proposed.py wrote.
import { it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extractCitations } from './utils/citationMatcher';
import { isSearchReady, parseLegalCitation } from './utils/citationParser';

it('measure today', () => {
  const dir = process.env.MEASURE_DIR as string;
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(`${dir}/plain`).filter((n) => n.endsWith('.txt'))) {
    const text = readFileSync(`${dir}/plain/${f}`, 'utf8');
    // As the page calls it: no norm in reading, so bare articles are never matched.
    out[f] = extractCitations(text).map((c) => ({ start: c.startIndex, end: c.endIndex, text: c.text, ...c.parsed }));
  }
  writeFileSync(`${dir}/today.json`, JSON.stringify(out, null, 1));
  // The client half of the search (§4.4) on each distinct query string, with no user alias.
  if (existsSync(`${dir}/proposed.json`)) {
    const queries = [...new Set(JSON.parse(readFileSync(`${dir}/proposed.json`, 'utf8')).queries as string[])];
    const readings = Object.fromEntries(queries.map((q) => {
      const parsed = parseLegalCitation(q, []);
      return [q, { ready: isSearchReady(parsed), parsed }];
    }));
    writeFileSync(`${dir}/client_queries.json`, JSON.stringify(readings, null, 1));
  }
});
