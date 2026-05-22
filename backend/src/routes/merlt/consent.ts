import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient, type MerltConsentLevel } from '@prisma/client';
import {
  consentSetRequestSchema,
  consentRevokeRequestSchema,
  preferencesForLevel,
  type ConsentResponse,
} from '../../schemas/merlt/consent';
import { authenticate } from '../../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

/**
 * Build the GET response shape from current DB state.
 */
async function buildConsentResponse(userId: string): Promise<ConsentResponse> {
  const [preference, lastAudit] = await Promise.all([
    prisma.merltUserPreference.findUnique({ where: { userId } }),
    prisma.merltConsentAudit.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  if (!preference) {
    return {
      level: 'none',
      contributionEnabled: false,
      validationEnabled: false,
      graphEnabled: false,
      updatedAt: null,
      lastAuditAt: lastAudit?.createdAt.toISOString() ?? null,
    };
  }

  return {
    level: preference.consentLevel,
    contributionEnabled: preference.contributionEnabled,
    validationEnabled: preference.validationEnabled,
    graphEnabled: preference.graphEnabled,
    updatedAt: preference.updatedAt.toISOString(),
    lastAuditAt: lastAudit?.createdAt.toISOString() ?? null,
  };
}

/**
 * Apply a level change: upsert MerltUserPreference + write audit row.
 * Wrapped in a transaction so the audit and the new state are atomic.
 */
async function applyLevelChange(
  userId: string,
  nextLevel: MerltConsentLevel,
  source: string,
  reason: string | undefined
): Promise<ConsentResponse> {
  const prefs = preferencesForLevel(nextLevel);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.merltUserPreference.findUnique({
      where: { userId },
      select: { consentLevel: true },
    });

    await tx.merltUserPreference.upsert({
      where: { userId },
      create: {
        userId,
        consentLevel: nextLevel,
        contributionEnabled: prefs.contributionEnabled,
        validationEnabled: prefs.validationEnabled,
        graphEnabled: prefs.graphEnabled,
      },
      update: {
        consentLevel: nextLevel,
        contributionEnabled: prefs.contributionEnabled,
        validationEnabled: prefs.validationEnabled,
        graphEnabled: prefs.graphEnabled,
      },
    });

    await tx.merltConsentAudit.create({
      data: {
        userId,
        previousLevel: existing?.consentLevel ?? null,
        nextLevel,
        source,
        reason: reason ?? null,
      },
    });
  });

  return buildConsentResponse(userId);
}

router.use(authenticate);

router.get('/consent', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const response = await buildConsentResponse(req.user.id);
  res.json(response);
});

router.post('/consent', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = consentSetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  const response = await applyLevelChange(
    req.user.id,
    parsed.data.level,
    'user',
    parsed.data.reason
  );
  res.status(200).json(response);
});

router.delete('/consent', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  // DELETE body is optional in browsers; treat undefined as {}
  const parsed = consentRevokeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  const response = await applyLevelChange(req.user.id, 'none', 'user', parsed.data.reason);
  res.status(200).json(response);
});

export default router;
