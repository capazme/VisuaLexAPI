/**
 * What this browser keeps of a person, and the one way it is taken away when a session ends (scan A.5).
 *
 * Every key the web writes to `localStorage` or `sessionStorage` is listed in `BROWSER_STORAGE` with what it
 * holds; `browserStorageInventory.test.ts` reads the sources and fails on a key that is not listed, so a new
 * key is classified before it ships. A session ends by an explicit logout, by a refresh the server refused
 * (`handleUnauthenticated`), by an account deletion, or because a different person signs in on this browser
 * (`claimBrowserFor`): every path calls `forgetUserData`.
 *
 * No imports from the app: `services/api.ts` calls it, and the store's own reset (which imports the services)
 * reaches it through `onSessionEnd`, registered by `userDataReset.ts`.
 */

export type StorageArea = 'local' | 'session';

/**
 * - `user`: the person's data or traces of their work — removed at every session end.
 * - `store`: the app store's persisted value; its per-user part (the practices) is emptied by the store's
 *   `clearUserData`, which runs through `onSessionEnd`; the rest (settings, panel positions) is the device's.
 * - `auth`: the tokens and the session's own bookkeeping, handled by the sign-in code.
 * - `device`: a preference of this browser (a width, a grouping, a tour seen), with nothing of the person.
 */
export type StorageKind = 'user' | 'store' | 'auth' | 'device';

export interface StorageEntry {
  area: StorageArea;
  /** The key, or a prefix ending in `*` for a family of keys (one per tab, for instance). */
  key: string;
  kind: StorageKind;
  what: string;
}

/** The key that names whose data this browser holds: a user id, read at the next sign-in. */
export const OWNER_KEY = 'visualex.user-data-owner';

export const BROWSER_STORAGE: readonly StorageEntry[] = [
  // auth
  { area: 'local', key: 'access_token', kind: 'auth', what: 'the access token' },
  { area: 'local', key: 'refresh_token', kind: 'auth', what: 'the refresh token' },
  { area: 'local', key: OWNER_KEY, kind: 'auth', what: 'the id of the person whose data this browser holds' },
  { area: 'session', key: 'vlx:return-to', kind: 'auth', what: 'the page to go back to after signing in again' },
  // the store
  { area: 'local', key: 'visualex-storage', kind: 'store', what: 'settings, panel positions, and the practices (per user)' },
  // user
  { area: 'local', key: 'visualex-storage.v0-backup', kind: 'user', what: 'the copy of the old saved tabs, before the practices' },
  { area: 'local', key: 'merlt-qa-thread-v1', kind: 'user', what: 'the questions asked to the assistant and its answers' },
  { area: 'session', key: 'merlt-graph-breadcrumb', kind: 'user', what: 'the last norms opened in the graph' },
  { area: 'local', key: 'visualex.studia.visto', kind: 'user', what: 'Gymnasium: the points and level last seen' },
  { area: 'local', key: 'visualex.studia.festeggiato', kind: 'user', what: 'Gymnasium: the day the goal was last celebrated' },
  { area: 'local', key: 'visualex.studia.ripasso.materia', kind: 'user', what: 'Gymnasium: the subject chosen for review' },
  { area: 'local', key: 'visualex.studia.valida.materia', kind: 'user', what: 'Gymnasium: the subject chosen for validation' },
  { area: 'local', key: 'visualex.studia.percorsi.passo', kind: 'user', what: 'Gymnasium: the step reached in each module' },
  { area: 'session', key: 'visualex.studia.percorsi.lavoro', kind: 'user', what: 'Gymnasium: the work on a module in this tab' },
  { area: 'local', key: 'visualex.merlt.consent', kind: 'user', what: 'legacy: the MERL-T consent level, no longer written' },
  { area: 'local', key: 'visualex.merlt.consent-snooze', kind: 'user', what: 'legacy: the old consent banner snoozed, no longer written' },
  { area: 'local', key: 'visualex.merlt.ask-teaser-dismissed', kind: 'user', what: 'legacy: the old teaser dismissed, no longer written' },
  // device
  { area: 'local', key: 'visualex-section', kind: 'device', what: 'the section last open' },
  { area: 'local', key: 'visualex-sidebar', kind: 'device', what: 'the sidebar width' },
  { area: 'local', key: 'visualex_tour', kind: 'device', what: 'the guided tours already seen' },
  { area: 'local', key: 'visualex_last_seen_version', kind: 'device', what: 'the version whose notes were shown' },
  { area: 'session', key: 'visualex_version_last_check', kind: 'device', what: 'when the version was last checked' },
  { area: 'local', key: 'visualex-opus-today-grouping', kind: 'device', what: 'Opus: how «Oggi» is grouped' },
  { area: 'session', key: 'visualex:find-window-place', kind: 'device', what: 'where the find window sits' },
  { area: 'session', key: 'visualex:find-window-scope', kind: 'device', what: 'what the find window searches' },
  { area: 'session', key: 'visualex:case-law-open:*', kind: 'device', what: 'whether case law is open, per tab' },
  { area: 'local', key: 'merlt-grafo-column-width', kind: 'device', what: 'the graph column width' },
  { area: 'local', key: 'merlt-grafo-column-collapsed', kind: 'device', what: 'the graph column collapsed' },
  { area: 'local', key: 'merlt_qa_dev_mode', kind: 'device', what: 'the assistant developer view' },
];

const cleanups: Array<() => void> = [];

/** A reset of in-memory state (stores, caches) to run whenever a session ends. Returns its removal. */
export function onSessionEnd(cleanup: () => void): () => void {
  cleanups.push(cleanup);
  return () => {
    const index = cleanups.indexOf(cleanup);
    if (index !== -1) cleanups.splice(index, 1);
  };
}

function storageOf(area: StorageArea): Storage | null {
  try {
    return area === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return null; // storage refused: nothing was kept there either
  }
}

/**
 * Takes away everything of the person: the in-memory state, through the registered resets, then every `user`
 * key of both storages. The tokens are the caller's (`auth`): a different person signing in keeps the new ones.
 * Never throws.
 */
export function forgetUserData(): void {
  for (const cleanup of [...cleanups]) {
    try {
      cleanup();
    } catch (error) {
      console.error('[session] a reset failed at the end of the session', error);
    }
  }
  for (const entry of BROWSER_STORAGE) {
    if (entry.kind !== 'user') continue;
    try {
      storageOf(entry.area)?.removeItem(entry.key);
    } catch {
      // storage refused: nothing to remove
    }
  }
  try {
    storageOf('local')?.removeItem(OWNER_KEY);
  } catch {
    // storage refused
  }
}

/**
 * Called once the signed-in person is known (sign-in, registration, start-up). When this browser holds the
 * data of someone else — or of no one known, at an explicit sign-in — it is taken away first; then the browser
 * is marked as this person's. At start-up (`signIn: false`) a browser with no mark is simply marked: its data
 * is the person whose session it already holds.
 */
export function claimBrowserFor(userId: string, { signIn }: { signIn: boolean }): void {
  let owner: string | null = null;
  try {
    owner = storageOf('local')?.getItem(OWNER_KEY) ?? null;
  } catch {
    owner = null;
  }
  if (owner !== userId && (owner !== null || signIn)) forgetUserData();
  try {
    storageOf('local')?.setItem(OWNER_KEY, userId);
  } catch {
    // storage refused: the next sign-in clears, as with no mark
  }
}
