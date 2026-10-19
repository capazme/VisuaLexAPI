/**
 * The authorization server's settings (MCP spike, spec section 4). Read from
 * the environment once; `readOAuthConfig` takes any environment so tests can
 * build a router with other values.
 */

export const SCOPES = ['dossier:read', 'dossier:write', 'lingo:cards:read', 'lingo:cards:write', 'content:delete'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * The permission to delete through a connected application (MCP second round,
 * spec §4.2): granted only when the user ticks it, switchable per connection,
 * and read live from the grant, never from the token.
 */
export const DELETE_SCOPE = 'content:delete';

/** The token's scopes with deletion read live from the grant: switching it takes effect on the next call. */
export function effectiveScopes(tokenScopes: string[], grantScopes: string[]): string[] {
  const rest = tokenScopes.filter((scope) => scope !== DELETE_SCOPE && grantScopes.includes(scope));
  return grantScopes.includes(DELETE_SCOPE) ? [...rest, DELETE_SCOPE] : rest;
}

// Asked for by clients that read `scopes_supported` as the list to request
// (or by habit): refresh tokens are always issued, so it is accepted and dropped.
export const IGNORED_SCOPES = new Set(['offline_access']);

export interface OAuthConfig {
  /** The `issuer`, exactly as the metadata and the `iss` parameter carry it. */
  issuer: string;
  /** The MCP server's canonical URI: the only `resource` and token audience. */
  resource: string;
  /** The audience of exchanged tokens: the API, never the MCP server. */
  apiAudience: string;
  /** The web page that shows the consent; the request id is appended as `?request=`. */
  consentUrl: string;
  /** HTTPS redirect URIs a client may register besides loopback ones. */
  allowedRedirectUris: string[];
  /** Dynamic registrations allowed per address per hour. */
  registrationsPerHour: number;
  /**
   * Requests per address per 15 minutes on authorize, token and revoke; unset
   * keeps the SDK's defaults (100, 50, 50). Introspection and the token
   * exchange, which the MCP server calls for every user from one address,
   * have a much higher ceiling of their own.
   */
  requestsPer15Minutes?: number;
}

const list = (value: string | undefined, fallback: string): string[] =>
  (value ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function readOAuthConfig(env: NodeJS.ProcessEnv): OAuthConfig {
  const issuer = (env.OAUTH_ISSUER || 'http://localhost:3001').replace(/\/+$/, '');
  return {
    issuer,
    apiAudience: env.OAUTH_API_AUDIENCE || `${issuer}/api`,
    resource: env.OAUTH_MCP_RESOURCE || 'http://localhost:3002/mcp',
    consentUrl: env.OAUTH_CONSENT_URL || 'http://localhost:5173/connect',
    // Claude's hosted apps (verified on Anthropic's documentation, 2 October 2026).
    allowedRedirectUris: list(env.OAUTH_ALLOWED_REDIRECT_URIS, 'https://claude.ai/api/mcp/auth_callback'),
    registrationsPerHour: parseInt(env.OAUTH_REGISTRATIONS_PER_HOUR || '10', 10),
    requestsPer15Minutes: env.OAUTH_REQUESTS_PER_15_MINUTES ? parseInt(env.OAUTH_REQUESTS_PER_15_MINUTES, 10) : undefined,
  };
}

export const oauthConfig = readOAuthConfig(process.env);

/** An endpoint's absolute URL under the issuer. */
export const endpoint = (config: OAuthConfig, path: string): string => `${config.issuer}${path}`;
