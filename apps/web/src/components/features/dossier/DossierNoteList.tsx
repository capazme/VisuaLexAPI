import { StickyNote, Trash2 } from 'lucide-react';
import type { DossierItem } from '../../../types';
import { hasAssistantNote } from '../../../utils/aiReview';
import { AiNoteEntryReview } from './AiNoteEntryReview';
import { formatTimestampLong } from './dossierUtils';
import { ROW_REMOVE } from './dossierStyles';
import { IconButton } from '../../ui/IconButton';
import { useNoteRemovalFocus } from './useNoteRemovalFocus';
import { NoteText } from './NoteText';

type NoteItem = Extract<DossierItem, { type: 'note' }>;

/**
 * The dossier's notes about an article (spec §6), as «Fonti» lists them under its row and «Lettura» under the text
 * (LC58): the words, when, and the bin; a note an application wrote has its state, the pencil and its bin (D7b).
 */
export function DossierNoteList({ notes, onRemoveNote }: { notes: NoteItem[]; onRemoveNote?: (note: NoteItem) => void }) {
  const { register, remove } = useNoteRemovalFocus(notes, onRemoveNote);

  return notes.map((note) => {
    const words = <NoteText note={note} className="text-sm text-slate-800 dark:text-slate-200" />;
    const meta = (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>{formatTimestampLong(note.addedAt)}</span>
      </div>
    );
    const reviewed = hasAssistantNote(note) && onRemoveNote;
    return (
      <div
        key={note.id}
        ref={register(note.id)}
        className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20">
        <StickyNote size={14} aria-hidden className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          {reviewed
            ? <AiNoteEntryReview note={note} meta={meta} onRemove={() => remove(note)}>{words}</AiNoteEntryReview>
            : <>{words}{meta}</>}
        </div>
        {onRemoveNote && !reviewed && (
          <IconButton size="lg" onClick={() => remove(note)} aria-label="Rimuovi nota" className={ROW_REMOVE} icon={<Trash2 aria-hidden />} />
        )}
      </div>
    );
  });
}
