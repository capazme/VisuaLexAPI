import { useId, useState } from 'react';
import { Expand } from '../../ui/Expand';
import { CARD_RADIUS, CONTROL_BORDER } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { CardForm, type CardFormMode } from './CardForm';

export interface CardFormPanelProps {
  /** The form's mode while it is open; null, closed. */
  mode: CardFormMode | null;
  onClose: () => void;
  /** Called with the card's id once it is saved; the caller closes the panel and says «Scheda salvata». */
  onSaved: (id: string) => void;
  /** For the command's `aria-controls`. */
  id?: string;
  className?: string;
}

/**
 * The card's form in the page (LC112, L-73), as «Modifica pratica» (LC107): a space that opens under what asked for it
 * (`Expand`), never over the content. The focus lands on the space, not on a field; Esc closes it and the focus goes
 * back to the command. Closed without a save (Esc, «Annulla»), the form stays drawn and hidden: opened again, what
 * was typed is still there (as the glosses' draft, #570); a save starts the next one empty. The reader keeps its window (`CardFormDialog`).
 */
export function CardFormPanel({ mode, onClose, onSaved, id, className }: CardFormPanelProps) {
  // The form stays drawn while the space closes: the closing shows it, not an empty box.
  const [shown, setShown] = useState(mode);
  if (mode && mode !== shown) setShown(mode);
  const headingId = useId();
  // A save ends the draft: the next opening starts from the mode again.
  const [saves, setSaves] = useState(0);
  const saved = (cardId: string) => {
    setSaves((n) => n + 1);
    onSaved(cardId);
  };

  return (
    <Expand id={id} open={mode !== null} onClose={onClose} keepMounted role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      {/* Kept drawn while closed (`keepMounted`): the draft waits for the next opening. */}
      {shown && (
        <>
          <h2 id={headingId} className="px-4 pt-4 text-base font-semibold text-slate-900 md:px-6 md:pt-5 dark:text-slate-50">
            {shown.kind === 'edit' ? 'Modifica scheda' : 'Nuova scheda'}
          </h2>
          <CardForm key={`${shown.kind === 'edit' ? shown.card.id : 'new'}-${saves}`} mode={shown} onSaved={saved} onCancel={onClose} />
        </>
      )}
    </Expand>
  );
}
