import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { oauthConfig } from '../oauth/config';
import { decideAuthorizationRequest, readAuthorizationRequest } from '../oauth/consent';
import { revokeGrant } from '../oauth/tokens';

/**
 * The signed-in user's side of the authorization server (spec 4.1): the
 * consent page reads a pending request and sends the decision; the settings
 * list the connected applications and revoke one. Behind the user session
 * (a Bearer header, so a forged cross-site form cannot decide for anyone).
 */
const router = Router();
router.use(authenticate);

const userId = (req: Request): string => req.user!.id;
const decisionSchema = z.object({ approve: z.boolean() }).strict();

router.get('/requests/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readAuthorizationRequest(req.params.id, userId(req)));
});

router.post('/requests/:id/decision', async (req, res) => {
  const { approve } = decisionSchema.parse(req.body);
  res.setHeader('Cache-Control', 'no-store');
  res.json(await decideAuthorizationRequest(oauthConfig, req.params.id, userId(req), approve));
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
      createdAt: grant.createdAt,
      lastUsedAt: grant.lastUsedAt,
    })),
  );
});

router.delete('/grants/:id', async (req, res) => {
  const grant = await prisma.oAuthGrant.findFirst({
    where: { id: req.params.id, userId: userId(req), revokedAt: null },
  });
  if (!grant) throw new AppError(404, 'Applicazione collegata non trovata.');
  await revokeGrant(grant.id);
  res.status(204).end();
});

export default router;
