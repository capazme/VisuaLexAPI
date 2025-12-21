// Configuration for automatic annex detection and switching
// NOTE: Auto-switch is DISABLED because it causes double-load and confusing UX.
// The user should select the correct annex from DocumentStructure.

export const ANNEX_AUTO_SWITCH_CONFIG = {
  // Auto-switch if main text has this many articles or fewer
  MAX_MAIN_ARTICLES: 50,

  // Auto-switch if annex has this many articles or more
  MIN_ANNEX_ARTICLES: 10,

  // Toast notification duration (ms)
  TOAST_DURATION: 3000,

  // DISABLED: causes double-load, tab flicker, and confusing UX
  ENABLED: false,

  // Auto-confirm switch without dialog
  AUTO_CONFIRM: false,
};
