import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/authService', () => ({
  isAuthenticated: () => false,
  logout: vi.fn(),
  getCurrentUser: vi.fn(),
}));
vi.mock('../services/decisionService', () => ({ fetchDecision: vi.fn() }));

import { fetchDecision } from '../services/decisionService';
import { fetchDecisionCached } from '../utils/decisionFetchCache';
import { appStore } from '../store/useAppStore';
import { useAuth } from './useAuth';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };

beforeEach(() => vi.mocked(fetchDecision).mockReset());

// The next reader of this browser starts with nothing of the last one's (user isolation).
describe('useAuth — logout', () => {
  it('drops the decision the last reader asked for, the focus request, the typed citation and the cached answers', async () => {
    vi.mocked(fetchDecision).mockResolvedValue({ esito: 'non_trovata' } as never);
    await fetchDecisionCached(REF);
    appStore.setState({ pendingDecision: REF, decisionFocusRequest: 'tab', commandPaletteQuery: 'Cass. civ., n. 1/2024' });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.logout(); });

    const s = appStore.getState();
    expect(s.pendingDecision).toBeNull();
    expect(s.decisionFocusRequest).toBeNull();
    expect(s.commandPaletteQuery).toBeNull();
    await fetchDecisionCached(REF);
    expect(fetchDecision).toHaveBeenCalledTimes(2);
  });
});
