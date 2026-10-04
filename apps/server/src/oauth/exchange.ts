import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { canonicalResource } from './authorize';
import type { OAuthConfig } from './config';
import { ACTOR, DELEGATED_TOKEN_LIFETIME_SECONDS, delegationSecret } from './delegationSecret';
import { isMcpClient } from './mcpClient';
import { findActiveAccessToken } from './tokens';

export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/** The claims of an exchanged token (spec section 5). */
export interface DelegatedClaims {
  iss: string;
  aud: string;
  sub: string;
  act: { sub: string };
  client_id: string;
  grant: string;
  scope: string;
  jti: string;
  iat: number;
  exp: number;
}

const oauthError = (res: Response, status: number, error: string, description: string) =>
  res.status(status).json({ error, error_description: description });

/**
 * `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` on
 * `/oauth/token` (RFC 8693, spec section 5). Only the MCP server may ask, with
 * its own credential. It hands over the client's access token (the subject)
 * and gets, for one call, a token for the API: audience the API, subject the
 * user, `act` naming the MCP server, the grant, a scope within the subject's,
 * and two minutes of life. The client's token never reaches the API, and this
 * one never reaches the client.
 */
export function createExchangeHandler(config: OAuthConfig) {
  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isMcpClient(req)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
      oauthError(res, 401, 'invalid_client', 'Client authentication failed');
      return;
    }
    const secret = delegationSecret();
    if (!secret) {
      console.error('[oauth] token exchange refused: OAUTH_DELEGATION_SECRET is unset or equals JWT_SECRET');
      oauthError(res, 500, 'server_error', 'Token exchange is not configured');
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const field = (name: string) => (typeof body[name] === 'string' ? (body[name] as string) : undefined);

    if (field('subject_token_type') !== ACCESS_TOKEN_TYPE) {
      oauthError(res, 400, 'invalid_request', `subject_token_type must be ${ACCESS_TOKEN_TYPE}`);
      return;
    }
    const requestedType = field('requested_token_type');
    if (requestedType !== undefined && requestedType !== ACCESS_TOKEN_TYPE) {
      oauthError(res, 400, 'invalid_request', `requested_token_type must be ${ACCESS_TOKEN_TYPE}`);
      return;
    }
    if (field('audience') !== config.apiAudience || (field('resource') !== undefined && field('resource') !== config.apiAudience)) {
      oauthError(res, 400, 'invalid_target', 'audience must be the API');
      return;
    }
    const subjectToken = field('subject_token');
    const subject = subjectToken ? await findActiveAccessToken(subjectToken) : null;
    // The requester is the MCP server: the subject token must have been issued for it.
    if (!subject || subject.token.resource !== canonicalResource(config.resource)) {
      oauthError(res, 400, 'invalid_grant', 'The subject token is not valid here');
      return;
    }
    const scopes = [...new Set((field('scope') ?? '').split(' ').filter(Boolean))];
    if (scopes.length === 0 || scopes.some((scope) => !subject.token.scopes.includes(scope))) {
      oauthError(res, 400, 'invalid_scope', 'scope must be a non-empty part of the subject token’s scope');
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const claims: DelegatedClaims = {
      iss: config.issuer,
      aud: config.apiAudience,
      sub: subject.grant.userId,
      act: { sub: ACTOR },
      client_id: subject.grant.clientId,
      grant: subject.grant.id,
      scope: scopes.join(' '),
      jti: randomUUID(),
      iat: now,
      // Never past the subject token's own expiry.
      exp: Math.min(now + DELEGATED_TOKEN_LIFETIME_SECONDS, Math.floor(subject.token.expiresAt.getTime() / 1000)),
    };
    const token = jwt.sign(claims, secret, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'at+jwt' } });
    res.json({
      access_token: token,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: 'Bearer',
      expires_in: claims.exp - now,
      scope: claims.scope,
    });
  };
}
