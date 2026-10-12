import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArticleData, Norma } from '../../types';

const { legalFetch } = vi.hoisted(() => ({ legalFetch: vi.fn() }));
vi.mock('../../services/legalFetch', () => ({ legalFetch }));

import { appStore } from '../../store/useAppStore';
import { useAnnexNavigation } from '../useAnnexNavigation';
import { clearActStructureCache } from '../../utils/actStructureCache';

// No URN: the hook would otherwise fetch the act's tree on mount, which is not under test here.
const L24: Norma = { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08' };
const art = (numero: string, extra: Partial<ArticleData['norma_data']> = {}): ArticleData => ({
  article_text: `Art. ${numero}\nTesto.`,
  norma_data: { ...L24, numero_articolo: numero, ...extra },
});
const answer = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const sentBody = (call = 0) => JSON.parse(legalFetch.mock.calls[call][1].body as string);

const triggerSearch = vi.fn();
let original: { triggerSearch: unknown };

beforeEach(() => {
  legalFetch.mockReset();
  triggerSearch.mockReset();
  const state = appStore.getState();
  original = { triggerSearch: state.triggerSearch };
  appStore.setState({ triggerSearch } as never);
});
afterEach(() => {
  appStore.setState(original as never);
});

describe('useAnnexNavigation with addArticles (the practice, spec §6.4)', () => {
  it('an article loaded lands through addArticles', async () => {
    legalFetch.mockResolvedValue(answer([art('7'), { error: 'not found' }]));
    const addArticles = vi.fn();
    const { result } = renderHook(() =>
      useAnnexNavigation({ norma: L24, articles: [art('5')], addArticles }));
    await act(async () => { await result.current.handleLoadArticle('7'); });
    expect(legalFetch).toHaveBeenCalledWith('/fetch_all_data', expect.objectContaining({ method: 'POST' }));
    expect(sentBody()).toEqual(expect.objectContaining({ act_type: 'legge', act_number: '24', article: '7', version: 'vigente' }));
    expect(addArticles).toHaveBeenCalledWith(L24, [art('7')]);
    expect(triggerSearch).not.toHaveBeenCalled();
  });

  it('an article already loaded is not fetched', async () => {
    const addArticles = vi.fn();
    const { result } = renderHook(() => useAnnexNavigation({ norma: L24, articles: [art('5')], addArticles }));
    await act(async () => { await result.current.handleLoadArticle('5'); });
    expect(legalFetch).not.toHaveBeenCalled();
    expect(addArticles).not.toHaveBeenCalled();
  });

  it('an answer with no article adds nothing', async () => {
    legalFetch.mockResolvedValue(answer({ error: 'not found' }));
    const addArticles = vi.fn();
    const { result } = renderHook(() => useAnnexNavigation({ norma: L24, articles: [], addArticles }));
    await act(async () => { await result.current.handleLoadArticle('9'); });
    expect(addArticles).not.toHaveBeenCalled();
  });

  it('an annex switch loads the article it is asked for into the practice', async () => {
    legalFetch.mockResolvedValue(answer([art('7', { allegato: 'A' })]));
    const addArticles = vi.fn();
    const { result } = renderHook(() =>
      useAnnexNavigation({ norma: L24, articles: [art('5'), art('7')], addArticles }));
    let found: string | null = null;
    await act(async () => { found = await result.current.handleAnnexSelect('A', '7'); });
    expect(sentBody()).toEqual(expect.objectContaining({ article: '7', annex: 'A' }));
    expect(addArticles).toHaveBeenCalledWith(L24, [art('7', { allegato: 'A' })]);
    expect(found).toBe('7');
  });

  it('without addArticles it runs a global search instead', async () => {
    const { result } = renderHook(() => useAnnexNavigation({ norma: L24, articles: [art('5')] }));
    await act(async () => { await result.current.handleLoadArticle('7'); });
    expect(legalFetch).not.toHaveBeenCalled();
    expect(triggerSearch).toHaveBeenCalledWith(expect.objectContaining({ act_type: 'legge', article: '7' }));
  });
});

describe('useAnnexNavigation: the act\'s tree', () => {
  it('a tree that fails to load is asked for once, not again and again; Struttura asks again', async () => {
    clearActStructureCache();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    legalFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const norma: Norma = { ...L24, urn: 'urn:nir:stato:legge:2017-03-08;24' };
    const { result } = renderHook(() => useAnnexNavigation({ norma, articles: [art('5')] }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const treeCalls = () => legalFetch.mock.calls.filter(([path]) => path === '/fetch_tree').length;
    expect(treeCalls()).toBe(1);
    await act(async () => { await result.current.fetchTree(); });
    expect(treeCalls()).toBe(2);
    error.mockRestore();
    clearActStructureCache();
  });
});
