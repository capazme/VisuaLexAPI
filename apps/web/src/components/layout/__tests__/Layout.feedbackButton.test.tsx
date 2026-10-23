import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({
  FeedbackButton: ({ className }: { className?: string; onOpen: () => void }) => <button type="button" data-testid="feedback" className={className}>Feedback</button>,
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

describe('Layout — what floats at the foot of the page on a phone', () => {
  // On a phone it is the user menu's «Invia un commento» (M1): it covered the bars pinned to the bottom and the pages' rows.
  it.each(['/', '/studia/ripasso', '/studia/ripasso/sessione?materia=DIRITTO_CIVILE', '/studia/valida', '/studia/schede', '/dossier'])(
    'hides the feedback button on a phone on %s',
    (path) => {
      at(path);
      expect(screen.getByTestId('feedback')).toHaveClass('max-md:hidden');
    },
  );

  // The services pill covered the foot of the page on a phone: it is the user menu's «Stato dei servizi» (S1).
  it.each(['/', '/studia/ripasso', '/studia/ripasso/sessione', '/studia/valida', '/dossier'])('draws no services pill on %s', (path) => {
    at(path);
    expect(screen.queryByText(/Servizi operativi|Controllo servizi/)).toBeNull();
  });
});

describe('Layout — the page\'s foot, clear of the feedback button (G8c)', () => {
  afterEach(() => {
    auth.isAuthenticated = true;
  });

  // From md the button, 24 px off the edge and 46 px tall, covered the last row on the right («Ripassa» of the last
  // subject on «Oggi»): the page ends 16 px over it.
  const CLEARANCE = 'md:pb-[5.375rem]';

  it.each(['/studia/ripasso', '/studia/schede', '/dossier', '/forum', '/studia/progressi'])('ends the page over the button on %s', (path) => {
    at(path);
    expect(screen.getByTestId('feedback')).toBeInTheDocument();
    expect(screen.getByTestId('layout-content')).toHaveClass(CLEARANCE);
  });

  it('keeps it in Focus mode, where the button still floats', async () => {
    const { appStore } = await import('../../../store/useAppStore');
    const before = appStore.getState().settings;
    appStore.setState({ settings: { ...before, focusMode: true } });
    try {
      at('/dossier');
      expect(screen.getByTestId('layout-content')).toHaveClass(CLEARANCE, 'py-12');
    } finally {
      appStore.setState({ settings: before });
    }
  });

  it('leaves the search page its padding, which its practice row is measured against (`h-app-row`)', () => {
    at('/');
    expect(screen.getByTestId('layout-content')).not.toHaveClass(CLEARANCE);
  });

  it('adds nothing for someone signed out, who has no button', () => {
    auth.isAuthenticated = false;
    at('/dossier');
    expect(screen.queryByTestId('feedback')).toBeNull();
    expect(screen.getByTestId('layout-content')).not.toHaveClass(CLEARANCE);
  });
});
