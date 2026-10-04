/**
 * The redirect URI rules of spec section 4.2.
 *
 * A registered URI is matched exactly, except on a loopback host, where the
 * port is free (RFC 8252 §7.3: a native client such as Claude Code listens on a
 * port the system gives it, a new one each session). Scheme, host, path and
 * query must still match; `localhost` and `127.0.0.1` are not interchangeable.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

const isLoopback = (url: URL): boolean => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

export function matchesRedirectUri(registered: string[], requested: string): boolean {
  const req = parse(requested);
  if (!req || req.hash) return false;
  return registered.some((uri) => {
    if (uri === requested) return true;
    const reg = parse(uri);
    if (!reg || !isLoopback(reg) || !isLoopback(req)) return false;
    return req.hostname === reg.hostname && req.pathname === reg.pathname && req.search === reg.search;
  });
}

/**
 * Whether dynamic registration accepts this redirect URI: a plain-HTTP loopback
 * address, or an HTTPS address on the configured allow-list, exactly.
 */
export function isRegistrableRedirectUri(uri: string, allowList: string[]): boolean {
  const url = parse(uri);
  if (!url || url.hash || url.username || url.password) return false;
  if (isLoopback(url)) return true;
  return url.protocol === 'https:' && allowList.includes(uri);
}
