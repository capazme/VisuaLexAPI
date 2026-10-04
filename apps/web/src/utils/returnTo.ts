/**
 * Where the reader goes back after the login (design 2026-10-01 §5). The address is kept by the
 * app itself — the router state, or sessionStorage when a failed token refresh reloads the page —
 * never by a URL parameter, so no link can be crafted that sends a reader elsewhere after login.
 * Only paths of the app are accepted, and the browser's own URL parser decides what that is: it
 * strips tab and newline and reads a backslash as a slash, so «/\t/evil.example» and
 * «/\evil.example» both mean another host and are refused, whatever way the address is then used.
 */
const KEY = 'vlx:return-to';
const BASE = 'http://return.invalid';

/** The value as a URL of the app, or null when the browser would read it as leaving the app. */
function appUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  try {
    const url = new URL(value, BASE);
    // «//host», «/\host», «/\t/host»: the parser reads them as another host
    if (url.origin !== BASE) return null;
    // Dot segments are removed but an empty one stays: «/..//x» comes out as «//x», which a
    // browser reads as another host the next time it is used. Refused, not repaired.
    if (url.pathname.startsWith('//')) return null;
    return url;
  } catch {
    return null;
  }
}

export function safeReturnPath(value: unknown): string | null {
  const url = appUrl(value);
  return url ? `${url.pathname}${url.search}${url.hash}` : null;
}

export function locationToPath(loc: { pathname?: string; search?: string; hash?: string } | null | undefined): string | null {
  if (!loc?.pathname) return null;
  return safeReturnPath(`${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`);
}

/** The router matches paths without case and with extra slashes, and a percent escape is a letter. */
function isLoginPage(pathname: string): boolean {
  let name = pathname;
  try {
    name = decodeURIComponent(pathname);
  } catch {
    // a malformed escape: keep the raw pathname
  }
  return name.toLowerCase().replace(/\/+$/, '') === '/login';
}

export function stashReturnTo(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  if (isLoginPage(new URL(safe, BASE).pathname)) return;
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

/** An explicit logout: the reader chose to leave, so no address waits for the next login. */
export function forgetReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch (error) {
    console.warn('sessionStorage unreadable; a stale return address may remain', error);
  }
}
