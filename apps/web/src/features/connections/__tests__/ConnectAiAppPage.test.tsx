import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const getConnectionInfo = vi.fn();
const listConnectedApps = vi.fn();
const revoke = vi.fn();
vi.mock('../connectionsService', () => ({
  connectionsService: {
    getConnectionInfo: (...args: unknown[]) => getConnectionInfo(...args),
    listConnectedApps: (...args: unknown[]) => listConnectedApps(...args),
    revoke: (...args: unknown[]) => revoke(...args),
    setCanDelete: vi.fn(),
  },
}));

import { ConnectAiAppPage } from '../ConnectAiAppPage';
import { aiClients } from '../aiClients';

const URL_ = 'https://visualex.example:10000/mcp';
const SCOPES = [
  { scope: 'dossier:read', label: 'Leggere i tuoi dossier' },
  { scope: 'content:delete', label: 'Eliminare dossier, voci e schede' },
];
const writeText = vi.fn();

beforeEach(() => {
  getConnectionInfo.mockReset().mockResolvedValue({ mcpUrl: URL_, scopes: SCOPES });
  listConnectedApps.mockReset().mockResolvedValue([]);
  revoke.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectAiAppPage', () => {
  it("shows the server's MCP address and copies it exactly", async () => {
    render(<ConnectAiAppPage />);
    const address = await screen.findByRole('region', { name: /l’indirizzo di visualex/i });
    expect(within(address).getByText(URL_)).toBeInTheDocument();
    fireEvent.click(within(address).getByRole('button', { name: /copia l’indirizzo del server mcp/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_));
    expect(await within(address).findByRole('button', { name: /copia l’indirizzo/i })).toHaveTextContent('Copiato');
  });

  it('gives one card per client that works, its command filled in with the address', async () => {
    render(<ConnectAiAppPage />);
    const clients = await screen.findByRole('region', { name: /come collegare la tua app/i });
    const names = within(clients).getAllByRole('article').map((card) => within(card).getByRole('heading').textContent);
    expect(names).toEqual(aiClients(URL_).map((client) => client.name));
    const claudeCode = within(clients).getByRole('article', { name: 'Claude Code' });
    expect(within(claudeCode).getByText(`claude mcp add --transport http --scope user visualex ${URL_}`)).toBeInTheDocument();
    fireEvent.click(within(claudeCode).getByRole('button', { name: /copia il comando per claude code/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`claude mcp add --transport http --scope user visualex ${URL_}`));
  });

  it('says which clients cannot confirm a deletion, and the Code tab limit of Claude desktop', async () => {
    render(<ConnectAiAppPage />);
    const gemini = await screen.findByRole('article', { name: 'Gemini CLI' });
    expect(within(gemini).getByText(/senza eliminazioni/i)).toBeInTheDocument();
    const claudeCode = screen.getByRole('article', { name: 'Claude Code' });
    expect(within(claudeCode).getByText(/eliminazioni con conferma incluse/i)).toBeInTheDocument();
    expect(within(claudeCode).getByText(/scheda Code dell’app desktop/i)).toBeInTheDocument();
    const bridge = screen.getByRole('article', { name: /mcp-remote/ });
    expect(within(bridge).getByText(/eliminazioni solo se l’app mostra il modulo/i)).toBeInTheDocument();
  });

  it('lists the clients that do not work today, with why', async () => {
    render(<ConnectAiAppPage />);
    await screen.findByRole('region', { name: /come collegare la tua app/i });
    for (const name of ['ChatGPT', 'VS Code con Copilot', 'Cursor', 'Windsurf', 'LibreLex']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("explains what a connected app can do, the server's own scope wording, and the two confirmations for deleting", async () => {
    render(<ConnectAiAppPage />);
    const canDo = await screen.findByRole('region', { name: /cosa può fare/i });
    expect(within(canDo).getByText('Leggere i tuoi dossier')).toBeInTheDocument();
    expect(within(canDo).getByText('Eliminare dossier, voci e schede')).toBeInTheDocument();
    expect(within(canDo).getByText(/due conferme/i)).toBeInTheDocument();
    expect(within(canDo).getByText(/cestino per 30 giorni/i)).toBeInTheDocument();
  });

  it('carries the safety note', async () => {
    render(<ConnectAiAppPage />);
    expect(await screen.findByText(/collega solo app di cui ti fidi/i)).toBeInTheDocument();
    expect(screen.getByText(/agisce con il tuo account, nei limiti dei permessi/i)).toBeInTheDocument();
  });

  it('lists the connected applications, with revoke', async () => {
    listConnectedApps.mockResolvedValue([
      {
        id: 'grant-1',
        clientName: 'Claude Code',
        redirectHost: '127.0.0.1',
        scopes: ['dossier:read'],
        canDelete: false,
        createdAt: '2026-10-04T10:00:00.000Z',
        lastUsedAt: null,
      },
    ]);
    render(<ConnectAiAppPage />);
    const connected = await screen.findByRole('region', { name: 'Applicazioni collegate' });
    expect(await within(connected).findByRole('button', { name: /revoca claude code/i })).toBeInTheDocument();
  });

  it('shows no address and no client when this server has no MCP server', async () => {
    getConnectionInfo.mockResolvedValue({ mcpUrl: null, scopes: SCOPES });
    render(<ConnectAiAppPage />);
    expect(await screen.findByText(/non è attivo su questo server/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /come collegare la tua app/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^copia/i })).toBeNull();
  });

  it('says why when the address cannot be read', async () => {
    getConnectionInfo.mockRejectedValue({ status: 500, message: 'Errore del server' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ConnectAiAppPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Errore del server');
    expect(screen.queryByRole('region', { name: /come collegare la tua app/i })).toBeNull();
  });

  it('tells the reader to copy by hand when the browser refuses the clipboard', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<ConnectAiAppPage />);
    const address = await screen.findByRole('region', { name: /l’indirizzo di visualex/i });
    fireEvent.click(within(address).getByRole('button', { name: /copia l’indirizzo/i }));
    expect(await within(address).findByText(/copialo a mano/i)).toBeInTheDocument();
  });
});

describe('aiClients', () => {
  it('fills every snippet with the address, and every JSON file parses', () => {
    for (const client of aiClients(URL_)) {
      const codes = client.steps.flatMap((step) => (step.code ? [step.code] : []));
      expect([client.id, codes.some((code) => code.includes(URL_))]).toEqual([client.id, true]);
      for (const code of codes.filter((c) => c.startsWith('{'))) expect(() => JSON.parse(code)).not.toThrow();
    }
  });
});
