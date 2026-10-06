import 'dotenv/config';
import { CONFIRMATION_TIMEOUT_MS } from './confirm.js';

/**
 * The MCP server's settings. Everything that names another process comes
 * from the environment, with the development stack's values as defaults; the
 * one secret (the credential shared with the authorization server) has no
 * default.
 */
export interface McpConfig {
  host: string;
  port: number;
  /** The canonical URL of the MCP endpoint, exactly as users type it: the token audience. */
  resource: string;
  /** The authorization server's issuer, as its metadata says it. */
  issuer: string;
  /**
   * Where introspection and the token exchange are sent: the authorization
   * server's address on the network. Defaults to the issuer; in a container it
   * is the server's container address, since the public origin is not reachable
   * from inside.
   */
  authUrl: string;
  /** The API's base URL (…/api) and the audience of the tokens exchanged for it. */
  apiBase: string;
  apiAudience: string;
  clientId: string;
  clientSecret: string;
  /** Origins a browser may call from; requests without an Origin header are not browsers. */
  allowedOrigins: string[];
  /** How long a deletion waits for the user's answer to the confirmation dialog. */
  confirmationTimeoutMs: number;
}

/** A positive integer from the environment, or the default: a NaN timeout would refuse every deletion at once. */
const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const port = parseInt(env.MCP_PORT || '3002', 10);
  const issuer = (env.MCP_AUTH_ISSUER || 'http://localhost:3001').replace(/\/+$/, '');
  const authUrl = (env.MCP_AUTH_URL || issuer).replace(/\/+$/, '');
  const apiBase = (env.MCP_API_BASE || `${issuer}/api`).replace(/\/+$/, '');
  const clientSecret = env.MCP_CLIENT_SECRET || '';
  if (!clientSecret) {
    throw new Error('MCP_CLIENT_SECRET is required: the same value as OAUTH_MCP_CLIENT_SECRET in apps/server');
  }
  return {
    host: env.MCP_HOST || '127.0.0.1',
    port,
    resource: env.MCP_RESOURCE || `http://localhost:${port}/mcp`,
    issuer,
    authUrl,
    apiBase,
    apiAudience: env.MCP_API_AUDIENCE || apiBase,
    clientId: 'mcp-omnilex',
    clientSecret,
    allowedOrigins: (env.MCP_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    confirmationTimeoutMs: positiveInt(env.MCP_CONFIRMATION_TIMEOUT_MS, CONFIRMATION_TIMEOUT_MS),
  };
}
