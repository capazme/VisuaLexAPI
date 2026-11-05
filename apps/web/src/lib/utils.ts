import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The theme's own sizes (U1, `index.css`): `max-w-frame`, `max-w-frame-full` and `max-w-measure` are max-widths like
 * `max-w-prose`, so a later one overrides an earlier one instead of both staying and the stylesheet's order deciding.
 */
const twMerge = extendTailwindMerge({ extend: { theme: { container: ['frame', 'frame-full', 'measure'] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
