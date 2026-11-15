import { useRef } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

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
