import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { NoteDraftField } from './MarginCards';

export interface NoteComposerSheetProps {
  /** The words the new note is on. */
  text: string;
  /** What is written in it: kept by the column, so it survives the move to a card and back. */
  value: string;
  onChange: (text: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}

/**
 * The editor of a new note where the reader has no room for the column beside the text — a phone, a narrow window
 * (A4 §6): a sheet from the bottom with the words and the field. Its X asks before dropping a text written, as
 * «Annulla» does.
 */
export function NoteComposerSheet({ text, value, onChange, onSave, onCancel }: NoteComposerSheetProps) {
  const [asking, setAsking] = useState(false);
  return (
    <Sheet
      title="Nuova nota"
      // A text written is not lost to the X: the field asks first («Scartare la modifica?»), as its «Annulla» does.
      onClose={() => (value.trim() ? setAsking(true) : onCancel())}
      className="sm:mx-auto sm:max-w-lg"
    >
      <div className="space-y-2 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <p className="line-clamp-3 font-serif text-[15px] italic text-amber-800 dark:text-amber-300">&ldquo;{text}&rdquo;</p>
        <NoteDraftField value={value} onChange={onChange} onSave={onSave} onCancel={onCancel} confirmDiscard={asking} onKeep={() => setAsking(false)} />
      </div>
    </Sheet>
  );
}
