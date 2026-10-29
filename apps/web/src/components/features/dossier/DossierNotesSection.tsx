import { useState } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { DossierItem } from '../../../types';
import { formatTimestampLong } from './dossierUtils';
import { AiNoteEntryReview } from './AiNoteEntryReview';
import { hasAssistantNote } from '../../../utils/aiReview';
import { FOCUS_RING } from '../studia/progress/tokens';
import { ROW, ROW_LINE, ROW_REMOVE, ROW_TITLE, SECTION_COUNT, SECTION_HEADING, SECTION_TILE } from './dossierStyles';

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
  const words = (
    <p className={cn(ROW_TITLE, 'whitespace-pre-wrap [overflow-wrap:anywhere]', long && !open && 'line-clamp-3')}>
      {note.data}
    </p>
  );
  // The grey line: when; under the words, never beside them, so a phone's narrow row keeps the note's width. Who wrote
  // it is not drawn (D7b): an application's note says it by its validation; the data and the PDF keep it.
  const meta = (
    <p className={cn(ROW_LINE, 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1')}>
      <span>{formatTimestampLong(note.addedAt)}</span>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn('-my-3 min-h-[44px] rounded px-1 font-medium text-amber-800 hover:underline dark:text-amber-300', FOCUS_RING)}
        >
          {open ? 'Mostra meno' : 'Mostra tutto'}
        </button>
      )}
    </p>
  );
  // A note an application wrote has its state and its own bin among the controls under it (D7b).
  if (hasAssistantNote(note)) {
    return (
      <li className={cn(ROW, 'pl-1 pr-1')}>
        <div className="min-w-0 py-2.5">
          <AiNoteEntryReview note={note} meta={meta} onRemove={onRemove}>{words}</AiNoteEntryReview>
        </div>
      </li>
    );
  }
  return (
    <li className={cn(ROW, 'flex items-start gap-1 pl-1')}>
      <div className="min-w-0 flex-1 py-2.5">
        {words}
        {meta}
      </div>
      <button type="button" onClick={onRemove} aria-label="Rimuovi nota" className={ROW_REMOVE}>
        <Trash2 size={15} aria-hidden />
      </button>
    </li>
  );
}

/**
 * The dossier's free notes, above the acts (spec §6), as the planner's rows (S7c): the words, a grey line under them,
 * the removal at the right, 44 px; in a tile like the acts', its heading in the reader's serif with the note's colour.
 */
export function DossierNotesSection({ notes, onRemove }: Props) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="dossier-notes-heading" className={cn(SECTION_TILE, 'px-3 pb-1 pt-3 md:px-4')}>
      <h2 id="dossier-notes-heading" className={cn(SECTION_HEADING, 'flex items-center gap-2')}>
        <StickyNote size={16} aria-hidden className="text-amber-600 dark:text-amber-400" />
        Note <span className={SECTION_COUNT}>({notes.length})</span>
      </h2>
      <ul className="mt-1">
        {notes.map((note) => (
          <NoteRow key={note.id} note={note} onRemove={() => onRemove(note)} />
        ))}
      </ul>
    </section>
  );
}
