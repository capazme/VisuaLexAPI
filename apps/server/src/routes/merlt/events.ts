import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { consentGuard } from '../../services/merlt/consentGuard';
import {
  articleViewedRequestSchema,
  highlightAnnotationRequestSchema,
  dossierBookmarkRequestSchema,
  citationClickedRequestSchema,
  forumSignalRequestSchema,
} from '../../schemas/merlt/events';
import {
  toMerltArticleViewed,
  toMerltHighlightAnnotation,
  toMerltDossierBookmark,
  toMerltCitationClicked,
  toMerltForumSignal,
} from '../../services/merlt/eventMapper';
import {
  createMerltClient,
  MerltClient,
  MerltClientError,
  MerltBadRequestError,
} from '../../services/merlt/merltClient';
import { getOrSyncAuthority } from '../../services/merlt/authorityCache';
import { logDeadLetter } from '../../services/merlt/deadLetterLog';
import { createGraphClient, GraphClient } from '../../services/merlt/graphClient';
import { ensureIngestionJob } from '../../services/merlt/lazyIngest';

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

// Singleton graph client for the MERLT-2a.5 lazy ingestion trigger. Separate
// from the graph router's client (module-private there) on purpose.
let cachedGraphClient: GraphClient | null = null;
function graphClient(): GraphClient {
  if (!cachedGraphClient) cachedGraphClient = createGraphClient();
  return cachedGraphClient;
}
/** Test hook: clear the cached graph client (e.g. when MERLT_API_URL changes). */
export function _resetEventsGraphClientForTests(): void {
  cachedGraphClient = null;
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

  let result: { received: number; timestamp: string };
  try {
    result = await client().sendEvent(merltPayload);
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

  // MERLT-2a.5: opportunistic lazy graph ingestion. If the article is not yet
  // in the knowledge graph, enqueue an ingestion job. This is best-effort: a
  // graph-check/enqueue failure must NEVER fail the (P0) tracking event, so it
  // is fully isolated in a try/catch that dead-letters and moves on.
  let ingestionJob: { jobId: string; status: string } | undefined;
  try {
    const check = await graphClient().checkArticle(parsed.data.articleUrn);
    if (!check.exists) {
      const ensured = await ensureIngestionJob(
        prisma,
        graphClient(),
        parsed.data.articleUrn,
        req.user.id
      );
      ingestionJob = { jobId: ensured.jobId, status: ensured.status };
    }
  } catch (err) {
    logDeadLetter('graph-lazy-trigger', req.user.id, { articleUrn: parsed.data.articleUrn }, err);
  }

  // MERL-T's tracking endpoint returns { received, timestamp } — there is
  // no per-event trace_id upstream (events are buffered server-side).
  // We surface both so the client can log without inventing identifiers.
  res.status(202).json({
    received: result.received,
    timestamp: result.timestamp,
    ...(ingestionJob ? { ingestionJob } : {}),
  });
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

/**
 * POST /api/merlt/events/dossier-bookmark  (MERLT-1.8)
 *
 * Discriminator `kind` decides MERL-T type:
 *  - kind=dossier  → type=dossier:item_added
 *  - kind=bookmark → type=bookmark:added
 *
 * Same chain as the other event endpoints.
 */
router.post('/events/dossier-bookmark', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = dossierBookmarkRequestSchema.safeParse(req.body);
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
    // opportunistic
  }

  const merltPayload = toMerltDossierBookmark(parsed.data, {
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
      logDeadLetter('dossier-bookmark', req.user.id, merltPayload, err);
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/merlt/events/citation-clicked  (MERLT-1.9)
 *
 * Fired when the user follows a citation link inside an article. The
 * target URN may be null when the citation linker could not resolve
 * the reference — still a useful signal (failed-resolution edges).
 */
router.post('/events/citation-clicked', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = citationClickedRequestSchema.safeParse(req.body);
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
    // opportunistic
  }

  const merltPayload = toMerltCitationClicked(parsed.data, {
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
      logDeadLetter('citation-clicked', req.user.id, merltPayload, err);
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/merlt/events/forum-signal  (MERLT-1.10)
 *
 * Community signals from the Forum (ex Bulletin Board): like, download,
 * suggestion accept/decline. MERL-T `type` is `forum:<action>`.
 *
 * `target_author_id` attribution policy (per docs/merlt-forum-authoring-decision.md):
 *   - like / download   → originalAuthorId of the SharedEnvironment
 *   - suggestion_*      → originalAuthorId of the SuggestionItem
 * Both arrive via payload.originalAuthorId — the route does not decide,
 * the call-site does.
 */
router.post('/events/forum-signal', async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = forumSignalRequestSchema.safeParse(req.body);
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
    // opportunistic
  }

  const merltPayload = toMerltForumSignal(parsed.data, {
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
      logDeadLetter('forum-signal', req.user.id, merltPayload, err);
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

export default router;
