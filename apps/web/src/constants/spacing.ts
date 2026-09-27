/**
 * Standardized spacing classes for consistent layout.
 * Based on 4px base unit (Tailwind's default spacing scale).
 */

export const SPACING = {
  /** Main content section padding */
  section: 'p-6',

  /** Card internal padding - responsive */
  card: 'p-4 md:p-5',

  /** Card header padding */
  cardHeader: 'px-4 py-3',

  /** Form field vertical gaps */
  form: 'space-y-4',

  /** Inline element gaps */
  inline: 'gap-2',

  /** Small inline gaps */
  inlineSm: 'gap-1',

  /** Large inline gaps */
  inlineLg: 'gap-3',

  /** Tight spacing between related elements */
  tight: 'gap-1.5',

  /** Page-level padding - responsive */
  page: 'px-4 py-6 md:px-6 md:py-8',

  /** Modal/dialog internal padding */
  modal: 'p-6',

  /** Stack spacing for vertical lists */
  stack: 'space-y-3',

  /** Large stack spacing */
  stackLg: 'space-y-6',
} as const;

/** Input/form field consistent padding */
export const INPUT_PADDING = 'px-4 py-2.5';

/** Button padding by size */
export const BUTTON_PADDING = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
  lg: 'px-6 py-3',
} as const;
