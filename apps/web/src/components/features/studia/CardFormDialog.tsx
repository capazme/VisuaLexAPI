import { useRef, useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Toast } from '../../ui/Toast';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { CardForm, type CardFormMode } from './CardForm';
import { Sheet } from '../../ui/Sheet';

export interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: CardFormMode;
  /** Called with the card's id once it is saved; the dialog then closes itself. */
  onSaved: (id: string) => void;
}

/**
 * The card form in its dialog: a `Modal` on desktop, a bottom sheet on a phone. Esc does not close
 * it (a stray key would drop what was typed); «Annulla» and the X do. It closes itself
 * after a save and says «Scheda salvata» from a toast of its own, which outlives the dialog: keep
 * the component mounted and drive it with `open`.
 */
export function CardFormDialog({ open, onClose, mode, onSaved }: CardFormDialogProps) {
  const desktop = useIsDesktop();
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const [saved, setSaved] = useState(false);

  const title = mode.kind === 'create' ? 'Nuova scheda' : 'Modifica scheda';
  const handleSaved = (id: string) => {
    setSaved(true);
    onSaved(id);
    onClose();
  };
  // The form is built only while the dialog is open, so each opening starts from its mode.
  const form = (
    <CardForm
      key={mode.kind === 'edit' ? mode.card.id : 'new'}
      mode={mode}
      onSaved={handleSaved}
      onCancel={onClose}
      initialFocusRef={initialFocusRef}
    />
  );

  return (
    <>
      {desktop ? (
        <Modal isOpen={open} onClose={onClose} title={title} size="lg" closeOnBackdrop={false} closeOnEscape={false} initialFocusRef={initialFocusRef} contentClassName="flex min-h-0 flex-col overflow-hidden p-0">
          {open ? form : null}
        </Modal>
      ) : (
        open && <Sheet title={title} onClose={onClose} initialFocusRef={initialFocusRef}>{form}</Sheet>
      )}
      {/* The toast's own box is fixed; this layer lifts it above the overlays, as `SyncErrorToast` does. */}
      <div className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
        <Toast message="Scheda salvata" type="success" isVisible={saved} onClose={() => setSaved(false)} />
      </div>
    </>
  );
}
