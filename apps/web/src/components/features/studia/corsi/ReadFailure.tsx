import { cn } from '../../../../lib/utils';
import { SECONDARY_BUTTON } from '../progress/tokens';

interface ReadFailureProps {
  /** What could not be read, after «Non è stato possibile leggere»: «i tuoi percorsi». */
  what: string;
  /** No answer at all: the browser is offline or the server unreachable. */
  offline: boolean;
  /** What was read before stays on screen under the notice. */
  stale?: boolean;
  onRetry: () => void;
}

/** A failed read of «Percorsi», said in words with «Riprova» (courses spec §6.3: loading, error, offline). */
export function ReadFailure({ what, offline, stale = false, onRetry }: ReadFailureProps) {
  const sentence = offline
    ? `Sei offline o il server non risponde: non è stato possibile leggere ${what}.`
    : `Non è stato possibile leggere ${what}.`;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="min-w-0 flex-1 basis-60">
        {sentence}
        {stale && ' Quello che vedi è l’ultima lettura.'}
        {offline && ' Si aggiorna da sé quando torna la connessione.'}
      </p>
      <button type="button" onClick={onRetry} className={cn(SECONDARY_BUTTON, 'bg-white dark:bg-transparent')}>
        Riprova
      </button>
    </div>
  );
}
