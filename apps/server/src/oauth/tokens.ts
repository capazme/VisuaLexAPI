import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidScopeError, InvalidTargetError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthGrant, OAuthToken, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { randomSecret, sha256 } from './hash';
import { DELETE_SCOPE, IGNORED_SCOPES } from './config';

export const ACCESS_TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

async function issuePair(
  tx: Tx,
  grant: Pick<OAuthGrant, 'id'>,
  chainId: string,
  scopes: { access: string[]; refresh: string[] },
  resource: string,
): Promise<OAuthTokens> {
  const access = randomSecret();
  const refresh = randomSecret();
  const now = Date.now();
  const base = { grantId: grant.id, chainId, resource };
  await tx.oAuthToken.createMany({
    data: [
      { ...base, kind: 'ACCESS', scopes: scopes.access, tokenHash: sha256(access), expiresAt: new Date(now + ACCESS_TOKEN_LIFETIME_MS) },
      // The refresh token keeps what the chain was granted: asking for less on
      // one refresh narrows that access token only (RFC 6749 §6).
      { ...base, kind: 'REFRESH', scopes: scopes.refresh, tokenHash: sha256(refresh), expiresAt: new Date(now + REFRESH_TOKEN_LIFETIME_MS) },
    ],
  });
  await tx.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date(now) } });
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_LIFETIME_MS / 1000,
    refresh_token: refresh,
    scope: scopes.access.join(' '),
  };
}

const revokeChain = (chainId: string) =>
  prisma.oAuthToken.updateMany({ where: { chainId, revokedAt: null }, data: { revokedAt: new Date() } });

export async function revokeGrant(grantId: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.oAuthToken.updateMany({ where: { grantId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
}

/**
 * The challenge the SDK verifies the PKCE verifier against. A code that is
 * unknown, foreign, or expired without ever being used is `invalid_grant`
 * here; a used one still answers, even past its expiry, so that its replay
 * reaches `exchangeAuthorizationCode` and is recognised there.
 */
export async function challengeForCode(client: OAuthClientInformationFull, code: string): Promise<string> {
  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: sha256(code) } });
  if (!row || row.clientId !== client.client_id || (!row.usedAt && row.expiresAt.getTime() <= Date.now())) {
    throw new InvalidGrantError('Invalid authorization code');
  }
  return row.codeChallenge;
}

const REPLAY = Symbol('replay');

/**
 * Code → tokens, after the SDK verified PKCE. The request is checked first;
 * then the code is consumed by a conditional update and the tokens written in
 * the same transaction. A second presentation racing the first waits on the
 * row lock until the first commits, finds the code used, and revokes the
 * chain the first one produced (OAuth 2.1 §4.1.3): nothing it produced can
 * be committed after the revocation ran.
 */
export async function exchangeCode(
  client: OAuthClientInformationFull,
  code: string,
  redirectUri: string | undefined,
  resource: URL | undefined,
): Promise<OAuthTokens> {
  const codeHash = sha256(code);
  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash }, include: { grant: true } });
  if (!row || row.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
  if (row.usedAt) {
    await revokeChain(row.id);
    throw new InvalidGrantError('Invalid authorization code');
  }
  if (row.expiresAt.getTime() <= Date.now()) throw new InvalidGrantError('Invalid authorization code');
  if (redirectUri !== undefined && redirectUri !== row.redirectUri) {
    throw new InvalidGrantError('redirect_uri does not match the authorization request');
  }
  if (!resource) throw new InvalidTargetError('resource is required (RFC 8707)');
  if (resource.href !== row.resource) throw new InvalidTargetError('resource does not match the authorization request');
  if (row.grant.revokedAt) throw new InvalidGrantError('The authorization was revoked');

  const result = await prisma.$transaction(async (tx) => {
    const consumed = await tx.oAuthAuthorizationCode.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) return REPLAY;
    return issuePair(tx, row.grant, row.id, { access: row.scopes, refresh: row.scopes }, row.resource);
  });
  if (result === REPLAY) {
    await revokeChain(row.id);
    throw new InvalidGrantError('Invalid authorization code');
  }
  return result;
}

/**
 * Refresh with rotation. A refresh token already rotated and presented again
 * means two parties hold it: the whole grant is revoked (spec 4.2). Rotation
 * and the new pair are one transaction, so a failure between them leaves the
 * old token usable rather than burning it. Every other failure is
 * `invalid_grant`, which is what Claude expects of a dead refresh token.
 */
export async function exchangeRefresh(
  client: OAuthClientInformationFull,
  refreshToken: string,
  scopes: string[] | undefined,
  resource: URL | undefined,
): Promise<OAuthTokens> {
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { grant: true },
  });
  if (!row || row.kind !== 'REFRESH' || row.grant.clientId !== client.client_id) {
    throw new InvalidGrantError('Invalid refresh token');
  }
  if (row.rotatedAt) {
    await revokeGrant(row.grantId);
    throw new InvalidGrantError('Invalid refresh token');
  }
  if (row.revokedAt || row.grant.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    throw new InvalidGrantError('Invalid refresh token');
  }
  if (resource && resource.href !== row.resource) throw new InvalidTargetError('resource does not match the grant');
  // Deletion is the grant's to decide, read live elsewhere: a client that asks for it again
  // on refresh (every scope it once asked) is not refused, it simply does not get it here.
  const asked = scopes?.filter((scope) => scope && !IGNORED_SCOPES.has(scope) && scope !== DELETE_SCOPE);
  if (asked && asked.some((scope) => !row.scopes.includes(scope))) {
    throw new InvalidScopeError('scope exceeds what was granted');
  }
  const accessScopes = asked && asked.length > 0 ? [...new Set(asked)] : row.scopes;

  const result = await prisma.$transaction(async (tx) => {
    const rotated = await tx.oAuthToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    // Rotated by a concurrent request with the same token: the same replay.
    if (rotated.count === 0) return REPLAY;
    return issuePair(tx, row.grant, row.chainId, { access: accessScopes, refresh: row.scopes }, row.resource);
  });
  if (result === REPLAY) {
    await revokeGrant(row.grantId);
    throw new InvalidGrantError('Invalid refresh token');
  }
  return result;
}

export interface ActiveAccessToken {
  token: OAuthToken;
  grant: OAuthGrant;
}

/**
 * A live access token: known, of kind access, not expired, not revoked, its
 * grant live and its user active. Anything else is `null`, said the same way
 * whatever the reason (RFC 7662: inactive).
 */
export async function findActiveAccessToken(accessToken: string): Promise<ActiveAccessToken | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: sha256(accessToken) },
    include: { grant: { include: { user: { select: { isActive: true } } } } },
  });
  if (
    !row ||
    row.kind !== 'ACCESS' ||
    row.revokedAt ||
    row.expiresAt.getTime() <= Date.now() ||
    row.grant.revokedAt ||
    !row.grant.user.isActive
  ) {
    return null;
  }
  const { grant, ...token } = row;
  const { user: _user, ...grantRow } = grant;
  return { token, grant: grantRow };
}

/**
 * Revocation by a client (RFC 7009): only the client's own tokens; a refresh
 * token takes its chain with it. Unknown or foreign tokens are ignored, as the
 * RFC asks.
 */
export async function revokeClientToken(client: OAuthClientInformationFull, token: string): Promise<void> {
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha256(token) }, include: { grant: true } });
  if (!row || row.grant.clientId !== client.client_id) return;
  if (row.kind === 'REFRESH') {
    await revokeChain(row.chainId);
  } else {
    await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
