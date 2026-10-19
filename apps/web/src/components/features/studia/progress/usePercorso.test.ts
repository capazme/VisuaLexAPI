import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { TappaIstituto } from '../../../../types/studia';

vi.mock('../../../../services/studiaService', () => ({ studiaService: { percorso: vi.fn() } }));

import { studiaService } from '../../../../services/studiaService';
import { usePercorso } from './usePercorso';

const percorso = vi.mocked(studiaService.percorso);
const tappa = (istituto: string): TappaIstituto => ({ materia: 'DIRITTO_CIVILE', istituto, nuove: 1, apprendimento: 0, consolidate: 0, dovute: 0 });

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => percorso.mockReset());

describe('usePercorso', () => {
  it('reads every subject at once, loading then ready', async () => {
    percorso.mockResolvedValue([tappa('Mora del debitore')]);
    const { result } = renderHook(() => usePercorso());
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual([tappa('Mora del debitore')]);
    expect(percorso).toHaveBeenCalledWith();
  });

  it('never lets an older read overwrite the one asked after it', async () => {
    const first = deferred<TappaIstituto[]>();
    const second = deferred<TappaIstituto[]>();
    percorso.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => usePercorso());
    act(() => result.current.reload());
    await act(async () => second.resolve([tappa('Nuova')]));
    await act(async () => first.resolve([tappa('Vecchia')]));
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toEqual([tappa('Nuova')]);
  });

  it('keeps the last answer on screen while a new read travels, and when it fails', async () => {
    percorso.mockResolvedValueOnce([tappa('Mora del debitore')]);
    const { result } = renderHook(() => usePercorso());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const again = deferred<TappaIstituto[]>();
    percorso.mockReturnValueOnce(again.promise);
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'loading', data: [tappa('Mora del debitore')] });
    await act(async () => again.reject(new Error('down')));
    expect(result.current).toMatchObject({ status: 'error', data: [tappa('Mora del debitore')] });
  });

  it('fails with nothing to show when the first read fails', async () => {
    percorso.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => usePercorso());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeNull();
  });
});
