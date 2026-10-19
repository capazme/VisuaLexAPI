import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { DELETE_SCOPE, SCOPES, oauthConfig } from '../oauth/config';
import { SCOPE_LABELS, decideAuthorizationRequest, readAuthorizationRequest } from '../oauth/consent';
import { revokeGrant } from '../oauth/tokens';
import { delegatedQuotaStatus } from '../middleware/delegated';

/**
 * The signed-in user's side of the authorization server (spec 4.1): the
 * consent page reads a pending request and sends the decision; the settings
 * list the connected applications and revoke one. Behind the user session
 * (a Bearer header, so a forged cross-site form cannot decide for anyone).
 */
const router = Router();
router.use(authenticate);

const userId = (req: Request): string => req.user!.id;
const decisionSchema = z.object({ approve: z.boolean(), allowDelete: z.boolean().optional() }).strict();
const permissionSchema = z.object({ canDelete: z.boolean() }).strict();

router.get('/requests/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readAuthorizationRequest(req.params.id, userId(req)));
});

router.post('/requests/:id/decision', async (req, res) => {
  const { approve, allowDelete } = decisionSchema.parse(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await decideAuthorizationRequest(oauthConfig, req.params.id, userId(req), approve, allowDelete ?? false));
});

router.get('/grants', async (req, res) => {
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId: userId(req), revokedAt: null },
    include: { client: { select: { clientName: true, redirectUris: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    grants.map((grant) => ({
      id: grant.id,
      clientName: grant.client.clientName,
      redirectHost: grant.client.redirectUris[0] ? new URL(grant.client.redirectUris[0]).hostname : null,
      scopes: grant.scopes,
      canDelete: grant.scopes.includes(DELETE_SCOPE),
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    })),
  );
});

// The deletion permission of one connection, switched from the settings (spec §4.2). User session only:
// this route is outside the delegated table, so no connected application can switch its own.
router.patch('/grants/:id', async (req, res) => {
  const { canDelete } = permissionSchema.parse(req.body);
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id: req.params.id, userId: userId(req), revokedAt: null },
  });
  if (!grant) throw new AppError(404, 'Applicazione collegata non trovata.');
  const scopes = [...grant.scopes.filter((scope) => scope !== DELETE_SCOPE), ...(canDelete ? [DELETE_SCOPE] : [])];
  const updated = await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { scopes } });
  res.json({ id: updated.id, scopes: updated.scopes, canDelete });
});

router.delete('/grants/:id', async (req, res) => {
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id: req.params.id, userId: userId(req), revokedAt: null },
  });
  if (!grant) throw new AppError(404, 'Applicazione collegata non trovata.');
  await revokeGrant(grant.id);
  res.status(204).end();
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The MCP server's address as a client is given it, or null when this server has none to give: in
 * production a loopback resource is the compose default of a stack started without MCP_PUBLIC_URL,
 * whose MCP module is not running. Read at each call, so tests can switch NODE_ENV.
 */
function publicMcpUrl(): string | null {
  const host = new URL(oauthConfig.resource).hostname;
  return process.env.NODE_ENV === 'production' && LOOPBACK_HOSTS.has(host) ? null : oauthConfig.resource;
}

// What the «Collega un'app AI» page shows: the MCP server's address a client is given, and what each
// scope lets an application do, worded as the consent page words it. User session only: this route is
// outside the delegated table, so an exchanged token gets a 403.
router.get('/connection', (_req, res) => {
  res.json({
    mcpUrl: publicMcpUrl(),
    scopes: SCOPES.map((scope) => ({ scope, label: SCOPE_LABELS[scope] ?? scope })),
  });
});

// What is left of the day's allowance for connected applications. Reachable by
// an exchanged token (the MCP server's `omnilex_stato_account`) and by the user.
router.get('/quota', async (req, res) => {
  res.json(await delegatedQuotaStatus(userId(req)));
});

export default router;
