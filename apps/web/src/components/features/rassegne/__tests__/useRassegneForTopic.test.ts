import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RASSEGNE_TOPIC_DELAY_MS, useRassegneForTopic } from '../useRassegneForTopic';
import { RassegneError } from '../../../../services/rassegneService';

const searchRassegne = vi.fn();
vi.mock('../../../../services/rassegneService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/rassegneService')>()),
  searchRassegne: (...args: unknown[]) => searchRassegne(...args),
}));

const page = (id: string) => ({ total: 1, volumi: 63, archivi: [{ archivio: 'civile', passi: 1 }], items: [{ id }], next_cursor: null });

describe('useRassegneForTopic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchRassegne.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('asks once the words have stood still for 350 ms, not while they are typed', async () => {
    searchRassegne.mockResolvedValue(page('a'));
    const { result, rerender } = renderHook(({ topic }) => useRassegneForTopic(topic), { initialProps: { topic: 'respons' as string | null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS - 50); });
    rerender({ topic: 'responsabilità medica' });
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS - 1); });
    expect(searchRassegne).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(searchRassegne).toHaveBeenCalledTimes(1);
    expect(searchRassegne).toHaveBeenCalledWith({ q: 'responsabilità medica' });
    expect(result.current).toEqual({ q: 'responsabilità medica', answer: page('a') });
  });

  it('drops an answer that comes after the words changed', async () => {
    let answerOld: (v: unknown) => void = () => {};
    searchRassegne.mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }));
    searchRassegne.mockResolvedValueOnce(page('new'));
    const { result, rerender } = renderHook(({ topic }) => useRassegneForTopic(topic), { initialProps: { topic: 'danno' as string | null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS); });
    rerender({ topic: 'danno medico' });
    expect(result.current).toBeNull(); // the old words' rows go at once
    await act(async () => { answerOld(page('old')); });
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS); });
    expect(result.current).toEqual({ q: 'danno medico', answer: page('new') });
  });

  it('asks nothing with no topic or words the store would refuse', async () => {
    const { rerender } = renderHook(({ topic }) => useRassegneForTopic(topic), { initialProps: { topic: null as string | null } });
    rerender({ topic: 'a b' });
    rerender({ topic: 'uno due tre quattro cinque sei sette otto nove' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(searchRassegne).not.toHaveBeenCalled();
  });

  it('says the reviews did not answer on a failure or an answer that is not a page', async () => {
    searchRassegne.mockRejectedValueOnce(new RassegneError(503));
    const { result, rerender } = renderHook(({ topic }) => useRassegneForTopic(topic), { initialProps: { topic: 'danno' as string | null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS); });
    expect(result.current).toEqual({ q: 'danno', answer: 'error' });
    searchRassegne.mockResolvedValueOnce({ recognized: false });
    rerender({ topic: 'colpa' });
    await act(async () => { await vi.advanceTimersByTimeAsync(RASSEGNE_TOPIC_DELAY_MS); });
    expect(result.current).toEqual({ q: 'colpa', answer: 'error' });
  });
});
