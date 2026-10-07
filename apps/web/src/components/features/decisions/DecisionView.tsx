import { useState } from 'react';
import { AlertCircle, Copy, ExternalLink, FolderPlus, Link2, RotateCw, Search } from 'lucide-react';
import { Button } from '../../ui/Button';
import { SkeletonText } from '../../ui/Skeleton';
import { Toast, type ToastProps } from '../../ui/Toast';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { DecisionIdentity, DecisionReference, FetchDecisionAnswer, FoundDecision } from '../../../types/decisions';
import {
  decisionPath,
  describeNotice,
  formatDecisionCitation,
  formatDecisionHeading,
  httpsUrl,
  notFoundMessage,
} from '../../../utils/decisionLinks';
import { hasDecisionText } from '../../../utils/decisionText';
import { AddToDossierPopover } from '../dossier/AddToDossierPopover';
import { sentenzaFromDecision } from '../dossier/dossierUtils';
import { DecisionTextView } from './DecisionTextView';

export interface DecisionViewProps {
  /** null while the decision is being fetched */
  answer: FetchDecisionAnswer | null;
  reference: DecisionReference;
  onRetry: () => void;
  onChooseCandidate: (identity: DecisionIdentity) => void;
  onOpenPalette: () => void;
  /** Extra buttons beside the decision's own actions. */
  actions?: React.ReactNode;
  /** Replaces the plain text (the reading surface, later). */
  textSlot?: React.ReactNode;
  /** The decision's heading: 1 on a page of its own, 2 (default) inside a workspace tab, where
   *  the app's page has its h1. */
  headingLevel?: 1 | 2;
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
      <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

type ShowToast = (message: string, type: ToastProps['type']) => void;

/** A link to a decision that a plain click handles in place; a modified click (ctrl, meta, shift,
 *  middle button) is left to the browser, so it opens in a new browser tab as a link should. */
function DecisionChoice({ identity, onChoose, className, children }: {
  identity: DecisionIdentity;
  onChoose: (identity: DecisionIdentity) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={decisionPath(identity)}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onChoose(identity);
      }}
    >
      {children}
    </a>
  );
}

function FoundView({ answer, onToast, actions, textSlot, headingLevel }: {
  answer: FoundDecision;
  onToast: ShowToast;
  actions?: React.ReactNode;
  textSlot?: React.ReactNode;
  headingLevel: 1 | 2;
}) {
  // The source's own page, only ever over https: the address comes from our server, built on fixed
  // bases, so this is defence in depth.
  const sourceUrl = httpsUrl(answer.fonte.url);
  const [dossierAnchor, setDossierAnchor] = useState<HTMLElement | null>(null);
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  const copy = async (text: string, done: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(done, 'success');
    } catch (error) {
      // no clipboard (a page that is not secure, an old browser), or the browser refused
      console.error(`copying the ${what} failed`, error);
      onToast('Copia non riuscita', 'error');
    }
  };

  return (
    <article className="space-y-5">
      <Heading className="text-xl font-semibold text-slate-900 dark:text-white">
        {formatDecisionHeading(answer.identita, answer.attributi)}
      </Heading>
      {answer.avvisi.map((notice, i) => (
        <Alert key={i}>{describeNotice(notice, answer.attributi)}</Alert>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy size={16} />}
          className={TOUCH_TARGET_RESPONSIVE}
          onClick={() => { void copy(formatDecisionCitation(answer.identita, answer.attributi), 'Citazione copiata', 'citation'); }}
        >
          Copia citazione
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Link2 size={16} />}
          className={TOUCH_TARGET_RESPONSIVE}
          onClick={() => { void copy(window.location.origin + decisionPath(answer.identita), 'Collegamento copiato', 'link'); }}
        >
          Copia collegamento
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FolderPlus size={16} />}
          className={TOUCH_TARGET_RESPONSIVE}
          onClick={(e) => setDossierAnchor(e.currentTarget)}
        >
          Aggiungi al dossier
        </Button>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:min-h-0 dark:text-primary-400"
          >
            <ExternalLink size={16} aria-hidden /> Apri sulla fonte
          </a>
        )}
        {actions}
      </div>
      {/* Found without its text: the notice above says so, and no empty block is drawn. */}
      {hasDecisionText(answer.testo) && (textSlot ?? <DecisionTextView testo={answer.testo} />)}
      {/* No licence line (the owner's decision, confirmed on 2026-10-04): fonte.licenza stays in
          the data. */}
      <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Fonte: {answer.fonte.nome}
      </footer>
      {/* The item keeps the identity and the citation computed from what it keeps (source
          convention, Q9), never the text. */}
      <AddToDossierPopover
        isOpen={dossierAnchor !== null}
        anchorEl={dossierAnchor}
        onClose={() => setDossierAnchor(null)}
        sentenza={sentenzaFromDecision(answer.identita, answer.attributi)}
        onAdded={(_dossierId, title) => onToast(`Aggiunta a «${title}»`, 'success')}
        onDuplicate={(title) => onToast(`Già presente in «${title}»`, 'info')}
      />
    </article>
  );
}

/**
 * Who did not answer, in the page's words. `quota`: the limit of requests. `rete`: the request never
 * reached our server. `risposta <status>`: something answered that was not the route (the ingress, the
 * login gate or the framework: a 502 while VisuaLex's Python service is down). Those are ours, and are
 * never blamed on the source; only the name of a source (`cassazione`, `corte_costituzionale`) is.
 */
function unreachableMessage(fonte: string): string {
  if (fonte === 'quota') return 'Hai raggiunto il limite di richieste: riprova tra un minuto.';
  if (fonte === 'rete') return 'Il server non ha risposto: controlla la connessione e riprova.';
  if (fonte.startsWith('risposta ')) return 'Il servizio non ha risposto correttamente: riprova tra poco.';
  return 'La fonte non risponde in questo momento.';
}

/** The body of a decision, wherever it is drawn: the workspace tab, the phone's view or the page. */
export function DecisionView({
  answer, reference, onRetry, onChooseCandidate, onOpenPalette, actions, textSlot, headingLevel = 2,
}: DecisionViewProps) {
  const [toast, setToast] = useState<{ message: string; type: ToastProps['type'] } | null>(null);
  const linkClass = `inline-flex items-center text-primary-600 hover:underline dark:text-primary-400 ${TOUCH_TARGET_RESPONSIVE}`;

  const retry = (
    <div className="mt-2">
      <Button variant="secondary" size="sm" icon={<RotateCw size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={onRetry}>
        Riprova
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (!answer) {
    // the status is announced on its own: inside an aria-busy container it would not be
    body = (
      <div>
        <p className="sr-only" role="status">Caricamento della decisione…</p>
        <SkeletonText lines={8} />
      </div>
    );
  } else if (answer.esito === 'trovata') {
    body = (
      <FoundView
        answer={answer}
        onToast={(message, type) => setToast({ message, type })}
        actions={actions}
        textSlot={textSlot}
        headingLevel={headingLevel}
      />
    );
  } else if (answer.esito === 'ambigua') {
    body = (
      <section className="space-y-3">
        <Alert>Con questi estremi esistono più decisioni: scegli quella citata.</Alert>
        <ul className="space-y-2">
          {answer.candidati.map((c) => (
            <li key={decisionPath(c.identita)}>
              <DecisionChoice identity={c.identita} onChoose={onChooseCandidate} className={linkClass}>
                {formatDecisionHeading(c.identita, c.attributi)}
              </DecisionChoice>
            </li>
          ))}
        </ul>
      </section>
    );
  } else if (answer.esito === 'non_trovata') {
    body = (
      <Alert>
        <p>{notFoundMessage(answer, reference)}</p>
        {answer.suggerimento && (
          <p className="mt-1">
            Per le decisioni penali il numero segue l'anno di deposito: prova{' '}
            <DecisionChoice identity={answer.suggerimento} onChoose={onChooseCandidate} className="font-medium underline">
              n. {answer.suggerimento.numero}/{answer.suggerimento.anno}
            </DecisionChoice>.
          </p>
        )}
      </Alert>
    );
  } else if (answer.esito === 'fonte_non_raggiungibile') {
    // Our own failures (the limit of requests, the network, an answer that was not the route's) are
    // told apart from a source that is silent, and never blamed on it (`unreachableMessage`). A source
    // that is silent includes a Corte costituzionale copy that could not be refreshed and lacks the
    // number: it confirms, it never denies.
    body = (
      <Alert>
        <p>{unreachableMessage(answer.fonte)}</p>
        {retry}
      </Alert>
    );
  } else if (answer.esito === 'errore_interno') {
    body = (
      <Alert>
        <p>Errore imprevisto: non è stato possibile caricare la decisione.</p>
        {retry}
      </Alert>
    );
  } else {
    // richiesta_non_valida: the route refused the request; its reasons, and the search to start over
    body = (
      <Alert>
        <p>L'indirizzo non indica una sentenza leggibile: {Object.values(answer.errori).join('; ')}.</p>
        <div className="mt-2">
          <Button variant="secondary" size="sm" icon={<Search size={16} />} className={TOUCH_TARGET_RESPONSIVE} onClick={onOpenPalette}>
            Cerca nella barra di ricerca
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {body}
      {toast && <Toast message={toast.message} type={toast.type} isVisible onClose={() => setToast(null)} />}
    </div>
  );
}
