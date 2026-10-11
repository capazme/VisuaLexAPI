import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { Layout } from '../Layout';
import { closeFindWindow } from '../../../utils/findWindowControl';

afterEach(() => {
  act(() => closeFindWindow());
});

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, { key: 'f', ...init });

describe('Layout — Cmd/Ctrl+F', () => {
  it('opens the find window with its field focused, on Cmd and on Ctrl', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    press({ metaKey: true });
    expect(screen.getByRole('searchbox', { name: 'Cerca nel testo' })).toHaveFocus();
    act(() => closeFindWindow());
    press({ ctrlKey: true });
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('keeps the browser\'s own find away', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('pressed again, focuses the field and selects the query', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    press({ metaKey: true });
    const field = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'fatto' } });
    screen.getByRole('button', { name: 'Chiudi la ricerca' }).focus();
    press({ metaKey: true });
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
  });
});
