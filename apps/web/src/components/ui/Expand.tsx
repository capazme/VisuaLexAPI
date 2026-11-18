import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/utils';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';

/** Web Animations here (jsdom has none): without them it opens and closes at once. */
/** The closing fade reduced motion keeps, as `index.css` gives every opacity change. */
const REDUCED_FADE = { duration: 150, easing: 'linear' } as const;
const canAnimate = () => typeof Element.prototype.animate === 'function';

const FIELD = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"]';
const FOCUSABLE = `${FIELD}, button, a[href], [tabindex]:not([tabindex="-1"])`;

export interface ExpandProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  /** For the command's `aria-controls`; the command itself carries `aria-expanded={open}`. */
  id?: string;
  open: boolean;
  /** Esc inside it. */
  onClose?: () => void;
  /** What takes the focus on opening; else its first field, else its first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * «Lo spazio che si apre» (LC77, L-73): a part of the page that grows in height under what opened it and pushes the
 * rest down, never over it — no portal, no `fixed`. Its content fades in. Opening takes the island's time and curve
 * (`ISLAND_OPEN`, 280 ms on the drawer's curve), closing the island's other (`ISLAND_CLOSE`, 220 ms ease-out); a change
 * of mind halfway turns back from where the height and the fade are. Under reduced motion only the fade remains.
 *
 * On opening the focus goes to its first field; on closing it goes back to what opened it. Esc inside closes it.
 */
export function Expand({ id, open, onClose, initialFocusRef, className, children, onKeyDown, ...rest }: ExpandProps) {
  // Still drawn while it closes; derived during render where no animation will run (react-hooks/set-state-in-effect).
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!open && mounted && !canAnimate()) setMounted(false);

  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  // The height's own animation among them, for the content's later growth to take over.
  const heightAnim = useRef<Animation | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const initial = first.current;
    first.current = false;

    // Drawn already open (a page that opens on its last article, LC86), it takes no focus: the focus follows an opening.
    if (open && !initial) {
      const active = document.activeElement;
      if (!(outer?.contains(active))) openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      const target = initialFocusRef?.current ?? inner?.querySelector<HTMLElement>(FIELD) ?? inner?.querySelector<HTMLElement>(FOCUSABLE);
      // The page does not jump to a field that is still a line high.
      target?.focus({ preventScroll: true });
    } else if (!open) {
      const active = document.activeElement;
      const opener = openerRef.current;
      if (opener?.isConnected && (active === document.body || active === null || outer?.contains(active))) opener.focus({ preventScroll: true });
    }

    // Brought into view from its start, clear of what sticks above it (its `scroll-margin-top`, the scroller's padding),
    // while it still has its natural height: a page scrolled down would leave its title under a sticky heading.
    const reveal = () => outer?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (initial || !outer || !inner || !canAnimate()) {
      if (open && !initial) reveal();
      return;
    }
    // Where the last movement is now, read before it is cancelled: the new one starts there.
    const moving = running.current.length > 0;
    const fromHeight = moving ? outer.getBoundingClientRect().height : open ? 0 : outer.offsetHeight;
    const fromOpacity = moving ? Number(getComputedStyle(inner).opacity) : open ? 0 : 1;
    running.current.forEach((a) => a.cancel());
    running.current = [];
    // A height a growth held (below) gives way to this movement, read above.
    outer.style.removeProperty('height');
    if (open) reveal();

    // Under reduced motion the closing is the app's own fade (`index.css`: 150 ms): the island's 220 ms ease-out had the
    // content gone in a third of it and the space standing empty for the rest, read as a delay (Papiniano, #599). The
    // opening keeps the island's time: a shorter fade there showed a row's late content settling (46 px in Fonti).
    const timing = open ? ISLAND_OPEN : prefersReducedMotion() ? REDUCED_FADE : ISLAND_CLOSE;
    const fill: FillMode = open ? 'none' : 'forwards';
    const fade = inner.animate([{ opacity: fromOpacity }, { opacity: open ? 1 : 0 }], { ...timing, fill });
    const anims = [fade];
    heightAnim.current = null;
    if (!prefersReducedMotion()) {
      // Opening ends on its natural height (none held in pixels): the content may still grow, a tree arriving late.
      const toHeight = open ? outer.offsetHeight : 0;
      heightAnim.current = outer.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], { ...timing, fill });
      anims.push(heightAnim.current);
    }
    running.current = anims;
    const last = anims[anims.length - 1];
    last.onfinish = () => {
      if (running.current !== anims) return;
      running.current = [];
      if (!open) setMounted(false);
    };
    // `initialFocusRef` is a ref: reading it at the change is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Open, the content may still change height (a tree arriving after the first measure, a filter): the space follows
  // it on the opening's timing, from where it is, instead of jumping.
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!open || !outer || !inner || typeof ResizeObserver === 'undefined' || !canAnimate()) return undefined;
    let last = inner.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      if (Math.abs(next - last) < 1 || prefersReducedMotion()) {
        last = next;
        return;
      }
      // Moving, the space is where its animation is; at rest it already took the new height in this layout (the
      // observer runs after it, before the paint): it starts from the height it had, or the text arriving late jumps.
      const moving = heightAnim.current !== null && running.current.includes(heightAnim.current);
      const from = moving ? outer.getBoundingClientRect().height : last;
      last = next;
      const replaced = heightAnim.current;
      replaced?.cancel();
      // An animation started here applies from the next frame: this frame, already styled, would be painted at the new
      // height. The space is held where it was until the animation takes over.
      outer.style.height = `${from}px`;
      const grow = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], ISLAND_OPEN);
      heightAnim.current = grow;
      const anims = [...running.current.filter((a) => a !== replaced), grow];
      running.current = anims;
      grow.onfinish = () => {
        if (heightAnim.current === grow) outer.style.removeProperty('height');
        if (running.current === anims) running.current = [];
      };
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [open]);

  if (!mounted) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Escape' || !onClose) return;
    // A dialog portalled from inside it sends its Esc up the React tree: that Esc is the dialog's.
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    // An open discussion panel or citation preview closes on Esc at the document: this one is the space's.
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      {...rest}
      ref={outerRef}
      id={id}
      // Closing, it is going: no longer read, no longer reached.
      inert={!open}
      aria-hidden={open ? undefined : true}
      onKeyDown={handleKeyDown}
      className={cn('overflow-hidden', className)}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
