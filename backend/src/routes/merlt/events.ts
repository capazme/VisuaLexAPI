import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { consentGuard } from '../../services/merlt/consentGuard';
import {
  articleViewedRequestSchema,
  highlightAnnotationRequestSchema,
} from '../../schemas/merlt/events';
import {
  toMerltArticleViewed,
  toMerltHighlightAnnotation,
} from '../../services/merlt/eventMapper';
import {
  createMerltClient,
  MerltClient,
  MerltClientError,
  MerltBadRequestError,
} from '../../services/merlt/merltClient';
import { getOrSyncAuthority } from '../../services/merlt/authorityCache';
import { logDeadLetter } from '../../services/merlt/deadLetterLog';

const router = Router();

// Singleton client: reuse the HTTP connection pool across requests.
let cachedClient: MerltClient | null = null;
function client(): MerltClient {
  if (!cachedClient) cachedClient = createMerltClient();
  return cachedClient;
}
/** Test hook: clear the cached client (e.g. when MERLT_API_URL changes). */
export function _resetMerltClientForTests(): void {
  cachedClient = null;
}

router.use(authenticate);
router.use(consentGuard);

/**
 * POST /api/merlt/events/article-viewed
 *
 * Body: { articleUrn, normaVisitataId?, dwellMs, scrollMaxPct, sessionId }
 *
 * Flow:
 *  1. authenticate    → sets req.user
 *  2. consentGuard    → 403 if consentLevel === 'none' (or missing)
 *  3. Zod validate    → 400 with .flatten() on failure
 *  4. authorityCache  → enriches user context (best-effort)
 *  5. eventMapper     → toMerltArticleViewed(payload, userCtx)
 *  6. merltClient     → POST /api/tracking/event upstream
 *  7. Response        → 202 { trace_id } on success, 503 on MERL-T outage,
 *                       4xx pass-through on MERL-T validation errors
 *
 * Fire-and-forget contract: the frontend MUST not block UI on this call.
 */
router.post('/events/article-viewed', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = articleViewedRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  // Enrich with authority (best-effort; absence is acceptable)
  let userAuthority: number | undefined;
  let baselineQual: string | undefined;
  try {
    const cached = await getOrSyncAuthority(req.user.id, client());
    if (cached) {
      userAuthority = cached.authorityScore;
      baselineQual = cached.baselineQual;
    }
  } catch {
    // Swallow — authority enrichment is opportunistic, never blocking
  }

  const merltPayload = toMerltArticleViewed(parsed.data, {
    userId: req.user.id,
    authorityScore: userAuthority,
    baselineQual,
  });

  try {
    const result = await client().sendEvent(merltPayload);
    // MERL-T's tracking endpoint returns { received, timestamp } — there is
    // no per-event trace_id upstream (events are buffered server-side).
    // We surface both so the client can log without inventing identifiers.
    res.status(202).json({ received: result.received, timestamp: result.timestamp });
  } catch (err) {
    if (err instanceof MerltBadRequestError) {
      res.status(err.status ?? 400).json({ detail: 'merlt_rejected', upstream: err.body });
      return;
    }
    if (err instanceof MerltClientError) {
      logDeadLetter('article-viewed', req.user.id, merltPayload, err);
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/merlt/events/highlight-annotation  (MERLT-1.7)
 *
 * Single endpoint for both highlight and annotation creations — the
 * `kind` discriminator in the body decides the MERL-T `type` field
 * (`highlight:created` vs `annotation:created`).
 *
 * Flow identical to article-viewed: authenticate → consentGuard → Zod →
 * authorityCache (best-effort) → eventMapper → merltClient.sendEvent.
 */
router.post('/events/highlight-annotation', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = highlightAnnotationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  let userAuthority: number | undefined;
  let baselineQual: string | undefined;
  try {
    const cached = await getOrSyncAuthority(req.user.id, client());
    if (cached) {
      userAuthority = cached.authorityScore;
      baselineQual = cached.baselineQual;
    }
  } catch {
    // opportunistic enrichment only
  }

  const merltPayload = toMerltHighlightAnnotation(parsed.data, {
    userId: req.user.id,
    authorityScore: userAuthority,
    baselineQual,
  });

  try {
    const result = await client().sendEvent(merltPayload);
    res.status(202).json({ received: result.received, timestamp: result.timestamp });
  } catch (err) {
    if (err instanceof MerltBadRequestError) {
      res.status(err.status ?? 400).json({ detail: 'merlt_rejected', upstream: err.body });
      return;
    }
    if (err instanceof MerltClientError) {
      logDeadLetter('highlight-annotation', req.user.id, merltPayload, err);
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

export default router;
