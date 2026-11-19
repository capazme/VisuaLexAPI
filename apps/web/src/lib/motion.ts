// The motion tokens of index.css for Framer Motion (spec 2026-10-18-redesign-inchiostro §4.4).
// Import these instead of typing a spring or a curve in a component.
export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
} as const;

export const dur = { press: 0.12, pop: 0.18, panel: 0.24, scene: 0.32 } as const;

export const spring = {
  snappy: { type: 'spring', duration: 0.3, bounce: 0 },
  gentle: { type: 'spring', duration: 0.45, bounce: 0.12 },
} as const;

/**
 * The search island (LC69): one time and one curve for each way, for every layer (shape, content, veil, pill), as Web
 * Animations timing. Opening on the drawer's curve, closing on the strong ease-out: it lands softly on the pill.
 */
export const ISLAND_OPEN = { duration: 280, easing: `cubic-bezier(${ease.drawer.join(', ')})` } as const;
export const ISLAND_CLOSE = { duration: 220, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;

/**
 * The frequency rule (LC132; Luca, 19 Nov: animations only where they help; agreed with the UI consultant). The more
 * often a gesture comes, the less it moves:
 * - a keystroke moves nothing (a letter, an arrow in a list: the change is there in the same frame);
 * - a repeated action (a row that opens, a notification, ⌘K) takes at most 150–200 ms, with no spring and no cascade;
 * - a change of place (a page, a view) takes 180 ms.
 * Rare moments (a confirmation, a Gymnasium reward, the first draw of a page) keep their own times above. Reduced
 * motion keeps its fades as they are. Every time below is one of these; a new one names its row of the rule.
 */
/** ⌘K's island, the field that grows out of the pill, and its band (a repeated action): at once, no wait. */
export const SEARCH_OPEN = { duration: 180, easing: `cubic-bezier(${ease.drawer.join(', ')})` } as const;
export const SEARCH_CLOSE = { duration: 120, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;
/** A repeated action that opens and closes: `Expand`'s space, the notifications. */
export const REPEAT_OPEN = { duration: 200, easing: `cubic-bezier(${ease.drawer.join(', ')})` } as const;
export const REPEAT_CLOSE = { duration: 150, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;
/** The notifications' stack moving into place, for Framer Motion: `REPEAT_OPEN`'s time, a tween, no bounce. */
export const REPEAT_MOVE = { type: 'tween', duration: REPEAT_OPEN.duration / 1000, ease: ease.out } as const;
/** A change of place inside a page (`ViewSlide`): `PageFade`'s 180 ms; sideways by `VIEW_SHIFT` px only list ↔ detail. */
export const PLACE_CHANGE = { duration: dur.pop * 1000, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;
export const VIEW_SHIFT = 12;

/**
 * The menus (LC102, variant A of the «⋯» page): they appear under their trigger, aligned to its edge, by a fade and a
 * shift of `MENU_SHIFT` px; under reduced motion only the fade, 150 ms linear (the app's rule in `index.css`).
 */
export const MENU_OPEN = { duration: 140, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;
export const MENU_CLOSE = { duration: 100, easing: `cubic-bezier(${ease.out.join(', ')})` } as const;
export const MENU_FADE = { duration: 150, easing: 'linear' } as const;
export const MENU_SHIFT = 4;

/**
 * The indeterminate progress bar's sweep, in seconds (LC119): a loop that says «still working», not a move, so none of
 * `dur`, which would make it frantic.
 */
export const PROGRESS_SWEEP = 1.5;
