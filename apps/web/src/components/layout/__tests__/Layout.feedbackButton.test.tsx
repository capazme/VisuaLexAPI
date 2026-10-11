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

describe('Layout — what sits where the review’s grade bar is pinned', () => {
  it('hides the feedback button and the services pill on a phone during a review session, and nowhere else', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/studia/ripasso/sessione?materia=DIRITTO_CIVILE']}><Layout /></MemoryRouter>);
    expect(screen.getByTestId('feedback')).toHaveClass('max-md:hidden');
    expect(screen.getByTestId('health')).toHaveClass('max-md:hidden');
    unmount();

    render(<MemoryRouter initialEntries={['/studia/ripasso']}><Layout /></MemoryRouter>);
    expect(screen.getByTestId('feedback')).not.toHaveClass('max-md:hidden');
    expect(screen.getByTestId('health')).not.toHaveClass('max-md:hidden');
  });
});
