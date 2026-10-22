import { useEffect, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject, type TransitionEvent } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/utils';

/**
 * «La tendina» (U1a): a panel that opens in place and pushes what follows down — no window, no veil. Its height grows
 * by `grid-template-rows` from `0fr` to `1fr` (no height measured in script) over 200 ms on the app's ease-out, its
 * content fading in over 150 ms just after; it closes faster, in 150 ms. Under reduced motion it opens and closes at
 * once: no height moves, and the content does not fade. Closed, it is `inert` and hidden from a reader, and
 * `visibility: hidden` once its height has gone; open and still, its content may overflow its edges (a menu, a focus
 * ring), clipped only while the height moves. Esc inside it closes it and gives the focus back to its trigger.
 *
 * The trigger is the caller's: a button with `aria-expanded={open}` and `aria-controls={id}`. Closed, it is still a
 * box of no height: in a parent with `gap-*` or `space-y-*` it keeps its gap, so it goes in a plain wrapper with what
 * it opens under.
 */
export interface CollapsibleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  id: string;
  open: boolean;
  /** Esc inside it. */
  onClose?: () => void;
  /** The button that opens it, to give the focus back to on Esc. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** The content's own box (its border, its padding). */
  contentClassName?: string;
  children: ReactNode;
}

export function Collapsible({ id, open, onClose, triggerRef, className, contentClassName, children, onKeyDown, onTransitionEnd, ...rest }: CollapsibleProps) {
  const reduce = useReducedMotion() ?? false;
  // Whether the height has reached the state asked for, derived during render (react-hooks/set-state-in-effect).
  const [settled, setSettled] = useState({ open, done: true });
  if (settled.open !== open) setSettled({ open, done: false });
  const still = reduce || settled.done;
  // Some changes end with no `transitionend` (an ancestor not displayed, a change undone within a frame): a little after
  // the longest transition the height is taken as still all the same, or its content would stay clipped.
  useEffect(() => {
    if (settled.done) return undefined;
    const timer = window.setTimeout(() => setSettled({ open, done: true }), 260);
    return () => window.clearTimeout(timer);
  }, [open, settled.done]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Escape' || !onClose) return;
    // A dialog portaled from inside it (a confirmation, a sheet) sends its Esc up the React tree: that Esc is the
    // dialog's, never the panel's.
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.stopPropagation();
    onClose();
    triggerRef?.current?.focus();
  };
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    onTransitionEnd?.(event);
    if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows') setSettled({ open, done: true });
  };

  return (
    <div
      {...rest}
      id={id}
      aria-hidden={open ? undefined : true}
      inert={!open}
      onKeyDown={handleKeyDown}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        // `visibility` moves only as it closes (hidden once the height has gone); opening, it is visible at once, so a
        // focus given in the next frame lands.
        'grid ease-out',
        open ? 'grid-rows-[1fr] transition-[grid-template-rows] duration-200' : 'invisible grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-150',
        className,
      )}
    >
      <div className={cn('min-h-0', open && still ? 'overflow-visible' : 'overflow-hidden')}>
        <div
          className={cn(
            'transition-opacity',
            open ? 'opacity-100 delay-50 duration-150' : 'opacity-0 duration-100',
            // Under reduced motion the content never fades (the global rule would give its opacity 150 ms, after the
            // delay): the panel is there at once, and closed `visibility` hides it.
            'motion-reduce:opacity-100 motion-reduce:delay-0',
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
