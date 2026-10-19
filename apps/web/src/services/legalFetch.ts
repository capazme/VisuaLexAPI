/**
 * `fetch` for the scraping API: the Python routes (/fetch_*, /stream_article_text,
 * /export_pdf, /parse_query, /health/detailed …).
 *
 * In production the ingress asks the server whether the caller is signed in before it
 * lets such a request through, so every call carries the access token. This is the one
 * place that knows it: it refreshes an expired token first (through the same single
 * in-flight refresh as services/api.ts), and on a 401 refreshes once and sends the
 * request again. It hands back fetch's own Response, so a caller reading a stream
 * (`stream_article_text`) or a file (`export_pdf`) gets exactly what fetch gives.
 *
 * Every call to those routes goes through here. `/version` and `/health` are the two the
 * ingress leaves open and need nothing. legalFetch.guard.test.ts fails on a bare fetch
 * to any other, which would work in development and be refused in production.
 */
import { getFreshAccessToken, handleUnauthenticated, refreshAccessToken } from './api';

function withAuthorization(
  headers: HeadersInit | undefined,
  token: string | null,
): HeadersInit | undefined {
  if (!token) return headers;
  const value = `Bearer ${token}`;
  if (!headers) return { Authorization: value };
  if (headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.set('Authorization', value);
    return copy;
  }
  if (Array.isArray(headers)) {
    return [...headers.filter(([name]) => name.toLowerCase() !== 'authorization'), ['Authorization', value]];
  }
  return { ...headers, Authorization: value };
}

// A request can be sent a second time only while its body is still in hand.
function canBeSentAgain(init: RequestInit): boolean {
  return init.body === undefined || init.body === null || typeof init.body === 'string';
}

export async function legalFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null): Promise<Response> => {
    const headers = withAuthorization(init.headers, token);
    // Without a token the caller's own init goes through untouched.
    return fetch(input, headers === init.headers ? init : { ...init, headers });
  };

  const response = await send(await getFreshAccessToken());
  if (response.status !== 401 || !canBeSentAgain(init)) return response;

  // The token was refused: it expired between the check and the request, or the session
  // ended. Refresh once and send again; a refresh that fails ends the session, as in api.ts.
  let token: string;
  try {
    token = await refreshAccessToken();
  } catch {
    handleUnauthenticated();
    return response;
  }
  const retry = await send(token);
  if (retry.status === 401) handleUnauthenticated();
  return retry;
}
