import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { SCOPES, endpoint, type OAuthConfig } from './config';

export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

/**
 * RFC 8414 metadata. Written here rather than taken from the SDK's
 * `createOAuthMetadata`, which puts the endpoints at the root, knows neither
 * token exchange nor introspection, and adds a trailing slash to the issuer:
 * `iss` must equal this `issuer` character for character (RFC 9207).
 */
// RFC 9207's flag is not in the SDK's type yet.
export type ServerMetadata = OAuthMetadata & { authorization_response_iss_parameter_supported: boolean };

export function authorizationServerMetadata(config: OAuthConfig): ServerMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: endpoint(config, '/oauth/authorize'),
    token_endpoint: endpoint(config, '/oauth/token'),
    registration_endpoint: endpoint(config, '/oauth/register'),
    revocation_endpoint: endpoint(config, '/oauth/revoke'),
    introspection_endpoint: endpoint(config, '/oauth/introspect'),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', TOKEN_EXCHANGE_GRANT],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none'],
    introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}
