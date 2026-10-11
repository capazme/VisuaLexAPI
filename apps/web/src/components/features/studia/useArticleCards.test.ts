import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { forArticle: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { SchedaDellArticolo } from '../../../types/studia';
import { clearArticleCardsCache } from '../../../utils/articleCardsCache';
import { useArticleCards } from './useArticleCards';

const forArticle = vi.mocked(studiaService.forArticle);

const card = (id: string): SchedaDellArticolo => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Contratto', tipo: 'ISTITUTO_DEFINIZIONE', domanda: `Domanda ${id}`, risposta: 'R',
  spiegazione: null, stato: 'BOZZA_PERSONALE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z',
  origine: null, ancore: [], comunita: false, approvazioni: null,
});

const URN_A = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453';
const URN_B = 'urn:nir:stato:regio.decreto:1942-03-16;262:2~art1454';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  forArticle.mockReset();
  clearArticleCardsCache();
});

describe('useArticleCards', () => {
  it('reads the cards of an article and counts them', async () => {
    forArticle.mockResolvedValue([card('a'), card('b')]);
    const { result } = renderHook(() => useArticleCards(URN_A));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.status).toBe('ready');
    expect(result.current.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('asks nothing without an address', () => {
    const { result } = renderHook(() => useArticleCards(undefined));
    expect(forArticle).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.count).toBe(0);
  });

  it('keeps an answer for the session, per address', async () => {
    forArticle.mockResolvedValue([card('a')]);
    const first = renderHook(() => useArticleCards(URN_A));
    await waitFor(() => expect(first.result.current.count).toBe(1));
    first.unmount();
    const second = renderHook(() => useArticleCards(URN_A));
    expect(second.result.current.count).toBe(1);
    expect(second.result.current.status).toBe('ready');
    expect(forArticle).toHaveBeenCalledTimes(1);
  });

  it('shares one request between two copies shown at once', async () => {
    forArticle.mockResolvedValue([card('a')]);
    const one = renderHook(() => useArticleCards(URN_A));
    const two = renderHook(() => useArticleCards(URN_A));
    await waitFor(() => expect(one.result.current.count).toBe(1));
    await waitFor(() => expect(two.result.current.count).toBe(1));
    expect(forArticle).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure: the next showing asks again', async () => {
    forArticle.mockRejectedValueOnce(new Error('down')).mockResolvedValue([card('a')]);
    const first = renderHook(() => useArticleCards(URN_A));
    await waitFor(() => expect(first.result.current.status).toBe('failed'));
    expect(first.result.current.count).toBe(0);
    first.unmount();
    const second = renderHook(() => useArticleCards(URN_A));
    await waitFor(() => expect(second.result.current.count).toBe(1));
    expect(forArticle).toHaveBeenCalledTimes(2);
  });

  it('refresh() reads again and replaces what was kept', async () => {
    forArticle.mockResolvedValueOnce([card('a')]).mockResolvedValue([card('a'), card('b')]);
    const { result } = renderHook(() => useArticleCards(URN_A));
    await waitFor(() => expect(result.current.count).toBe(1));
    await act(() => result.current.refresh());
    expect(result.current.count).toBe(2);
    const again = renderHook(() => useArticleCards(URN_A));
    expect(again.result.current.count).toBe(2);
  });

  it('drops an answer that arrives after the address changed', async () => {
    const slow = deferred<SchedaDellArticolo[]>();
    forArticle.mockImplementation((urn) => (urn === URN_A ? slow.promise : Promise.resolve([card('b1'), card('b2')])));
    const { result, rerender } = renderHook(({ urn }) => useArticleCards(urn), { initialProps: { urn: URN_A } });
    rerender({ urn: URN_B });
    await waitFor(() => expect(result.current.count).toBe(2));
    await act(async () => slow.resolve([card('a')]));
    expect(result.current.cards.map((c) => c.id)).toEqual(['b1', 'b2']);
  });

  it('shows nothing of the previous article while the next is being read', async () => {
    const slow = deferred<SchedaDellArticolo[]>();
    forArticle.mockImplementation((urn) => (urn === URN_A ? Promise.resolve([card('a')]) : slow.promise));
    const { result, rerender } = renderHook(({ urn }) => useArticleCards(urn), { initialProps: { urn: URN_A } });
    await waitFor(() => expect(result.current.count).toBe(1));
    rerender({ urn: URN_B });
    expect(result.current.count).toBe(0);
    expect(result.current.status).toBe('loading');
    await act(async () => slow.resolve([card('b')]));
    expect(result.current.cards.map((c) => c.id)).toEqual(['b']);
  });
});
