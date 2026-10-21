import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
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
