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
 * 7. Standard modals (z-50)
 * 8. User menu backdrop (z-[60])
 * 9. User menu popup (z-[70])
 * 10. Workspace dock (z-[80])
 * 11. Tooltips and previews (z-[80])
 * 12. Study mode (z-[120] backdrop, z-[130] panel)
 * 13. Command palette (z-[130])
 * 14. Settings modal (z-[200]) - ALWAYS on top
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

  /** Workspace dock/navigator */
  dock: 'z-[80]',

  /** Tooltips and previews */
  tooltip: 'z-[80]',

  /** Study mode backdrop */
  studyBackdrop: 'z-[120]',

  /** Study mode panel, Command palette */
  studyPanel: 'z-[130]',

  /** Settings modal - ALWAYS on top of everything */
  settings: 'z-[200]',
} as const;

/** Numeric values for use in inline styles */
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
  tooltip: 80,
  studyBackdrop: 120,
  studyPanel: 130,
  settings: 200,
} as const;
