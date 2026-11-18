import { beforeEach, describe, expect, it } from 'vitest';
import { appStore } from '../../../store/useAppStore';
import type { Dossier, DossierItem } from '../../../types';
import { dropFromTable } from './inDossier';

const norma = (numero: string, tipo = 'legge', numeroAtto = '24'): DossierItem => ({
  id: `n-${tipo}-${numero}`, addedAt: '', type: 'norma',
  data: { tipo_atto: tipo, numero_atto: numeroAtto, data: '2017-03-08', numero_articolo: numero, versione: 'vigente' },
});
const dossier = (items: DossierItem[]): Dossier => ({ id: 'dos-1', title: 'Responsabilità medica', createdAt: '', items });
const table = (id: string) => appStore.getState().practices.find((p) => p.id === id)!;

beforeEach(() => {
  appStore.setState({ practices: [], activePracticeId: null, practiceRows: {}, pendingReveal: null, dossiers: [] });
});

describe('dropFromTable: once «Annulla» has run out, what left the dossier leaves the table (LC91)', () => {
  it('takes the whole act off when its last article goes: no empty block with «0 articoli»', () => {
    const items = [norma('5'), norma('7')];
    const id = appStore.getState().openDossierPractice(dossier(items));
    // The dossier no longer holds them (they went to the trash): the table follows.
    appStore.setState({ dossiers: [dossier([])] });
    dropFromTable('dos-1', items);
    expect(table(id).acts).toEqual([]);
  });

  it('keeps an act that still has articles, and the other acts', () => {
    const items = [norma('5'), norma('7'), norma('1', 'decreto legislativo', '81')];
    const id = appStore.getState().openDossierPractice(dossier(items));
    appStore.setState({ dossiers: [dossier([items[1], items[2]])] });
    dropFromTable('dos-1', [items[0]]);
    expect(table(id).acts).toHaveLength(2);
    expect(table(id).acts.flatMap((a) => a.articles.map((r) => r.norma_data.numero_articolo)).sort()).toEqual(['1', '7']);
  });
});
