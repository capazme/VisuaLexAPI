import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { usePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { MENU_CLOSE, MENU_FADE, MENU_OPEN, MENU_SHIFT } from '../../lib/motion';
import { now, useReducedMotionLive } from './islandMotion';

export interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  /** Opens over its trigger: it comes down towards it instead of up. */
  above?: boolean;
  children: ReactNode;
}

/**
 * A menu's list (LC102, variant A): it appears under its trigger by a fade and a 4 px shift, and leaves the same way,
 * one Web Animation on one element. A change of mind goes on from where the list is. Under reduced motion (read live)
 * it only fades. The confirmations and notifications keep `IslandSurface`. Kept mounted while it closes by
 * `AnimatePresence` (its `usePresence`).
 */
export function MenuSurface({ ref, above = false, className, children, ...rest }: MenuSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const still = useReducedMotionLive();
  const [isPresent, safeToRemove] = usePresence();
  const running = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof root.animate !== 'function') return;
    // Where it is now, a closing or opening under way included, then that animation stopped.
    const was = running.current ? now(root, still ? ['opacity'] : ['opacity', 'transform']) : null;
    running.current?.cancel();
    root.style.pointerEvents = isPresent ? '' : 'none';
    const off = still ? { opacity: 0 } : { opacity: 0, transform: `translateY(${above ? MENU_SHIFT : -MENU_SHIFT}px)` };
    const on = still ? { opacity: 1 } : { opacity: 1, transform: 'none' };
    const timing = still ? MENU_FADE : isPresent ? MENU_OPEN : MENU_CLOSE;
    const animation = root.animate([was ?? (isPresent ? off : on), isPresent ? on : off], { ...timing, fill: isPresent ? 'backwards' : 'forwards' });
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      running.current = null;
      // Open: its own CSS again. Closed: it holds its end until it is removed.
      if (isPresent) animation.cancel();
      else safeToRemove?.();
    };
    // Once per opening and per closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  // No Web Animations (jsdom): gone at once, from a passive effect (`AnimatePresence` ignores a removal from a layout one).
  useEffect(() => {
    if (!isPresent && typeof rootRef.current?.animate !== 'function') safeToRemove?.();
  }, [isPresent, safeToRemove]);

  const setRoot = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  return (
    // Closing, it takes no key and no click.
    <div ref={setRoot} {...rest} inert={!isPresent || undefined} className={cn(className)}>
      {children}
    </div>
  );
}
