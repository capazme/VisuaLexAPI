import { describe, expect, it, vi } from 'vitest';
import {
  articleFetchBody,
  buildItemKey,
  isReadOnly,
  normaOfContent,
  partialNoticeOf,
  uniqueArticleIdFromNorma,
  type StoredNorma,
} from '../../src/assistant/entryText';
// The web's own code: the ports must say what it says, or a proposal would never show (spec §8.5).
import { buildItemKey as webItemKey, uniqueArticleIdFromNorma as webArticleId } from '../../../web/src/utils/normaKeys';
import { describeVersion } from '../../../web/src/utils/versionDisplay';

const sent: unknown[] = [];
vi.mock('../../../web/src/services/legalFetch', () => ({
  legalFetch: async (_path: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify([{ article_text: 'x', norma_data: {} }]), { status: 200 });
  },
}));

const NORMS: StoredNorma[] = [
  { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '1453' },
  { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2645-bis', versione: 'vigente' },
  { tipo_atto: 'decreto legislativo', data: '2010-07-02', numero_atto: '104', numero_articolo: '29', allegato: '2' },
  { tipo_atto: 'regolamento UE', data: '2016', numero_atto: '679', numero_articolo: '6' },
  { tipo_atto: 'Costituzione', data: '', numero_atto: '', numero_articolo: '3' },
  { tipo_atto: 'legge', data: '1990-08-07', numero_atto: ' 241 ', numero_articolo: '21-octies', versione: 'originale' },
  { tipo_atto: 'decreto del Presidente della Repubblica', data: '2000-12-28', numero_atto: '445', numero_articolo: '47', data_versione: '2005-01-01' },
  { tipo_atto: "codice dell'ambiente (à)", data: '2006-04-03', numero_atto: '152', numero_articolo: '3 bis', allegato: ' ' },
];

describe('the ported keys say what the web says', () => {
  it.each(NORMS.map((n) => [buildItemKey(n), n] as const))('%s', (_key, norma) => {
    expect(buildItemKey(norma)).toBe(webItemKey(norma as never));
    expect(uniqueArticleIdFromNorma(norma)).toBe(webArticleId(norma as never));
  });
});

describe('the entry’s content is read as the web reads it', () => {
  // As the web's `unpackItemContent` and `dossierItemFromApi` do (dossierUtils.ts), which import more than this
  // suite installs.
  it('drops the star’s envelope and reads a Forum entry’s articleRef', () => {
    const stored = { ...NORMS[0], _dossierMeta: { important: true } };
    expect(normaOfContent(stored)).toMatchObject(NORMS[0]);
    expect(buildItemKey(normaOfContent(stored)!)).toBe(webItemKey(NORMS[0] as never));
    const forum = { articleRef: NORMS[2], status: 'unread' };
    expect(normaOfContent(forum)).toMatchObject(NORMS[2]);
    expect(normaOfContent('una nota')).toBeNull();
  });
});

describe('the body of /fetch_article_text is the web’s', () => {
  it.each(NORMS.map((n, i) => [i, n] as const))('norm %i', async (_i, norma) => {
    const { fetchArticleForNorma, clearArticleCache } = await import('../../../web/src/utils/articleFetchCache');
    clearArticleCache();
    sent.length = 0;
    await fetchArticleForNorma(norma as never);
    expect(sent).toEqual([articleFetchBody(norma)]);
  });
});

describe('read-only is the web’s describeVersion', () => {
  const validities = [
    undefined,
    { state: 'current' },
    { state: 'historical' },
    { state: 'not_yet' },
    { state: 'abrogated' },
    { state: 'current', request_in_window: false },
    { state: 'abrogated', request_in_window: null },
  ];
  const requests = [{}, { versione: 'originale' }, { versione: ' Originale ' }, { data_versione: '2005-01-01' }, { data_versione: '  ' }, { versione: 'vigente' }];
  it.each(validities.flatMap((v) => requests.map((r) => [JSON.stringify(v), JSON.stringify(r), v, r] as const)))('%s, %s', (_a, _b, validity, request) => {
    expect(isReadOnly(validity, request)).toBe(describeVersion(validity as never, request as never).readOnly);
  });
});


describe('a part of a split article (G-387 (a))', () => {
  const ART_1 = { tipo_atto: 'legge', data: '2006-12-27', numero_atto: '296', numero_articolo: '1' };
  const PART_8 = { ...ART_1, parte: '701-800' };

  it('keys a part with its commas, the first part as the article (spec 2026-10-29 §2; the web follows in 3c)', () => {
    expect(buildItemKey(PART_8)).toBe('legge--296--2006-12-27--1--c701-800');
    expect(uniqueArticleIdFromNorma(PART_8)).toBe('1~c701-800');
    expect(uniqueArticleIdFromNorma({ ...PART_8, allegato: '2' })).toBe('all2:1~c701-800');
    // No `parte`: the web's own key, as for every norm above.
    expect(buildItemKey(ART_1)).toBe(webItemKey(ART_1 as never));
    expect(uniqueArticleIdFromNorma(ART_1)).toBe(webArticleId(ART_1 as never));
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
