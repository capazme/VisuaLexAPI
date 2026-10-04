import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchArticleForNorma = vi.fn();
vi.mock('../../../utils/articleFetchCache', () => ({ fetchArticleForNorma: (...a: unknown[]) => fetchArticleForNorma(...a) }));

import { buildPdfBlocks, loadDossierTexts, PDF_TEXT_UNAVAILABLE, type PdfBlock } from './dossierPdf';
import type { DossierItem, NormaVisitata } from '../../../types';

const L247 = 'l. 31 dicembre 2012, n. 247';
type Act = { numero_atto: string; data: string };
const norm = (id: string, numero_articolo: string, more: Partial<NormaVisitata> = {}, act: Act = { numero_atto: '247', data: '2012-12-31' }, actCitation = L247): DossierItem => ({
  id, type: 'norma', addedAt: '', actCitation,
  data: { tipo_atto: 'legge', numero_articolo, ...act, ...more },
});
const a1 = norm('a1', '1');
const a3 = norm('a3', '3');
const b1 = norm('b1', '1', {}, { numero_atto: '49', data: '2023-04-21' }, 'l. 21 aprile 2023, n. 49');
const past = norm('p3', '3', { versione: 'originale', data_versione: '2013-01-01' });
const note: DossierItem = { id: 'n', type: 'note', addedAt: '', data: 'Verificare la decorrenza' };

beforeEach(() => { vi.clearAllMocks(); });

describe('loadDossierTexts', () => {
  it('fetches each text, reports progress, and keeps going past a failure', async () => {
    fetchArticleForNorma
      .mockResolvedValueOnce({ article_text: 'Art. 1\n(Oggetto)\n1. Testo.', norma_data: {}, validity: { state: 'current' } })
      .mockRejectedValueOnce(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const progress = vi.fn();
    const texts = await loadDossierTexts([a1, note, b1], progress);
    expect(texts.get('a1')?.text).toContain('1. Testo.');
    expect(texts.get('b1')).toEqual({ text: null });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('says why a text may not be exported', async () => {
    fetchArticleForNorma.mockResolvedValueOnce({ article_text: 'x', norma_data: {}, validity: { state: 'historical', request_in_window: false } });
    const texts = await loadDossierTexts([past], () => {});
    expect(texts.get('p3')?.text).toBeNull();
    expect(texts.get('p3')?.blockedReason).toMatch(/non comprende la data richiesta/);
  });
});

describe('buildPdfBlocks', () => {
  it('puts the notes first, then each act once with its articles in order', () => {
    const blocks = buildPdfBlocks([a3, note, a1, b1], new Map([
      ['a1', { text: '<b>uno</b>' }], ['a3', { text: 'tre', rubrica: 'Doveri' }], ['b1', { text: null }],
    ]), new Map([['legge|247|2012-12-31', 'Nuova disciplina']]));
    expect(blocks.map((b) => b.kind)).toEqual(['notes', 'act', 'act']);
    const act = blocks[1] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act).toMatchObject({ heading: L247, title: 'Nuova disciplina' });
    expect(act.articles.map((x) => [x.label, x.rubrica, x.text])).toEqual([['art. 1', null, 'uno'], ['art. 3', 'Doveri', 'tre']]);
    const other = blocks[2] as Extract<PdfBlock, { kind: 'act' }>;
    expect(other.title).toBeNull();
    expect(other.articles[0]).toMatchObject({ missing: 'unavailable', text: PDF_TEXT_UNAVAILABLE });
  });

  it('labels a past text, and prints why its text is missing', () => {
    const blocks = buildPdfBlocks([past], new Map([['p3', { text: null, blockedReason: 'Non disponibile' }]]), new Map());
    const act = blocks[0] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act.articles[0]).toMatchObject({ versionLabel: 'Testo al 01/01/2013', missing: 'blocked', text: 'Non disponibile' });
  });
});

describe('buildPdfBlocks — notes', () => {
  it("prints an article's notes under it, and says who wrote a note", () => {
    const about: DossierItem = { id: 'na', type: 'note', addedAt: '', data: 'Sul dovere.', aboutItemId: 'a3', createdBy: { clientName: 'Claude Code' } };
    const free: DossierItem = { id: 'nf', type: 'note', addedAt: '', data: 'Libera.' };
    const blocks = buildPdfBlocks([a3, about, free], new Map([['a3', { text: 'tre' }]]), new Map());
    expect(blocks[0]).toEqual({ kind: 'notes', notes: ['Libera.'] });
    const act = blocks[1] as Extract<PdfBlock, { kind: 'act' }>;
    expect(act.articles[0].notes).toEqual(['Sul dovere. (scritta da Claude Code)']);
  });
});
