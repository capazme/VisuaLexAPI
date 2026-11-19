import { FOCUS_RING } from '../../constants/interactions';

/**
 * One radius, one height per size and one border for `Button`, `IconButton`, `Input` and `Select` (LC97): Button's
 * Pietra values, written here once so a field set beside a button lines up with it.
 */
export type ControlSize = 'sm' | 'md' | 'lg';

export const CONTROL_RADIUS = 'rounded-md';

/** A box that holds things (`Card`): 8 px, against the 4 px of what is pressed or typed in (the consultant's rule, LC106). */
export const CARD_RADIUS = 'rounded-[8px]';

/** 44 px on a phone (the touch target); 32, 36 and 44 px on a desktop. `min-h`, so a long label wraps. */
export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: 'min-h-11 md:min-h-8',
  md: 'min-h-11 md:min-h-9',
  lg: 'min-h-11',
};

/** The outline of `Button variant="secondary"` and of every field. */
export const CONTROL_BORDER = 'border border-ink-200 dark:border-ink-800';

/** A field's label and its message, one form for `Input` and `Select`. */
export const FIELD_LABEL = 'mb-1 block text-xs font-semibold tracking-wide text-ink-600 dark:text-ink-300';
export const FIELD_HELP = 'text-xs text-ink-600 dark:text-ink-300';
export const FIELD_ERROR = 'text-xs font-medium text-red-600 dark:text-red-400';

/**
 * A field's ground, the one a field is known by: `Input`'s, `Select`'s, `Textarea`'s and the quick add's box (LC111). In
 * the light the card's paper. In the dark a veil of black over what lies under it (LC116, the consultant: on the card's
 * own grey a field was known by its border alone): on a card it comes to about the sign-in's old `ink-950` fields, on the
 * page (which is itself about `ink-950`) a step below it. An opaque ground cannot do both: none lies between the two.
 */
export const FIELD_SURFACE = 'bg-card dark:bg-black/40';

/**
 * A field's box, `Input`'s and `Select`'s: the paper of a card, the shared outline, a toga edge on focus. Colours only
 * move: the focus ring is a box-shadow and appears at once. The height comes from `CONTROL_HEIGHT`.
 */
export const FIELD_CONTROL = [
  'w-full py-1.5 font-medium',
  CONTROL_RADIUS,
  CONTROL_BORDER,
  FIELD_SURFACE, 'text-ink-900 dark:text-ink-50',
  'placeholder:text-ink-500 dark:placeholder:text-ink-400',
  'hover:border-ink-300 dark:hover:border-ink-700 focus:border-toga-500 dark:focus:border-toga-400',
  'transition-colors duration-(--dur-press) ease-out',
  FOCUS_RING,
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-ink-100 dark:disabled:bg-ink-800',
  // In the dark theme the browser's own parts (a date's calendar, a time's clock, a select's list) are drawn dark.
  'dark:[color-scheme:dark]',
].join(' ');

/** A field with an error: the red stays (a functional colour). */
export const FIELD_CONTROL_INVALID = 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/10';
