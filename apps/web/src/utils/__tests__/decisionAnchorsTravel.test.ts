import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leftOutMessage, travellingAnchors, travellingSelection } from '../decisionAnchorsTravel';
import { fetchDecisionCached } from '../decisionFetchCache';

vi.mock('../decisionFetchCache', () => ({ fetchDecisionCached: vi.fn() }));
const fetchMock = vi.mocked(fetchDecisionCached);

const KEY = 'cassazione:civile:99999:2024';
const found = (motivazione: string) => ({ esito: 'trovata', identita: { corte: 'cassazione', archivio: 'civile', numero: 99999, anno: 2024 }, attributi: {}, testo: { motivazione }, fonte: { nome: 'f' }, avvisi: [] }) as never;
const hl = (normaKey: string, startOffset: number, text: string) => ({ id: `${normaKey}${startOffset}`, normaKey, articleId: '', text, startOffset, color: 'yellow' }) as never;
const note = (normaKey: string, startOffset: number, anchorText: string) => ({ id: `n${startOffset}`, normaKey, articleId: '', text: 'nota', startOffset, anchorText }) as never;

beforeEach(() => {
  fetchMock.mockReset(); // not returned: a function a hook returns is run as its teardown
});

describe('travellingAnchors', () => {
  it('lets an anchor travel when its words are still in the current text', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const out = await travellingAnchors({ annotations: [note(KEY, 3, 'ricorso')], highlights: [hl(KEY, 3, 'ricorso')] });
    expect(out.highlights).toHaveLength(1);
    expect(out.annotations).toHaveLength(1);
    expect(out.leftOut).toEqual({ annotations: 0, highlights: 0 });
  });
  it('leaves out an anchor on a decision now without its text (obscured)', async () => {
    fetchMock.mockResolvedValue({ ...(found('') as object), testo: {}, avvisi: [{ tipo: 'testo_non_disponibile' }], attributi: { testo_assente: 'oscuramento' } } as never);
    const out = await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'Mario Rossi')] });
    expect(out.highlights).toEqual([]);
    expect(out.leftOut.highlights).toBe(1);
  });
  it('leaves out an anchor whose words changed (anonymised)', async () => {
    fetchMock.mockResolvedValue(found('Il sig. omissis ricorre.'));
    const out = await travellingAnchors({ annotations: [note(KEY, 8, 'Mario Rossi')], highlights: [] });
    expect(out.annotations).toEqual([]);
    expect(out.leftOut.annotations).toBe(1);
  });
  it('sends nothing on trust when the decision cannot be fetched now', async () => {
    fetchMock.mockResolvedValue({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
    const out = await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'ricorso')] });
    expect(out.leftOut.highlights).toBe(1);
    fetchMock.mockRejectedValue(new Error('network'));
    expect((await travellingAnchors({ annotations: [], highlights: [hl(KEY, 3, 'ricorso')] })).leftOut.highlights).toBe(1);
  });
  it('never touches an article\'s anchors and fetches each decision once', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const article = hl('codice-civile--2043', 0, 'Qualunque');
    const out = await travellingAnchors({ annotations: [], highlights: [article, hl(KEY, 3, 'ricorso'), hl(KEY, 13, 'fondato')] });
    expect(out.highlights).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('treats a note with a quote but no offset as anchored: it cannot land, so it is left out', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const quoting = { id: 'q', normaKey: KEY, articleId: '', text: 'nota', anchorText: 'ricorso' } as never;
    const out = await travellingAnchors({ annotations: [quoting], highlights: [] });
    expect(out.annotations).toEqual([]);
    expect(out.leftOut.annotations).toBe(1);
  });
  it('lets a free note on a decision travel without asking the source: it quotes no words of the court', async () => {
    const free = { id: 'free', normaKey: KEY, articleId: '', text: 'da rivedere' } as never;
    const out = await travellingAnchors({ annotations: [free], highlights: [] });
    expect(out.annotations).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['a malformed key', 'cassazione:civile:007:2024'],
    ['a future year', 'cassazione:civile:99999:2999'],
    ['another shape', 'corte_costituzionale:civile:71:2020'],
  ])('leaves out the anchors on %s: it is a decision\'s key space, never an article\'s', async (_name, key) => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const out = await travellingAnchors({ annotations: [note(key, 3, 'ricorso')], highlights: [hl(key, 3, 'ricorso')] });
    expect(out.annotations).toEqual([]);
    expect(out.highlights).toEqual([]);
    expect(out.leftOut).toEqual({ annotations: 1, highlights: 1 });
  });
  it('leaves out a note that quotes the court but has no offset to land by', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const quoting = { id: 'q', normaKey: KEY, articleId: '', text: 'nota', anchorText: 'ricorso' } as never;
    const out = await travellingAnchors({ annotations: [quoting], highlights: [] });
    expect(out.leftOut.annotations).toBe(1);
  });
  it('lets a note with an empty anchor travel as free', async () => {
    const free = { id: 'f', normaKey: KEY, articleId: '', text: 'nota', anchorText: '', startOffset: 3 } as never;
    const out = await travellingAnchors({ annotations: [free], highlights: [] });
    expect(out.annotations).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('asks the source for at most four decisions at a time', async () => {
    let running = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return found('Il ricorso è fondato.');
    });
    const many = Array.from({ length: 10 }, (_, i) => hl(`cassazione:civile:${100 + i}:2024`, 3, 'ricorso'));
    await travellingAnchors({ annotations: [], highlights: many });
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(4);
  });
  it('says how many were left out and why', () => {
    expect(leftOutMessage({ annotations: 0, highlights: 0 })).toBeNull();
    expect(leftOutMessage({ annotations: 1, highlights: 2 }))
      .toBe('1 nota e 2 evidenziazioni su sentenze non incluse: il loro testo non è più presente nella fonte, o la fonte non risponde.');
  });
  it('gives the ids that travel and the line for a selection', async () => {
    fetchMock.mockResolvedValue(found('Il ricorso è fondato.'));
    const out = await travellingSelection([note(KEY, 8, 'Mario Rossi')], [hl(KEY, 3, 'ricorso')]);
    expect([...out.annotationIds]).toEqual([]);
    expect([...out.highlightIds]).toEqual([`${KEY}3`]);
    expect(out.message).toContain('1 nota');
  });
});
