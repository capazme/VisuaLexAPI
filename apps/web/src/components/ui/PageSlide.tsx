import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../lib/motion';
import { prefersReducedMotion } from '../../features/sections/sectionTransition';

/** How far a page travels as it comes and goes: a nudge, not a whole screen. */
const SHIFT = 24;

export interface PageSlideProps {
  /** The page shown, usually the route's path: a new key is a new page. */
  pageKey: string;
  /** Going back (LC84, leaving Impostazioni): the same movement the other way, the page coming from the left. */
  back?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * «Una pagina vera» (LC77, the plan's third form): the new page comes in sliding from the right while the old one
 * leaves to the left, both in the same place of the page, never over another part of it. The coming page takes the
 * island's opening (`ISLAND_OPEN`), the leaving one its closing (`ISLAND_CLOSE`). Under reduced motion only the fade.
 * Without Web Animations the page changes at once.
 */
export function PageSlide({ pageKey, back = false, className, children }: PageSlideProps) {
  const [current, setCurrent] = useState({ key: pageKey, node: children });
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  const motion = typeof Element.prototype.animate === 'function';
  if (current.key !== pageKey) {
    if (motion) setLeaving(current);
    setCurrent({ key: pageKey, node: children });
  } else if (current.node !== children) {
    setCurrent({ key: pageKey, node: children });
  }

  const enterRef = useRef<HTMLDivElement>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Where the page stood at the last commit (LC84): the leaving page keeps that place and width, so a frame that changes
  // with the page coming in (the search page's is wider) neither moves it nor is decided by it.
  const placed = useRef<{ left: number; width: number } | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current || !motion) {
      first.current = false;
      return undefined;
    }
    const still = prefersReducedMotion();
    const toward = back ? -1 : 1;
    const enter = enterRef.current;
    const leave = leaveRef.current;
    const grid = gridRef.current;
    if (leave && grid && placed.current) {
      leave.style.left = `${placed.current.left - grid.getBoundingClientRect().left}px`;
      leave.style.width = `${placed.current.width}px`;
    }
    const coming = enter?.animate(
      [{ opacity: 0, transform: still ? 'none' : `translateX(${toward * SHIFT}px)` }, { opacity: 1, transform: 'none' }],
      ISLAND_OPEN,
    );
    const going = leave?.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: still ? 'none' : `translateX(${-toward * SHIFT}px)` }],
      { ...ISLAND_CLOSE, fill: 'forwards' },
    );
    if (going) going.onfinish = () => setLeaving(null);
    return () => {
      coming?.cancel();
      going?.cancel();
    };
    // `motion` is the environment's, the same for every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key]);

  // After every commit, after the movement's effect above has read the last one.
  useLayoutEffect(() => {
    const box = gridRef.current?.getBoundingClientRect();
    if (box) placed.current = { left: box.left, width: box.width };
  });

  return (
    <div ref={gridRef} className={cn('relative grid', className)}>
      {/* Out of the grid's flow: the cell is the coming page's alone. */}
      {leaving && (
        <div ref={leaveRef} key={leaving.key} inert aria-hidden className="pointer-events-none absolute top-0 left-0 w-full">
          {leaving.node}
        </div>
      )}
      <div ref={enterRef} key={current.key} className="[grid-area:1/1] min-w-0">
        {current.node}
      </div>
    </div>
  );
}
