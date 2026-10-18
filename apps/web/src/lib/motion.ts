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
