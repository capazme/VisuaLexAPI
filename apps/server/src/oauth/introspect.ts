import type { Request, Response } from 'express';
import { isMcpClient } from './mcpClient';
import { findActiveAccessToken } from './tokens';
import { effectiveScopes } from './config';
import { prisma } from '../lib/prisma';

/**
 * `POST /oauth/introspect` (RFC 7662), for the MCP server alone: it asks, on
 * every request it receives, whether the client's access token is live, so a
 * revoked connection stops at the next call. The answer names the user, the
 * client, the audience and the grant; an inactive token is just
 * `{ active: false }`, whatever the reason.
 */
export async function introspectionHandler(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (!isMcpClient(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
    res.status(401).json({ error: 'invalid_client', error_description: 'Client authentication failed' });
    return;
  }
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const active = token ? await findActiveAccessToken(token) : null;
  if (!active) {
    res.json({ active: false });
    return;
  }
  await prisma.oAuthGrant.update({ where: { id: active.grant.id }, data: { lastUsedAt: new Date() } });
  res.json({
    active: true,
    // Deletion is read live from the grant (spec §4.2): switching it takes effect on the next call.
    scope: effectiveScopes(active.token.scopes, active.grant.scopes).join(' '),
    client_id: active.grant.clientId,
    sub: active.grant.userId,
    aud: active.token.resource,
    exp: Math.floor(active.token.expiresAt.getTime() / 1000),
    iat: Math.floor(active.token.createdAt.getTime() / 1000),
    token_type: 'Bearer',
    grant: active.grant.id,
  });
}
