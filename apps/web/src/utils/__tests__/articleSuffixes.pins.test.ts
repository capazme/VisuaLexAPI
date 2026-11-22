import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTICLE_ORDINAL_SUFFIXES } from '../articleSuffixes';

// The ordinal table has one source, the Python API's services/visualex/visualex_api/tools/article_suffixes.py,
// and mirrors in the web app and the server. A mirror that stops short ("decies") reads "art. 25-terdecies"
// as 25-ter, an article that exists: nothing looks wrong. The source's table is copied into
// conventions/contract/pins.json by scripts/contract/build.mjs; the server's own test checks its mirror
// against the source, this one checks the web's against the contract.

function pinnedSuffixes(from: string): string[] {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'contract', 'pins.json');
    if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { article_ordinal_suffixes: string[] }).article_ordinal_suffixes;
    if (dirname(dir) === dir) throw new Error('conventions/contract/pins.json not found above ' + from);
  }
}

describe('ARTICLE_ORDINAL_SUFFIXES (web mirror)', () => {
  it('matches the contract\'s table of the Python source', () => {
    const pinned = pinnedSuffixes(__dirname);
    expect(pinned.length).toBeGreaterThan(20);
    expect([...ARTICLE_ORDINAL_SUFFIXES].sort()).toEqual([...pinned].sort());
  });
});
