import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The sidebar's «Impostazioni» and the dialog, drawn as what they are given: the dialog's state is the store's.
vi.mock('../Sidebar', () => ({
  Sidebar: ({ openSettings }: { openSettings: () => void }) => <button type="button" onClick={openSettings}>Impostazioni</button>,
}));
vi.mock('../../ui/SettingsModal', () => ({
  SettingsModal: ({ isOpen, section, onClose }: { isOpen: boolean; section: string | null; onClose: () => void }) =>
    isOpen ? <div role="dialog" aria-label="Impostazioni" data-section={section ?? ''}><button type="button" onClick={onClose}>Chiudi</button></div> : null,
}));
vi.mock('../../ui/FeedbackButton', () => ({ FeedbackButton: () => null }));
vi.mock('../../ui/FeedbackModal', () => ({ FeedbackModal: () => null }));
vi.mock('../../ui/ChangelogNotification', () => ({ ChangelogNotification: () => null }));
vi.mock('../../ui/Toast', () => ({ NotificationHost: () => null }));
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
import { appStore } from '../../../store/useAppStore';

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);

afterEach(() => appStore.getState().closeSettings());

describe('Layout — Impostazioni, opened from anywhere', () => {
  it('the user menu opens it at its top, «Chiudi» closes it', () => {
    at('/dossier');
    fireEvent.click(screen.getAllByRole('button', { name: 'Impostazioni' })[0]);
    expect(screen.getByRole('dialog', { name: 'Impostazioni' })).toHaveAttribute('data-section', '');
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog', { name: 'Impostazioni' })).toBeNull();
    expect(appStore.getState().settingsDialog).toEqual({ open: false, section: null });
  });

  it.each(['/', '/dossier', '/studia/ripasso'])('a reader\'s gear opens it at the colours\' meanings on %s', (path) => {
    at(path);
    act(() => appStore.getState().openSettings('highlightColors'));
    expect(screen.getByRole('dialog', { name: 'Impostazioni' })).toHaveAttribute('data-section', 'highlightColors');
  });
});
