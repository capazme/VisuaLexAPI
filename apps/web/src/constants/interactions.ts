/**
 * Standardized interactive state classes for consistent UI feedback.
 * Use these constants across all interactive elements.
 */

/** Standard focus ring for all interactive elements: 2 px toga-500 on a 2 px paper offset, never animated */
export const FOCUS_RING = 'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-toga-500 focus-visible:ring-offset-background focus:outline-none';

/** Standard disabled state */
export const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

/** Standard active (pressed) state, on buttons only */
export const ACTIVE = 'active:scale-[0.97]';

/**
 * Hover lift, for a fine pointer only and never on a row or a list item (motion on something seen
 * tens of times a day). Carries no transition of its own: pair it with `TRANSITION`, which moves
 * `translate`, or a second `transition-*` class would replace the first.
 */
export const HOVER_LIFT = '[@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px';

/**
 * A row that scrolls sideways with no scrollbar drawn: a swipe, the trackpad and the keyboard (focus
 * brings a control into view) still scroll it. For a short row of controls on a phone, where a bar adds
 * nothing and in dark mode showed light (the subject chips). Both engines: the standard property, and
 * WebKit's pseudo-element, which Safari still needs.
 */
export const HIDDEN_SCROLLBAR = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/** Mobile touch target minimum size - use on interactive elements */
// A field's text: 16 px below md, 14 px from it. Safari on an iPhone zooms the page into a field whose text is under
// 16 px as it takes the focus, and the page stays zoomed. Every text field and select takes it (`ui/Input`,
// `ui/FormSelect` and the fields written by hand).
export const FIELD_TEXT = 'text-base md:text-sm';

export const TOUCH_TARGET = 'min-h-[44px] min-w-[44px]';

/** Mobile touch target with desktop override */
export const TOUCH_TARGET_RESPONSIVE = 'min-h-[44px] md:min-h-0';

/**
 * Standard transition for state changes: the properties that change, never `all` (it animated
 * layout). Tailwind v4's `scale-*` and `translate-*` set the `scale` and `translate` properties,
 * not `transform`, so both are listed or `ACTIVE` would snap. `box-shadow` is left out on purpose:
 * the focus ring is a box-shadow and must appear at once.
 */
export const TRANSITION = 'transition-[color,background-color,border-color,opacity,transform,translate,scale] duration-150 ease-out';

/** Combined base interactive styles for buttons */
export const INTERACTIVE_BASE = `${TRANSITION} ${FOCUS_RING} ${DISABLED} ${ACTIVE}`;
