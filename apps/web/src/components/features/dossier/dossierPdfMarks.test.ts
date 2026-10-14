import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../../../store/useAppStore';
import type { Annotation, DossierItem, Highlight } from '../../../types';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { loadPdfMarks } from './dossierPdfMarks';

const normaData = { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '1' };
const norma: DossierItem = { id: 'a1', type: 'norma', addedAt: '', data: normaData };
const sentenza: DossierItem = { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' } };
const other: DossierItem = { id: 's2', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 2, anno: 2014, etichetta: 'x' } };

const itemKey = buildItemKey(normaData);
const articleId = uniqueArticleIdFromNorma(normaData);
const DECISION_KEY = 'corte_costituzionale:1:2014';

const hl = (id: string, normaKey: string, articleId: string) => ({ id, normaKey, articleId, text: id, color: 'yellow' }) as Highlight;
const note = (id: string, normaKey: string, articleId: string) => ({ id, normaKey, articleId, text: id }) as Annotation;

const loadHighlights = vi.fn(async () => {});
const loadAnnotations = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({
    loadHighlightsForArticle: loadHighlights, loadAnnotationsForArticle: loadAnnotations,
    highlights: [hl('ha', itemKey, articleId), hl('hs', DECISION_KEY, ''), hl('hx', 'altro', 'x')],
    annotations: [note('na', itemKey, articleId), note('ns', DECISION_KEY, ''), note('nx', DECISION_KEY, 'art-1')],
  });
});

describe('loadPdfMarks', () => {
  it('loads and reads the chosen decisions\' marks under the decision\'s key with no article, as its reader does', async () => {
    const marks = await loadPdfMarks([norma, sentenza, other], { articles: false, decisionIds: new Set(['s1']) });
    expect(loadHighlights).toHaveBeenCalledTimes(1);
    expect(loadHighlights).toHaveBeenCalledWith(DECISION_KEY, '');
    expect(loadAnnotations).toHaveBeenCalledWith(DECISION_KEY, '');
    expect([...marks.keys()]).toEqual(['s1']);
    expect(marks.get('s1')?.highlights.map((h) => h.id)).toEqual(['hs']);
    expect(marks.get('s1')?.notes.map((n) => n.id)).toEqual(['ns']);
  });

  it('adds the articles\' marks, under buildItemKey and the unique article id, when asked', async () => {
    const marks = await loadPdfMarks([norma, sentenza], { articles: true, decisionIds: new Set() });
    expect(loadHighlights).toHaveBeenCalledWith(itemKey, articleId);
    expect([...marks.keys()]).toEqual(['a1']);
    expect(marks.get('a1')?.highlights.map((h) => h.id)).toEqual(['ha']);
    expect(marks.get('a1')?.notes.map((n) => n.id)).toEqual(['na']);
  });

  it('asks for nothing when nothing needs marks', async () => {
    const marks = await loadPdfMarks([norma, sentenza], { articles: false, decisionIds: new Set() });
    expect(marks.size).toBe(0);
    expect(loadHighlights).not.toHaveBeenCalled();
  });
});
