import { useLayoutEffect, useRef } from 'react';
import type { SectionId } from './sections';
import { prefersReducedMotion } from './sectionTransition';

/** How long one entry takes to fade in. */
export const ENTRY_FADE_MS = 140;
/** The step between the first entries; the cascade runs over `CASCADE_ENTRIES` and the rest come with the last. */
export const CASCADE_STEP_MS = 20;
export const CASCADE_ENTRIES = 6;

/**
 * The entries of the sidebar's section group, in the order they are drawn: what sits in the group, and what sits in
 * its named subgroups (Gymnasium's «Studia» and «Contribuisci»), headings included.
 */
const ENTRIES = ':scope > :not([role="group"]), :scope > [role="group"] > *';

/** Fades in the group's entries, the first six 20 ms apart: 240 ms at most. Nothing moves, nothing is held after. */
export function fadeInEntries(group: HTMLElement) {
  group.querySelectorAll<HTMLElement>(ENTRIES).forEach((entry, index) => {
    if (typeof entry.animate !== 'function') return;
    entry.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: ENTRY_FADE_MS,
      delay: Math.min(index, CASCADE_ENTRIES - 1) * CASCADE_STEP_MS,
      easing: 'ease-out',
      fill: 'backwards',
    });
  });
}

/**
 * The sidebar's entries for a new section fade in (T1); the old ones are simply gone. Only on a change of section,
 * never when the sidebar first draws, and not under reduced motion. Returns the ref for the group.
 */
export function useEntriesEntrance(section: SectionId) {
  const group = useRef<HTMLDivElement>(null);
  const drawn = useRef(section);
  useLayoutEffect(() => {
    if (drawn.current === section) return;
    drawn.current = section;
    if (group.current && !prefersReducedMotion()) fadeInEntries(group.current);
  }, [section]);
  return group;
}
