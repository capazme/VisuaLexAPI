import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { ARTICLE_ORDINAL_SUFFIXES } from '../../src/utils/articleSuffixes';

/**
 * The ordinal table has one source, the Python API's
 * services/visualex/visualex_api/tools/article_suffixes.py, and two mirrors:
 * the web app's and this one. A mirror that stops short ("decies") reads
 * "art. 25-terdecies" as 25-ter, an article that exists: nothing looks wrong.
 * This file checks the server's mirror against the source; the web's is
 * checked against conventions/contract/pins.json, which holds a copy of the
 * source's table (apps/web/app/src/utils/__tests__/articleSuffixes.pins.test.ts).
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

// The block ends at the bracket that opens a line: a comment inside it holds
// one of its own ("vicies semel", 21).
function suffixesIn(file: string, blockStart: RegExp, blockEnd: string): string[] {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf-8');
  const start = text.search(blockStart);
  const block = text.slice(start, text.indexOf(blockEnd, start));
  return [...block.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1]);
}

describe('ARTICLE_ORDINAL_SUFFIXES (server mirror)', () => {
  it('matches the Python source table', () => {
    const python = suffixesIn(
      'services/visualex/visualex_api/tools/article_suffixes.py',
      /ARTICLE_ORDINAL_SUFFIXES = \(/,
      '\n)'
    );
    expect(python.length).toBeGreaterThan(20);
    expect([...ARTICLE_ORDINAL_SUFFIXES].sort()).toEqual([...python].sort());
  });
});

describe('the ninth, as Normattiva prints it', () => {
  it('knows «nonies» (art. 21-nonies l. 241/1990) beside «novies»', () => {
    expect(ARTICLE_ORDINAL_SUFFIXES).toContain('nonies');
    expect(ARTICLE_ORDINAL_SUFFIXES).toContain('novies');
  });
});
