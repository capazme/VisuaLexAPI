import { describe, expect, it } from 'vitest';
import { dossierHoldsArticle, practiceDossierItems } from './practiceDossierItems';
import type { Practice, PracticeDecision } from '../../../utils/practice';
import { L24, L241, CC_BARE, CC_RD, article } from '../../../utils/__fixtures__/savedWorkspaces';

const act = (id: string, norma: typeof L24, articles: ReturnType<typeof article>[]) =>
  ({ id, key: id, norma, articles, isCollapsed: false });

const decision = (id: string, more: Partial<PracticeDecision> = {}): PracticeDecision => ({
  id,
  reference: { corte: 'cassazione', numero: 100, anno: 2020 },
  label: 'Cass. 100/2020',
  identified: true,
  ...more,
});

const practice = (p: Partial<Practice>): Practice => ({
  id: 'p', label: 'Pratica', labelIsCustom: true, acts: [], decisions: [], beside: [], ...p,
});

describe('practiceDossierItems (spec §7)', () => {
  it('lists the acts in table order, each one’s articles in table order, then the decisions', () => {
    const items = practiceDossierItems(practice({
      acts: [act('a1', L241, [article(L241, '2'), article(L241, '3')]), act('a2', L24, [article(L24, '5')])],
      decisions: [decision('d1')],
    }));
    expect(items.norms.map((n) => `${n.numero_atto}/${n.numero_articolo}`)).toEqual(['241/2', '241/3', '24/5']);
    expect(items.decisions).toHaveLength(1);
    expect(items.unidentified).toBe(0);
  });

  it('keeps a past text with its version, next to the text in force, as two items', () => {
    const past = article(L24, '5', { versione: 'originale', data_versione: '2017-03-08' });
    const now = article(L24, '5');
    const { norms } = practiceDossierItems(practice({ acts: [act('a', L24, [now, past])] }));
    expect(norms).toHaveLength(2);
    expect(norms[1]).toMatchObject({ versione: 'originale', data_versione: '2017-03-08' });
    expect(norms[0].data_versione).toBeUndefined();
  });

  it('saves two versions of one code article as two items', () => {
    const a = article(CC_RD, '2043', { versione: 'vigente' });
    const b = article(CC_RD, '2043', { versione: 'vigente', data_versione: '2020-01-01' });
    const { norms } = practiceDossierItems(practice({ acts: [act('a', CC_RD, [a, b])] }));
    expect(norms).toHaveLength(2);
    expect(norms.every((n) => n.urn === CC_RD.urn)).toBe(true);
  });

  it.each([
    ['the index copy first', true],
    ['the search copy first', false],
  ])('a code article from a search (annex 2, the R.D.) and from the index (none) is one item, the search copy (%s)', (_, indexFirst) => {
    const search = article(CC_RD, '2043', { allegato: '2' });
    const index = article(CC_BARE, '2043');
    const rows = indexFirst ? [index, search] : [search, index];
    const { norms } = practiceDossierItems(practice({ acts: [act('a', indexFirst ? CC_BARE : CC_RD, rows)] }));
    expect(norms).toHaveLength(1);
    expect(norms[0]).toMatchObject({ tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2' });
  });

  it('each row is saved as its own norma_data names it, not as the copy that opened the act', () => {
    // The act was opened from the index (bare); a later search brought art. 1218 with the R.D.
    const { norms } = practiceDossierItems(practice({
      acts: [act('a', CC_BARE, [article(CC_BARE, '2043'), article(CC_RD, '1218', { allegato: '2' })])],
    }));
    expect(norms.map((n) => [n.numero_articolo, n.numero_atto ?? '', n.data, n.allegato ?? ''])).toEqual([
      ['2043', '', '', ''],
      ['1218', '262', '1942-03-16', '2'],
    ]);
  });

  it('outside a code, annex 2 and no annex are two articles (gotcha 9)', () => {
    const { norms } = practiceDossierItems(practice({
      acts: [act('a', L24, [article(L24, '1'), article(L24, '1', { allegato: '2' })])],
    }));
    expect(norms).toHaveLength(2);
    expect(norms.map((n) => n.allegato ?? '')).toEqual(['', '2']);
  });

  it('puts decisions in decisionOrder with sezione, tipo and data_deposito', () => {
    const older = decision('d1', {
      reference: { corte: 'cassazione', numero: 10, anno: 2018 }, depositDate: '2018-05-01', sezione: 'U', tipo: 'sentenza',
    });
    const newer = decision('d2', {
      reference: { corte: 'cassazione', numero: 20, anno: 2021 }, depositDate: '2021-05-01', sezione: 'L', tipo: 'ordinanza',
    });
    const { decisions } = practiceDossierItems(practice({ decisions: [older, newer] }));
    expect(decisions.map((d) => d.numero)).toEqual([20, 10]);
    expect(decisions[0]).toMatchObject({ corte: 'cassazione', anno: 2021, sezione: 'L', tipo: 'ordinanza', data_deposito: '2021-05-01' });
    expect(decisions[0].etichetta).toBeTruthy();
  });

  it('saves an administrative decision with its kind and its seat, as the server keeps it', () => {
    const tar = { corte: 'tar' as const, sede: 'roma', provvedimento: 'ocau', numero: 1234, anno: 2020 };
    const { decisions } = practiceDossierItems(practice({ decisions: [decision('t', { reference: tar, tipo: 'ordinanza', sezione: 'I' })] }));
    expect(decisions).toEqual([{ ...tar, sezione: 'I', tipo: 'ordinanza', etichetta: 'TAR Lazio, Roma, sez. I, ord., n. 1234/2020' }]);
  });

  it('counts an unidentified decision and does not save it', () => {
    const { decisions, unidentified } = practiceDossierItems(practice({
      decisions: [decision('d1'), decision('d2', { identified: false, reference: { corte: 'cassazione', numero: 7, anno: 2019 } })],
    }));
    expect(decisions).toHaveLength(1);
    expect(unidentified).toBe(1);
  });
});

describe('dossierHoldsArticle', () => {
  const dossierWith = (data: Record<string, unknown>) =>
    ({ id: 'd', title: 'D', createdAt: 'x', items: [{ id: 'i', type: 'norma', addedAt: 'x', data }] }) as never;

  it('finds a code article saved from a search when the practice holds the index copy', () => {
    const saved = { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2', versione: 'vigente' };
    const { norms } = practiceDossierItems(practice({ acts: [act('a', CC_BARE, [article(CC_BARE, '2043')])] }));
    expect(dossierHoldsArticle(dossierWith(saved), norms[0])).toBe(true);
  });

  it('keeps an annex apart outside a code, and a past text apart from the text in force', () => {
    const saved = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '1', versione: 'vigente' };
    expect(dossierHoldsArticle(dossierWith(saved), { ...saved, allegato: '2' })).toBe(false);
    expect(dossierHoldsArticle(dossierWith(saved), { ...saved, data_versione: '2018-01-01' })).toBe(false);
    expect(dossierHoldsArticle(dossierWith(saved), { ...saved, numero_articolo: '1 ' })).toBe(true);
  });
});
