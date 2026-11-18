import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { dur, ease } from '../../lib/motion';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';

/** How far what arrives rises as it comes in: a hint, not a movement. */
const RISE = 4;

export interface ArriveProps {
  /** What it waits for is on its way: the placeholder is shown. */
  loading: boolean;
  /** The place held meanwhile, at the size of what is coming (`Skeleton`). */
  placeholder?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The one entrance of what arrives after a wait (LC98): the placeholder while `loading`, then the content, coming in
 * with a fade and a 4 px rise in `dur.pop` on `ease.out`. Only what was waited for comes in so: content already there
 * when it mounts (a view the slide brings in) and a read again over what is on screen (dimmed by its page) do not.
 * Under reduced motion only the fade; without Web Animations the content is simply there.
 */
export function Arrive({ loading, placeholder = null, className, children }: ArriveProps) {
  const box = useRef<HTMLDivElement>(null);
  const waited = useRef(loading);

  useLayoutEffect(() => {
    if (loading) {
      waited.current = true;
      return undefined;
    }
    const el = box.current;
    if (!waited.current || !el || typeof el.animate !== 'function') return undefined;
    waited.current = false;
    const coming = el.animate(
      [{ opacity: 0, transform: prefersReducedMotion() ? 'none' : `translateY(${RISE}px)` }, { opacity: 1, transform: 'none' }],
      { duration: dur.pop * 1000, easing: `cubic-bezier(${ease.out.join(', ')})` },
    );
    return () => coming.cancel();
  }, [loading]);

  return (
    <div ref={box} className={className}>
      {loading ? placeholder : children}
    </div>
  );
}
