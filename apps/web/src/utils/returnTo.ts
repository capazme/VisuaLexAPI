/**
 * Where the reader goes back after the login (design 2026-10-01 §5). The address is kept by the
 * app itself — the router state, or sessionStorage when a failed token refresh reloads the page —
 * never by a URL parameter, so no link can be crafted that sends a reader elsewhere after login.
 * Only paths of the app are accepted.
 */
const KEY = 'vlx:return-to';

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

export function locationToPath(loc: { pathname?: string; search?: string; hash?: string } | null | undefined): string | null {
  if (!loc?.pathname) return null;
  return safeReturnPath(`${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`);
}

export function stashReturnTo(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe || safe === '/login' || safe.startsWith('/login?')) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch (error) {
    console.warn('sessionStorage refused the return address; the login will land on /', error);
  }
}

export function takeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeReturnPath(value);
  } catch (error) {
    console.warn('sessionStorage unreadable; the login will land on /', error);
    return null;
  }
}
