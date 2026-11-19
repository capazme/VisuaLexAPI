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
