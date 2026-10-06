import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { McpConfig } from './config.js';

/** Who is calling: what the authorization server says of the client's token. */
export interface Caller {
  userId: string;
  clientId: string;
  grantId: string;
  scopes: string[];
  /** The client's access token: exchanged per call, never forwarded, never logged. */
  token: string;
}

export type AuthResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401; error?: 'invalid_token' }
  | { ok: false; status: 503 };

const basic = (config: McpConfig) =>
  `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`;

/**
 * Validates the client's access token by introspection (RFC 7662) on every
 * request, so a connection the user revoked stops at the next call. The token
 * must be live and issued for this server (its audience is our resource URI).
 */
export async function authenticate(config: McpConfig, authorization: string | undefined): Promise<AuthResult> {
  if (!authorization?.startsWith('Bearer ')) return { ok: false, status: 401 };
  const token = authorization.slice(7).trim();
  if (!token) return { ok: false, status: 401 };

  let body: Record<string, unknown>;
  try {
    const response = await fetch(`${config.authUrl}/oauth/introspect`, {
      method: 'POST',
      headers: { authorization: basic(config), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[mcp] introspection answered ${response.status}`);
      return { ok: false, status: 503 };
    }
    body = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error('[mcp] introspection failed:', error instanceof Error ? error.message : 'unknown error');
    return { ok: false, status: 503 };
  }

  if (body.active !== true || body.aud !== config.resource) return { ok: false, status: 401, error: 'invalid_token' };
  if (typeof body.sub !== 'string' || typeof body.client_id !== 'string' || typeof body.grant !== 'string') {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
  const scopes = typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [];
  return { ok: true, caller: { userId: body.sub, clientId: body.client_id, grantId: body.grant, scopes, token } };
}

export { basic as basicAuthorization };

/** The request's AuthInfo for the SDK, carrying the caller to the tools (sessions outlive tokens). */
export function authInfoFor(caller: Caller): AuthInfo {
  return { token: caller.token, clientId: caller.clientId, scopes: caller.scopes, extra: { caller } };
}

/**
 * Who is calling in this tool call: the caller introspected for this very
 * request, not the one that opened the session (a client refreshes its token
 * and carries on in the same session).
 */
export function callerOf(extra: { authInfo?: AuthInfo }): Caller {
  const caller = extra.authInfo?.extra?.caller as Caller | undefined;
  if (!caller) throw new Error('tool call without an authenticated caller');
  return caller;
}
