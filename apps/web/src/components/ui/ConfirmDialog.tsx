import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { originOf } from './islandMotion';
import type { IslandSource } from './IslandSurface';

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
  /**
   * The control that asked for it (`event.currentTarget`, or a menu's trigger): the card grows out of it and the focus
   * goes back to it. Required, so no caller forgets it; null only where nothing on screen asked (a key, a route).
   */
  origin: HTMLElement | null;
  /** Where the focus goes once it closes when `origin` is gone or disabled (busy): the row, its title; never the body. */
  focusBack?: () => HTMLElement | null | undefined;
}

/**
 * A confirmation that grows out of the control that asked for it and goes back into it (`IslandSurface`, LC85): its
 * `origin`, or the rectangle that control had as it opened (`originOf`).
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
  origin,
  focusBack,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const Icon = variant === 'danger' ? AlertTriangle : Info;
  // The control, kept from the render that opens it: a menu's entry is gone by the time the dialog grows.
  const [wasOpen, setWasOpen] = useState(false);
  const [from, setFrom] = useState<{ el: HTMLElement | null; source: IslandSource }>({ el: null, source: null });
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setFrom({ el: origin, source: originOf(origin) });
  }
  const focusBackRef = useRef(focusBack);
  useEffect(() => {
    focusBackRef.current = focusBack;
  });
  // Closed: the focus goes back to the control, or to `focusBack` where the control is gone or busy. After `Modal`'s own
  // return (an effect of a child, run first), which goes to what had the focus as it opened: the body, after a click
  // that focused nothing. Once per real closing.
  const closing = useRef(false);
  useEffect(() => {
    if (open) {
      closing.current = true;
      return;
    }
    if (!closing.current) return;
    closing.current = false;
    const el = from.el;
    const back = el?.isConnected && !(el as HTMLButtonElement).disabled ? el : focusBackRef.current?.();
    back?.focus({ preventScroll: true });
  }, [open, from]);

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
      growFrom={from.source}
      cardCorners
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
