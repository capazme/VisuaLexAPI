import { spring } from '../../lib/motion';

/**
 * The motion of `SegmentedTabs` (U1), apart so it can be read and tested on its own: the chosen tab's mark slides on
 * the app's spring, and is drawn in place under reduced motion.
 */
export function markTransition(reduced: boolean) {
  return reduced ? { duration: 0 } : spring.snappy;
}

/**
 * The panel's entrance after a change: a fade and a shift of 12 px the way the choice moved (to the right for a tab
 * further right: the content starts on the left), 160 ms on the app's ease-out; nothing on the first drawing. CSS, not
 * Framer: the `animate-in` utilities fill backwards only, so the content ends on its own style with nothing written on
 * it. Framer's fade ends by writing the final opacity, which showed one frame at 0 and, under reduced motion, started
 * the global 150 ms opacity transition of `index.css` for a second fade. Under reduced motion that same sheet makes
 * every animation instant: the content changes at once.
 */
export function panelEntrance(direction: number, changed: boolean): string {
  if (!changed) return '';
  if (direction > 0) return 'animate-in fade-in slide-in-from-left-3 duration-160';
  if (direction < 0) return 'animate-in fade-in slide-in-from-right-3 duration-160';
  return 'animate-in fade-in duration-160';
}
