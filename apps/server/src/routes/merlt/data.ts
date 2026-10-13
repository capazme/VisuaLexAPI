import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import {
  MerltUnavailableError,
  attemptMerltErasureNow,
  eraseLocalMerltData,
  exportFromMerlt,
  requestMerltErasure,
} from '../../services/merlt/userData';

/**
 * The person's own MERL-T data, from Impostazioni › Dati MERL-T (spec
 * docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md):
 *
 *  - GET /data/export → everything MERL-T keeps about them and what this server keeps for
 *    MERL-T (the consent and its history, the questions to the assistant, the jobs, the cached
 *    authority), as one JSON download. 503 when MERL-T cannot answer: a copy without MERL-T's
 *    part would look complete and not be.
 *  - DELETE /data → erase it: this server's rows at once, MERL-T's through a request that is
 *    retried until MERL-T confirms (`services/merlt/userData.ts`). 202 with `completed`. The
 *    consent stays as it is: erasing the data is not a revocation.
 *
 * Session only: neither route is in the delegated table, so an exchanged token gets 403.
 */
const router = Router();

router.get('/data/export', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  let merlt: unknown;
  try {
    merlt = await exportFromMerlt(userId);
  } catch (err) {
    if (err instanceof MerltUnavailableError) {
      res.status(503).json({ detail: 'MERL-T non è raggiungibile: riprova più tardi.' });
      return;
    }
    throw err;
  }
  const [preference, audits, qaJobs, ingestionJobs, extractionJobs, authority] = await Promise.all([
    prisma.merltUserPreference.findUnique({
      where: { userId },
      select: {
        consentLevel: true,
        contributionEnabled: true,
        validationEnabled: true,
        graphEnabled: true,
        createdAt: true,
        updatedAt: true,
        informativa: { select: { versione: true } },
      },
    }),
    prisma.merltConsentAudit.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        previousLevel: true,
        nextLevel: true,
        source: true,
        reason: true,
        createdAt: true,
        informativa: { select: { versione: true } },
      },
    }),
    prisma.merltQaJob.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.merltIngestionJob.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.merltExtractionJob.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.merltUserAuthorityCache.findUnique({ where: { userId } }),
  ]);
  res.setHeader('Content-Disposition', 'attachment; filename="dati-merlt.json"');
  res.json({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    visualex: { consent: preference, consentHistory: audits, qaJobs, ingestionJobs, extractionJobs, authority },
    merlt,
  });
});

router.delete('/data', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    // The request first: it reads whether work is in flight from the jobs about to go.
    await requestMerltErasure(tx, userId, 'user_request');
    await eraseLocalMerltData(tx, userId);
  });
  const completed = await attemptMerltErasureNow(userId, 15_000);
  res.status(202).json({ completed });
});

export default router;
