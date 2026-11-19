import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cn } from '../../lib/utils';
import { ISLAND_OPEN, MENU_FADE, REPEAT_CLOSE, REPEAT_OPEN } from '../../lib/motion';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';

/** Web Animations here (jsdom has none): without them it opens and closes at once. */
/** The closing fade reduced motion keeps, as `index.css` gives every opacity change: the menus' own (150 ms, linear). */
const REDUCED_FADE = MENU_FADE;
const canAnimate = () => typeof Element.prototype.animate === 'function';
const REPEAT = { open: REPEAT_OPEN, close: REPEAT_CLOSE };

// Clipped only while its height moves, and on the height alone (`clip`, no scroll container): at rest nothing is cut, a
// focus ring at its edges, a sticky toolbar inside it, a gloss's margin at the side.
const clip = (el: HTMLElement) => el.style.setProperty('overflow-y', 'clip');
const unclip = (el: HTMLElement) => el.style.removeProperty('overflow-y');

export interface ExpandProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  /** For the command's `aria-controls`; the command itself carries `aria-expanded={open}`. */
  id?: string;
  open: boolean;
  /** Esc inside it. */
  onClose?: () => void;
  /** What takes the focus on opening, never a text, number or date field (LC105); else the space itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Closed, its content stays drawn, `hidden`: what it reads is read once, before the first opening (LC105). */
  keepMounted?: boolean;
  /** Open, its height follows its content (default). Off where the content changes at a key (⌘K's band, LC129): it changes at once. */
  followContent?: boolean;
  /** Its two ways' times: a repeated action's by default (`REPEAT_OPEN`, `REPEAT_CLOSE`); ⌘K's band its island's. Given, they are the fades' under reduced motion too (LC133). */
  timing?: { open: KeyframeAnimationOptions; close: KeyframeAnimationOptions };
  children: ReactNode;
}

/**
 * «Lo spazio che si apre» (LC77, L-73): a part of the page that grows in height under what opened it and pushes the
 * rest down, never over it — no portal, no `fixed`. Its content fades in. It opens in 200 ms on the drawer's curve
 * (`REPEAT_OPEN`) and closes in 150 ms ease-out (`REPEAT_CLOSE`): a repeated action under the frequency rule (LC132; it
 * was the island's 280/220); a change of mind halfway turns back from where the height and the fade are. Under reduced
 * motion only the fade remains, on its own times (below).
 *
 * On opening the focus goes to the space itself (`tabIndex={-1}`), or to `initialFocusRef`: never by itself into a
 * field, whose keyboard would rise over the page on a phone (LC105). On closing it goes back to what opened it. Esc
 * inside closes it.
 */
export function Expand({ id, open, onClose, initialFocusRef, keepMounted = false, followContent = true, timing: given, className, children, onKeyDown, ...rest }: ExpandProps) {
  // Still drawn while it closes; derived during render where no animation will run (react-hooks/set-state-in-effect).
  const ways = given ?? REPEAT;
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
      const target = initialFocusRef?.current ?? outer;
      // The page does not jump to a space that is still a line high.
      target?.focus({ preventScroll: true });
    } else if (!open) {
      const active = document.activeElement;
      const opener = openerRef.current;
      if (opener?.isConnected && (active === document.body || active === null || outer?.contains(active))) opener.focus({ preventScroll: true });
    }

    // Brought into view from its start, clear of what sticks above it (its `scroll-margin-top`, the scroller's padding),
    // while it still has its natural height: a page scrolled down would leave its title under a sticky heading. Only if
    // it would leave the view (`nearest`), and at once (LC132: the browser's smooth scroll took 450–500 ms each time).
    const reveal = () => outer?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    if (initial || !outer || !inner || !canAnimate()) {
      if (open && !initial) reveal();
      return;
    }
    // Closed already (kept mounted and hidden, the effect run again by StrictMode): there is nothing to close.
    if (!open && outer.hidden) return;
    // Where the last movement is now, read before it is cancelled: the new one starts there.
    const moving = running.current.length > 0;
    const fromHeight = moving ? outer.getBoundingClientRect().height : open ? 0 : outer.offsetHeight;
    const fromOpacity = moving ? Number(getComputedStyle(inner).opacity) : open ? 0 : 1;
    running.current.forEach((a) => a.cancel());
    running.current = [];
    // A height a growth held (below) gives way to this movement, read above.
    outer.style.removeProperty('height');
    clip(outer);
    if (open) reveal();

    // Under reduced motion the closing is the app's own fade (`index.css`: 150 ms): the island's 220 ms ease-out had the
    // content gone in a third of it and the space standing empty for the rest, read as a delay (Papiniano, #599). The
    // opening keeps the island's time: a shorter fade there showed a row's late content settling (46 px in Fonti).
    // With motion, the frequency rule's times (LC132); times given by the owner (⌘K's) hold for the fade too (LC133).
    const reduced = prefersReducedMotion();
    const timing = reduced && !given ? (open ? ISLAND_OPEN : REDUCED_FADE) : open ? ways.open : ways.close;
    const fill: FillMode = open ? 'none' : 'forwards';
    const fade = inner.animate([{ opacity: fromOpacity }, { opacity: open ? 1 : 0 }], { ...timing, fill });
    const anims = [fade];
    heightAnim.current = null;
    if (!reduced) {
      // Opening ends on its natural height (none held in pixels): the content may still grow, a tree arriving late.
      const toHeight = open ? outer.offsetHeight : 0;
      heightAnim.current = outer.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], { ...timing, fill });
      anims.push(heightAnim.current);
    }
    running.current = anims;
    const last = anims[anims.length - 1];
    last.onfinish = () => {
      if (running.current !== anims) return;
      // Kept mounted, the closing's fill holds the space at no height until the next opening starts from it and cancels it.
      if (open || !keepMounted) running.current = [];
      if (open) unclip(outer);
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
    if (!open || !followContent || !outer || !inner || typeof ResizeObserver === 'undefined' || !canAnimate()) return undefined;
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
      clip(outer);
      const grow = outer.animate([{ height: `${from}px` }, { height: `${next}px` }], ways.open);
      heightAnim.current = grow;
      const anims = [...running.current.filter((a) => a !== replaced), grow];
      running.current = anims;
      grow.onfinish = () => {
        if (heightAnim.current === grow) {
          outer.style.removeProperty('height');
          unclip(outer);
        }
        if (running.current === anims) running.current = [];
      };
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [open, followContent, ways]);

  if (!mounted && !keepMounted) return null;

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
      tabIndex={-1}
      {...rest}
      ref={outerRef}
      id={id}
      // Closing, it is going: no longer read, no longer reached.
      inert={!open}
      aria-hidden={open ? undefined : true}
      hidden={!mounted}
      onKeyDown={handleKeyDown}
      className={cn('focus:outline-none', className)}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
