/**
 * Standardized z-index values for consistent layering.
 *
 * TWO BANDS design:
 * - BASE BAND (0-119): in-document stacking, sidebar, bar of practices, floating windows
 *   (structure 90, search panel 100, find window 110)
 * - OVERLAY BAND (1000+): modals, drawers, tooltips, toasts, settings
 *
 * The gap (120-999) is intentionally unused: it isolates the base band from
 * the overlay band so modals cannot be hidden by dynamic counters used for
 * floating windows (search panel). Study Mode's own layers
 * (backdrop 120, window 130) sit in that gap, over the find window; while an
 * overlay covers the workspace (`aria-modal="true"` or `data-find-overlay`,
 * `isWorkspaceCovered`) Cmd/Ctrl+F does not open the find window at all.
 *
 * IMPORTANT: Import and use these constants instead of hardcoding z-index.
 */

export const Z_INDEX = {
  // ── BASE BAND ────────────────────────────────────────────────────
  /** Within-component stacking (e.g. active indicator bar) */
  local: 'z-10',

  /** Sticky headers, fixed toolbars */
  sticky: 'z-20',

  /**
   * A sticky heading over sticky rows of its own (a practice's act heading over an open row's
   * reading toolbar): when the row ends, its toolbar slides up under the heading, never over it.
   */
  stickyHead: 'z-[25]',

  /** Inline dropdown menus, popovers within cards */
  dropdown: 'z-30',

  /** Floating action buttons, FABs */
  floating: 'z-40',

  /**
   * A bar pinned to the bottom of a phone's screen (the review's grades). Under the mobile menu's
   * backdrop (`z-40`), so the open menu covers it; the feedback button, which would sit on it, is
   * hidden on that route on a phone (`Layout`).
   */
  pinnedBar: 'z-[35]',

  /** App sidebar navigation */
  sidebar: 'z-50',

  /** The bar of practices (the old dock's band) */
  dock: 'z-[80]',

  /**
   * Floating structure (index) window. Above the bar of practices and the windows beside the table,
   * because it is a tool held over the content it drives; below the overlay
   * band, so modals still cover it.
   */
  structure: 'z-[90]',

  /** Floating search panel — above the bar of practices, below overlay band */
  searchPanel: 'z-[100]',

  /** Floating find window — a tool held over the workspace, above the search panel */
  findWindow: 'z-[110]',

  // ── OVERLAY BAND (1000+) ─────────────────────────────────────────
  /** Side drawers (Brocardi drawer, etc.) */
  drawer: 'z-[1000]',

  /** Standard modals and dialogs (Modal base consumed here) */
  modal: 'z-[1100]',

  /** @deprecated use `modal` instead */
  heavyModal: 'z-[1100]',

  /** Compare view overlay */
  compare: 'z-[1150]',

  /** Citation preview popover */
  citationPreview: 'z-[1200]',

  /** Command palette */
  commandPalette: 'z-[1250]',

  /** Study mode backdrop */
  studyBackdrop: 'z-[1300]',

  /** Study mode panel */
  studyPanel: 'z-[1310]',

  /** Tooltips — above everything normal so they work inside modals */
  tooltip: 'z-[1400]',

  /** Toast notifications — above tooltips so errors always surface */
  toast: 'z-[1450]',

  /** User menu backdrop */
  menuBackdrop: 'z-[1500]',

  /** User menu popup */
  menuPanel: 'z-[1510]',

  /** Settings modal — ALWAYS on top of everything */
  settings: 'z-[1900]',
} as const;
