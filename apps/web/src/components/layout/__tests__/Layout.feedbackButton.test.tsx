import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({
  FeedbackButton: ({ className }: { className?: string; onOpen: () => void }) => <button type="button" data-testid="feedback" className={className}>Commenti</button>,
}));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
// The planner's host reads the tasks from the server: not under test here.
vi.mock('../../features/planner/PlannerHost', () => ({ PlannerHost: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../../hooks/useServiceHealth', () => ({ useServiceHealth: () => ({ snapshot: { overall: 'online', services: [], checkedAt: '' }, refresh: vi.fn() }) }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);

describe('Layout — «Commenti» at the top right (D-253)', () => {
  afterEach(() => {
    auth.isAuthenticated = true;
  });

  // Below md it is the user menu's «Commenti» (M1).
  it.each(['/', '/learn/ripasso', '/learn/ripasso/sessione?materia=DIRITTO_CIVILE', '/learn/valida', '/learn/schede', '/dossier'])(
    'shows it from md only on %s, left of «Tutto schermo», which Tab reaches after it',
    (path) => {
      at(path);
      const feedback = screen.getByTestId('feedback');
      expect(feedback).toHaveClass('hidden', 'md:inline-flex', 'fixed', 'top-4', 'right-[4.25rem]');
      expect(feedback.compareDocumentPosition(screen.getByRole('button', { name: 'Tutto schermo' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it("sits in the bar's right end between md and lg, as «Tutto schermo», and at the window's top right in full screen", async () => {
    at('/dossier');
    expect(screen.getByTestId('feedback')).toHaveClass('max-lg:right-14');
    cleanup();
    const { appStore } = await import('../../../store/useAppStore');
    const before = appStore.getState().settings;
    appStore.setState({ settings: { ...before, focusMode: true } });
    try {
      at('/dossier');
      expect(screen.getByTestId('feedback')).not.toHaveClass('max-lg:right-14');
      // The top rows keep clear of both buttons from md, which draws no bar in full screen.
      expect(screen.getByTestId('layout-content')).toHaveClass('md:[--focus-button-room:11rem]');
    } finally {
      appStore.setState({ settings: before });
    }
  });

  it('keeps the top rows clear of it from lg, never over the search page, whose field ends before it', () => {
    at('/dossier');
    expect(screen.getByTestId('layout-content')).toHaveClass('lg:[--focus-button-room:11rem]');
    cleanup();
    at('/');
    expect(screen.getByTestId('layout-content').className).not.toMatch(/--focus-button-room/);
    expect(screen.getByTestId('search-bar')).toHaveClass('md:pr-[10.5rem]', 'lg:pr-[11rem]');
  });

  it("leaves the page's foot its own padding: nothing floats there any more", () => {
    at('/dossier');
    expect(screen.getByTestId('layout-content').className).not.toMatch(/page-foot/);
  });

  it('is not drawn for someone signed out', () => {
    auth.isAuthenticated = false;
    at('/dossier');
    expect(screen.queryByTestId('feedback')).toBeNull();
  });

  // The services pill covered the foot of the page on a phone: it is the user menu's «Stato dei servizi» (S1).
  it.each(['/', '/learn/ripasso', '/learn/ripasso/sessione', '/learn/valida', '/dossier'])('draws no services pill on %s', (path) => {
    at(path);
    expect(screen.queryByText(/Servizi operativi|Controllo servizi/)).toBeNull();
  });
});
