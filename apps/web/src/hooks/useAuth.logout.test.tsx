import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// D7b's flag, asked as the app starts: off here, with no request leaving the test.
vi.mock('../services/assistantService', () => ({ assistantService: { features: vi.fn(async () => ({ assistantPassages: false })) } }));
vi.mock('../services/authService', () => ({
  isAuthenticated: () => false,
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  getCurrentUser: vi.fn(),
}));
vi.mock('../services/decisionService', () => ({ fetchDecision: vi.fn() }));
vi.mock('../services/studiaService', () => ({ studiaService: { forArticle: vi.fn() } }));

import * as authService from '../services/authService';
import { fetchDecision } from '../services/decisionService';
import { studiaService } from '../services/studiaService';
import { useArticleCards } from '../components/features/studia/useArticleCards';
import { fetchDecisionCached } from '../utils/decisionFetchCache';
import { appStore } from '../store/useAppStore';
import { useAuth } from './useAuth';
import { assistantProposalsStore } from '../store/assistantProposals';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 99999, anno: 2024 };

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

  it('forgets the cards read on an article, which are the last reader’s', async () => {
    const urn = 'urn:nir:stato:legge:1990-08-07;241~art2';
    vi.mocked(studiaService.forArticle).mockResolvedValue([]);
    const cards = renderHook(() => useArticleCards(urn));
    await waitFor(() => expect(cards.result.current.status).toBe('ready'));
    cards.unmount();
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.logout(); });

    const next = renderHook(() => useArticleCards(urn));
    expect(next.result.current.status).toBe('loading');
    await waitFor(() => expect(next.result.current.status).toBe('ready'));
    expect(studiaService.forArticle).toHaveBeenCalledTimes(2);
  });

  it('forgets what applications proposed on the last reader\'s dossiers (D7b)', async () => {
    assistantProposalsStore.setState({ enabled: true, byItem: { a1: [] } });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.logout(); });

    expect(assistantProposalsStore.getState()).toEqual({ enabled: false, byItem: {}, busy: {}, moving: null });
  });

  it('forgets what Gymnasium last drew here: the last reader’s points and level (G-316)', async () => {
    localStorage.setItem('visualex.studia.visto', JSON.stringify({ xp: 900, livello: 7 }));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.logout(); });

    expect(localStorage.getItem('visualex.studia.visto')).toBeNull();
  });

  it('forgets it too at a sign-in and a sign-up: a new person on this browser', async () => {
    vi.mocked(authService.getCurrentUser).mockResolvedValue({ id: 'u2' } as never);
    vi.spyOn(appStore.getState(), 'fetchUserData').mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    localStorage.setItem('visualex.studia.visto', JSON.stringify({ xp: 900, livello: 7 }));
    await act(async () => { await result.current.login('b@example.test', 'pw'); });
    expect(localStorage.getItem('visualex.studia.visto')).toBeNull();
    localStorage.setItem('visualex.studia.visto', JSON.stringify({ xp: 900, livello: 7 }));
    await act(async () => { await result.current.register('c@example.test', 'c', 'pw'); });
    expect(localStorage.getItem('visualex.studia.visto')).toBeNull();
  });
});
