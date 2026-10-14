import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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

// The find window, by its name: the search page also draws its own search field.
const FIND = { name: 'Cerca nel testo' };

const press = (init: KeyboardEventInit) => fireEvent.keyDown(window, { key: 'f', ...init });

describe('Layout — Cmd/Ctrl+F', () => {
  it('opens the find window with its field focused, on Cmd and on Ctrl', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    expect(screen.queryByRole('search', FIND)).not.toBeInTheDocument();
    press({ metaKey: true });
    expect(screen.getByRole('searchbox', { name: 'Cerca nel testo' })).toHaveFocus();
    act(() => closeFindWindow());
    press({ ctrlKey: true });
    expect(screen.getByRole('search', FIND)).toBeInTheDocument();
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
    const field = screen.getByRole('searchbox', FIND) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'fatto' } });
    screen.getByRole('button', { name: 'Chiudi la ricerca' }).focus();
    press({ metaKey: true });
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
  });

  it('leaves the browser\'s own find alone under an overlay marked data-find-overlay', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    const overlay = document.createElement('div');
    overlay.setAttribute('data-find-overlay', '');
    document.body.appendChild(overlay);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('search', FIND)).not.toBeInTheDocument();
    overlay.remove();
  });

  it.each(['/dossier', '/forum', '/history', '/grafo'])('leaves the browser\'s own find alone on %s', (path) => {
    render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('search', FIND)).not.toBeInTheDocument();
  });

  it('closes the window when the reader leaves the search page', () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Link to="/dossier">Dossier</Link>} />
            <Route path="dossier" element={<p>I miei dossier</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    press({ metaKey: true });
    expect(screen.getByRole('search', FIND)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Dossier' }));
    expect(screen.getByText('I miei dossier')).toBeInTheDocument();
    expect(screen.queryByRole('search', FIND)).not.toBeInTheDocument();
  });

  it('leaves the browser\'s own find alone under a modal overlay', () => {
    render(<MemoryRouter><Layout /></MemoryRouter>);
    const overlay = document.createElement('div');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true, bubbles: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('search', FIND)).not.toBeInTheDocument();
    overlay.remove();
    press({ ctrlKey: true });
    expect(screen.getByRole('search', FIND)).toBeInTheDocument();
  });
});
