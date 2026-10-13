import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({
  FeedbackButton: ({ className }: { className?: string }) => <button type="button" data-testid="feedback" className={className}>Feedback</button>,
}));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../ui/ServiceHealthBanner', () => ({
  ServiceHealthBanner: ({ className }: { className?: string }) => <div data-testid="health" className={className}>Servizi operativi</div>,
}));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);

describe('Layout — what sits where a bar is pinned to the bottom on a phone', () => {
  it.each(['/studia/ripasso/sessione?materia=DIRITTO_CIVILE', '/studia/valida'])(
    'hides the feedback button and the services pill on a phone on %s',
    (path) => {
      at(path);
      expect(screen.getByTestId('feedback')).toHaveClass('max-md:hidden');
      expect(screen.getByTestId('health')).toHaveClass('max-md:hidden');
    },
  );

  it.each(['/', '/studia', '/studia/ripasso', '/studia/schede', '/dossier'])('leaves them as they are on %s', (path) => {
    at(path);
    expect(screen.getByTestId('feedback')).not.toHaveClass('max-md:hidden');
    expect(screen.getByTestId('health')).not.toHaveClass('max-md:hidden');
  });
});
