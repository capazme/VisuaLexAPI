import type { Response } from 'express';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidRequestError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { prisma } from '../lib/prisma';
import { IGNORED_SCOPES, SCOPES, type OAuthConfig } from './config';
import { matchesRedirectUri } from './redirectUri';

export const AUTHORIZATION_REQUEST_LIFETIME_MS = 10 * 60 * 1000;

/** The canonical form a resource URI is compared in. */
export const canonicalResource = (uri: string): string => new URL(uri).href;

/**
 * The scopes a request asks for, checked against the supported ones. No scope
 * means every scope of the phase; `offline_access` is accepted and dropped.
 */
export function requestedScopes(scopes: string[] | undefined): string[] {
  const asked = (scopes ?? []).filter((scope) => scope && !IGNORED_SCOPES.has(scope));
  const unknown = asked.filter((scope) => !(SCOPES as readonly string[]).includes(scope));
  if (unknown.length > 0) throw new InvalidScopeError(`unsupported scope: ${unknown.join(' ')}`);
  return asked.length > 0 ? [...new Set(asked)] : [...SCOPES];
}

/**
 * `GET /oauth/authorize`, after the SDK's handler has checked the client, the
 * redirect URI and an S256 challenge. It never issues a code: it stores the
 * request for ten minutes and sends the browser to the consent page. A client
 * library that requests the URL once before opening the browser (LibreLex's
 * does) therefore leaves only an unclaimed request behind, which expires.
 *
 * What it throws, the SDK's handler turns into an error redirect to the
 * (already validated) redirect URI.
 */
export async function beginAuthorization(
  config: OAuthConfig,
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  res: Response,
): Promise<void> {
  if (!params.resource) throw new InvalidRequestError('resource is required (RFC 8707)');
  if (params.resource.href !== canonicalResource(config.resource)) {
    throw new InvalidTargetError('resource is not served by this authorization server');
  }
  if (!matchesRedirectUri(client.redirect_uris, params.redirectUri)) {
    throw new InvalidRequestError('Unregistered redirect_uri');
  }
  const scopes = requestedScopes(params.scopes);

  const request = await prisma.oAuthAuthorizationRequest.create({
    data: {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      scopes,
      resource: params.resource.href,
      expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_LIFETIME_MS),
    },
  });
  const consent = new URL(config.consentUrl);
  consent.searchParams.set('request', request.id);
  res.redirect(302, consent.href);
}
