import { useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Select } from '../../ui/Select';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { focusLanding } from '../../../utils/focusPage';
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
  if (entry.kind === 'DOSSIER') return `Pratica «${entry.label}»`;
  if (entry.kind === 'LINGO_CARDS') return entry.itemCount === 1 ? 'Scheda di studio' : `Schede di studio (${entry.itemCount})`;
  if (entry.kind === 'LINGO_CORSO') return `Percorso «${entry.label}»`;
  if (entry.kind === 'LINGO_CORSO_MODULO') {
    // The server's label is «module · course»: the quotes take the module's name only (split at the first « · »,
    // so a course title holding one stays whole).
    const at = entry.label.indexOf(' · ');
    return at === -1 ? `Modulo «${entry.label}»` : `Modulo «${entry.label.slice(0, at)}» · ${entry.label.slice(at + 3)}`;
  }
  return showSource ? `Da «${entry.label}»` : (entry.itemCount === 1 ? '1 elemento' : `${entry.itemCount} elementi`);
}

function whatOf(entry: TrashEntry): string {
  if (entry.kind === 'DOSSIER') return entry.itemCount === 1 ? '1 elemento' : `${entry.itemCount} elementi`;
  if (entry.kind === 'LINGO_CARDS') return trashCardsSummary(entry.cards ?? []);
  if (entry.kind === 'LINGO_CORSO' || entry.kind === 'LINGO_CORSO_MODULO') {
    const cards = entry.cardCount ?? 0;
    const cardsLine = cards === 0 ? 'nessuna scheda' : cards === 1 ? '1 scheda' : `${cards} schede`;
    if (entry.kind === 'LINGO_CORSO_MODULO') return cards === 0 ? 'Senza schede' : `Con ${cardsLine}`;
    return `${entry.itemCount === 1 ? '1 modulo' : `${entry.itemCount} moduli`} · ${cardsLine}`;
  }
  return trashItemsSummary(entry.items ?? []);
}

/** One entry of the trash: what it holds, who removed it and until when, Ripristina and Elimina definitivamente. */
export function TrashEntryRow({ entry, showSource, dossiers, onRestore, onPurge, showToast }: Props) {
  const [busy, setBusy] = useState(false);
  const [needsTarget, setNeedsTarget] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purgeFrom, setPurgeFrom] = useState<HTMLElement | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const title = titleOf(entry, showSource);

  const restore = async (targetDossierId?: string) => {
    setBusy(true);
    const outcome = await onRestore(entry, targetDossierId);
    setBusy(false);
    if (outcome.kind === 'restored') {
      showToast('Ripristinato', 'success');
      // The pressed button was disabled while it worked, and the row leaves the list: the focus would rest on the
      // body. It goes to the page's title, where what came back is listed (LC106, the consultant on #640).
      requestAnimationFrame(() => {
        if (!rowRef.current?.isConnected || document.activeElement === document.body) focusLanding(false);
      });
    } else if (outcome.kind === 'needs-target') setNeedsTarget(outcome.message);
    else showToast(outcome.message, 'error');
  };

  const purge = async () => {
    setConfirmPurge(false);
    setBusy(true);
    // Where the focus goes once this row has left the list: the next row, else the one before, else the list's page.
    const row = rowRef.current;
    const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>('button:not([disabled])');
    // The nearest control outside the row, however deep the list sits in its page (the trash's `PageFrame`).
    let page: HTMLElement | undefined;
    for (let up = row?.parentElement?.parentElement; up && !page; up = up.parentElement) {
      page = [...up.querySelectorAll<HTMLElement>('button:not([disabled])')].find((b) => !row?.contains(b));
    }
    const done = await onPurge(entry);
    setBusy(false);
    // Once the list has drawn itself without this row.
    if (done) requestAnimationFrame(() => {
      if (!row?.isConnected) (neighbour?.isConnected ? neighbour : page)?.focus({ preventScroll: true });
    });
    showToast(done ? 'Eliminato definitivamente' : 'Impossibile eliminare. Riprova.', done ? 'success' : 'error');
  };

  return (
    // `Card`'s box (8 px, its border, the paper) on a list item.
    <li ref={rowRef} tabIndex={-1} className={cn('bg-card px-3 py-2 focus-visible:outline-none', CARD_RADIUS, CONTROL_BORDER)}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
          {whatOf(entry) && <p className="text-sm text-slate-600 dark:text-slate-300">{whatOf(entry)}</p>}
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{trashWhen(entry)}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void restore()}
            disabled={busy}
            aria-label={`Ripristina ${title}`}
            icon={<RotateCcw size={14} aria-hidden />}
          >
            Ripristina
          </Button>
          <IconButton
            onClick={(event) => { setPurgeFrom(event.currentTarget); setConfirmPurge(true); }}
            disabled={busy}
            aria-label={`Elimina definitivamente ${title}`}
            className="text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
            icon={<Trash2 aria-hidden />}
          />
        </div>
      </div>
      {needsTarget && (
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-amber-50 p-2 md:flex-row md:items-center dark:bg-amber-950/20">
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">{needsTarget}</p>
          <label className="sr-only" htmlFor={`trash-target-${entry.id}`}>Pratica in cui ripristinare</label>
          <div className="md:w-64">
            <Select id={`trash-target-${entry.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Scegli una pratica…</option>
              {dossiers.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </div>
          <Button type="button" onClick={() => void restore(target)} disabled={!target || busy}>
            Ripristina qui
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmPurge}
        variant="danger"
        title="Eliminare definitivamente?"
        message={`${title} lascia il cestino e non si potrà più ripristinare. Il resto del cestino e le tue pratiche non saranno toccati.`}
        confirmLabel="Elimina definitivamente"
        focusCancel
        origin={purgeFrom}
        // Confirmed, the button is busy: the focus waits on the row until it leaves the list (`purge`).
        focusBack={() => rowRef.current}
        onConfirm={() => void purge()}
        onCancel={() => setConfirmPurge(false)}
      />
    </li>
  );
}
