/**
 * Standardized z-index values for consistent layering.
 *
 * TWO BANDS design:
 * - BASE BAND (0-99): in-document stacking, sidebar, dock, floating panels
 * - OVERLAY BAND (1000+): modals, drawers, tooltips, toasts, settings
 *
 * The gap (100-999) is intentionally unused: it isolates the base band from
 * the overlay band so modals cannot be hidden by dynamic counters used for
 * floating windows (workspace tabs, search panel).
 *
 * The workspace tab dynamic counter is clamped in WorkspaceTabPanel.tsx to
 * stay below Z_INDEX_VALUES.dock, so stack ordering among tabs works but
 * never leaks into the overlay band.
 *
 * IMPORTANT: Import and use these constants instead of hardcoding z-index.
 */

export const Z_INDEX = {
  // ── BASE BAND ────────────────────────────────────────────────────
  /** Within-component stacking (e.g. active indicator bar) */
  local: 'z-10',

  /** Sticky headers, fixed toolbars */
  sticky: 'z-20',

  /** Inline dropdown menus, popovers within cards */
  dropdown: 'z-30',

  /** Floating action buttons, FABs */
  floating: 'z-40',

  /** App sidebar navigation */
  sidebar: 'z-50',

  /** Workspace dock / navigator — tabs clamp below this */
  dock: 'z-[80]',

  /** Floating search panel — above dock, below overlay band */
  searchPanel: 'z-[100]',

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

/** Numeric values for inline styles or dynamic z-index (parallel to Z_INDEX) */
export const Z_INDEX_VALUES = {
  local: 10,
  sticky: 20,
  dropdown: 30,
  floating: 40,
  sidebar: 50,
  dock: 80,
  searchPanel: 100,
  drawer: 1000,
  modal: 1100,
  heavyModal: 1100,
  compare: 1150,
  citationPreview: 1200,
  commandPalette: 1250,
  studyBackdrop: 1300,
  studyPanel: 1310,
  tooltip: 1400,
  toast: 1450,
  menuBackdrop: 1500,
  menuPanel: 1510,
  settings: 1900,
} as const;

/**
 * Overlays that should hide the workspace dock when active — prevents
 * interaction conflicts between floating content and full-screen overlays.
 */
export const shouldHideDock = (activeOverlay: string | null): boolean => {
  const overlaysThatHideDock = ['compare', 'settings', 'commandPalette', 'heavyModal', 'modal', 'study'];
  return activeOverlay !== null && overlaysThatHideDock.includes(activeOverlay);
};
