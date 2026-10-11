import { describe, expect, it } from 'vitest';
import { practiceDossierItems } from './practiceDossierItems';
import type { Practice, PracticeDecision } from '../../../utils/practice';
import { L24, L241, CC_RD, article } from '../../../utils/__fixtures__/savedWorkspaces';

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

  it('saves the two rows of one code article (search and index copies) as two items', () => {
    const a = article(CC_RD, '2043', { versione: 'vigente' });
    const b = article(CC_RD, '2043', { versione: 'vigente', data_versione: '2020-01-01' });
    const { norms } = practiceDossierItems(practice({ acts: [act('a', CC_RD, [a, b])] }));
    expect(norms).toHaveLength(2);
    expect(norms.every((n) => n.urn === CC_RD.urn)).toBe(true);
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

  it('counts an unidentified decision and does not save it', () => {
    const { decisions, unidentified } = practiceDossierItems(practice({
      decisions: [decision('d1'), decision('d2', { identified: false, reference: { corte: 'cassazione', numero: 7, anno: 2019 } })],
    }));
    expect(decisions).toHaveLength(1);
    expect(unidentified).toBe(1);
  });
});
