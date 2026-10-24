import { act, render, screen } from '@testing-library/react';
import { lazy, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn(), tryStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';

// A page whose code arrives when the test says, and one whose code cannot be had.
const arrival = vi.hoisted(() => ({ open: () => {} }));
const Waiting = lazy(() => new Promise<{ default: () => ReactElement }>((resolve) => {
  arrival.open = () => resolve({ default: () => <h1>Dossier</h1> });
}));
const Missing = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="dossier" element={<Waiting />} />
        <Route path="history" element={<Missing />} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Layout — the page loaded with its route', () => {
  it('waits in the outlet with nothing in its place, the layout drawn; the phone’s bar names nothing meanwhile', async () => {
    // A phone: the bar over the page, which names the page once its title is out of sight.
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: !/min-width/.test(query), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
    // An observer that has not answered yet: what the bar reads while the page is on its way.
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    at('/dossier');
    expect(screen.getByTestId('layout-content')).toBeEmptyDOMElement();
    expect(screen.queryByText('Dossier')).toBeNull();
    await act(async () => { arrival.open(); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Dossier' })).toBeInTheDocument();
  });

  it('keeps the layout when a page’s code cannot be had, with words the app has', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    at('/history');
    expect(await screen.findByText('Si è verificato un errore.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeInTheDocument();
    expect(screen.getByTestId('layout-content')).toBeInTheDocument();
  });
});
