import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Who may talk to the desktop app's port (G-612, spec §6). The server listens on 127.0.0.1 only, but every program on
 * the computer and every page open in a browser can reach that address. So:
 *
 * 1. `portGuard`, on every request: the exact `Host` (`127.0.0.1:<port>`; anything else is 421, against DNS
 *    rebinding), no `Origin` but the app's own, no `Sec-Fetch-Site` but `same-origin` or `none` (a page of another
 *    site, 403). No CORS header is ever sent: the app's page is same-origin, and nobody else is allowed to read.
 * 2. `sessionExchange`, `POST /__lexcraft/session`: the shell, and only it, proves the launch secret it wrote on this
 *    process's stdin (`Authorization: Bearer <secret>`) and receives the window's cookies, which it sets in the
 *    window's own cookie store (Tauri's `Webview::set_cookie`). The secret never travels in a URL, and a request that
 *    looks like a browser's (an `Origin` or any `Sec-Fetch-*` header) is refused even with it.
 * 3. `windowGuard`, on every other request: the window's cookie, a random value made for this launch.
 */

export const WINDOW_COOKIE = 'lexcraft_window';
export const SESSION_PATH = '/__lexcraft/session';

/** The launch secret's shape: base64url, at least 32 bytes' worth. */
export const LAUNCH_SECRET = /^[A-Za-z0-9_-]{43,128}$/;

/** Constant-time comparison of two strings, whatever their lengths (both are hashed first). */
export function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** The first value of a cookie in a request, or null. The server has no cookie parser. */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function refuse(res: Response, status: number, text: string): void {
  res.status(status).set('Cache-Control', 'no-store').type('text/plain').send(text);
}

/** Step 1: the exact Host, and no request another site started. */
export function portGuard(port: number): RequestHandler {
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.host !== host) return refuse(res, 421, 'LexCraft: host non ammesso');
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return refuse(res, 403, 'LexCraft: richiesta da un altro sito');
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return refuse(res, 403, 'LexCraft: origine non ammessa');
    next();
  };
}

export interface WindowCookies {
  /** The cookies the shell sets in the window, for `http://127.0.0.1:<port>/`: HttpOnly, SameSite=Strict, Path=/. */
  cookies: Array<{ name: string; value: string }>;
}

/**
 * Step 2: the shell's exchange. `open` makes the window's session (the local profile's web session) and returns the
 * cookies to set; it runs only once the launch secret is proved.
 */
export function sessionExchange(launchSecret: string, open: (userAgent: string | undefined) => Promise<WindowCookies>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const fromBrowser = req.headers.origin !== undefined || Object.keys(req.headers).some((name) => name.startsWith('sec-fetch-'));
    const auth = req.headers.authorization ?? '';
    const given = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (fromBrowser || !sameSecret(given, launchSecret)) return refuse(res, 403, 'LexCraft: richiesta non autorizzata');
    open(req.headers['user-agent']).then((body) => {
      res.status(200).set('Cache-Control', 'no-store').json({ ...body, attributes: { path: '/', httpOnly: true, sameSite: 'Strict' } });
    }, next);
  };
}

/** Step 3: the window's cookie, on every request but the shell's exchange. */
export function windowGuard(windowToken: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const cookie = readCookie(req, WINDOW_COOKIE);
    if (cookie === null || !sameSecret(cookie, windowToken)) return refuse(res, 403, 'LexCraft: richiesta non autorizzata');
    next();
  };
}
