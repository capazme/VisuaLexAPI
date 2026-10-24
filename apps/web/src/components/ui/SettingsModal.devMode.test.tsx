import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth() }));
vi.mock('../../features/connections/ConnectedAppsSection', () => ({ ConnectedAppsSection: () => null }));
vi.mock('../../services/accountService', () => ({ accountService: {} }));

import { SettingsModal } from './SettingsModal';

const setDevMode = vi.fn();

function open() {
  return render(
    <MemoryRouter>
      <SettingsModal isOpen onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setDevMode.mockReset().mockResolvedValue(undefined);
  // The version box asks /version when the modal opens; it is not under test.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

describe('SettingsModal — «Modalità sviluppo»', () => {
  it('is not there for an account the administrator has not enabled', () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: false, devMode: false, setDevMode });
    open();
    expect(screen.queryByText('Modalità sviluppo')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('is not there for an administrator either, unless they were enabled', () => {
    auth.mockReturnValue({ isAdmin: true, canUseDevMode: false, devMode: false, setDevMode });
    open();
    expect(screen.queryByRole('switch', { name: /Modalità sviluppo/ })).toBeNull();
  });

  it('shows an enabled account the switch, off, with one line on what it shows', () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: false, setDevMode });
    open();
    const toggle = screen.getByRole('switch', { name: 'Modalità sviluppo' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Assistente, Grafo/)).toBeInTheDocument();
  });

  it('gives the switch a 44 px hit area on a phone', () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: false, setDevMode });
    open();
    expect(screen.getByRole('switch', { name: 'Modalità sviluppo' })).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'md:min-h-0');
  });

  it('shows the switch on when the mode is on', () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: true, setDevMode });
    open();
    expect(screen.getByRole('switch', { name: 'Modalità sviluppo' })).toHaveAttribute('aria-checked', 'true');
  });

  it('asks the server to turn it on, and off', async () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: false, setDevMode });
    const { unmount } = open();
    fireEvent.click(screen.getByRole('switch', { name: 'Modalità sviluppo' }));
    await waitFor(() => expect(setDevMode).toHaveBeenCalledWith(true));
    unmount();

    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: true, setDevMode });
    open();
    fireEvent.click(screen.getByRole('switch', { name: 'Modalità sviluppo' }));
    await waitFor(() => expect(setDevMode).toHaveBeenLastCalledWith(false));
  });

  it('says so when the server refuses, and the switch stays as it was', async () => {
    auth.mockReturnValue({ isAdmin: false, canUseDevMode: true, devMode: false, setDevMode });
    setDevMode.mockRejectedValue(new Error('403'));
    open();
    fireEvent.click(screen.getByRole('switch', { name: 'Modalità sviluppo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile cambiare la modalità sviluppo');
    expect(screen.getByRole('switch', { name: 'Modalità sviluppo' })).toHaveAttribute('aria-checked', 'false');
  });
});
