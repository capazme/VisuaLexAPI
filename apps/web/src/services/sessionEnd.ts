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
 * - `user`: copies of server data or traces of use — removed at every session end.
 * - `only-copy`: the person's work that exists nowhere else (no copy on the server). Never removed when a session
 *   ends: it is parked under the owner's id (`visualex.parked.<id>`), out of the app's sight, and given back to
 *   the same person at their next sign-in (`claimBrowserFor`). Only an account deletion removes it.
 * - `store`: the app store's persisted value; its per-user part (the practices) is emptied by the store's
 *   `clearUserData`, which runs through `onSessionEnd`; the rest (settings, panel positions) is the device's.
 * - `auth`: the tokens and the session's own bookkeeping, handled by the sign-in code.
 * - `device`: a preference of this browser (a width, a grouping, a tour seen), with nothing of the person.
 */
export type StorageKind = 'user' | 'only-copy' | 'store' | 'auth' | 'device';

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
  { area: 'local', key: 'visualex-storage', kind: 'store', what: 'settings, panel positions, and the practices (only copy: parked, see PARKED_STORE_FIELDS)' },
  // only copy
  { area: 'local', key: 'visualex.parked.*', kind: 'auth', what: 'the only-copy work of a person, parked when their session ended' },
  // user
  { area: 'local', key: 'visualex-storage.v0-backup', kind: 'only-copy', what: 'the copy of the old saved tabs, before the practices' },
  { area: 'local', key: 'merlt-qa-thread-v1', kind: 'only-copy', what: 'the assistant thread with its full answers (the server keeps a history, not this thread)' },
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

const STORE_KEY = 'visualex-storage';
/** The fields of the store's persisted value that are only-copy work (spec D6: the practices live in the browser). */
export const PARKED_STORE_FIELDS = ['practices', 'activePracticeId'] as const;
const PARKED_PREFIX = 'visualex.parked.';
/** Parked work whose owner is unknown (a browser from before the owner mark): never given back automatically. */
export const UNKNOWN_OWNER = '_unknown';

export function parkedKey(owner: string): string {
  return `${PARKED_PREFIX}${owner}`;
}

interface Parked {
  store?: Record<string, unknown>;
  keys?: Record<string, string>;
}

function readJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasWork(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
}

/**
 * Moves the person's only-copy work out of the app's sight, under their id: the practices from the store's saved
 * value and every `only-copy` key. Work parked earlier for the same person is kept where nothing newer replaces it.
 */
function parkOnlyCopy(): void {
  const local = storageOf('local');
  if (!local) return;
  try {
    const owner = local.getItem(OWNER_KEY) ?? UNKNOWN_OWNER;
    const previous = (readJson(local.getItem(parkedKey(owner))) ?? {}) as Parked;
    const parked: Parked = { store: { ...(previous.store ?? {}) }, keys: { ...(previous.keys ?? {}) } };
    const saved = readJson(local.getItem(STORE_KEY));
    const state = (saved?.state ?? null) as Record<string, unknown> | null;
    let any = false;
    if (state && hasWork(state.practices)) {
      for (const field of PARKED_STORE_FIELDS) parked.store![field] = state[field] ?? null;
      any = true;
    }
    for (const entry of BROWSER_STORAGE) {
      if (entry.kind !== 'only-copy') continue;
      const value = storageOf(entry.area)?.getItem(entry.key);
      if (value !== null && value !== undefined) {
        parked.keys![`${entry.area}:${entry.key}`] = value;
        any = true;
      }
    }
    if (any || previous.store || previous.keys) local.setItem(parkedKey(owner), JSON.stringify(parked));
  } catch (error) {
    // Parking failed (a full store): nothing only-copy is removed below either.
    console.error('[session] the work could not be set aside', error);
    throw error;
  }
}

const restorers: Array<() => void> = [];

/** What reloads the app's state once parked work is given back (the store re-reads its saved value). */
export function onWorkRestored(restore: () => void): () => void {
  restorers.push(restore);
  return () => {
    const index = restorers.indexOf(restore);
    if (index !== -1) restorers.splice(index, 1);
  };
}

/** Gives the person back the work parked under their id, beside anything the browser holds now. */
function restoreParked(userId: string): void {
  const local = storageOf('local');
  if (!local) return;
  const parked = readJson(local.getItem(parkedKey(userId))) as Parked | null;
  if (!parked) return;
  try {
    if (parked.store && hasWork(parked.store.practices)) {
      const saved = readJson(local.getItem(STORE_KEY)) ?? { state: {}, version: 1 };
      const state = { ...((saved.state as Record<string, unknown>) ?? {}) };
      const current = Array.isArray(state.practices) ? (state.practices as Array<{ id?: unknown }>) : [];
      const ids = new Set(current.map((p) => p?.id));
      const back = (parked.store.practices as Array<{ id?: unknown }>).filter((p) => !ids.has(p?.id));
      state.practices = [...current, ...back];
      if (!state.activePracticeId) state.activePracticeId = parked.store.activePracticeId ?? null;
      local.setItem(STORE_KEY, JSON.stringify({ ...saved, state }));
    }
    for (const [where, value] of Object.entries(parked.keys ?? {})) {
      const [area, ...rest] = where.split(':');
      const key = rest.join(':');
      const target = storageOf(area as StorageArea);
      if (target && target.getItem(key) === null) target.setItem(key, value);
    }
    local.removeItem(parkedKey(userId));
  } catch (error) {
    console.error('[session] the parked work could not be given back; it stays parked', error);
    return;
  }
  for (const restore of [...restorers]) {
    try {
      restore();
    } catch (error) {
      console.error('[session] reloading the given-back work failed', error);
    }
  }
}

function removeKinds(kinds: StorageKind[]): void {
  for (const entry of BROWSER_STORAGE) {
    if (!kinds.includes(entry.kind)) continue;
    try {
      storageOf(entry.area)?.removeItem(entry.key);
    } catch {
      // storage refused: nothing to remove
    }
  }
}

/**
 * Ends what this browser shows of the person: their only-copy work is parked under their id (never deleted), then
 * the in-memory state goes through the registered resets, and every `user` and `only-copy` key of both storages. The tokens are the caller's (`auth`): a different person signing in keeps the new ones.
 * Never throws.
 */
export function forgetUserData(): void {
  // The only copy of the person's work is set aside first; if that fails, nothing of it is touched.
  let parked = true;
  try {
    parkOnlyCopy();
  } catch {
    parked = false;
  }
  if (!parked) {
    // Clear the caches in memory and the copies of server data only; the store and the only-copy keys stay.
    removeKinds(['user']);
    return;
  }
  for (const cleanup of [...cleanups]) {
    try {
      cleanup();
    } catch (error) {
      console.error('[session] a reset failed at the end of the session', error);
    }
  }
  removeKinds(['user', 'only-copy']);
  try {
    storageOf('local')?.removeItem(OWNER_KEY);
  } catch {
    // storage refused
  }
}

/**
 * Called once the signed-in person is known (sign-in, registration, start-up). A browser marked as someone else's
 * is emptied first (that person's only-copy work is parked under their id); then the browser is marked as this
 * person's, and any work parked under their id is given back.
 */
export function claimBrowserFor(userId: string, { signIn }: { signIn: boolean }): void {
  let owner: string | null = null;
  try {
    owner = storageOf('local')?.getItem(OWNER_KEY) ?? null;
  } catch {
    owner = null;
  }
  // An unmarked browser is adopted (a browser from before the mark, whose work would otherwise be hidden from its
  // own person; after a sign-out nothing is left to adopt). At a sign-in the copies of server data and the traces of
  // use go in any case, as before the mark (G-316): they are never anyone's only copy.
  if (owner !== null && owner !== userId) forgetUserData();
  else if (signIn) removeKinds(['user']);
  try {
    storageOf('local')?.setItem(OWNER_KEY, userId);
  } catch {
    // storage refused: the next sign-in clears, as with no mark
  }
  restoreParked(userId);
}

/**
 * Another tab of this browser ended the session or signed in someone else (the owner or the token changed):
 * this tab reloads, so it never writes the previous person's data back into the storage the new one reads.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== globalThis.localStorage) return;
    if (event.key === OWNER_KEY && event.oldValue !== null) window.location.reload();
  });
}
