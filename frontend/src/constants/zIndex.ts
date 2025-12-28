/**
 * Standardized z-index values for consistent layering.
 *
 * Layer hierarchy (lowest to highest):
 * 1. Base content (no z-index needed)
 * 2. Local stacking within components (z-10)
 * 3. Sticky headers (z-20)
 * 4. Dropdowns base (z-30)
 * 5. Floating buttons (z-40)
 * 6. Sidebar navigation (z-50)
 * 7. Standard modals and drawers (z-50)
 * 8. Toast notifications (z-[60])
 * 9. User menu backdrop (z-[60])
 * 10. User menu popup (z-[70])
 * 11. Workspace dock (z-[80])
 * 12. Tooltips and previews (z-[85])
 * 13. Compare view overlay (z-[90])
 * 14. Heavy modals - Dossier, PDF, Annex (z-[100])
 * 15. Study mode (z-[120] backdrop, z-[130] panel)
 * 16. Command palette (z-[130])
 * 17. Settings modal (z-[200]) - ALWAYS on top
 *
 * IMPORTANT: Import and use these constants instead of hardcoding z-index values!
 */

export const Z_INDEX = {
  /** Local stacking within a component */
  local: 'z-10',

  /** Sticky headers, fixed navigation */
  sticky: 'z-20',

  /** Dropdowns, menus, popovers */
  dropdown: 'z-30',

  /** Floating buttons, FABs */
  floating: 'z-40',

  /** Sidebar navigation */
  sidebar: 'z-50',

  /** Standard modals and dialogs */
  modal: 'z-50',

  /** Drawers and slide-out panels */
  drawer: 'z-50',

  /** Toast notifications */
  toast: 'z-[60]',

  /** User menu and dropdown backdrops */
  menuBackdrop: 'z-[60]',

  /** User menu and dropdown panels */
  menuPanel: 'z-[70]',

  /** Workspace dock/navigator - hidden when heavy overlays are open */
  dock: 'z-[80]',

  /** Tooltips and previews - above dock */
  tooltip: 'z-[85]',

  /** Compare view overlay - above dock, below heavy modals */
  compare: 'z-[90]',

  /** Heavy modals (Dossier, PDF, Annex) - above dock and compare */
  heavyModal: 'z-[100]',

  /** Study mode backdrop */
  studyBackdrop: 'z-[120]',

  /** Study mode panel */
  studyPanel: 'z-[130]',

  /** Command palette - above most things */
  commandPalette: 'z-[130]',

  /** Settings modal - ALWAYS on top of everything */
  settings: 'z-[200]',
} as const;

/** Numeric values for use in inline styles or dynamic z-index */
export const Z_INDEX_VALUES = {
  local: 10,
  sticky: 20,
  dropdown: 30,
  floating: 40,
  sidebar: 50,
  modal: 50,
  drawer: 50,
  toast: 60,
  menuBackdrop: 60,
  menuPanel: 70,
  dock: 80,
  tooltip: 85,
  compare: 90,
  heavyModal: 100,
  studyBackdrop: 120,
  studyPanel: 130,
  commandPalette: 130,
  settings: 200,
} as const;

/**
 * Check if an overlay should hide the workspace dock.
 * Returns true for overlays that need the full screen without dock interference.
 */
export const shouldHideDock = (activeOverlay: string | null): boolean => {
  const overlaysThatHideDock = ['compare', 'settings', 'commandPalette', 'heavyModal', 'study'];
  return activeOverlay !== null && overlaysThatHideDock.includes(activeOverlay);
};
