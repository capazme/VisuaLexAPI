import { render } from '@testing-library/react';
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


// The sidebar made the document scrollable in a low window (935 px of icons in 706): the page is
// exactly the window, and the content areas scroll inside it. The geometry is for the browser pass.
describe('Layout — the document never scrolls', () => {
  it('is the height of the window and clips, with the content scrolling inside main', () => {
    const { container } = at('/');
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('h-screen', 'overflow-hidden');
    expect(root).not.toHaveClass('min-h-screen');
    const main = container.querySelector('main') as HTMLElement;
    expect(main).toHaveClass('h-screen', 'overflow-hidden');
    expect(main.querySelector('.overflow-y-auto')).not.toBeNull();
  });
});
