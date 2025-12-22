/**
 * Standardized interactive state classes for consistent UI feedback.
 * Use these constants across all interactive elements.
 */

/** Standard focus ring for all interactive elements */
export const FOCUS_RING = 'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50 focus:outline-none';

/** Standard disabled state */
export const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

/** Standard active (pressed) state */
export const ACTIVE = 'active:scale-[0.98]';

/** Hover lift effect for buttons */
export const HOVER_LIFT = 'hover:-translate-y-0.5 transition-transform';

/** Mobile touch target minimum size - use on interactive elements */
export const TOUCH_TARGET = 'min-h-[44px] min-w-[44px]';

/** Mobile touch target with desktop override */
export const TOUCH_TARGET_RESPONSIVE = 'min-h-[44px] md:min-h-0';

/** Standard transition for smooth state changes */
export const TRANSITION = 'transition-all duration-200 ease-out';

/** Combined base interactive styles for buttons */
export const INTERACTIVE_BASE = `${TRANSITION} ${FOCUS_RING} ${DISABLED} ${ACTIVE}`;
