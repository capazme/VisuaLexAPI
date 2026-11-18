import { useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { openerNow } from './islandMotion';

export interface ConfirmDialogProps {
  open: boolean;
  variant?: 'default' | 'danger';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Start the focus on «Annulla», where an Enter pressed at once must not act (the Forum's «Segnala», #449). */
  focusCancel?: boolean;
}

/**
 * A confirmation that grows out of the control that asked for it and goes back into it (`IslandSurface`, LC85): the
 * one focused as it opens, else the one last pressed (Safari and a tap focus no button).
 */
export function ConfirmDialog({
  open,
  variant = 'default',
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  onConfirm,
  onCancel,
  focusCancel = false,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const Icon = variant === 'danger' ? AlertTriangle : Info;
  // The control, kept from the render that opens it: a menu's entry is gone by the time the dialog grows.
  const [wasOpen, setWasOpen] = useState(false);
  const [from, setFrom] = useState<HTMLElement | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setFrom(openerNow());
  }

  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      role="alertdialog"
      size="sm"
      variant={variant === 'danger' ? 'danger' : 'info'}
      icon={<Icon size={20} />}
      title={title}
      description={message}
      showCloseButton={false}
      initialFocusRef={focusCancel ? cancelRef : confirmRef}
      growFrom={from}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
