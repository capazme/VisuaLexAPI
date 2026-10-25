import { useContext, useState, type ReactNode } from 'react';
import type { AssistantNoteEntry, DossierItem } from '../../../types';
import { AiReviewControls } from '../search/AiReviewControls';
import { NoteEditBox } from '../search/NoteEditBox';
import { editNoteEntryText, setNoteEntryState } from '../../../store/assistantProposals';
import { CurrentDossierContext } from './currentDossier';

type NoteItem = Extract<DossierItem, { type: 'note' }>;

interface Props {
  note: NoteItem & { assistantNote: AssistantNoteEntry };
  /** The note's words, as its row draws them; the pencil puts the editing box in their place. */
  children: ReactNode;
  /** What the row shows under the words (when, who wrote it), kept while editing. */
  meta?: ReactNode;
  /** The bin: the row's own removal, «Annulla» included. */
  onRemove: () => void;
}

/**
 * A note an application wrote in a dossier (D7b, contract §3): its words, then what the user does with them, as on a
 * proposed passage's note (`AiReviewControls`): validate, flag «Da rivedere», edit with the pencil (the note's own
 * editing box; saving makes it «Validato, modificato da te»), remove.
 */
export function AiNoteEntryReview({ note, children, meta, onRemove }: Props) {
  const dossierId = useContext(CurrentDossierContext);
  const [draft, setDraft] = useState<string | null>(null);
  const review = note.assistantNote;
  if (!dossierId) return <>{children}{meta}</>;
  const commit = () => {
    const text = draft?.trim() ?? '';
    // As a note's: only a changed, non-empty text is saved.
    if (text && text !== note.data) void editNoteEntryText(dossierId, note, text);
    setDraft(null);
  };
  return (
    <>
      {draft !== null
        ? <NoteEditBox value={draft} onChange={setDraft} onCommit={commit} onCancel={() => setDraft(null)} label="Testo della nota" />
        : children}
      {meta}
      <AiReviewControls
        state={review.state}
        edited={review.edited}
        original={review.edited ? review.originalText : null}
        reviewComment={review.reviewComment}
        onValidate={(validated) => void setNoteEntryState(dossierId, note, validated ? 'validated' : 'proposed')}
        onFlag={(flagged) => void setNoteEntryState(dossierId, note, flagged ? 'review' : 'proposed')}
        onReviewComment={(text) => void setNoteEntryState(dossierId, note, 'review', text)}
        onEdit={() => setDraft(note.data)}
        onRemove={onRemove}
        editLabel="Modifica la nota"
        removeLabel="Rimuovi nota"
      />
    </>
  );
}
