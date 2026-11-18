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
 * back to the command. The reader keeps its window (`CardFormDialog`).
 */
export function CardFormPanel({ mode, onClose, onSaved, id, className }: CardFormPanelProps) {
  // The form stays drawn while the space closes: the closing shows it, not an empty box.
  const [shown, setShown] = useState(mode);
  if (mode && mode !== shown) setShown(mode);
  const headingId = useId();

  return (
    <Expand id={id} open={mode !== null} onClose={onClose} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER, className)}>
      {/* Closed, `Expand` draws nothing: opened again, the fields start from the mode as it is. */}
      {shown && (
        <>
          <h2 id={headingId} className="px-4 pt-4 text-base font-semibold text-slate-900 md:px-6 md:pt-5 dark:text-slate-50">
            {shown.kind === 'edit' ? 'Modifica scheda' : 'Nuova scheda'}
          </h2>
          <CardForm key={shown.kind === 'edit' ? shown.card.id : 'new'} mode={shown} onSaved={onSaved} onCancel={onClose} />
        </>
      )}
    </Expand>
  );
}
