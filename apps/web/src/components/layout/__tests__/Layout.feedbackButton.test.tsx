import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ UndoToastContainer: () => null }));
vi.mock('../../ui/SyncErrorToast', () => ({ SyncErrorToast: () => null }));
vi.mock('../../ui/KeyboardShortcutsModal', () => ({ KeyboardShortcutsModal: () => null }));
vi.mock('../../ui/ServiceHealthBanner', () => ({
  ServiceHealthBanner: ({ className }: { className?: string }) => <div data-testid="health" className={className} />,
}));
vi.mock('../../features/compare/CompareView', () => ({ CompareView: () => null }));
vi.mock('../../../plugins/PluginSlot', () => ({ PluginSlot: () => null }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('../../../hooks/useTour', () => ({
  useTour: () => ({ startTour: vi.fn(), hasSeenTour: () => true, resetAndStartTour: vi.fn() }),
}));
// The Layout's part is the class it hands over; the real button's wrapper is checked below.
vi.mock('../../ui/FeedbackButton', () => ({
  FeedbackButton: ({ className }: { className?: string }) => <div data-testid="feedback" className={className} />,
}));

import { Layout } from '../Layout';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);

describe('Layout — the feedback button on the validators’ queue', () => {
  it('hides it below the desktop breakpoint on /studia/valida, where it would cover the vote bar', () => {
    at('/studia/valida');
    expect(screen.getByTestId('feedback')).toHaveClass('hidden', 'md:block');
  });

  it('hides the services pill there too: on a phone it sat over «Approvata» and «Migliorabile»', () => {
    at('/studia/valida');
    expect(screen.getByTestId('health')).toHaveClass('hidden', 'md:block');
  });

  it.each(['/', '/studia', '/studia/schede', '/dossier'])('leaves it as it is on %s', (path) => {
    at(path);
    expect(screen.getByTestId('feedback')).not.toHaveClass('hidden');
    expect(screen.getByTestId('health')).not.toHaveClass('hidden');
  });
});
