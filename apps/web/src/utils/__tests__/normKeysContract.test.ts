import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildItemKey, uniqueArticleIdFromNorma } from '../normaKeys';
import { clearArticleCache, fetchArticleForNorma } from '../articleFetchCache';
import { describeVersion } from '../versionDisplay';
import type { NormaVisitata } from '../../types';

// The keys the server's assistant ports from this code (apps/server/src/assistant/entryText.ts): the item key, the
// article id, the body of /fetch_article_text and whether a text is read-only. Server and web are each checked against
// the same cases (conventions/sources/norm-keys.json), so neither imports the other: a key that drifts here is a
// proposal the server makes and the web never shows (spec §8.5).

interface NormKeys {
  norms: Array<{ norma: Record<string, string>; item_key: string; article_id: string; fetch_body: Record<string, unknown> }>;
  read_only: Array<{ validity?: unknown; request: Record<string, string>; read_only: boolean }>;
}
function normKeys(from: string): NormKeys {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'norm-keys.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as NormKeys;
    if (dirname(dir) === dir) throw new Error('conventions/sources/norm-keys.json not found above ' + from);
  }
}
const KEYS = normKeys(__dirname);

const sent = vi.hoisted(() => [] as unknown[]);
vi.mock('../../services/legalFetch', () => ({
  legalFetch: async (_path: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify([{ article_text: 'x', norma_data: {} }]), { status: 200 });
  },
}));

describe('the norm keys are the shared cases', () => {
  it('has the cases', () => {
    expect(KEYS.norms.length).toBeGreaterThan(5);
    expect(KEYS.read_only.length).toBeGreaterThan(20);
  });

  it.each(KEYS.norms.map((c) => [c.item_key, c] as const))('%s', (_key, c) => {
    expect(buildItemKey(c.norma as unknown as NormaVisitata)).toBe(c.item_key);
    expect(uniqueArticleIdFromNorma(c.norma as unknown as NormaVisitata)).toBe(c.article_id);
  });
});

describe('the body of /fetch_article_text is the shared case', () => {
  beforeEach(() => {
    clearArticleCache();
    sent.length = 0;
  });

  it.each(KEYS.norms.map((c, i) => [i, c] as const))('norm %i', async (_i, c) => {
    await fetchArticleForNorma(c.norma as unknown as NormaVisitata);
    expect(sent).toEqual([c.fetch_body]);
  });
});

describe('read-only is the shared case', () => {
  it.each(KEYS.read_only.map((c) => [JSON.stringify(c.validity), JSON.stringify(c.request), c] as const))('%s, %s', (_a, _b, c) => {
    expect(describeVersion(c.validity as never, c.request as never).readOnly).toBe(c.read_only);
  });
});
