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
vi.mock('../../ui/ServiceHealthBanner', () => ({ ServiceHealthBanner: () => null }));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));

import { Layout } from '../Layout';

describe('Layout — the feedback button', () => {
  it('is hidden on a phone during a review session, where the grade bar is pinned, and nowhere else', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/studia/ripasso/sessione?materia=DIRITTO_CIVILE']}><Layout /></MemoryRouter>);
    expect(screen.getByTestId('feedback')).toHaveClass('max-md:hidden');
    unmount();

    render(<MemoryRouter initialEntries={['/studia/ripasso']}><Layout /></MemoryRouter>);
    expect(screen.getByTestId('feedback')).not.toHaveClass('max-md:hidden');
  });
});
