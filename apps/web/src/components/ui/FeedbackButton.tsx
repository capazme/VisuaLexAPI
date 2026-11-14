import { Button } from './Button';
import { cn } from '../../lib/utils';

interface FeedbackButtonProps {
  className?: string;
  /** Opens the form, which `Layout` holds: the user menu's «Commenti» opens it on a phone (M1). */
  onOpen: () => void;
}

/** «Commenti», a word at the top right beside «Tutto schermo» (D-253). `Layout` places it and keeps the pages' top rows clear of it. */
export function FeedbackButton({ className, onOpen }: FeedbackButtonProps) {
  return (
    // 44 px tall, as «Tutto schermo» beside it, and the touch target.
    <Button type="button" variant="secondary" onClick={onOpen} className={cn('h-11 shadow-sm', className)}>
      Commenti
    </Button>
  );
}
