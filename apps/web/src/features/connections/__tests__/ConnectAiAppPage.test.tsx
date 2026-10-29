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
import { LEGAL_IT_PRIVACY } from '../legalItClients';

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

  it('carries the safety note: what a connected app reads, no personal data of clients, only trusted apps', async () => {
    render(<ConnectAiAppPage />);
    const notice = await screen.findByRole('region', { name: 'Dati personali e app AI' });
    expect(within(notice).getByText(/legge i nomi dei tuoi dossier, i titoli e i riferimenti delle voci e le tue schede e i tuoi percorsi di studio/i)).toBeInTheDocument();
    expect(within(notice).getByText(/non scrivere lì dati personali dei clienti, oppure collega solo app AI di cui ti fidi/i)).toBeInTheDocument();
    expect(within(notice).getByText(/agisce con il tuo account, nei limiti dei permessi/i)).toBeInTheDocument();
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
    // mcp-legal-it needs no VisuaLex server, so its commands stay: the VisuaLex part has none.
    const visualex = screen.getByRole('region', { name: 'VisuaLex' });
    expect(within(visualex).queryByRole('button', { name: /^copia/i })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'mcp-legal-it' })).getAllByRole('button', { name: /^copia/i }).length).toBeGreaterThan(0);
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

describe('ConnectAiAppPage — mcp-legal-it', () => {
  const ALLOWED_LINKS = ['https://github.com/capazme/mcp-legal-it', 'https://github.com/capazme/mcp-legal-it/releases/latest'];

  it('names the two parts at the top, each an anchor to its section', async () => {
    render(<ConnectAiAppPage />);
    await screen.findByRole('region', { name: /come collegare la tua app/i });
    const parts = screen.getByRole('navigation', { name: 'Le due parti della pagina' });
    expect(within(parts).getByText(/sono due cose diverse/i)).toBeInTheDocument();
    const links = within(parts).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['VisuaLexOnline, con il tuo account', '#visualex'],
      ['mcp-legal-itSul tuo computer, senza account', '#mcp-legal-it'],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'VisuaLex' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'mcp-legal-it' })).toBeInTheDocument();
    expect(document.getElementById('visualex')).toBe(screen.getByRole('region', { name: 'VisuaLex' }));
    expect(document.getElementById('mcp-legal-it')).toBe(screen.getByRole('region', { name: 'mcp-legal-it' }));
  });

  it('says what it is, the privacy sentence word for word, uv first, the two Claude cards and what is not supported', async () => {
    render(<ConnectAiAppPage />);
    const legalIt = screen.getByRole('region', { name: 'mcp-legal-it' });
    expect(within(legalIt).getByText(/oltre 200 strumenti di diritto italiano/i)).toBeInTheDocument();
    expect(within(legalIt).getByText(LEGAL_IT_PRIVACY)).toBeInTheDocument();
    expect(within(legalIt).getByRole('group', { name: 'Prima installa uv' })).toBeInTheDocument();
    expect(within(legalIt).getByText(/chiudi del tutto Claude \(⌘Q su Mac.*Con Claude Code apri invece un nuovo terminale/)).toBeInTheDocument();
    expect(within(legalIt).getAllByRole('article').map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Claude Desktop (consigliato)',
      'Claude Code (plugin)',
    ]);
    expect(within(legalIt).getByText(/circa un minuto/)).toBeInTheDocument();
    expect(within(legalIt).getByText(/Serve anche git/)).toBeInTheDocument();
    const claudeCode = within(legalIt).getByRole('article', { name: 'Claude Code (plugin)' });
    expect(within(claudeCode).getByText(/rinunciare dopo 30 secondi con «connection timed out».*\/mcp/)).toBeInTheDocument();
    for (const name of ['claude.ai sul web', 'Le app mobili di Claude', 'L’agente cloud di Claude Desktop (Cowork)']) {
      expect(within(legalIt).getByText(name)).toBeInTheDocument();
    }
    expect(within(legalIt).getByRole('link', { name: /apri il readme/i })).toHaveAttribute('href', ALLOWED_LINKS[0]);
    // The cards carry no line about deletions: that is VisuaLex's.
    expect(within(legalIt).queryByText(/eliminazioni/i)).toBeNull();
  });

  it('links only to the repository and its latest release, in a new tab', async () => {
    render(<ConnectAiAppPage />);
    const legalIt = screen.getByRole('region', { name: 'mcp-legal-it' });
    const links = within(legalIt).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(ALLOWED_LINKS).toContain(link.getAttribute('href'));
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(within(legalIt).getByRole('link', { name: /apri l’ultima versione/i })).toHaveAttribute('href', ALLOWED_LINKS[1]);
  });

  it('shows no version number, no licence and nothing about Brocardi', async () => {
    render(<ConnectAiAppPage />);
    const text = screen.getByRole('region', { name: 'mcp-legal-it' }).textContent ?? '';
    expect(text).not.toMatch(/\bv?\d+\.\d+(?:\.\d+)?\b/);
    expect(text).not.toMatch(/\bv\d+\b|legal-it-\d/);
    expect(text).not.toMatch(/\blicenz|\bApache\b|\bMPL\b/i);
    expect(text).not.toMatch(/brocardi/i);
    expect(text).toContain('legal-it-….mcpb');
  });

  it('copies each command exactly', async () => {
    render(<ConnectAiAppPage />);
    const legalIt = screen.getByRole('region', { name: 'mcp-legal-it' });
    const commands: [RegExp, string][] = [
      [/copia il comando per installare uv su macos e linux/i, 'curl -LsSf https://astral.sh/uv/install.sh | sh'],
      [/copia il comando per installare uv su windows/i, 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'],
      [/copia il comando per aggiungere il marketplace/i, 'claude plugin marketplace add capazme/mcp-legal-it'],
      [/copia il comando per installare il plugin/i, 'claude plugin install legal-it@mcp-legal-it'],
      [/copia il comando per installare git su mac/i, 'xcode-select --install'],
    ];
    for (const [name, code] of commands) {
      expect(within(legalIt).getByText(code)).toBeInTheDocument();
      fireEvent.click(within(legalIt).getByRole('button', { name }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(code));
    }
  });

  it('keeps every «Copia» button 44 px tall at every width, not only on a phone', async () => {
    render(<ConnectAiAppPage />);
    await screen.findByRole('region', { name: /come collegare la tua app/i });
    const buttons = screen.getAllByRole('button', { name: /^copia/i });
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-[44px]');
      // No breakpoint may lower it again (the 66x24 button seen at 1470 px wide).
      expect([...button.classList].filter((name) => /^(sm|md|lg|xl|2xl):(min-h|h|py)-/.test(name))).toEqual([]);
    }
  });

  it('keeps every link of the page 44 px tall at every width, as the buttons', async () => {
    render(<ConnectAiAppPage />);
    await screen.findByRole('region', { name: /come collegare la tua app/i });
    const links = screen.getAllByRole('link');
    // The two anchors at the top, the release link in the Desktop card and the README link at the end.
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      expect(link).toHaveClass('min-h-[44px]');
      // No breakpoint may lower it again (226x20 and 223x20 seen at 1366 px wide).
      expect([...link.classList].filter((name) => /^(sm|md|lg|xl|2xl):(min-h|h|py)-/.test(name))).toEqual([]);
    }
    expect(screen.getByRole('link', { name: /apri l’ultima versione su github/i })).toHaveClass('min-h-[44px]');
    expect(screen.getByRole('link', { name: /apri il readme di mcp-legal-it/i })).toHaveClass('min-h-[44px]');
  });

  it('is there while the address loads and when it cannot be read', async () => {
    getConnectionInfo.mockRejectedValue({ status: 500, message: 'Errore del server' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ConnectAiAppPage />);
    expect(screen.getByRole('region', { name: 'mcp-legal-it' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Errore del server');
    expect(screen.getByRole('region', { name: 'mcp-legal-it' })).toBeInTheDocument();
  });
});
