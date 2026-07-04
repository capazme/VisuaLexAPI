import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { internalAuth } from '../../middleware/internalAuth';
import { consentGuard } from '../../services/merlt/consentGuard';
import { ingestRequestSchema, jobCallbackSchema } from '../../schemas/merlt/graph';
import {
  createGraphClient,
  normalizeGraphUrn,
  GraphClient,
} from '../../services/merlt/graphClient';
import {
  createSubgraphCache,
  subgraphCacheKey,
  SubgraphCache,
} from '../../services/merlt/subgraphCache';
import { ensureIngestionJob } from '../../services/merlt/lazyIngest';
import { MerltClientError } from '../../services/merlt/merltClient';

/**
 * MERL-T graph layer BFF routes (Slice 2a).
 *
 * Mounted at /api/merlt (see routes/merlt/index.ts). We do NOT apply
 * `router.use(authenticate)` globally here: the worker callback route must
 * skip JWT and use the shared-secret internalAuth instead. Middleware is
 * therefore applied per-route.
 *
 *  - GET  /graph/article/:urn          authenticate
 *  - POST /graph/ingest                authenticate + consentGuard
 *  - GET  /graph/jobs/:jobId/status    authenticate
 *  - POST /internal/job-callback       internalAuth
 */

const router = Router();

/** Parse a query param to an int, falling back to `def`, clamped to [min,max]. */
function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// Singleton graph client: reuse the HTTP connection pool across requests.
let cachedGraphClient: GraphClient | null = null;
function graphClient(): GraphClient {
  if (!cachedGraphClient) cachedGraphClient = createGraphClient();
  return cachedGraphClient;
}
/** Test hook: clear the cached client (e.g. when MERLT_API_URL changes). */
export function _resetGraphClientForTests(): void {
  cachedGraphClient = null;
}

// Singleton subgraph cache (P1.12): TTL + LRU + request coalescing, shared by
// the article GET (read path) and the internal job-callback (invalidation).
let cachedSubgraphCache: SubgraphCache | null = null;
function subgraphCache(): SubgraphCache {
  if (!cachedSubgraphCache) cachedSubgraphCache = createSubgraphCache();
  return cachedSubgraphCache;
}
/** Test hook: drop the cache (entries + pending) and re-read env on next use. */
export function _resetSubgraphCacheForTests(): void {
  cachedSubgraphCache = null;
}

/**
 * GET /api/merlt/graph/article/:urn
 *
 * Returns the subgraph around the article URN. The :urn param is
 * URL-encoded by the client (URNs contain ':' and ';') — decode it.
 * On MERL-T outage/timeout → 503 merlt_unavailable.
 *
 * Intentionally `authenticate`-only, NOT consent-gated: reading the graph is a
 * passive lookup, not a contribution flow, so no consentGuard. Contrast with
 * POST /graph/ingest below, which IS consent-gated because it feeds MERL-T.
 * Do not "fix" this by adding a gate here.
 */
router.get('/graph/article/:urn', authenticate, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const urn = decodeURIComponent(req.params.urn);
  // depth ∈ [1,3] (side rail wants 1, page allows up to 3), limit ∈ [1,200].
  // MERL-T hard-caps max_nodes at 200 (graph_router.py) — a higher BFF cap
  // would be silently truncated upstream, so the clamps must stay aligned.
  const depth = clampInt(req.query.depth, 2, 1, 3);
  const limit = clampInt(req.query.limit, 200, 1, 200);

  try {
    // TTL+LRU cache with request coalescing (P1.12). Keyed on the NORMALIZED
    // urn so "…!vig=" and the bare form share one entry, matching what the
    // graphClient actually sends to MERL-T.
    const cacheKey = subgraphCacheKey(normalizeGraphUrn(urn), depth, limit);
    const subgraph = await subgraphCache().getOrFetch(cacheKey, () =>
      graphClient().getSubgraph(urn, depth, limit)
    );
    res.status(200).json(subgraph);
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

/**
 * GET /api/merlt/graph/search?q=&limit=
 *
 * Proxy to MERL-T entity search for the explorer autocomplete. authenticate-only
 * (a read lookup, like /graph/article/:urn — not consent-gated). 400 on blank q.
 */
router.get('/graph/search', authenticate, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ detail: 'q is required' });
    return;
  }
  const limit = clampInt(req.query.limit, 10, 1, 50);

  try {
    const results = await graphClient().searchEntities(q, limit);
    res.status(200).json(results);
  } catch (err) {
    if (err instanceof MerltClientError) {
      res.status(503).json({ detail: 'merlt_unavailable' });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/merlt/graph/ingest
 *
 * Body: { urn }
 *
 * Idempotent on (articleUrn, status in {pending,running}): if a job is already
 * in flight for the URN, return it with 200. Otherwise create a pending job,
 * best-effort ask MERL-T to enqueue (threading job.id as bff_job_id), and
 * return 202. If the MERL-T enqueue throws, we STILL return the job — the
 * worker may pick it up later, and we don't want to lose the BFF-side record.
 */
router.post('/graph/ingest', authenticate, consentGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const parsed = ingestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  const { urn } = parsed.data;

  // Idempotency + best-effort enqueue live in the shared ensureIngestionJob
  // helper (also used by the lazy trigger in events.ts). created=false means an
  // in-flight job for this URN already existed → 200 instead of 202.
  const { jobId, status, created } = await ensureIngestionJob(
    prisma,
    graphClient(),
    urn,
    req.user.id
  );

  res.status(created ? 202 : 200).json({ jobId, status });
});

/**
 * GET /api/merlt/graph/jobs/:jobId/status
 *
 * Returns the current status of a user-owned ingestion job. 404 if the job
 * does not exist or belongs to another user.
 */
router.get('/graph/jobs/:jobId/status', authenticate, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }

  const job = await prisma.merltIngestionJob.findFirst({
    where: { id: req.params.jobId, userId: req.user.id },
  });
  if (!job) {
    res.status(404).json({ detail: 'job_not_found' });
    return;
  }

  res.status(200).json({
    jobId: job.id,
    status: job.status,
    nodesCreated: job.nodesCreated,
    edgesCreated: job.edgesCreated,
    error: job.errorMessage,
  });
});

/**
 * POST /api/merlt/internal/job-callback
 *
 * Called by the RQ worker (internalAuth, NOT JWT) when an ingestion job
 * reaches a terminal/transitional state. Body is camelCase:
 *   { bffJobId, status, nodesCreated?, edgesCreated?, error? }
 *
 * Terminal statuses (completed/failed/timeout) set completedAt; running sets
 * startedAt. 404 if the referenced job id does not exist.
 */
router.post('/internal/job-callback', internalAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = jobCallbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }

  const { bffJobId, status, nodesCreated, edgesCreated, error } = parsed.data;

  const job = await prisma.merltIngestionJob.findUnique({ where: { id: bffJobId } });
  if (!job) {
    res.status(404).json({ detail: 'job_not_found' });
    return;
  }

  const isTerminal = ['completed', 'failed', 'timeout'].includes(status);
  await prisma.merltIngestionJob.update({
    where: { id: bffJobId },
    data: {
      status,
      nodesCreated: nodesCreated ?? undefined,
      edgesCreated: edgesCreated ?? undefined,
      errorMessage: error ?? undefined,
      // A `running` callback marks the worker actually started; terminal callbacks
      // stamp completion. This also closes the previously-dead startedAt column.
      startedAt: status === 'running' ? new Date() : undefined,
      completedAt: isTerminal ? new Date() : undefined,
    },
  });

  // P1.12: a completed ingestion changes the graph around this URN — drop every
  // cached (depth, limit) subgraph for it so the next read sees the new nodes
  // instead of a stale (possibly empty) snapshot for up to a full TTL.
  if (status === 'completed') {
    subgraphCache().invalidateUrn(normalizeGraphUrn(job.articleUrn));
  }

  res.status(200).json({ updated: true });
});

export default router;
