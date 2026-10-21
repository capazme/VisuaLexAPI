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


// The sidebar made the document scrollable in a low window (935 px of icons in 706): the page is
// exactly the window, and the content areas scroll inside it. The geometry is for the browser pass.
describe('Layout — the document never scrolls', () => {
  it('is the height of the window and clips, with the content scrolling inside main', () => {
    const { container } = at('/');
    const root = container.firstElementChild as HTMLElement;
    // `h-app`: the dynamic viewport height, with `100vh` as the fallback (see index.css).
    expect(root).toHaveClass('h-app', 'overflow-hidden');
    expect(root).not.toHaveClass('min-h-screen', 'h-screen');
    const main = container.querySelector('main') as HTMLElement;
    expect(main).toHaveClass('h-full', 'overflow-hidden');
    const scroller = main.querySelector('.overflow-y-auto') as HTMLElement;
    expect(scroller).not.toBeNull();
    // The content area pads 2 rem above and below it at `md`: the practice row's `h-app-row` (100dvh - 4rem)
    // is that, so the scroller's content is exactly its height with windows beside.
    expect(scroller.firstElementChild).toHaveClass('md:p-8');
  });
});

// A page that grows past the window drew its bar and moved the centred column sideways by half of it.
describe('Layout — the scrollbar moves nothing', () => {
  it('keeps the bar\'s room on a page that scrolls', () => {
    const { container } = at('/studia/progressi');
    const scroller = container.querySelector('main .overflow-y-auto') as HTMLElement;
    expect(scroller).toHaveClass('[scrollbar-gutter:stable]');
  });

  it('keeps none on the search page, whose practice row is the scroller\'s height', () => {
    const { container } = at('/');
    const scroller = container.querySelector('main .overflow-y-auto') as HTMLElement;
    expect(scroller).not.toHaveClass('[scrollbar-gutter:stable]');
  });
});
