/**
 * The AI applications the «Collega un'app AI» page explains, and how each one connects to VisuaLex's
 * MCP server. Which clients are here, and what each can do, is the survey of 13 October 2026: each
 * client checked against our authorization server (dynamic registration, PKCE, the `resource`
 * parameter, the redirect URIs it registers) and the elicitation the deletion confirmation needs.
 * A client whose registration our server refuses today is listed in `UNSUPPORTED_CLIENTS` with why,
 * never given a card that cannot work.
 */

/** The server name a client is told to use; the snippets and the sign-in commands repeat it. */
export const SERVER_NAME = 'visualex';

export interface ClientStep {
  /** What to do, in Italian. */
  text: string;
  /** The command or file to copy, with the address filled in. */
  code?: string;
  /** A file of several lines rather than one command. */
  block?: boolean;
  /** What `code` is, for the copy button's name («il comando per Claude Code»). */
  codeLabel?: string;
  /** A page to open for this step, outside VisuaLex (a new tab). */
  link?: { href: string; label: string };
}

export interface AiClient {
  id: string;
  name: string;
  /** One line under the name: where it runs. */
  kind: string;
  /**
   * Whether the client can show the deletion confirmation (without it every deletion is declined):
   * `depends` for a bridge, which passes the form on only when the application behind it shows one.
   */
  confirmsDeletions: 'yes' | 'no' | 'depends';
  steps: ClientStep[];
  /** What the user should know before relying on it. */
  limits: string[];
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export function aiClients(mcpUrl: string): AiClient[] {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      kind: 'Terminale (macOS, Linux, Windows)',
      confirmsDeletions: 'yes',
      steps: [
        {
          text: 'Nel terminale, aggiungi VisuaLex per tutti i tuoi progetti:',
          code: `claude mcp add --transport http --scope user ${SERVER_NAME} ${mcpUrl}`,
          codeLabel: 'il comando per Claude Code',
        },
        {
          text: `Avvia Claude Code, scrivi /mcp, scegli «${SERVER_NAME}» e poi «Authenticate».`,
        },
        { text: 'Si apre il browser su VisuaLex: controlla i permessi e premi «Autorizza».' },
      ],
      limits: [
        'Nella scheda Code dell’app desktop di Claude il modulo di conferma delle eliminazioni non compare, quindi ogni eliminazione viene rifiutata. Per eliminare usa Claude Code dal terminale oppure un’altra app.',
      ],
    },
    {
      id: 'claude-app',
      name: 'Claude (claude.ai, app desktop e mobile)',
      kind: 'Connettore personalizzato',
      confirmsDeletions: 'no',
      steps: [
        { text: 'In Claude apri Impostazioni → Connettori e scegli «Aggiungi connettore personalizzato» (Add custom connector).' },
        { text: 'Come nome scrivi VisuaLex; come indirizzo incolla:', code: mcpUrl, codeLabel: 'l’indirizzo per Claude' },
        {
          text: 'Se Claude chiede come registrarsi, scegli «Register automatically» (registrazione automatica), non l’identità pubblicata di Claude.',
        },
        { text: 'Premi «Connetti»: si apre VisuaLex; controlla i permessi e premi «Autorizza».' },
      ],
      limits: [
        'Claude non mostra ancora il modulo di conferma: ogni eliminazione viene rifiutata. Leggere, creare dossier e aggiungere norme, sentenze, note e schede funziona.',
        'Il collegamento parte dai server di Anthropic, non dal tuo computer: funziona solo se questo VisuaLex è raggiungibile da internet. Se non lo è, l’accesso non si completa: usa un’app da terminale o chiedi all’amministratore.',
        'Piano Free: un solo connettore personalizzato. Piani Team ed Enterprise: lo aggiunge il proprietario dell’organizzazione.',
      ],
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      kind: 'Terminale',
      confirmsDeletions: 'yes',
      steps: [
        {
          text: 'Nel terminale, aggiungi VisuaLex:',
          code: `codex mcp add ${SERVER_NAME} --url ${mcpUrl}`,
          codeLabel: 'il comando per Codex',
        },
        { text: 'Poi accedi:', code: `codex mcp login ${SERVER_NAME}`, codeLabel: 'il comando di accesso per Codex' },
        { text: 'Si apre il browser su VisuaLex: controlla i permessi e premi «Autorizza».' },
        {
          text: 'In alternativa, aggiungi queste righe a ~/.codex/config.toml:',
          code: `[mcp_servers.${SERVER_NAME}]\nurl = "${mcpUrl}"`,
          block: true,
          codeLabel: 'la configurazione per Codex',
        },
      ],
      limits: ['Non aggiungere «oauth_resource» alla configurazione: Codex lo manderebbe due volte e l’accesso fallirebbe.'],
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      kind: 'Terminale',
      confirmsDeletions: 'no',
      steps: [
        {
          text: 'Aggiungi VisuaLex a ~/.gemini/settings.json (se il file ha già altro, aggiungi solo la voce dentro «mcpServers»):',
          code: json({ mcpServers: { [SERVER_NAME]: { httpUrl: mcpUrl } } }),
          block: true,
          codeLabel: 'la configurazione per Gemini CLI',
        },
        { text: 'Avvia Gemini CLI e accedi:', code: `/mcp auth ${SERVER_NAME}`, codeLabel: 'il comando di accesso per Gemini CLI' },
        { text: 'Si apre il browser su VisuaLex: controlla i permessi e premi «Autorizza».' },
      ],
      limits: [
        'Gemini CLI non mostra il modulo di conferma: ogni eliminazione viene rifiutata.',
        'L’accesso apre un browser sullo stesso computer: non funziona in una sessione remota senza browser.',
      ],
    },
    {
      id: 'mcp-remote',
      name: 'Altre app (tramite mcp-remote)',
      kind: 'Per le app che accettano solo server locali',
      confirmsDeletions: 'depends',
      steps: [
        {
          text: 'Se un’app accetta solo server MCP avviati da un comando, aggiungi VisuaLex alla sua configurazione così (serve Node.js):',
          code: json({ mcpServers: { [SERVER_NAME]: { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl] } } }),
          block: true,
          codeLabel: 'la configurazione con mcp-remote',
        },
        { text: 'Al primo avvio si apre il browser su VisuaLex: controlla i permessi e premi «Autorizza».' },
      ],
      limits: [
        'Le eliminazioni funzionano solo se l’app mostra il modulo di conferma; altrimenti vengono rifiutate.',
      ],
    },
  ];
}

/** The clients whose registration our server refuses today, and why, so nobody spends time on them. */
export const UNSUPPORTED_CLIENTS: { name: string; reason: string }[] = [
  { name: 'ChatGPT', reason: 'l’indirizzo di ritorno che usa non è ancora tra quelli ammessi da VisuaLex.' },
  { name: 'VS Code con Copilot', reason: 'l’indirizzo di ritorno che usa non è ancora tra quelli ammessi da VisuaLex.' },
  { name: 'Cursor', reason: 'si registra con un indirizzo di ritorno proprio dell’app, che VisuaLex non accetta.' },
  { name: 'Windsurf', reason: 'non ancora provato.' },
  { name: 'LibreLex', reason: 'da verificare.' },
];

/** The tools a connected application gets, in the words a user reads. */
export const AI_TOOLS: { name: string; what: string }[] = [
  { name: 'Dossier', what: 'elencare e leggere i tuoi dossier, crearne di nuovi' },
  { name: 'Norme', what: 'aggiungere a un dossier da 1 a 50 norme scritte a parole, verificate sulle fonti' },
  { name: 'Sentenze', what: 'aggiungere a un dossier da 1 a 10 sentenze, verificate sulle fonti' },
  { name: 'Note', what: 'aggiungere una nota a un dossier o a un suo articolo (solo aggiungere, mai modificare)' },
  { name: 'Schede di studio', what: 'leggere le tue schede e crearne di nuove, sempre come tue bozze' },
  { name: 'Account', what: 'vedere quanto resta della quota giornaliera' },
  { name: 'Eliminare', what: 'dossier, voci e schede, solo con il permesso e la tua conferma (vedi sotto)' },
];
