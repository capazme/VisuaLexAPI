import { useLayoutEffect, useState } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { DossierItem } from '../../../types';
import { formatTimestampLong } from './dossierUtils';
import { AiNoteEntryReview } from './AiNoteEntryReview';
import { hasAssistantNote } from '../../../utils/aiReview';
import { FOCUS_RING } from '../studia/progress/tokens';
import { useNoteRemovalFocus } from './useNoteRemovalFocus';
import { NOTE_FOLDED_EM, NoteText } from './NoteText';
import { ROW, ROW_LINE, ROW_REMOVE, ROW_TITLE, SECTION_COUNT, SECTION_HEADING, SECTION_TILE } from './dossierStyles';

type NoteItem = Extract<DossierItem, { type: 'note' }>;

interface Props {
  notes: NoteItem[];
  onRemove: (item: DossierItem) => void;
}

// A user's note longer than this, or of more than three lines, is shown folded.
const FOLD_AT = 240;
const isLong = (text: string) => text.length > FOLD_AT || text.split('\n').length > 3;

/**
 * Whether an application's note, drawn, is taller than its folded box (D4): measured on its box, again as its width or
 * its words change. Its Markdown's height cannot be counted from its characters.
 */
function useTallerThanFolded(text: string, measure: boolean) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [taller, setTaller] = useState(false);
  useLayoutEffect(() => {
    if (!measure || !box) return;
    // 15 px, the row's size, where no style is computed (tests).
    const check = () => setTaller(box.scrollHeight > (parseFloat(getComputedStyle(box).fontSize) || 15) * NOTE_FOLDED_EM + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, measure, text]);
  return [setBox, taller] as const;
}

function NoteRow({ note, onRemove, rowRef }: { note: NoteItem; onRemove: () => void; rowRef: (el: HTMLElement | null) => void }) {
  const [open, setOpen] = useState(false);
  const fromApp = !!note.createdBy;
  const [boxRef, taller] = useTallerThanFolded(note.data, fromApp);
  const long = fromApp ? taller : isLong(note.data);
  const words = <NoteText note={note} className={ROW_TITLE} folded={long && !open} boxRef={boxRef} />;
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
      <li ref={rowRef} className={cn(ROW, 'pl-1 pr-1')}>
        <div className="min-w-0 py-2.5">
          <AiNoteEntryReview note={note} meta={meta} onRemove={onRemove}>{words}</AiNoteEntryReview>
        </div>
      </li>
    );
  }
  return (
    <li ref={rowRef} className={cn(ROW, 'flex items-start gap-1 pl-1')}>
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
  // A note removed from the keyboard hands the focus on (LC61), never to the body.
  const focus = useNoteRemovalFocus(notes, onRemove);
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="dossier-notes-heading" className={cn(SECTION_TILE, 'px-3 pb-1 pt-3 md:px-4')}>
      <h2 id="dossier-notes-heading" className={cn(SECTION_HEADING, 'flex items-center gap-2')}>
        <StickyNote size={16} aria-hidden className="text-amber-600 dark:text-amber-400" />
        Note <span className={SECTION_COUNT}>({notes.length})</span>
      </h2>
      <ul className="mt-1">
        {notes.map((note) => (
          <NoteRow key={note.id} note={note} rowRef={focus.register(note.id)} onRemove={() => focus.remove(note)} />
        ))}
      </ul>
    </section>
  );
}
