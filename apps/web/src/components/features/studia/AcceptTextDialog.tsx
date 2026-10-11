import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import type { TestoDaAccettare } from '../../../types/studia';
import { TextParagraphs } from './TextParagraphs';

export interface AcceptTextDialogProps {
  /** The server's version of the text: title, body, the checkbox's label and the button's. */
  text: TestoDaAccettare;
  /** Called with the accepted version's id. */
  onAccept: (textId: string) => void;
  onCancel: () => void;
  /** The acceptance is being sent: the button waits. */
  busy?: boolean;
}

/**
 * The one place a text to accept is drawn (the proposal notice now, the simulation's consent later).
 * Every word comes from the version it is given. The button stays disabled until the box is ticked; a
 * new version replacing the one shown comes with the box unticked, because the tick was for the old
 * words, takes the focus back to the box (the button it was on is now disabled) and says so in a
 * polite live region.
 */
export function AcceptTextDialog({ text, onAccept, onCancel, busy = false }: AcceptTextDialogProps) {
  // The tick belongs to a version: a different one shows it unticked, with no effect to reset it.
  const [tickedFor, setTickedFor] = useState<string | null>(null);
  const ticked = tickedFor === text.id;
  const checkboxId = useId();
  const checkboxRef = useRef<HTMLInputElement>(null);
  // A version that replaces the one first shown (never the first render): focus and a note, once.
  const [shownId, setShownId] = useState(text.id);
  const [replaced, setReplaced] = useState(false);
  if (shownId !== text.id) {
    setShownId(text.id);
    setReplaced(true);
  }
  useEffect(() => {
    if (replaced) checkboxRef.current?.focus();
  }, [text.id, replaced]);

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={text.titolo}
      size="md"
      showCloseButton={false}
      initialFocusRef={checkboxRef}
      footer={
        <>
          <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={onCancel}>
            Annulla
          </Button>
          <Button size="sm" className="min-h-[44px] md:min-h-0" disabled={!ticked || busy} onClick={() => onAccept(text.id)}>
            {text.azione}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <TextParagraphs body={text.corpo} />
      </div>
      {/* Always in the page, so the note is announced when it appears. */}
      <div role="status" aria-live="polite" className={replaced ? 'mt-4 text-sm font-medium text-amber-700 dark:text-amber-300' : 'sr-only'}>
        {replaced ? 'Il testo è cambiato nel frattempo: rileggilo e conferma.' : ''}
      </div>
      <div className="mt-5 flex items-start gap-3">
        <input
          ref={checkboxRef}
          id={checkboxId}
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTickedFor(e.target.checked ? text.id : null)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        />
        <label htmlFor={checkboxId} className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {text.conferma}
        </label>
      </div>
    </Modal>
  );
}
