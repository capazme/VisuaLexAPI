import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// A cold boot (Irnerio's repro, LC61): the browser remembers the Forum as the last section before the app mounts.
vi.hoisted(() => {
  localStorage.setItem('visualex-section', JSON.stringify({ state: { section: 'forum', dossierKind: 'studio' }, version: 0 }));
});

vi.mock('../features/merlt/consent/ConsentContext', () => ({ ConsentProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
// The real session check: a saved session, the account answers, then the user's data is read (`fetchUserData`).
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return {
    ...actual,
    isAuthenticated: () => true,
    isAccessTokenExpired: () => false,
    getCurrentUser: vi.fn(async () => ({ id: 'u1', email: 'a@b.it', username: 'anteprima', is_active: true, is_admin: false, dev_mode: false, created_at: '' })),
  };
});
const api = (id: string, name: string, kind: string) => ({ id, name, kind, items: [], created_at: '2026-10-01T00:00:00Z', tags: [], is_pinned: false });
vi.mock('../services/bookmarkService', () => ({ bookmarkService: { getAll: vi.fn(async () => []) } }));
vi.mock('../services/environmentService', () => ({ environmentService: { getAll: vi.fn(async () => []) } }));
vi.mock('../services/quickNormService', () => ({ quickNormService: { getAll: vi.fn(async () => []) } }));
vi.mock('../services/customAliasService', () => ({ customAliasService: { getAll: vi.fn(async () => []) } }));
vi.mock('../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn(), startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }) }));
vi.mock('../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../services/trashService', () => ({ trashService: { list: vi.fn(async () => []), restore: vi.fn(), purge: vi.fn() } }));
vi.mock('../services/dossierService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/dossierService')>();
  return { ...actual, dossierService: { ...actual.dossierService, getSnapshots: vi.fn(async () => []),
    getAll: vi.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return [api('w1', 'Condominio', 'lavoro'), api('s1', 'Diritto penale', 'studio'), api('s2', 'Marchi', 'studio')]; }) } };
});
vi.mock('../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../components/ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../components/features/planner/PlannerHost', () => ({ PlannerHost: () => null }));

import App from '../App';
import { sectionStore } from '../features/sections/useSection';


describe('App — a pratica opened by its address on a cold boot after the Forum (LC61)', () => {
  it('opens that work pratica, and the section follows it', async () => {
    expect(sectionStore.getState().section).toBe('forum');
    const changes: string[] = [];
    sectionStore.subscribe((st, prev) => changes.push(`${prev.section}->${st.section} @ ${new Error().stack?.split('\n').slice(2, 7).map((l) => l.trim().replace(/\(.*\/src\//, '(')).join(' | ')}`));
    window.history.pushState({}, '', '/pratiche?dossier=w1');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: /Condominio/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(window.location.search).toBe('?dossier=w1');
    // The section follows the pratica in an effect after the commit that draws its heading (`DossierPage`): the heading
    // can be found before that effect has run, more so on a busy machine, so the section is awaited, not read at once.
    await waitFor(() => expect(sectionStore.getState().section).toBe('opus'));
  });
});
