import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ui/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
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

import { appStore } from '../../../store/useAppStore';
import { Layout } from '../Layout';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
const INSET = ['pt-[4.5rem]', 'md:pt-[4.5rem]', 'lg:pt-8'];

beforeEach(() => {
  appStore.setState((s) => ({ settings: { ...s.settings, focusMode: false } }));
});

describe('Layout — page headers clear the floating menu button below lg', () => {
  it.each(['/dossier', '/dossier?dossier=d1', '/history', '/environments', '/forum', '/studia/schede', '/documents'])(
    'starts the content under the button on %s',
    (path) => {
      at(path);
      expect(screen.getByRole('button', { name: 'Apri il menu' })).toBeInTheDocument();
      expect(screen.getByTestId('layout-content')).toHaveClass(...INSET);
    },
  );

  it('leaves the search page alone: its search field sits beside the button', () => {
    at('/');
    for (const cls of INSET) expect(screen.getByTestId('layout-content')).not.toHaveClass(cls);
  });

  it('adds nothing in focus mode, where the button is not drawn', () => {
    appStore.setState((s) => ({ settings: { ...s.settings, focusMode: true } }));
    at('/dossier');
    expect(screen.queryByRole('button', { name: 'Apri il menu' })).toBeNull();
    for (const cls of INSET) expect(screen.getByTestId('layout-content')).not.toHaveClass(cls);
  });
});
