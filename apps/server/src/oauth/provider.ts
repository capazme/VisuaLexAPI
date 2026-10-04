import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthConfig } from './config';
import { createClientsStore } from './registration';
import { beginAuthorization } from './authorize';
import { challengeForCode, exchangeCode, exchangeRefresh, findActiveAccessToken, revokeClientToken } from './tokens';

/**
 * The Prisma-backed provider the SDK's handlers call (spec E10). The SDK owns
 * the protocol plumbing (parsing, PKCE verification, client lookup, error
 * bodies); this owns what is stored and what is decided.
 */
export function createOAuthProvider(config: OAuthConfig): OAuthServerProvider {
  return {
    clientsStore: createClientsStore(config),
    authorize: (client, params, res) => beginAuthorization(config, client, params, res),
    challengeForAuthorizationCode: challengeForCode,
    exchangeAuthorizationCode: (client, code, _verifier, redirectUri, resource) =>
      exchangeCode(client, code, redirectUri, resource),
    exchangeRefreshToken: exchangeRefresh,
    async verifyAccessToken(token) {
      const active = await findActiveAccessToken(token);
      if (!active) throw new InvalidTokenError('Invalid or expired token');
      return {
        token,
        clientId: active.grant.clientId,
        scopes: active.token.scopes,
        expiresAt: Math.floor(active.token.expiresAt.getTime() / 1000),
        resource: new URL(active.token.resource),
      };
    },
    revokeToken: (client, request) => revokeClientToken(client, request.token),
  };
}
