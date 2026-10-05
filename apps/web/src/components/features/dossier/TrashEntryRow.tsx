import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import type { TrashEntry } from '../../../services/trashService';
import type { Dossier } from '../../../types';
import { trashCardsSummary, trashItemsSummary, trashWhen } from './trashSummary';
import type { RestoreOutcome } from './useTrash';

interface Props {
  entry: TrashEntry;
  /** Show which dossier an entry came from (the global trash), or not (the dossier's own row). */
  showSource: boolean;
  /** The user's dossiers, to choose where entries go back when theirs is gone. */
  dossiers: Dossier[];
  onRestore: (entry: TrashEntry, targetDossierId?: string) => Promise<RestoreOutcome>;
  onPurge: (entry: TrashEntry) => Promise<boolean>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function titleOf(entry: TrashEntry, showSource: boolean): string {
  if (entry.kind === 'DOSSIER') return `Dossier «${entry.label}»`;
  if (entry.kind === 'LINGO_CARDS') return entry.itemCount === 1 ? 'Scheda LingoLex' : `Schede LingoLex (${entry.itemCount})`;
  return showSource ? `Da «${entry.label}»` : (entry.itemCount === 1 ? '1 elemento' : `${entry.itemCount} elementi`);
}

function whatOf(entry: TrashEntry): string {
  if (entry.kind === 'DOSSIER') return entry.itemCount === 1 ? '1 elemento' : `${entry.itemCount} elementi`;
  if (entry.kind === 'LINGO_CARDS') return trashCardsSummary(entry.cards ?? []);
  return trashItemsSummary(entry.items ?? []);
}

/** One entry of the trash: what it holds, who removed it and until when, Ripristina and Elimina definitivamente. */
export function TrashEntryRow({ entry, showSource, dossiers, onRestore, onPurge, showToast }: Props) {
  const [busy, setBusy] = useState(false);
  const [needsTarget, setNeedsTarget] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);
  const title = titleOf(entry, showSource);

  const restore = async (targetDossierId?: string) => {
    setBusy(true);
    const outcome = await onRestore(entry, targetDossierId);
    setBusy(false);
    if (outcome.kind === 'restored') showToast('Ripristinato', 'success');
    else if (outcome.kind === 'needs-target') setNeedsTarget(outcome.message);
    else showToast(outcome.message, 'error');
  };

  const purge = async () => {
    setConfirmPurge(false);
    setBusy(true);
    const done = await onPurge(entry);
    setBusy(false);
    showToast(done ? 'Eliminato definitivamente' : 'Impossibile eliminare. Riprova.', done ? 'success' : 'error');
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
          {whatOf(entry) && <p className="text-sm text-slate-600 dark:text-slate-300">{whatOf(entry)}</p>}
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{trashWhen(entry)}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void restore()}
            disabled={busy}
            aria-label={`Ripristina ${title}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:min-h-0 md:py-1.5 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <RotateCcw size={14} aria-hidden /> Ripristina
          </button>
          <button
            type="button"
            onClick={() => setConfirmPurge(true)}
            disabled={busy}
            aria-label={`Elimina definitivamente ${title}`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 md:min-h-0 md:min-w-0 md:p-1.5 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {needsTarget && (
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-amber-50 p-2 md:flex-row md:items-center dark:bg-amber-950/20">
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{needsTarget}</p>
          <label className="sr-only" htmlFor={`trash-target-${entry.id}`}>Dossier in cui ripristinare</label>
          <select
            id={`trash-target-${entry.id}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-h-[44px] rounded-md border border-slate-300 bg-white px-2 text-sm md:min-h-0 md:py-1 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">Scegli un dossier…</option>
            {dossiers.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void restore(target)}
            disabled={!target || busy}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 md:min-h-0 md:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Ripristina qui
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmPurge}
        variant="danger"
        title="Eliminare definitivamente?"
        message={`${title} lascia il cestino e non si potrà più ripristinare. Il resto del cestino e i tuoi dossier non saranno toccati.`}
        confirmLabel="Elimina definitivamente"
        onConfirm={() => void purge()}
        onCancel={() => setConfirmPurge(false)}
      />
    </li>
  );
}
