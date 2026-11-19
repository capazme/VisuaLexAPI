import { useLayoutEffect, useRef, useState } from 'react';
import { FolderInput } from 'lucide-react';
import { useAppStore, type ImportProgress } from '../../../store/useAppStore';
import { importReport, importToastType, type ImportCheck } from './dossierUtils';
import { countsLine } from './dossierLayout';
import { tagLabel } from '../../../utils/tagLabel';
import { Button } from '../../ui/Button';
import { Expand } from '../../ui/Expand';
import { CARD_RADIUS, CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

/** A check, and whether it came from a share link (someone shared it) or from a file the user chose. */
export type ImportRequest = ImportCheck & { fromLink?: boolean };

interface Props {
  /** What a share link or a file holds, checked (`validateImportedDossier`); null, closed. */
  check: ImportRequest | null;
  onClose: () => void;
  /** Opens the dossier the import made. */
  onOpen: (dossierId: string) => void;
  showToast: (message: string, type?: ToastType) => void;
  className?: string;
}

/** What the import did, said in the space when something did not come in: the counts and the server's own words. */
interface Result {
  message: string;
  type: ToastType;
  dossierId?: string;
  /** Stopped by the server's write limit or a lost connection: «Riprendi» goes on from there. */
  resumable?: boolean;
}

/** The runs of one import so far (a stopped one and its «Riprendi»), added up. */
interface Tally {
  id: string;
  imported: number;
  failed: number;
  refusals: string[];
  next?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SLOW_DOWN = 'Il server ha chiesto di rallentare';
const NO_ANSWER = 'La connessione non risponde';

/**
 * «Importa una pratica» in the page (LC107, L-73): a space at the top of the dossiers (`Expand`), never over them. The
 * items go one at a time at the server's write pace (`importDossier`), and the space says how many are in. An import
 * that takes everything opens the new dossier, as before. One the server cut short stays here: its caps (G-576, a 409
 * in Italian) said in its words; its write limit, if it kept refusing, with «Riprendi» for the items left, into the same
 * dossier.
 */
export function ImportDossierPanel({ check, onClose, onOpen, showToast, className }: Props) {
  // The preview stays drawn while the space closes; a new check (the same file chosen again) starts afresh.
  const [shown, setShown] = useState(check);
  const [round, setRound] = useState(0);
  if (check && check !== shown) {
    setShown(check);
    setRound(round + 1);
  }
  // While the server works, Esc does not close: the outcome would have nowhere to be said.
  const [busy, setBusy] = useState(false);

  return (
    <Expand
      open={check !== null}
      onClose={busy ? undefined : onClose}
      role="region"
      aria-label="Importa una pratica"
      className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}
    >
      {shown && (
        <ImportBody key={round} check={shown} busy={busy} setBusy={setBusy} onClose={onClose} onOpen={onOpen} showToast={showToast} />
      )}
    </Expand>
  );
}

function ImportBody({ check, busy, setBusy, onClose, onOpen, showToast }: Omit<Props, 'check' | 'className'> & {
  check: ImportRequest;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const importDossier = useAppStore((s) => s.importDossier);
  const { dossier, discarded, fromLink } = check;
  const total = dossier.items.length;
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  // The pressed «Importa» is gone with the outcome: the focus goes to what comes next, a button, never a field. In the
  // commit that draws the outcome: a passive effect ran a task later, and the focus was still on the space meanwhile.
  const nextRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (result) nextRef.current?.focus({ preventScroll: true }); }, [result]);
  // Leaving the page stops the import, and what is not in yet is lost: the browser asks first (L-74, data at stake).
  // Held and let go in the commit that shows or hides «Se lasci la pagina…», as the focus above.
  useLayoutEffect(() => {
    if (!busy) return undefined;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', hold);
    return () => window.removeEventListener('beforeunload', hold);
  }, [busy]);

  const run = async () => {
    const prior = tally;
    setBusy(true);
    setResult(null);
    setProgress(null);
    const outcome = await importDossier(dossier, {
      onProgress: setProgress,
      ...(prior?.next !== undefined && { resume: { id: prior.id, from: prior.next } }),
    });
    setBusy(false);
    setProgress(null);
    if (!outcome) {
      setResult({ message: 'Impossibile importare la pratica: errore server', type: 'error', dossierId: prior?.id });
      return;
    }
    if ('refused' in outcome) {
      setResult({ message: `Pratica non importata. ${outcome.refused}`, type: 'error' });
      return;
    }
    const sum: Tally = {
      id: outcome.id,
      imported: (prior?.imported ?? 0) + outcome.imported,
      failed: (prior?.failed ?? 0) + outcome.failed,
      refusals: [...new Set([...(prior?.refusals ?? []), ...(outcome.refusals ?? [])])],
      next: outcome.next,
    };
    setTally(sum);
    if (sum.next !== undefined) {
      // What is left is not yet in, never «scartate»: that word is for a cap's 409.
      const why = outcome.stopped === 'network' ? 'Connessione persa' : `Import interrotto, ${SLOW_DOWN.toLowerCase()}`;
      const notYet = total - sum.next;
      setResult({
        message: `${why}: ${plural(sum.imported, 'voce entrata', 'voci entrate')} su ${total}, ${notYet} non ancora ${notYet === 1 ? 'importata' : 'importate'}. «Riprendi» continua dalle voci rimaste, nella stessa pratica.`,
        type: 'warning',
        dossierId: sum.id,
        resumable: true,
      });
      return;
    }
    const lost = sum.failed + discarded.length;
    if (lost === 0) {
      showToast(importReport(sum.imported, lost), 'success');
      onOpen(sum.id);
      return;
    }
    const words = sum.refusals.length ? ` ${sum.refusals.join(' ')}` : '';
    setResult({ message: `${importReport(sum.imported, lost)}.${words}`, type: importToastType(sum.imported, lost), dossierId: sum.id });
  };

  // While it runs: the items in so far, of how many, and whether it is waiting for the server's limit.
  const entered = (tally?.imported ?? 0) + (progress?.done ?? 0);
  const running = progress?.waiting
    ? `${plural(entered, 'voce entrata', 'voci entrate')} su ${total}. ${progress.reason === 'network' ? NO_ANSWER : SLOW_DOWN}: aspetto e riprovo da solo.`
    : `Importo la pratica: ${plural(entered, 'voce entrata', 'voci entrate')} su ${total}…`;
  const left = total - (tally?.next ?? total);

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-50">
          <FolderInput size={18} aria-hidden className="text-slate-500 dark:text-slate-400" />
          Importa una pratica
        </h2>
        {/* Only a link was shared by someone: a file is the user's own. */}
        {fromLink && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Qualcuno ha condiviso una pratica con te</p>}
      </div>

      <div className={cn('space-y-2 bg-slate-50 p-4 dark:bg-slate-800/50', CARD_RADIUS)}>
        <h3 className="break-words font-serif text-lg font-medium text-slate-900 dark:text-slate-50">{dossier.title}</h3>
        {dossier.description && <p className="break-words text-sm text-slate-700 dark:text-slate-300">{dossier.description}</p>}
        {/* The same line as a dossier's card (LC88). */}
        <p className="text-sm text-slate-600 dark:text-slate-400">{countsLine(dossier.items)}</p>
        {dossier.tags && dossier.tags.length > 0 && (
          <ul aria-label="Etichette" className="flex flex-wrap gap-1">
            {dossier.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                {tagLabel(tag)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {discarded.length > 0 && (
        <p role="alert" className={cn('border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200', CONTROL_RADIUS)}>
          {discarded.length} {discarded.length === 1 ? 'voce non importabile' : 'voci non importabili'}:{' '}
          {[...new Set(discarded.map((d) => d.reason))].join('; ')}
        </p>
      )}

      {/* The outcome in the flow: what came in, and the server's words for what did not. */}
      <p role="status" className={cn(result || busy ? 'text-sm font-medium' : 'sr-only', result?.type === 'error' ? 'text-red-700 dark:text-red-300' : 'text-slate-800 dark:text-slate-200')}>
        {busy ? running : result?.message}
      </p>
      {busy && <p className="text-sm text-slate-600 dark:text-slate-400">Se lasci la pagina l’importazione si ferma.</p>}

      <div className="flex flex-wrap justify-end gap-3">
        {result ? (
          <>
            <Button ref={result.dossierId ? undefined : nextRef} type="button" variant="quiet" onClick={onClose}>Chiudi</Button>
            {result.dossierId && (
              <Button ref={result.resumable ? undefined : nextRef} type="button" variant={result.resumable ? 'secondary' : 'primary'} onClick={() => onOpen(result.dossierId!)}>
                Apri la pratica
              </Button>
            )}
            {result.resumable && (
              <Button ref={nextRef} type="button" onClick={() => void run()}>
                Riprendi: {plural(left, 'voce', 'voci')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>Annulla</Button>
            <Button type="button" onClick={() => void run()} disabled={busy} icon={<FolderInput size={16} aria-hidden />}>
              Importa
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
