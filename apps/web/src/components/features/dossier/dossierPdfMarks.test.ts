import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/highlightService', () => ({ highlightService: { getByNormaKeyPrefix: vi.fn() } }));
vi.mock('../../../services/annotationService', () => ({ annotationService: { getByNormaKeyPrefix: vi.fn() } }));

import { annotationService } from '../../../services/annotationService';
import { highlightService } from '../../../services/highlightService';
import type { DossierItem } from '../../../types';
import type { AnnotationResponse, HighlightResponse } from '../../../types/api';
import { buildItemKey, uniqueArticleIdFromNorma } from '../../../utils/normaKeys';
import { buildWireNormaKey } from '../../../utils/storeApiMappers';
import { loadPdfMarks } from './dossierPdfMarks';

const normaData = { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo: '1' };
const norma: DossierItem = { id: 'a1', type: 'norma', addedAt: '', data: normaData };
const sentenza: DossierItem = { id: 's1', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' } };
const other: DossierItem = { id: 's2', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 2, anno: 2014, etichetta: 'x' } };

const itemKey = buildItemKey(normaData);
const articleId = uniqueArticleIdFromNorma(normaData);
const DECISION_KEY = 'corte_costituzionale:1:2014';

const hl = (id: string, wire: string) => ({ id, normaKey: wire, text: id, color: 'yellow', startOffset: 0 }) as unknown as HighlightResponse;
const note = (id: string, wire: string) => ({ id, normaKey: wire, content: id, createdAt: '' }) as unknown as AnnotationResponse;

// The server's rows under each prefix, answered a tick late: the PDF must wait for them.
const later = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 5));
const highlights = vi.mocked(highlightService.getByNormaKeyPrefix);
const annotations = vi.mocked(annotationService.getByNormaKeyPrefix);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  highlights.mockImplementation((prefix: string) => later(
    prefix.startsWith(DECISION_KEY) ? [hl('hs', buildWireNormaKey(DECISION_KEY, ''))]
      : [hl('ha', buildWireNormaKey(itemKey, articleId)), hl('h-brocardi', buildWireNormaKey(itemKey, `${articleId}/brocardi/ratio`))],
  ));
  annotations.mockImplementation((prefix: string) => later(
    prefix.startsWith(DECISION_KEY) ? [note('ns', buildWireNormaKey(DECISION_KEY, ''))] : [note('na', buildWireNormaKey(itemKey, articleId))],
  ));
});

describe('loadPdfMarks', () => {
  it("reads the chosen decisions' marks under the decision's key with no article, as its reader does, and waits for them", async () => {
    const marks = await loadPdfMarks([norma, sentenza, other], { articles: false, decisionIds: new Set(['s1']) });
    expect(highlights).toHaveBeenCalledTimes(1);
    expect(highlights).toHaveBeenCalledWith(buildWireNormaKey(DECISION_KEY, ''));
    expect([...marks.keys()]).toEqual(['s1']);
    expect(marks.get('s1')?.highlights.map((h) => h.id)).toEqual(['hs']);
    expect(marks.get('s1')?.notes.map((n) => n.id)).toEqual(['ns']);
    expect(marks.get('s1')?.unavailable).toBeUndefined();
  });

  it("adds the articles' marks, under buildItemKey and the unique article id, and not those of its Brocardi sections", async () => {
    const marks = await loadPdfMarks([norma, sentenza], { articles: true, decisionIds: new Set() });
    expect(highlights).toHaveBeenCalledWith(buildWireNormaKey(itemKey, articleId));
    expect([...marks.keys()]).toEqual(['a1']);
    expect(marks.get('a1')?.highlights.map((h) => h.id)).toEqual(['ha']);
    expect(marks.get('a1')?.notes.map((n) => n.id)).toEqual(['na']);
  });

  it('says a text whose marks the server refused is unavailable, never that it has none', async () => {
    highlights.mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));
    const marks = await loadPdfMarks([norma], { articles: true, decisionIds: new Set() });
    expect(marks.get('a1')).toEqual({ highlights: [], notes: [], unavailable: true });
  });

  it('asks for nothing when nothing needs marks', async () => {
    const marks = await loadPdfMarks([norma, sentenza], { articles: false, decisionIds: new Set() });
    expect(marks.size).toBe(0);
    expect(highlights).not.toHaveBeenCalled();
  });
});
