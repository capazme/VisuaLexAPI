import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const list = vi.fn();
const restoreCall = vi.fn();
const purgeCall = vi.fn();
vi.mock('../../../services/trashService', () => ({
  trashService: { list: () => list(), restore: (...a: unknown[]) => restoreCall(...a), purge: (...a: unknown[]) => purgeCall(...a) },
}));

import { appStore } from '../../../store/useAppStore';
import { useTrash } from './useTrash';
import type { TrashEntry } from '../../../services/trashService';

const entry = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  id: 't1', kind: 'DOSSIER_ITEMS', dossierId: 'd1', label: 'Prova', itemCount: 1,
  items: [{ itemType: 'note', citation: null, actCitation: null }], clientName: 'Claude Code', byApplication: true,
  deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z', ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('useTrash', () => {
  it('lists, restores and reloads the dossier the entry went back to', async () => {
    const refreshDossier = vi.fn(async () => {});
    appStore.setState({ refreshDossier });
    list.mockResolvedValue([entry()]);
    restoreCall.mockResolvedValue({ dossierId: 'd1' });
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome;
    await act(async () => { outcome = await result.current.restore(entry()); });
    expect(outcome).toEqual({ kind: 'restored' });
    expect(refreshDossier).toHaveBeenCalledWith('d1');
    expect(result.current.entries).toEqual([]);
  });

  it('asks for a dossier when the entry’s own is gone', async () => {
    appStore.setState({ dossiers: [] });
    list.mockResolvedValue([entry()]);
    restoreCall.mockRejectedValue({ status: 409, message: 'Il dossier non esiste più: scegli dove ripristinare.' });
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome;
    await act(async () => { outcome = await result.current.restore(entry()); });
    expect(outcome).toEqual({ kind: 'needs-target', message: 'Il dossier non esiste più: scegli dove ripristinare.' });
  });

  it('says the trash is out of reach when it cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    list.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.error).toMatch(/non è raggiungibile/));
    error.mockRestore();
  });

  it('empties one entry', async () => {
    list.mockResolvedValue([entry()]);
    purgeCall.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    await act(async () => { await result.current.purge(entry()); });
    expect(purgeCall).toHaveBeenCalledWith('t1');
    expect(result.current.entries).toEqual([]);
  });
});

describe('useTrash — what can go wrong', () => {
  it('drops an entry the server no longer has, and says why', async () => {
    list.mockResolvedValue([entry()]);
    restoreCall.mockRejectedValue({ status: 404, message: 'Elemento del cestino non trovato.' });
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome;
    await act(async () => { outcome = await result.current.restore(entry()); });
    expect(outcome).toEqual({ kind: 'failed', message: expect.stringMatching(/Non è più nel cestino/) });
    expect(result.current.entries).toEqual([]);
  });

  it("does not ask for a dossier when the entry's own is still here (restored meanwhile)", async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', items: [], tags: [] }] });
    list.mockResolvedValue([entry()]);
    restoreCall.mockRejectedValue({ status: 409, message: 'Questi elementi sono già stati ripristinati.' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome;
    await act(async () => { outcome = await result.current.restore(entry()); });
    expect(outcome).toEqual({ kind: 'failed', message: 'Questi elementi sono già stati ripristinati.' });
    error.mockRestore();
  });

  it("never shows the server's English words", async () => {
    list.mockResolvedValue([entry()]);
    restoreCall.mockRejectedValue({ status: 500, message: 'Internal server error' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    let outcome;
    await act(async () => { outcome = await result.current.restore(entry()); });
    expect(outcome).toEqual({ kind: 'failed', message: 'Impossibile ripristinare. Riprova.' });
    error.mockRestore();
  });

  it('reads the trash again when the tab comes back into view', async () => {
    list.mockResolvedValueOnce([]).mockResolvedValueOnce([entry()]);
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.entries).toEqual([]));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });
});
