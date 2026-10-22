/** The Forum's three views, left to right as their tabs (S7a): the order the panel's entrance reads its side from. */
export type ForumTab = 'explore' | 'my' | 'suggestions';

export const FORUM_TAB_ORDER: ReadonlyArray<ForumTab> = ['explore', 'my', 'suggestions'];

/** The panel under the tabs (`SegmentedTabPanel`), whose id the tabs' ids are made from. */
export const FORUM_PANEL_ID = 'forum-sections';
