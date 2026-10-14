import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DossierItem } from '../../../types';
import { decisionKey } from '../../../utils/decisionLinks';
import { loadPublicationMarks } from './publicationMarks';

const loadPdfMarks = vi.hoisted(() => vi.fn());
vi.mock('./dossierPdfMarks', () => ({ loadPdfMarks }));
const fetchDecisionCached = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/decisionFetchCache', () => ({ fetchDecisionCached }));

const COST = { corte: 'corte_costituzionale' as const, numero: 1, anno: 2014, tipo: 'sentenza' as const, data_deposito: '2014-01-13', etichetta: 'x' };
const KEY = decisionKey(COST);
const items = [{ id: 's1', type: 'sentenza', data: COST, addedAt: '' } as DossierItem];

beforeEach(() => {
  loadPdfMarks.mockReset().mockResolvedValue(new Map([['s1', {
    notes: [
      { id: 'kept', normaKey: KEY, articleId: '', text: 'nota', anchorText: 'la questione è fondata', startOffset: 0, createdAt: '' },
      { id: 'gone', normaKey: KEY, articleId: '', text: 'nota', anchorText: 'il nome della parte', startOffset: 40, createdAt: '' },
      { id: 'free', normaKey: KEY, articleId: '', text: 'nota libera', createdAt: '' },
    ],
    highlights: [{ id: 'hgone', normaKey: KEY, articleId: '', text: 'il nome della parte', color: 'yellow', rangeSerialized: '', startOffset: 40 }],
  }]]));
  fetchDecisionCached.mockReset().mockResolvedValue({ esito: 'trovata', testo: { motivazione: 'la questione è fondata e va accolta.' } });
});

describe('loadPublicationMarks', () => {
  it('leaves out a decision\'s anchors whose words are no longer in its text, and says so', async () => {
    const { marks, leftOut } = await loadPublicationMarks(items);
    expect(marks.get('s1')!.notes.map((n) => n.id)).toEqual(['kept', 'free']);
    expect(marks.get('s1')!.highlights).toEqual([]);
    expect(leftOut).toMatch(/^1 nota e 1 evidenziazione su sentenze non incluse/);
  });

  it('sends no anchor on trust when the decision cannot be read now', async () => {
    fetchDecisionCached.mockRejectedValue(new Error('down'));
    const { marks } = await loadPublicationMarks(items);
    expect(marks.get('s1')!.notes.map((n) => n.id)).toEqual(['free']);
  });
});
