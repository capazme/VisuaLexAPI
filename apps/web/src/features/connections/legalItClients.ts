/**
 * mcp-legal-it on the «Collega un'app AI» page: a separate MCP server, installed on the user's own
 * computer, that gives an AI application tools of Italian law without a VisuaLex account. The steps
 * are the short path of its README; everything else (other clients, Docker, the Python library) is
 * left to the README, so the page does not age with each release.
 *
 * Two rules hold this file, and `legalItClients.test.ts` reads it to check them: no version number
 * (the release link is `releases/latest`, the file is named `legal-it-….mcpb`), and no link other than
 * the repository and its latest release — never the archives of the source code GitHub offers, which
 * do not contain the server. The licence is not named: it is in the repository.
 */
import type { AiClient, ClientStep } from './aiClients';

/** A card of the mcp-legal-it part: an `AiClient` without the deletion line, which is VisuaLex's. */
export type LegalItClient = Omit<AiClient, 'confirmsDeletions'>;

export const LEGAL_IT_REPO_URL = 'https://github.com/capazme/mcp-legal-it';
export const LEGAL_IT_RELEASES_URL = 'https://github.com/capazme/mcp-legal-it/releases/latest';

/** The privacy sentence, word for word as the owner approved it (19 October 2026). */
export const LEGAL_IT_PRIVACY =
  'Il server gira sul tuo computer e interroga direttamente le fonti pubbliche; non manda i tuoi dati a VisuaLex. Quello che scrivi all’app AI resta soggetto alle sue condizioni.';

/** `uv`, the one prerequisite: it installs Python and the libraries by itself. */
export const UV_INSTALL: ClientStep[] = [
  {
    text: 'Su macOS e Linux, nel terminale:',
    code: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
    codeLabel: 'il comando per installare uv su macOS e Linux',
  },
  {
    text: 'Su Windows, in PowerShell:',
    code: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
    codeLabel: 'il comando per installare uv su Windows',
  },
];

export const LEGAL_IT_CLIENTS: LegalItClient[] = [
  {
    id: 'legal-it-claude-desktop',
    name: 'Claude Desktop (consigliato)',
    kind: 'App desktop di Claude',
    steps: [
      {
        text: 'Scarica il file legal-it-….mcpb dall’ultima versione pubblicata.',
        link: { href: LEGAL_IT_RELEASES_URL, label: 'Apri l’ultima versione su GitHub' },
      },
      {
        text: 'Fai doppio clic sul file. In alternativa: Impostazioni → Estensioni → Impostazioni avanzate → Sviluppatore estensioni → «Installa file .mcpb».',
      },
      { text: 'Riavvia Claude.' },
    ],
    limits: [
      'Il primo avvio richiede circa un minuto, perché scarica Python e le librerie. Se il server risulta «disconnesso», attendi e riavvia Claude: dal secondo avvio parte in pochi secondi.',
    ],
  },
  {
    id: 'legal-it-claude-code',
    name: 'Claude Code (plugin)',
    kind: 'Terminale (macOS, Linux, Windows)',
    steps: [
      {
        text: 'Serve anche git. Su Mac, se non c’è, si installa con:',
        code: 'xcode-select --install',
        codeLabel: 'il comando per installare git su Mac',
      },
      {
        text: 'Nel terminale, aggiungi il marketplace di mcp-legal-it:',
        code: 'claude plugin marketplace add capazme/mcp-legal-it',
        codeLabel: 'il comando per aggiungere il marketplace di mcp-legal-it',
      },
      {
        text: 'Poi installa il plugin:',
        code: 'claude plugin install legal-it@mcp-legal-it',
        codeLabel: 'il comando per installare il plugin mcp-legal-it',
      },
    ],
    limits: [
      'Gli aggiornamenti automatici sono spenti all’inizio: per accenderli scrivi /plugin, apri la scheda Marketplaces, scegli mcp-legal-it e poi «Enable auto-update».',
    ],
  },
];

/** Where mcp-legal-it cannot run: none of these can start a server on the user's computer. */
export const LEGAL_IT_UNSUPPORTED: string[] = [
  'claude.ai sul web',
  'Le app mobili di Claude',
  'L’agente cloud di Claude Desktop (Cowork)',
];
