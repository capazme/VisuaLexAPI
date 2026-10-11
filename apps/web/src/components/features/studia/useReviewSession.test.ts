import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../services/studiaService', () => ({
  studiaService: { session: vi.fn(), review: vi.fn() },
}));

import { studiaService } from '../../../services/studiaService';
import type { SchedaDiRipasso } from '../../../types/studia';
import { useReviewSession } from './useReviewSession';

const session = vi.mocked(studiaService.session);
const review = vi.mocked(studiaService.review);

const card = (id: string, extra: Partial<SchedaDiRipasso> = {}): SchedaDiRipasso => ({
  id, materia: 'DIRITTO_CIVILE', istituto: 'Risoluzione', tipo: 'ISTITUTO_DEFINIZIONE',
  domanda: `Domanda ${id}?`, risposta: `Risposta ${id}.`, spiegazione: null, stato: 'BOZZA_PERSONALE',
  createdAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-05T10:00:00Z', origine: null, ancore: [],
  nuova: false, comunita: false, anteprima: { '1': 1, '2': 3, '3': 8, '4': 21 },
  ...extra,
});

const key = (k: string, target: Element = document.body) => fireEvent.keyDown(target, { key: k });

async function started(cards: SchedaDiRipasso[], options?: Parameters<typeof useReviewSession>[1]) {
  session.mockResolvedValue({ conteggi: { dovute: cards.length, nuove: 0 }, cards });
  const hook = renderHook(() => useReviewSession(undefined, options));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  review.mockReset();
  review.mockResolvedValue({ registrata: true, prossimoRipasso: '2026-10-12', scheduledDays: 3 });
});
afterEach(() => vi.useRealTimers());

describe('useReviewSession', () => {
  it('reads the session once, for the chosen subject, and offers the head of the queue', async () => {
    session.mockResolvedValue({ conteggi: { dovute: 2, nuove: 0 }, cards: [card('a'), card('b')] });
    const { result } = renderHook(() => useReviewSession('DIRITTO_PENALE'));
    await waitFor(() => expect(result.current.current?.id).toBe('a'));
    expect(session).toHaveBeenCalledWith('DIRITTO_PENALE');
    expect(result.current.remaining).toBe(2);
    expect(result.current.revealed).toBe(false);
    expect(result.current.done).toBe(false);
  });

  it('is done at once when there is nothing to review', async () => {
    const { result } = await started([]);
    expect(result.current.current).toBeNull();
    expect(result.current.done).toBe(true);
  });

  it('reports a session that cannot be read', async () => {
    session.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useReviewSession());
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.done).toBe(false);
  });

  it('shows the answer on space (and stops the page from scrolling), and grades only after that', async () => {
    const { result } = await started([card('a'), card('b')]);
    key('3');
    expect(review).not.toHaveBeenCalled();
    const notCancelled = fireEvent.keyDown(document.body, { key: ' ' });
    expect(notCancelled).toBe(false);
    expect(result.current.revealed).toBe(true);
    key('3');
    await waitFor(() => expect(result.current.current?.id).toBe('b'));
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'a', rating: 3 }));
    expect(result.current.revealed).toBe(false);
  });

  it('sends the time from the question shown to the grade, capped at an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    const { result } = await started([card('a'), card('b')]);
    act(() => result.current.reveal());
    vi.setSystemTime(new Date('2026-10-12T10:00:07Z'));
    await act(async () => result.current.grade(2));
    expect(review).toHaveBeenLastCalledWith({ cardId: 'a', rating: 2, durataMs: 7000 });

    act(() => result.current.reveal());
    vi.setSystemTime(new Date('2026-10-12T14:00:07Z'));
    await act(async () => result.current.grade(2));
    expect(review).toHaveBeenLastCalledWith({ cardId: 'b', rating: 2, durataMs: 3_600_000 });
  });

  it('puts a first «Di nuovo» back at the end, sent once; its later passes are not sent', async () => {
    const { result } = await started([card('a'), card('b')]);
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'a', rating: 1 }));
    expect(result.current.current?.id).toBe('b');
    expect(result.current.revealed).toBe(false);
    expect(result.current.remaining).toBe(2);

    act(() => result.current.reveal());
    await act(async () => result.current.grade(3));
    expect(result.current.current?.id).toBe('a');

    // Second pass of «a»: «Di nuovo» again sends it back, nothing is posted.
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    expect(result.current.current?.id).toBe('a');
    expect(result.current.remaining).toBe(1);

    // «Bene» takes it out, still nothing posted.
    act(() => result.current.reveal());
    await act(async () => result.current.grade(3));
    expect(result.current.current).toBeNull();
    expect(result.current.done).toBe(true);
    expect(review).toHaveBeenCalledTimes(2);
  });

  it('counts distinct cards and keeps the shortest interval it recorded', async () => {
    review
      .mockResolvedValueOnce({ registrata: true, prossimoRipasso: '2026-10-13', scheduledDays: 1 })
      .mockResolvedValueOnce({ registrata: false, prossimoRipasso: '2026-10-20', scheduledDays: 8 });
    const { result } = await started([card('a'), card('b')]);
    expect(result.current.summary).toEqual({ reviewed: 0, again: 0, nextDue: null });
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    act(() => result.current.reveal());
    await act(async () => result.current.grade(3));
    // «a» again, twice «Di nuovo» in all, still one card.
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    act(() => result.current.reveal());
    await act(async () => result.current.grade(4));
    expect(result.current.summary).toEqual({ reviewed: 2, again: 1, nextDue: 1 });
  });

  it('keeps the card, shown, when the grade does not reach the server, and sends it again on the next grade', async () => {
    const { result } = await started([card('a'), card('b')]);
    review.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.reveal());
    await act(async () => result.current.grade(3));
    expect(result.current.saveError).toBe(true);
    expect(result.current.current?.id).toBe('a');
    expect(result.current.revealed).toBe(true);
    expect(result.current.summary.reviewed).toBe(0);

    await act(async () => result.current.grade(3));
    expect(review).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBe(false);
    expect(result.current.current?.id).toBe('b');
    expect(result.current.summary.reviewed).toBe(1);
  });

  it('does not send one grade twice while it is on its way', async () => {
    let finish: (value: Awaited<ReturnType<typeof studiaService.review>>) => void = () => {};
    review.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = await started([card('a'), card('b')]);
    act(() => result.current.reveal());
    act(() => { void result.current.grade(3); });
    act(() => { void result.current.grade(3); });
    expect(review).toHaveBeenCalledTimes(1);
    await act(async () => finish({ registrata: true, prossimoRipasso: '2026-10-15', scheduledDays: 3 }));
    expect(result.current.current?.id).toBe('b');
  });

  it('ignores a key pressed after the grade went through and before the screen caught up', async () => {
    let finish: (value: Awaited<ReturnType<typeof studiaService.review>>) => void = () => {};
    review.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result } = await started([card('a'), card('b')]);
    act(() => result.current.reveal());
    key('3');
    expect(review).toHaveBeenCalledTimes(1);
    // The post resolves; React has not rendered yet, so the listener in place is still the old one.
    finish({ registrata: true, prossimoRipasso: '2026-10-15', scheduledDays: 3 });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    key('3');
    key('1');
    await waitFor(() => expect(result.current.current?.id).toBe('b'));
    expect(review).toHaveBeenCalledTimes(1);
    expect(result.current.remaining).toBe(1);
    expect(result.current.revealed).toBe(false);
  });

  it('does not stop the page from scrolling on a space once the answer is shown', async () => {
    await started([card('a')]);
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(true);
  });

  it('marks a requeued card as practice', async () => {
    const { result } = await started([card('a'), card('b')]);
    expect(result.current.practice).toBe(false);
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    act(() => result.current.reveal());
    await act(async () => result.current.grade(3));
    expect(result.current.current?.id).toBe('a');
    expect(result.current.practice).toBe(true);
  });

  it('counts a step each time the queue moves on, even to the same card', async () => {
    const { result } = await started([card('a')]);
    const before = result.current.step;
    act(() => result.current.reveal());
    await act(async () => result.current.grade(1));
    expect(result.current.current?.id).toBe('a');
    expect(result.current.step).toBe(before + 1);
  });

  it('asks to stop on Esc', async () => {
    const onEscape = vi.fn();
    await started([card('a')], { onEscape });
    key('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  describe('the keys it leaves alone', () => {
    it('ignores keys typed in a field', async () => {
      const { result } = await started([card('a')]);
      const input = document.body.appendChild(document.createElement('input'));
      key(' ', input);
      expect(result.current.revealed).toBe(false);
      input.remove();
    });

    it('lets a focused button take space itself: no second action', async () => {
      const { result } = await started([card('a')]);
      const button = document.body.appendChild(document.createElement('button'));
      const notCancelled = fireEvent.keyDown(button, { key: ' ' });
      expect(notCancelled).toBe(true);
      expect(result.current.revealed).toBe(false);
      button.remove();
    });

    it('ignores every key while a dialog is open, and while paused', async () => {
      const onEscape = vi.fn();
      const { result, rerender } = await started([card('a')], { onEscape });
      const dialog = document.body.appendChild(document.createElement('div'));
      dialog.setAttribute('aria-modal', 'true');
      key(' ');
      key('Escape');
      expect(result.current.revealed).toBe(false);
      expect(onEscape).not.toHaveBeenCalled();
      dialog.remove();

      const paused = renderHook(() => useReviewSession(undefined, { paused: true, onEscape }));
      await waitFor(() => expect(paused.result.current.loading).toBe(false));
      key(' ');
      expect(paused.result.current.revealed).toBe(false);
      rerender();
    });

    it('ignores a key with a modifier (Cmd+1 switches tabs)', async () => {
      const { result } = await started([card('a')]);
      fireEvent.keyDown(document.body, { key: ' ', metaKey: true });
      expect(result.current.revealed).toBe(false);
    });
  });
});
