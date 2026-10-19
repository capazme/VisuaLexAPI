import { Router } from 'express';
import type { Request, Response } from 'express';
import { type MerltConsentLevel } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  consentSetRequestSchema,
  consentRevokeRequestSchema,
  preferencesForLevel,
  type ConsentResponse,
} from '../../schemas/merlt/consent';
import { authenticate } from '../../middleware/auth';
import { effectiveConsent } from '../../services/merlt/effectiveConsent';
import {
  attemptMerltErasureNow,
  eraseLocalMerltData,
  requestMerltErasure,
} from '../../services/merlt/userData';

const router = Router();

/** The current MERL-T notice, as the consent answer carries it. */
async function currentNotice() {
  return prisma.lingoTestoVersione.findFirst({
    where: { chiave: 'INFORMATIVA_MERLT' },
    orderBy: { versione: 'desc' },
    select: { id: true, versione: true, titolo: true, corpo: true, conferma: true, azione: true },
  });
}

/**
 * Build the GET response shape from current DB state.
 */
async function buildConsentResponse(userId: string): Promise<ConsentResponse> {
  const [preference, lastAudit, effective, notice] = await Promise.all([
    prisma.merltUserPreference.findUnique({ where: { userId } }),
    prisma.merltConsentAudit.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    effectiveConsent(userId),
    currentNotice(),
  ]);

  return {
    level: effective.consentLevel,
    storedLevel: preference?.consentLevel ?? 'none',
    noticeAnswered: effective.noticeAnswered,
    notice,
    contributionEnabled: effective.contributionEnabled,
    validationEnabled: effective.validationEnabled,
    graphEnabled: effective.graphEnabled,
    updatedAt: preference?.updatedAt.toISOString() ?? null,
    lastAuditAt: lastAudit?.createdAt.toISOString() ?? null,
  };
}

/**
 * Apply a level change under a notice version: upsert MerltUserPreference + write audit row.
 * Wrapped in a transaction so the audit and the new state are atomic.
 */
async function applyLevelChange(
  userId: string,
  nextLevel: MerltConsentLevel,
  noticeId: string,
  source: string,
  reason: string | undefined
): Promise<void> {
  const prefs = preferencesForLevel(nextLevel);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.merltUserPreference.findUnique({
      where: { userId },
      select: { consentLevel: true },
    });

    const state = {
      consentLevel: nextLevel,
      contributionEnabled: prefs.contributionEnabled,
      validationEnabled: prefs.validationEnabled,
      graphEnabled: prefs.graphEnabled,
      informativaTestoId: noticeId,
    };
    await tx.merltUserPreference.upsert({
      where: { userId },
      create: { userId, ...state },
      update: state,
    });

    await tx.merltConsentAudit.create({
      data: {
        userId,
        previousLevel: existing?.consentLevel ?? null,
        nextLevel,
        source,
        reason: reason ?? null,
        informativaTestoId: noticeId,
      },
    });
  });
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

  // A choice counts only under the notice the person read: the current version.
  const notice = await currentNotice();
  if (!notice || notice.id !== parsed.data.noticeId) {
    res.status(409).json({ detail: 'notice_changed', notice });
    return;
  }

  await applyLevelChange(req.user.id, parsed.data.level, notice.id, 'user', parsed.data.reason);
  res.status(200).json(await buildConsentResponse(req.user.id));
});

router.delete('/consent', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const userId = req.user.id;

  // DELETE body is optional in browsers; treat undefined as {}
  const parsed = consentRevokeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  // A revocation answers the current notice with «none»: it is never asked again until a new
  // version comes. The notice always exists (the migrations write version 1).
  const notice = await currentNotice();
  if (!notice) {
    res.status(503).json({ detail: 'notice_missing' });
    return;
  }
  await applyLevelChange(userId, 'none', notice.id, 'user', parsed.data.reason);

  let erasure: { requested: boolean; completed: boolean } = { requested: false, completed: false };
  if (parsed.data.deleteData) {
    await prisma.$transaction(async (tx) => {
      await requestMerltErasure(tx, userId, 'consent_revoked');
      await eraseLocalMerltData(tx, userId);
    });
    erasure = { requested: true, completed: await attemptMerltErasureNow(userId, 15_000) };
  }
  res.status(200).json({ ...(await buildConsentResponse(userId)), erasure });
});

export default router;
