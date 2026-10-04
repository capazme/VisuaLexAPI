import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchActRubriche = vi.fn();
const fetchActTree = vi.fn();
const resolveAct = vi.fn();
vi.mock('../../../utils/actStructureCache', () => ({
  fetchActRubriche: (...a: unknown[]) => fetchActRubriche(...a),
  fetchActTree: (...a: unknown[]) => fetchActTree(...a),
}));
vi.mock('../../../utils/actUrn', () => ({ resolveAct: (...a: unknown[]) => resolveAct(...a) }));

import { useActDetails, actUrnForBlock, annexFromActUrn, resolveBlockUrn } from './useActDetails';
import { layoutDossier } from './dossierLayout';
import type { DossierItem } from '../../../types';

const URN = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247';
const item = (numero_articolo: string, more: object = {}): DossierItem => ({
  id: numero_articolo, type: 'norma', addedAt: '2026-10-04', actCitation: 'l. 31 dicembre 2012, n. 247',
  data: { tipo_atto: 'legge', numero_atto: '247', data: '2012-12-31', numero_articolo, urn: `${URN}~art${numero_articolo}`, ...more },
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useActDetails', () => {
  it('reads the title and the rubriche of a flat act with one call, and no tree', async () => {
    fetchActRubriche.mockResolvedValue({ title: 'Nuova disciplina', rubriche: { '3': 'Doveri e deontologia' }, parts: [] });
    const [block] = layoutDossier([item('3')]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.title).toBe('Nuova disciplina'));
    expect(result.current.rubricaOf(block.articles[0].data)).toBe('Doveri e deontologia');
    expect(fetchActRubriche).toHaveBeenCalledWith(URN);
    expect(fetchActTree).not.toHaveBeenCalled();
  });

  it('matches an act in parts through its tree, and shows no title for a code', async () => {
    fetchActRubriche.mockResolvedValue({
      title: 'Approvazione del testo del Codice civile', rubriche: { '1': 'Indicazione delle fonti' },
      parts: [{ name: 'CODICE CIVILE', keys: ['2042', '2043', '2044'], rubriche: { '2043': 'Risarcimento per fatto illecito' }, abrogati: [] }],
    });
    fetchActTree.mockResolvedValue({ articles: [], metadata: { annexes: [{ number: '2', label: 'Codice civile', article_count: 3, article_numbers: ['2042', '2043', '2044'] }] } });
    const [block] = layoutDossier([{
      id: 'cc', type: 'norma', addedAt: '2026-10-04', actCitation: 'c.c.',
      data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2', urn: 'urn:x;262:2~art2043' },
    }]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.rubricaOf(block.articles[0].data)).toBe('Risarcimento per fatto illecito'));
    expect(result.current.title).toBeNull();
    expect(fetchActTree).toHaveBeenCalledWith('urn:x;262:2');
  });

  it("reads a code's article saved without its annex from the code's own part", async () => {
    fetchActRubriche.mockResolvedValue({
      title: '', rubriche: {},
      parts: [{ name: 'CODICE CIVILE', keys: ['1218', '2043', '2044'], rubriche: { '1218': 'Responsabilità del debitore', '2043': 'Risarcimento per fatto illecito' }, abrogati: [] }],
    });
    fetchActTree.mockResolvedValue({ articles: [], metadata: { annexes: [{ number: '2', label: 'Codice civile', article_count: 3, article_numbers: ['1218', '2043', '2044'] }] } });
    const cc = (id: string, numero_articolo: string, allegato?: string): DossierItem => ({
      id, type: 'norma', addedAt: '', actCitation: 'c.c.',
      data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo, urn: `urn:x;262:2~art${numero_articolo}`, ...(allegato ? { allegato } : {}) },
    });
    const [block] = layoutDossier([cc('a', '2043', '2'), cc('b', '1218')]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.rubricaOf(block.articles[0].data)).toBe('Responsabilità del debitore'));
    expect(result.current.rubricaOf(block.articles[1].data)).toBe('Risarcimento per fatto illecito');
  });

  it("finds a code's own part for articles imported from its index, which carry no annex and no urn", async () => {
    resolveAct.mockResolvedValue({ urn: 'urn:x;262:2~art1', norma: {} });
    fetchActRubriche.mockResolvedValue({
      title: '', rubriche: {},
      parts: [
        { name: 'Dispositivo', keys: ['1', '2'], rubriche: {}, abrogati: [] },
        { name: 'CODICE CIVILE', keys: ['1', '2', '2043'], rubriche: { '2043': 'Risarcimento per fatto illecito' }, abrogati: [] },
      ],
    });
    fetchActTree.mockResolvedValue({ articles: [], metadata: { annexes: [
      { number: null, label: 'Dispositivo', article_count: 2, article_numbers: ['1', '2'] },
      { number: '2', label: 'Codice civile', article_count: 3, article_numbers: ['1', '2', '2043'] },
    ] } });
    const [block] = layoutDossier([{
      id: 'cc', type: 'norma', addedAt: '', data: { tipo_atto: 'codice civile', numero_atto: '', data: '', numero_articolo: '2043' },
    }]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.rubricaOf(block.articles[0].data)).toBe('Risarcimento per fatto illecito'));
    expect(fetchActTree).toHaveBeenCalledWith('urn:x;262:2');
  });

  it('resolves the act when no item carries a urn', async () => {
    resolveAct.mockResolvedValue({ urn: `${URN}~art1`, norma: {} });
    fetchActRubriche.mockResolvedValue({ title: 'Nuova disciplina', rubriche: {}, parts: [] });
    const [block] = layoutDossier([item('3', { urn: undefined })]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(result.current.title).toBe('Nuova disciplina'));
    expect(resolveAct).toHaveBeenCalledWith({ act_type: 'legge', act_number: '247', date: '2012-12-31' });
    // The act's URN, the same key the reader caches the act under: one call, not two.
    expect(fetchActRubriche).toHaveBeenCalledWith(URN);
  });

  it('logs a failure and shows nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchActRubriche.mockRejectedValue(new Error('down'));
    const [block] = layoutDossier([item('3')]).acts;
    const { result } = renderHook(() => useActDetails(block));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(result.current.title).toBeNull();
    expect(result.current.rubricaOf(block.articles[0].data)).toBeNull();
    error.mockRestore();
  });
});

describe('actUrnForBlock', () => {
  it('is the first urn without the article', () => {
    expect(actUrnForBlock(layoutDossier([item('3')]).acts[0])).toBe(URN);
  });
});

describe('the act behind a block', () => {
  it("reads a decree's annex from its URN", () => {
    expect(annexFromActUrn('https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2')).toBe('2');
    expect(annexFromActUrn('urn:nir:stato:regio.decreto:1930-10-19;1398:1')).toBe('1');
    expect(annexFromActUrn(URN)).toBe('');
  });
  it('resolves a block with no urn through the act, without the probed article', async () => {
    resolveAct.mockResolvedValue({ urn: `${URN}~art1`, norma: {} });
    const [block] = layoutDossier([item('3', { urn: undefined })]).acts;
    expect(await resolveBlockUrn(block)).toBe(URN);
  });
});
