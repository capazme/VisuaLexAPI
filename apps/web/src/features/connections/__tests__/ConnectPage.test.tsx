import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getRequest = vi.fn();
const decide = vi.fn();
vi.mock('../connectionsService', () => ({
  connectionsService: {
    getRequest: (...args: unknown[]) => getRequest(...args),
    decide: (...args: unknown[]) => decide(...args),
  },
}));

import { ConnectPage } from '../ConnectPage';

const REQUEST = {
  id: 'req-1',
  client: { name: 'Claude Code', redirectHost: '127.0.0.1', registeredAutomatically: true },
  scopes: [
    { scope: 'dossier:read', label: 'Leggere i tuoi dossier: i nomi e le norme che contengono' },
    { scope: 'dossier:write', label: 'Creare dossier e aggiungervi norme (non può modificare né cancellare nulla)' },
  ],
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

const assign = vi.fn();
const originalLocation = window.location;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ConnectPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getRequest.mockReset();
  decide.mockReset();
  assign.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('ConnectPage', () => {
  it('shows the application, where it goes back to, that nobody verified it, and the scopes in Italian', async () => {
    getRequest.mockResolvedValue(REQUEST);
    renderAt('/connect?request=req-1');
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(getRequest).toHaveBeenCalledWith('req-1');
    expect(screen.getByText(/127\.0\.0\.1/)).toBeInTheDocument();
    expect(screen.getByText(/registrata automaticamente, non verificata/i)).toBeInTheDocument();
    expect(screen.getByText(REQUEST.scopes[0].label)).toBeInTheDocument();
    expect(screen.getByText(REQUEST.scopes[1].label)).toBeInTheDocument();
  });

  it('renders a name built as markup as plain text', async () => {
    getRequest.mockResolvedValue({ ...REQUEST, client: { ...REQUEST.client, name: '<img src=x onerror=alert(1)>VisuaLex' } });
    const { container } = renderAt('/connect?request=req-1');
    expect(await screen.findByText('<img src=x onerror=alert(1)>VisuaLex')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('names an application without a name as such', async () => {
    getRequest.mockResolvedValue({ ...REQUEST, client: { ...REQUEST.client, name: null } });
    renderAt('/connect?request=req-1');
    expect(await screen.findByText(/applicazione senza nome/i)).toBeInTheDocument();
  });

  it('approves and sends the browser back to the application', async () => {
    getRequest.mockResolvedValue(REQUEST);
    decide.mockResolvedValue({ redirectTo: 'http://127.0.0.1:33418/callback?code=abc&state=s&iss=http%3A%2F%2Flocalhost%3A3001' });
    renderAt('/connect?request=req-1');
    fireEvent.click(await screen.findByRole('button', { name: /autorizza/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:33418/callback?code=abc&state=s&iss=http%3A%2F%2Flocalhost%3A3001'));
    expect(decide).toHaveBeenCalledWith('req-1', true);
  });

  it('refuses and still sends the browser back, with the refusal', async () => {
    getRequest.mockResolvedValue(REQUEST);
    decide.mockResolvedValue({ redirectTo: 'http://127.0.0.1:33418/callback?error=access_denied' });
    renderAt('/connect?request=req-1');
    fireEvent.click(await screen.findByRole('button', { name: /rifiuta/i }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(decide).toHaveBeenCalledWith('req-1', false);
  });

  it('never follows a redirect that is not http(s)', async () => {
    getRequest.mockResolvedValue(REQUEST);
    decide.mockResolvedValue({ redirectTo: 'javascript:alert(1)' });
    renderAt('/connect?request=req-1');
    fireEvent.click(await screen.findByRole('button', { name: /autorizza/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('says what went wrong when the request is expired or unknown', async () => {
    getRequest.mockRejectedValue({ status: 410, message: 'La richiesta di collegamento è scaduta: riavvia il collegamento dall’applicazione.' });
    renderAt('/connect?request=req-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/scaduta/);
    expect(screen.queryByRole('button', { name: /autorizza/i })).toBeNull();
  });

  it('says so when the link carries no request', async () => {
    renderAt('/connect');
    expect(await screen.findByRole('alert')).toHaveTextContent(/collegamento non valido/i);
    expect(getRequest).not.toHaveBeenCalled();
  });
});
