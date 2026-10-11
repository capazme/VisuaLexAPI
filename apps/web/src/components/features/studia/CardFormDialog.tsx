import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FloatingFocusManager, FloatingPortal, useFloating, useInteractions, useRole } from '@floating-ui/react';
import { X } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Toast } from '../../ui/Toast';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { CardForm, type CardFormMode } from './CardForm';

export interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: CardFormMode;
  /** Called with the card's id once it is saved; the dialog then closes itself. */
  onSaved: (id: string) => void;
}

interface SheetProps {
  title: string;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/** A phone's bottom sheet, after `AddToDossierPopover`'s: a backdrop, the sheet, the focus kept inside. */
function Sheet({ title, onClose, initialFocusRef, children }: SheetProps) {
  // Neither Esc nor a press outside dismisses it: closing is «Annulla», the X, or a save.
  const { refs, context } = useFloating({ open: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([role]);

  // The page behind does not scroll under the sheet, as under `Modal`.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  return (
    <FloatingPortal>
      <div className={cn('fixed inset-0 bg-slate-900/40 motion-safe:animate-in motion-safe:fade-in duration-150', Z_INDEX.modal)} aria-hidden />
      <FloatingFocusManager context={context} modal initialFocus={initialFocusRef}>
        <div
          // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
          ref={refs.setFloating}
          {...getFloatingProps()}
          aria-label={title}
          className={cn(
            'fixed inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-2xl border border-b-0',
            'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
            'motion-safe:animate-in motion-safe:slide-in-from-bottom duration-200',
            Z_INDEX.modal,
          )}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
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
