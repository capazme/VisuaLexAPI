import { useMemo, useState, type KeyboardEvent } from 'react';
import { Folder } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { dossierRecency } from '../dossier/dossierUtils';
import { useHostDossier } from './readingHost';

// The cap of every note of a dossier, as `AddNoteModal` and the MCP round set it (S11).
const MAX_NOTE_LENGTH = 4000;

const QUIET_BUTTON =
  'inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 md:min-h-9 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const PANEL = 'mb-2 mt-1 space-y-2 rounded-lg border border-slate-200 p-3 md:ml-6 dark:border-slate-800';

/**
 * «Aggiungi una nota» from a row's «⋯» in «Fonti» (LC86): the note's field under the row, in the page (L-73), not a
 * dialog. Saved through the dossier's notes route; a refused note keeps its words.
 */
export function RowNoteComposer({ name, onSave, onDone }: { name: string; onSave: (text: string) => Promise<boolean>; onDone: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const saved = await onSave(trimmed);
    setSaving(false);
    if (saved) {
      setText('');
      onDone();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  };
  return (
    <div className={PANEL}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
        onKeyDown={onKeyDown}
        rows={3}
        aria-label={`Nota su ${name}`}
        placeholder="Scrivi la nota…"
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onDone} className={QUIET_BUTTON}>Annulla</button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!text.trim() || saving}
          className={cn(QUIET_BUTTON, 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100')}
        >
          {saving ? 'Salvo…' : 'Aggiungi la nota'}
        </button>
      </div>
    </div>
  );
}

/**
 * «Sposta in un'altra pratica» from a row's «⋯» in «Fonti» (LC86): the other dossiers under the row, most recent first,
 * in the page (L-73), as `MoveToDossierModal` lists them over it.
 */
export function RowMovePicker({ onMove, onDone, from }: { onMove: (targetId: string) => void; onDone: () => void; from?: string }) {
  const host = useHostDossier();
  // The dossier moved from: the reading's host, or the page's (the selection bar, LC88, stands outside the reading).
  const current = from ?? host?.id;
  const dossiers = useAppStore((s) => s.dossiers);
  const others = useMemo(
    () => dossiers.filter((d) => d.id !== current).sort((a, b) => dossierRecency(b) - dossierRecency(a)),
    [dossiers, current],
  );
  return (
    <div className={PANEL}>
      <p className="text-sm font-medium text-slate-900 dark:text-white">Sposta in un&apos;altra pratica</p>
      {others.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">Nessun&apos;altra pratica disponibile.</p>
      ) : (
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {others.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => { onMove(d.id); onDone(); }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-800 hover:bg-slate-100 md:min-h-9 dark:text-slate-200 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              >
                <Folder size={15} aria-hidden className="flex-shrink-0 text-slate-500 dark:text-slate-400" />
                <span className="min-w-0 truncate">{d.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onDone} className={QUIET_BUTTON}>Annulla</button>
      </div>
    </div>
  );
}
