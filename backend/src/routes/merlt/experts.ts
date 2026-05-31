import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middleware/auth';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import {
  expertQueryRequestSchema,
  inlineFeedbackRequestSchema,
  sourceFeedbackRequestSchema,
  detailedFeedbackRequestSchema,
  preferenceFeedbackRequestSchema,
  refineRequestSchema,
  confirmSourceRequestSchema,
} from '../../schemas/merlt/experts';
import { getExpertsClient } from '../../services/merlt/expertsClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';

/**
 * MERL-T expert Q&A routes (Loop β Phase F). Thin proxy: authenticate +
 * contributionGuard (full consent → "full per tutto"), inject user_id, map
 * consent, forward to MERL-T :8000. Registered in routes/merlt/index.ts BEFORE
 * the catch-all auth routers (per-route auth → order-safe; gotcha #1).
 */

const prisma = new PrismaClient();
const router = Router();

export function mapConsentLevel(
  level: string | null | undefined
): 'anonymous' | 'basic' | 'full' {
  if (level === 'full') return 'full';
  if (level === 'basic') return 'basic';
  return 'anonymous';
}

function handleMerltError(err: unknown, res: Response): void {
  if (err instanceof MerltBadRequestError) {
    res
      .status(err.status ?? 400)
      .json(typeof err.body === 'object' && err.body ? err.body : { detail: 'merlt_bad_request' });
    return;
  }
  if (err instanceof MerltClientError) {
    res.status(503).json({ detail: 'merlt_unavailable' });
    return;
  }
  throw err;
}

router.post('/experts/query', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = expertQueryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  const pref = await prisma.merltUserPreference.findUnique({
    where: { userId: req.user.id },
    select: { consentLevel: true },
  });
  try {
    const result = await getExpertsClient().query({
      query: parsed.data.query,
      user_id: req.user.id,
      consent_level: mapConsentLevel(pref?.consentLevel),
      max_experts: parsed.data.maxExperts,
      context: parsed.data.mode ? { mode: parsed.data.mode } : undefined,
      include_trace: true,
    });
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/inline', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = inlineFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackInline({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        rating: parsed.data.rating,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/source', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = sourceFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackSource({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        source_id: parsed.data.sourceId,
        relevance: parsed.data.relevance,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/detailed', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = detailedFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackDetailed({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        retrieval_score: parsed.data.retrievalScore,
        reasoning_score: parsed.data.reasoningScore,
        synthesis_score: parsed.data.synthesisScore,
        comment: parsed.data.comment,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/preference', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = preferenceFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackPreference({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        preferred_expert: parsed.data.preferredExpert,
        comment: parsed.data.comment,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/refine', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = refineRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().refine({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        follow_up_query: parsed.data.followUpQuery,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/confirm-source', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = confirmSourceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().confirmSource({
        node_id: parsed.data.nodeId,
        user_id: req.user.id,
        entity_text: parsed.data.entityText,
        entity_type: parsed.data.entityType,
        ambito: parsed.data.ambito,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

export default router;
