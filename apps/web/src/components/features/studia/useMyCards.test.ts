import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { list: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { Materia, Scheda } from '../../../types/studia';
import { groupCards, useMyCards } from './useMyCards';

const list = vi.mocked(studiaService.list);

const card = (id: string, materia: Materia, istituto: string): Scheda => ({
  id, materia, istituto, tipo: 'ISTITUTO_DEFINIZIONE', domanda: `Domanda ${id}`, risposta: 'R', spiegazione: null,
  stato: 'BOZZA_PERSONALE', createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null, ancore: [],
});

beforeEach(() => list.mockReset());

describe('groupCards', () => {
  it('groups by subject and institute, in the order given', () => {
    const groups = groupCards([
      card('a', 'DIRITTO_CIVILE', 'Contratto'),
      card('b', 'DIRITTO_CIVILE', 'Risoluzione'),
      card('c', 'DIRITTO_CIVILE', 'Risoluzione'),
      card('d', 'DIRITTO_PENALE', 'Reato'),
    ]);
    expect(groups.map((g) => g.materia)).toEqual(['DIRITTO_CIVILE', 'DIRITTO_PENALE']);
    expect(groups[0].istituti.map((i) => [i.istituto, i.cards.map((c) => c.id)])).toEqual([['Contratto', ['a']], ['Risoluzione', ['b', 'c']]]);
  });
});

describe('useMyCards', () => {
  it('always lists by subject, with the filters it was given', async () => {
    list.mockResolvedValue({ cards: [], nextOffset: null });
    renderHook(() => useMyCards({ stato: 'VALIDATA', q: 'caparra' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(list).toHaveBeenCalledWith({ stato: 'VALIDATA', q: 'caparra', ordine: 'materia' });
  });

  it('merges the pages, so a group split across two is one group', async () => {
    list
      .mockResolvedValueOnce({ cards: [card('a', 'DIRITTO_CIVILE', 'Risoluzione'), card('b', 'DIRITTO_CIVILE', 'Risoluzione')], nextOffset: 2 })
      .mockResolvedValueOnce({ cards: [card('c', 'DIRITTO_CIVILE', 'Risoluzione'), card('d', 'DIRITTO_PENALE', 'Reato')], nextOffset: null });
    const { result } = renderHook(() => useMyCards({}));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(list).toHaveBeenLastCalledWith({ ordine: 'materia', offset: 2 });
    expect(result.current.groups).toHaveLength(2);
    expect(result.current.groups[0].istituti).toHaveLength(1);
    expect(result.current.groups[0].istituti[0].cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not repeat a card that two pages both hold', async () => {
    list
      .mockResolvedValueOnce({ cards: [card('a', 'DIRITTO_CIVILE', 'X')], nextOffset: 1 })
      .mockResolvedValueOnce({ cards: [card('a', 'DIRITTO_CIVILE', 'X'), card('b', 'DIRITTO_CIVILE', 'X')], nextOffset: null });
    const { result } = renderHook(() => useMyCards({}));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('starts again from the first page when the filters change', async () => {
    list.mockResolvedValueOnce({ cards: [card('a', 'DIRITTO_CIVILE', 'X')], nextOffset: 1 });
    const { result, rerender } = renderHook(({ q }: { q?: string }) => useMyCards({ q }), { initialProps: {} });
    await waitFor(() => expect(result.current.cards).toHaveLength(1));
    list.mockResolvedValueOnce({ cards: [card('z', 'DIRITTO_PENALE', 'Y')], nextOffset: null });
    rerender({ q: 'furto' });
    await waitFor(() => expect(result.current.cards.map((c) => c.id)).toEqual(['z']));
    expect(list).toHaveBeenLastCalledWith({ q: 'furto', ordine: 'materia' });
  });

  it('drops the answer to filters that are no longer the ones asked for', async () => {
    let slow!: (page: { cards: Scheda[]; nextOffset: number | null }) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { slow = resolve; }));
    const { result, rerender } = renderHook(({ q }: { q?: string }) => useMyCards({ q }), { initialProps: {} });
    list.mockResolvedValueOnce({ cards: [card('new', 'DIRITTO_CIVILE', 'X')], nextOffset: null });
    rerender({ q: 'nuovo' });
    await waitFor(() => expect(result.current.cards.map((c) => c.id)).toEqual(['new']));
    await act(async () => slow({ cards: [card('old', 'DIRITTO_PENALE', 'Y')], nextOffset: null }));
    expect(result.current.cards.map((c) => c.id)).toEqual(['new']);
  });

  it('says when the cards cannot be read, and reads them again on refresh', async () => {
    list.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useMyCards({}));
    await waitFor(() => expect(result.current.error).toBe('Non riesco a leggere le schede. Riprova.'));
    list.mockResolvedValueOnce({ cards: [card('a', 'DIRITTO_CIVILE', 'X')], nextOffset: null });
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.cards).toHaveLength(1);
  });
});
