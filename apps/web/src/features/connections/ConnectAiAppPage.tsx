import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, Info, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getErrorMessage } from '../../utils/errors';
import { connectionsService, type ConnectionInfo } from './connectionsService';
import { ConnectedAppsSection } from './ConnectedAppsSection';
import { CopyableCode } from './CopyableCode';
import { AI_TOOLS, UNSUPPORTED_CLIENTS, aiClients, type AiClient } from './aiClients';
import {
  LEGAL_IT_CLIENTS,
  LEGAL_IT_PRIVACY,
  LEGAL_IT_REPO_URL,
  LEGAL_IT_UNSUPPORTED,
  UV_INSTALL,
  type LegalItClient,
} from './legalItClients';

type InfoState = { status: 'loading' } | { status: 'ready'; info: ConnectionInfo } | { status: 'error'; message: string };

const DELETIONS: Record<AiClient['confirmsDeletions'], { text: string; tone: string }> = {
  yes: { text: 'Funziona, eliminazioni con conferma incluse', tone: 'text-emerald-700 dark:text-emerald-400' },
  no: { text: 'Funziona, ma senza eliminazioni', tone: 'text-amber-700 dark:text-amber-400' },
  depends: { text: 'Funziona; le eliminazioni solo se l’app mostra il modulo di conferma', tone: 'text-amber-700 dark:text-amber-400' },
};

const sectionTitle = 'text-base font-semibold text-slate-900 dark:text-white';
const card = 'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';
// An anchor scrolled to the top clears the floating menu button (below lg) and the Focus toggle (from md).
const anchorTarget = 'scroll-mt-20';
const partTitle = 'font-serif text-2xl font-medium tracking-tight text-slate-900 dark:text-slate-50';
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/** A page outside VisuaLex, in a new tab, said so to a screen reader; 44 px high on a phone. */
function ExternalAnchor({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1 rounded font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800 md:min-h-0 dark:text-primary-300 dark:hover:text-primary-200',
        focusRing,
      )}
    >
      {children}
      <ExternalLink size={14} aria-hidden />
      <span className="sr-only"> (si apre in una nuova scheda)</span>
    </a>
  );
}

/** A client card: VisuaLex's say whether deletions work; mcp-legal-it's have no such line. */
function ClientCard({ client }: { client: AiClient | LegalItClient }) {
  const deletions = 'confirmsDeletions' in client ? client.confirmsDeletions : null;
  const headingId = `ai-client-${client.id}`;
  return (
    <article aria-labelledby={headingId} className={card}>
      <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-white">
        {client.name}
      </h3>
      <p className="text-xs text-slate-500">{client.kind}</p>
      {deletions && (
        <p className={cn('mt-2 inline-flex items-center gap-1 text-xs', DELETIONS[deletions].tone)}>
          {deletions === 'yes' ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
          {DELETIONS[deletions].text}
        </p>
      )}
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-200">
        {client.steps.map((step) => (
          <li key={step.text} className="space-y-1">
            <p>{step.text}</p>
            {step.link && <ExternalAnchor href={step.link.href}>{step.link.label}</ExternalAnchor>}
            {step.code && <CopyableCode code={step.code} label={step.codeLabel ?? 'il testo'} block={step.block} />}
          </li>
        ))}
      </ol>
      {client.limits.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Da sapere</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
            {client.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** The two parts of the page, named at its top: what each is, in one line. */
const PARTS: { href: string; name: string; line: string }[] = [
  { href: '#visualex', name: 'VisuaLex', line: 'Online, con il tuo account' },
  { href: '#mcp-legal-it', name: 'mcp-legal-it', line: 'Sul tuo computer, senza account' },
];

/**
 * mcp-legal-it: a server the user installs on their own computer, no VisuaLex account involved, so it
 * does not wait for VisuaLex's MCP address. The short path only; the rest is the README's
 * (`legalItClients.ts`).
 */
function LegalItSection() {
  return (
    <section
      id="mcp-legal-it"
      aria-labelledby="legal-it-title"
      className={cn(anchorTarget, 'space-y-4 border-t border-slate-200 pt-8 dark:border-slate-700')}
    >
      <header>
        <h2 id="legal-it-title" className={partTitle}>
          mcp-legal-it
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Un server MCP che aggiunge a Claude oltre 200 strumenti di diritto italiano: le norme da Normattiva ed EUR-Lex, la
          giurisprudenza, i calcoli legali e i modelli di atti. Si installa sul tuo computer e non richiede un account
          VisuaLex.
        </p>
      </header>

      <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span>{LEGAL_IT_PRIVACY}</span>
      </p>

      <div aria-labelledby="legal-it-uv" role="group" className={card}>
        <h3 id="legal-it-uv" className="text-sm font-semibold text-slate-900 dark:text-white">
          Prima installa uv
        </h3>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
          uv installa da solo Python e le librerie necessarie. Serve sia per Claude Desktop sia per Claude Code.
        </p>
        <ul className="mt-3 space-y-3 text-sm text-slate-700 dark:text-slate-200">
          {UV_INSTALL.map((step) => (
            <li key={step.text} className="space-y-1">
              <p>{step.text}</p>
              {step.code && <CopyableCode code={step.code} label={step.codeLabel ?? 'il comando'} />}
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          Dopo l’installazione chiudi del tutto Claude (⌘Q su Mac: non basta chiudere la finestra) e riaprilo.
        </p>
      </div>

      <div className="space-y-4">
        {LEGAL_IT_CLIENTS.map((client) => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      <div className="text-sm text-slate-600 dark:text-slate-300">
        <h3 className="font-medium">Non supportati</h3>
        <ul className="mt-1 space-y-1">
          {LEGAL_IT_UNSUPPORTED.map((name) => (
            <li key={name} className="flex items-start gap-2">
              <XCircle size={14} className="mt-1 shrink-0 text-slate-400" aria-hidden />
              <span>{name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1">Nessuno di questi può avviare un server sul tuo computer.</p>
      </div>

      <div className="text-sm text-slate-600 dark:text-slate-300">
        <h3 className="font-medium">Altri client, Docker e libreria Python</h3>
        <p className="mt-1">Per tutto il resto segui le istruzioni del README nel repository.</p>
        <ExternalAnchor href={LEGAL_IT_REPO_URL}>Apri il README di mcp-legal-it</ExternalAnchor>
      </div>
    </section>
  );
}

/**
 * «Collega un'app AI», in two parts named at the top. VisuaLex: how to connect an AI application
 * (Claude Code, Claude, Codex, Gemini CLI, any client through mcp-remote) to VisuaLex's MCP server, with
 * the address filled in from the server's configuration; what a connected application can do; and the
 * applications already connected, with revoke. mcp-legal-it: how to install that server on one's own
 * computer, shown whatever VisuaLex's server says. Reached from the user menu.
 */
export function ConnectAiAppPage() {
  const [state, setState] = useState<InfoState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    connectionsService
      .getConnectionInfo()
      .then((info) => !cancelled && setState({ status: 'ready', info }))
      .catch((error: unknown) => {
        console.error('[ConnectAiAppPage] connection info failed', error);
        if (!cancelled) setState({ status: 'error', message: getErrorMessage(error) ?? 'Impossibile leggere l’indirizzo del server MCP.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mcpUrl = state.status === 'ready' ? state.info.mcpUrl : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <header>
        <h1 className="flex items-center gap-2 font-serif text-3xl font-medium tracking-tight text-slate-900 dark:text-slate-50">
          <Bot className="text-primary-500" size={24} aria-hidden /> Collega un’app AI
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Un’app di intelligenza artificiale collegata a VisuaLex può leggere i tuoi dossier, crearne di nuovi e aggiungervi
          norme, sentenze, note e schede di studio, con il tuo account. Il collegamento usa il protocollo MCP: copi
          l’indirizzo nell’app, accedi a VisuaLex e scegli tu i permessi.
        </p>
      </header>

      <nav aria-label="Le due parti della pagina" className="space-y-2">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Sono due cose diverse: VisuaLex collega l’app AI al tuo account e ai tuoi dossier, online; mcp-legal-it si installa sul
          tuo computer e dà all’app AI strumenti di diritto italiano, senza account.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PARTS.map((part) => (
            <li key={part.href}>
              <a
                href={part.href}
                className={cn(
                  'flex min-h-[44px] flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 transition-colors duration-150 hover:border-primary-300 hover:bg-primary-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-700 dark:hover:bg-slate-700',
                  focusRing,
                )}
              >
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{part.name}</span>
                <span className="text-xs text-slate-600 dark:text-slate-300">{part.line}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="visualex" aria-labelledby="visualex-title" className={cn(anchorTarget, 'space-y-8')}>
        <h2 id="visualex-title" className={partTitle}>
          VisuaLex
        </h2>
        <section
          aria-labelledby="ai-personal-data"
          className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <h2 id="ai-personal-data" className="font-semibold">
              Dati personali e app AI
            </h2>
            <p>
              Un’app AI collegata legge i nomi dei tuoi dossier, i titoli e i riferimenti delle voci e le tue schede di studio, e li
              passa al servizio di intelligenza artificiale che usa. Non scrivere lì dati personali dei clienti, oppure collega
              solo app AI di cui ti fidi.
            </p>
            <p>
              Un’app collegata agisce con il tuo account, nei limiti dei permessi che le dai; puoi revocarla in qualsiasi momento
              qui sotto.
            </p>
          </div>
        </section>

        <section aria-labelledby="mcp-address" className="space-y-2">
          <h2 id="mcp-address" className={sectionTitle}>
            L’indirizzo di VisuaLex
          </h2>
          {state.status === 'loading' && <p className="text-sm text-slate-500">Caricamento…</p>}
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {state.message}
            </p>
          )}
          {state.status === 'ready' && mcpUrl && <CopyableCode code={mcpUrl} label="l’indirizzo del server MCP" />}
          {state.status === 'ready' && !mcpUrl && (
            <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
              Il collegamento con le app AI non è attivo su questo server. Chiedi all’amministratore di attivarlo.
            </p>
          )}
        </section>

        {mcpUrl && (
          <section aria-labelledby="ai-clients" className="space-y-3">
            <h2 id="ai-clients" className={sectionTitle}>
              Come collegare la tua app
            </h2>
            <div className="space-y-4">
              {aiClients(mcpUrl).map((client) => (
                <ClientCard key={client.id} client={client} />
              ))}
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <p className="font-medium">Non ancora supportate</p>
              <ul className="mt-1 space-y-1">
                {UNSUPPORTED_CLIENTS.map((client) => (
                  <li key={client.name} className="flex items-start gap-2">
                    <XCircle size={14} className="mt-1 shrink-0 text-slate-400" aria-hidden />
                    <span>
                      <span className="font-medium">{client.name}</span>: {client.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section aria-labelledby="ai-can-do" className="space-y-3">
          <h2 id="ai-can-do" className={sectionTitle}>
            Cosa può fare un’app collegata
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            {AI_TOOLS.map((tool) => (
              <li key={tool.name}>
                <span className="font-medium">{tool.name}</span>: {tool.what}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Non può modificare né spostare nulla, e non riceve il testo degli articoli.
          </p>
          {state.status === 'ready' && state.info.scopes.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">I permessi che un’app può chiederti</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {state.info.scopes.map((scope) => (
                  <li key={scope.scope}>{scope.label}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={card}>
            <p className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              <Trash2 size={16} aria-hidden /> Eliminare richiede due conferme
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
              <li>
                Il permesso di eliminare è spento all’inizio: lo accendi tu, per ogni app, quando la autorizzi o da «Applicazioni collegate»
                qui sotto.
              </li>
              <li>
                Ogni eliminazione ti chiede conferma nell’app, con un modulo in cui spunti «Confermo». Se l’app non sa mostrare il
                modulo, l’eliminazione viene rifiutata.
              </li>
            </ol>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Ciò che viene eliminato finisce nel cestino per 30 giorni: lo trovi in Dossier → Cestino e puoi ripristinarlo.
            </p>
          </div>
        </section>

        <section aria-label="Applicazioni collegate">
          <ConnectedAppsSection />
        </section>
      </section>

      <LegalItSection />
    </div>
  );
}
