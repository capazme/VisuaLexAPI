/**
 * The pages loaded with their route (P1): their code is not in the chunk every page loads, sign-in included. Ricerca,
 * the sign-in page, Dossier and the Forum's «Dossier pubblici» stay there (measured: opened directly, the last two drew
 * their largest text later). One place for the modules, so `App.tsx`'s `lazy` routes, the sidebar's entries and
 * the section switcher (`SECTION_HOME_CODE`) ask for the same files.
 */
export const PAGE_CODE = {
  history: () => import('./components/features/history/HistoryView'),
  community: () => import('./components/features/bulletin/ForumCommunityPage'),
  documents: () => import('./components/features/documents/DocumentReviewPage'),
  credits: () => import('./pages/CreditsPage'),
  connectAiApp: () => import('./features/connections/ConnectAiAppPage'),
  // Opus's frame and its views together: one wait, not two in a row.
  opus: () => Promise.all([import('./components/features/planner/OpusPage'), import('./components/features/planner/OpusViews')]),
} as const;

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

/** The code an address's page waits for, if it is loaded with its route. */
export function pageCodeFor(pathname: string): (() => Promise<unknown>) | null {
  if (under(pathname, '/history')) return PAGE_CODE.history;
  if (under(pathname, '/forum/community')) return PAGE_CODE.community;
  if (under(pathname, '/documents')) return PAGE_CODE.documents;
  if (under(pathname, '/crediti')) return PAGE_CODE.credits;
  if (under(pathname, '/collega-app')) return PAGE_CODE.connectAiApp;
  if (under(pathname, '/opus')) return PAGE_CODE.opus;
  return null;
}

/**
 * Fetches a page's code ahead, when the way to it is pointed at or focused (a sidebar entry), so the click finds it
 * there. A failed fetch is the route's to report, when it is visited.
 */
export function preparePage(pathname: string): void {
  pageCodeFor(pathname)?.().catch(() => {});
}
