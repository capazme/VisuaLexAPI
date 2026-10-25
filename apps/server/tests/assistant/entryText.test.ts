import { describe, expect, it, vi } from 'vitest';
import {
  articleFetchBody,
  buildItemKey,
  isReadOnly,
  normaOfContent,
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
