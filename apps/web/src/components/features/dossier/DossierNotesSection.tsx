import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { DossierItem } from '../../../types';
import { formatTimestampLong } from './dossierUtils';

type NoteItem = Extract<DossierItem, { type: 'note' }>;

interface Props {
  notes: NoteItem[];
  onRemove: (item: DossierItem) => void;
}

// A note longer than this, or of more than three lines, is shown folded.
const FOLD_AT = 240;
const isLong = (text: string) => text.length > FOLD_AT || text.split('\n').length > 3;

function NoteRow({ note, onRemove }: { note: NoteItem; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const long = isLong(note.data);
  return (
    <li className="group flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className={cn('whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200', long && !open && 'line-clamp-3')}>
          {note.data}
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-0.5 rounded text-xs font-medium text-amber-800 hover:underline dark:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {open ? 'Mostra meno' : 'Mostra tutto'}
          </button>
        )}
      </div>
      <span className="flex-shrink-0 pt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatTimestampLong(note.addedAt)}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Rimuovi nota"
        className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:text-red-500 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

/** The dossier's free notes, above the acts (spec §6). */
export function DossierNotesSection({ notes, onRemove }: Props) {
  if (notes.length === 0) return null;
  return (
    <section
      aria-labelledby="dossier-notes-heading"
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 md:p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
    >
      <h3 id="dossier-notes-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        Note ({notes.length})
      </h3>
      <ul className="space-y-2">
        {notes.map((note) => (
          <NoteRow key={note.id} note={note} onRemove={() => onRemove(note)} />
        ))}
      </ul>
    </section>
  );
}
