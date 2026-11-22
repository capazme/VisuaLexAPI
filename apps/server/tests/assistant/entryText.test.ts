import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  articleFetchBody,
  buildItemKey,
  isReadOnly,
  normaOfContent,
  partialNoticeOf,
  uniqueArticleIdFromNorma,
  type StoredNorma,
} from '../../src/assistant/entryText';

// The ports must say what the web's own code says, or a proposal would never show (spec §8.5). The cases are shared
// with the web (conventions/sources/norm-keys.json): its normaKeys.ts, articleFetchCache.ts and describeVersion are
// checked against the same file there, so neither side imports the other.
interface NormKeys {
  norms: Array<{ norma: StoredNorma; item_key: string; article_id: string; fetch_body: Record<string, unknown> }>;
  read_only: Array<{ validity?: unknown; request: Pick<StoredNorma, 'versione' | 'data_versione'>; read_only: boolean }>;
}
function normKeys(): NormKeys {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'norm-keys.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as NormKeys;
    if (dirname(dir) === dir) throw new Error('conventions/sources/norm-keys.json not found above ' + __dirname);
  }
}
const KEYS = normKeys();
const NORMS = KEYS.norms.map((c) => c.norma);

describe('the ported keys are the shared cases', () => {
  it.each(KEYS.norms.map((c) => [c.item_key, c] as const))('%s', (_key, c) => {
    expect(buildItemKey(c.norma)).toBe(c.item_key);
    expect(uniqueArticleIdFromNorma(c.norma)).toBe(c.article_id);
  });
});

describe('the entry’s content is read as the web reads it', () => {
  // As the web's `unpackItemContent` and `dossierItemFromApi` do (dossierUtils.ts), which import more than this
  // suite installs.
  it('drops the star’s envelope and reads a Forum entry’s articleRef', () => {
    const stored = { ...NORMS[0], _dossierMeta: { important: true } };
    expect(normaOfContent(stored)).toMatchObject(NORMS[0]);
    expect(buildItemKey(normaOfContent(stored)!)).toBe(KEYS.norms[0].item_key);
    const forum = { articleRef: NORMS[2], status: 'unread' };
    expect(normaOfContent(forum)).toMatchObject(NORMS[2]);
    expect(normaOfContent('una nota')).toBeNull();
  });
});

describe('the body of /fetch_article_text is the shared case', () => {
  it.each(KEYS.norms.map((c, i) => [i, c] as const))('norm %i', (_i, c) => {
    expect(articleFetchBody(c.norma)).toEqual(c.fetch_body);
  });
});

describe('read-only is the shared case (the web\'s describeVersion)', () => {
  it.each(KEYS.read_only.map((c) => [JSON.stringify(c.validity), JSON.stringify(c.request), c] as const))('%s, %s', (_a, _b, c) => {
    expect(isReadOnly(c.validity, c.request)).toBe(c.read_only);
  });
});

describe('a part of a split article (G-387 (a))', () => {
  const ART_1 = { tipo_atto: 'legge', data: '2006-12-27', numero_atto: '296', numero_articolo: '1' };
  const PART_8 = { ...ART_1, parte: '701-800' };

  it('keys a part with its commas, the first part as the article (spec 2026-10-29 §2; the web follows in 3c)', () => {
    expect(buildItemKey(PART_8)).toBe('legge--296--2006-12-27--1--c701-800');
    expect(uniqueArticleIdFromNorma(PART_8)).toBe('1~c701-800');
    expect(uniqueArticleIdFromNorma({ ...PART_8, allegato: '2' })).toBe('all2:1~c701-800');
    // No `parte`: the web's own key, as for every norm above (the shared cases hold this article).
    const shared = KEYS.norms.find((c) => c.norma.numero_atto === ART_1.numero_atto && c.norma.numero_articolo === ART_1.numero_articolo)!;
    expect(shared.norma).toEqual(ART_1);
    expect(buildItemKey(ART_1)).toBe(shared.item_key);
    expect(uniqueArticleIdFromNorma(ART_1)).toBe(shared.article_id);
  });

  it('reads the part stored and asks the API for it', () => {
    expect(normaOfContent(PART_8)).toMatchObject({ parte: '701-800' });
    expect(normaOfContent({ ...ART_1, parte: 'tutto' })).not.toHaveProperty('parte');
    expect(articleFetchBody(normaOfContent(PART_8)!)).toMatchObject({ article: '1', parte: '701-800' });
    expect(articleFetchBody(normaOfContent(ART_1)!)).not.toHaveProperty('parte');
  });

  it('names the part served in the notice', () => {
    const parti = Array.from({ length: 14 }, (_, i) => ({
      progressivo: i + 1, commi_dal: String(100 * i + 1), commi_al: i === 13 ? '1364' : String(100 * (i + 1)), url: 'https://www.normattiva.it/x',
    }));
    expect(partialNoticeOf({ testo_parziale: true, parti, norma_data: { parte: '701-800' } }))
      .toBe('testo parziale: commi 701-800 di 1364 (diviso in 14 parti)');
    expect(partialNoticeOf({ testo_parziale: true, parti, norma_data: {} }))
      .toBe('testo parziale: commi 1-100 di 1364 (diviso in 14 parti)');
    // The article page that lists the parts has left the API's cache: the part is still said.
    expect(partialNoticeOf({ testo_parziale: true, parti: null, norma_data: { parte: '701-800' } }))
      .toBe('testo parziale: commi 701-800 dell’articolo, diviso in parti');
    expect(partialNoticeOf({ testo_parziale: false, parti: [], norma_data: {} })).toBeUndefined();
  });
});
