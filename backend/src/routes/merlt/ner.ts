import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import { requireAdmin } from '../../middleware/merlt/requireAdmin';
import { nerFeedbackRequestSchema } from '../../schemas/merlt/ner';
import { getNerClient } from '../../services/merlt/nerClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';

/**
 * MERL-T NER feedback routes (Loop β #2). Thin proxy: authenticate +
 * contributionGuard (full consent → the corrections feed the shared RLCF
 * training set), inject user_id, map camelCase → snake_case, forward to MERL-T
 * :8000. Registered in routes/merlt/index.ts BEFORE the catch-all auth routers
 * (per-route auth → order-safe; gotcha #1).
 */

// Privacy cap (decision: ±500 around the citation). The FE should already trim,
// but the server enforces it so a raw query can never be persisted.
const CONTEXT_WINDOW_MAX = 1200;

const router = Router();

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

router.post(
  '/ner/feedback',
  authenticate,
  contributionGuard,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }
    const parsed = nerFeedbackRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
      return;
    }
    const d = parsed.data;
    try {
      const result = await getNerClient().submitFeedback({
        user_id: req.user.id,
        source_surface: d.surface,
        feedback_type: d.feedbackType,
        article_urn: d.articleUrn,
        selected_text: d.selectedText,
        start_offset: d.startOffset,
        end_offset: d.endOffset,
        context_window: d.contextWindow?.slice(0, CONTEXT_WINDOW_MAX),
        original_parsed: d.originalParsed,
        correct_reference: d.correctReference,
        confidence_before: d.confidenceBefore,
      });
      res.status(202).json(result);
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

router.get(
  '/ner/feedback/stats',
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json(await getNerClient().stats());
    } catch (err) {
      handleMerltError(err, res);
    }
  }
);

export default router;
