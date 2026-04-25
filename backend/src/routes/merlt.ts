import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
const prisma = new PrismaClient();

const MERLT_API_PREFIX = '/api/v1';
const MERLT_SLOTS = [
  'article_toolbar',
  'article_sidebar',
  'content_overlay',
  'graph_view',
  'profile_tabs',
  'admin_dashboard',
  'dossier_actions',
  'bulletin_community',
] as const;

const metadataSchema = z.record(z.string(), z.unknown());
const consentLevelSchema = z.enum(['none', 'basic', 'full']);
type MerltConsentLevel = z.infer<typeof consentLevelSchema>;

const querySchema = z.object({
  query: z.string().trim().min(5),
  articleText: z.string().optional(),
  normaData: metadataSchema.optional(),
  includeTrace: z.boolean().optional(),
  maxExperts: z.number().int().min(1).max(4).optional(),
  consentLevel: z.enum(['anonymous', 'basic', 'full']).optional(),
  mode: z.enum(['convergent', 'divergent']).optional(),
});

const inlineFeedbackSchema = z.object({
  traceId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  articleUrn: z.string().optional(),
  comment: z.string().optional(),
});

const entityValidationSchema = z.object({
  entity_id: z.string().trim().min(1, 'entity_id is required'),
  vote: z.string().trim().min(1, 'vote is required'),
  suggested_edits: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  user_authority: z.number().min(0).max(1).optional(),
});

const relationValidationSchema = z.object({
  relation_id: z.string().trim().min(1, 'relation_id is required'),
  vote: z.string().trim().min(1, 'vote is required'),
  suggested_edits: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  user_authority: z.number().min(0).max(1).optional(),
});

const entityProposalSchema = z.object({
  article_urn: z.string().trim().min(1, 'article_urn is required'),
  nome: z.string().trim().min(1, 'nome is required'),
  tipo: z.string().trim().min(1, 'tipo is required'),
  descrizione: z.string().trim().min(1, 'descrizione is required'),
  articoli_correlati: z.array(z.string()).optional(),
  ambito: z.string().optional(),
  evidence: z.string().optional(),
  source_reference: z.string().nullable().optional(),
  skip_duplicate_check: z.boolean().optional(),
  acknowledged_duplicate_of: z.string().nullable().optional(),
});

const relationProposalSchema = z.object({
  source_urn: z.string().trim().min(1, 'source_urn is required'),
  target_entity_id: z.string().trim().min(1, 'target_entity_id is required'),
  tipo_relazione: z.string().trim().min(1, 'tipo_relazione is required'),
  article_urn: z.string().trim().min(1, 'article_urn is required'),
  descrizione: z.string().trim().min(1, 'descrizione is required'),
  certezza: z.number().min(0).max(1).optional(),
  skip_duplicate_check: z.boolean().optional(),
  acknowledged_duplicate_of: z.string().nullable().optional(),
});

const graphSearchSchema = z.object({
  query: z.string().trim().min(1, 'query is required'),
  filters: z.record(z.unknown()).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const consentUpdateSchema = z.object({
  consentLevel: consentLevelSchema,
  contributionEnabled: z.boolean().optional(),
  validationEnabled: z.boolean().optional(),
  graphEnabled: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

type MerltRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

type MerltErrorBody = {
  detail?: string;
  message?: string;
};

class MerltGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'MerltGatewayError';
  }
}

function merltBaseUrl(): string {
  return config.merlt.apiUrl.replace(/\/+$/, '');
}

function buildHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-ID': req.user!.id,
  };

  const authorization = req.header('authorization');
  if (authorization) {
    headers.Authorization = authorization;
  }

  if (config.merlt.apiKey) {
    headers['X-API-Key'] = config.merlt.apiKey;
  }

  return headers;
}

function appendQuery(path: string, query: Request['query']): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach(item => {
        if (item !== undefined) params.append(key, String(item));
      });
      continue;
    }
    if (value !== undefined) params.set(key, String(value));
  }

  const qs = params.toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

function withUserId(req: Request, body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>), user_id: req.user!.id };
  }
  return { user_id: req.user!.id, payload: body };
}

async function callMerlt<T>(
  req: Request,
  path: string,
  options: MerltRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.merlt.timeoutMs);

  try {
    const response = await fetch(`${merltBaseUrl()}${path}`, {
      method: options.method || 'GET',
      headers: buildHeaders(req),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const errorBody = payload as MerltErrorBody;
      const detail = typeof errorBody.detail === 'string'
        ? errorBody.detail
        : typeof errorBody.message === 'string'
          ? errorBody.message
          : `MERLT returned ${response.status}`;
      throw new MerltGatewayError(detail, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('MERLT returned a non-JSON response');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyGet(req: Request, res: Response, targetPath: string): Promise<void> {
  try {
    const result = await callMerlt(req, appendQuery(targetPath, req.query));
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
}

async function proxyPost(
  req: Request,
  res: Response,
  targetPath: string,
  options: { injectUserId?: boolean } = { injectUserId: true },
): Promise<void> {
  try {
    const result = await callMerlt(req, targetPath, {
      method: 'POST',
      body: options.injectUserId === false ? req.body : withUserId(req, req.body),
    });
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
}

async function validateAndProxyPost(
  req: Request,
  res: Response,
  targetPath: string,
  schema: z.ZodSchema,
  options: { injectUserId?: boolean } = { injectUserId: true },
): Promise<void> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: parsed.error.issues[0]?.message || 'Invalid MERLT payload' });
    return;
  }

  try {
    const result = await callMerlt(req, targetPath, {
      method: 'POST',
      body: options.injectUserId === false ? parsed.data : withUserId(req, parsed.data),
    });
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
}

async function proxyPatch(
  req: Request,
  res: Response,
  targetPath: string,
  options: { injectUserId?: boolean } = { injectUserId: true },
): Promise<void> {
  try {
    const result = await callMerlt(req, targetPath, {
      method: 'PATCH',
      body: options.injectUserId === false ? req.body : withUserId(req, req.body),
    });
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
}

function mapGatewayError(error: unknown): { status: number; detail: string } {
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, detail: 'MERLT request timed out' };
  }

  if (error instanceof MerltGatewayError) {
    return { status: error.status, detail: error.message };
  }

  if (error instanceof Error) {
    return { status: 502, detail: error.message };
  }

  return { status: 502, detail: 'MERLT gateway error' };
}

async function getOrCreatePreference(userId: string) {
  return prisma.merltUserPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

function featurePayload(req: Request, consentLevel: MerltConsentLevel) {
  const isAdmin = Boolean(req.user?.isAdmin);
  const hasBasicConsent = consentLevel === 'basic' || consentLevel === 'full';
  const hasFullConsent = consentLevel === 'full';

  return {
    enabled: config.merlt.enabled,
    consent_required: true,
    consent_level: consentLevel,
    features: {
      merlt: config.merlt.enabled && hasBasicConsent,
      merlt_contribution: config.merlt.enabled && config.merlt.flags.contribution && hasFullConsent,
      merlt_validation: config.merlt.enabled && config.merlt.flags.validation && hasFullConsent,
      merlt_graph: config.merlt.enabled && config.merlt.flags.graph && hasBasicConsent,
      merlt_ops: config.merlt.enabled && config.merlt.flags.ops && isAdmin,
    },
    slots: MERLT_SLOTS,
    user: {
      id: req.user!.id,
      isAdmin,
    },
  };
}

async function requireConsent(req: Request, res: Response): Promise<boolean> {
  const preference = await getOrCreatePreference(req.user!.id);
  if (preference.consentLevel === 'none') {
    res.status(403).json({ detail: 'MERLT consent is required for this action' });
    return false;
  }
  return true;
}

function requireMerltAdminApiKey(res: Response): boolean {
  if (config.merlt.apiKey) return true;
  res.status(503).json({
    detail: 'MERLT admin API key is required for this operation. Set MERLT_API_KEY with an admin-capable MERLT key.',
  });
  return false;
}

router.use(authenticate);

router.get('/merlt/features', async (req, res) => {
  const preference = await getOrCreatePreference(req.user!.id);
  res.json(featurePayload(req, preference.consentLevel as MerltConsentLevel));
});

router.get('/merlt/consent', async (req, res) => {
  const preference = await getOrCreatePreference(req.user!.id);
  res.json({
    consentLevel: preference.consentLevel,
    contributionEnabled: preference.contributionEnabled,
    validationEnabled: preference.validationEnabled,
    graphEnabled: preference.graphEnabled,
    updatedAt: preference.updatedAt,
  });
});

async function updateConsentHandler(req: Request, res: Response): Promise<void> {
  const parsed = consentUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: parsed.error.issues[0]?.message || 'Invalid MERLT consent payload' });
    return;
  }

  const current = await getOrCreatePreference(req.user!.id);
  const next = parsed.data;
  const nextContributionEnabled = next.consentLevel === 'full' && (next.contributionEnabled ?? current.contributionEnabled);
  const nextValidationEnabled = next.consentLevel === 'full' && (next.validationEnabled ?? current.validationEnabled);
  const nextGraphEnabled = next.consentLevel !== 'none' && (next.graphEnabled ?? current.graphEnabled);

  const [preference] = await prisma.$transaction([
    prisma.merltUserPreference.update({
      where: { userId: req.user!.id },
      data: {
        consentLevel: next.consentLevel,
        contributionEnabled: nextContributionEnabled,
        validationEnabled: nextValidationEnabled,
        graphEnabled: nextGraphEnabled,
      },
    }),
    prisma.merltConsentAudit.create({
      data: {
        userId: req.user!.id,
        previousLevel: current.consentLevel,
        nextLevel: next.consentLevel,
        reason: next.reason,
      },
    }),
  ]);

  res.json({
    consentLevel: preference.consentLevel,
    contributionEnabled: preference.contributionEnabled,
    validationEnabled: preference.validationEnabled,
    graphEnabled: preference.graphEnabled,
    updatedAt: preference.updatedAt,
    features: featurePayload(req, preference.consentLevel as MerltConsentLevel),
  });
}

router.put('/merlt/consent', updateConsentHandler);
router.post('/merlt/consent', updateConsentHandler);

router.get('/merlt/health', async (req, res) => {
  try {
    const health = await callMerlt(req, '/health');
    res.json(health);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
});

router.get('/merlt/health/deep', async (req, res) => {
  const [health, dashboard] = await Promise.allSettled([
    callMerlt(req, '/health'),
    callMerlt(req, `${MERLT_API_PREFIX}/dashboard/health`),
  ]);

  const payload = {
    status: health.status === 'fulfilled' && dashboard.status === 'fulfilled' ? 'ok' : 'degraded',
    health: health.status === 'fulfilled' ? health.value : { error: mapGatewayError(health.reason).detail },
    dashboard: dashboard.status === 'fulfilled' ? dashboard.value : { error: mapGatewayError(dashboard.reason).detail },
  };

  res.status(payload.status === 'ok' ? 200 : 502).json(payload);
});

router.post('/merlt/experts/query', async (req, res) => {
  if (!(await requireConsent(req, res))) return;

  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: parsed.error.issues[0]?.message || 'Invalid MERLT query payload' });
    return;
  }

  const { query, articleText, normaData, includeTrace, maxExperts, consentLevel, mode } = parsed.data;
  const articleUrn = typeof normaData?.urn === 'string' ? normaData.urn : undefined;
  const articleNumber = typeof normaData?.numero_articolo === 'string' ? normaData.numero_articolo : undefined;
  const retrievedChunks = articleText
    ? [{
      text: articleText,
      urn: articleUrn,
      article_urn: articleUrn,
      chunk_id: articleUrn || `visualex_article_${articleNumber || 'current'}`,
      source_type: 'norma',
      source: 'visualex',
      metadata: normaData,
      final_score: 1,
    }]
    : [];

  try {
    const result = await callMerlt(req, `${MERLT_API_PREFIX}/experts/query`, {
      method: 'POST',
      body: {
        query,
        user_id: req.user!.id,
        context: {
          entities: articleUrn ? { norm_references: [articleUrn] } : undefined,
          retrieved_chunks: retrievedChunks,
          article_urn: articleUrn,
          norma_data: normaData,
        },
        max_experts: maxExperts ?? 4,
        include_trace: includeTrace ?? false,
        consent_level: consentLevel ?? 'basic',
        mode: mode ?? 'convergent',
      },
    });
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
});

router.post('/merlt/query', async (_req, res) => {
  res.status(410).json({
    detail: 'Use /api/merlt/experts/query. The legacy minimal MERLT query endpoint has been retired.',
  });
});

router.post('/merlt/experts/feedback/inline', async (req, res) => {
  const parsed = inlineFeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: parsed.error.issues[0]?.message || 'Invalid MERLT feedback payload' });
    return;
  }

  try {
    const result = await callMerlt(req, `${MERLT_API_PREFIX}/experts/feedback/inline`, {
      method: 'POST',
      body: {
        trace_id: parsed.data.traceId,
        user_id: req.user!.id,
        rating: parsed.data.rating,
        article_urn: parsed.data.articleUrn,
        comment: parsed.data.comment,
      },
    });
    res.json(result);
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
});

router.post('/merlt/feedback', (_req, res) => {
  res.status(410).json({
    detail: 'Use /api/merlt/experts/feedback/inline. The legacy minimal MERLT feedback endpoint has been retired.',
  });
});

router.post('/merlt/experts/feedback/detailed', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/experts/feedback/detailed`));
router.post('/merlt/experts/feedback/source', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/experts/feedback/source`));
router.post('/merlt/experts/feedback/preference', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/experts/feedback/preference`));
router.post('/merlt/experts/feedback/router', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/experts/feedback/router`));
router.post('/merlt/experts/feedback/refine', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/experts/feedback/refine`));
router.get('/merlt/experts/trace/:traceId', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/experts/trace/${encodeURIComponent(req.params.traceId)}`));
router.get('/merlt/expert-metrics/performance', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/expert-metrics/performance`));
router.get('/merlt/expert-metrics/queries/stats', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/expert-metrics/queries/stats`));
router.get('/merlt/expert-metrics/queries/recent', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/expert-metrics/queries/recent`));
router.get('/merlt/expert-metrics/trace/:traceId', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/expert-metrics/trace/${encodeURIComponent(req.params.traceId)}`));
router.get('/merlt/expert-metrics/aggregation', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/expert-metrics/aggregation`));

router.post('/merlt/feedback/interaction', async (req, res) => {
  if (!(await requireConsent(req, res))) return;
  await proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/interaction`);
});
router.post('/merlt/feedback/batch', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/batch`));
router.post('/merlt/feedback/explicit', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/explicit`));
router.post('/merlt/feedback/session', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/session`));
router.get('/merlt/feedback/mappings', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/feedback/mappings`));
router.post('/merlt/tracking/events', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/tracking/events`));

router.get('/merlt/enrichment/check-article', (req, res) => {
  const { numero_articolo: _numeroArticolo, article_urn: _articleUrn, ...restQuery } = req.query;
  const query = {
    ...restQuery,
    articolo: req.query.articolo ?? req.query.numero_articolo,
  };
  void (async () => {
    try {
      const result = await callMerlt(req, appendQuery(`${MERLT_API_PREFIX}/enrichment/check-article`, query));
      res.json(result);
    } catch (error) {
      const mapped = mapGatewayError(error);
      res.status(mapped.status).json({ detail: mapped.detail });
    }
  })();
});

router.post('/merlt/enrichment/live', (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const normaData = body.norma_data && typeof body.norma_data === 'object'
    ? body.norma_data as Record<string, unknown>
    : {};

  const transformedBody = {
      ...body,
      tipo_atto: body.tipo_atto ?? normaData.tipo_atto,
      articolo: body.articolo ?? normaData.numero_articolo,
  };

  void (async () => {
    try {
      const result = await callMerlt(req, `${MERLT_API_PREFIX}/enrichment/live`, {
        method: 'POST',
        body: withUserId(req, transformedBody),
      });
      res.json(result);
    } catch (error) {
      const mapped = mapGatewayError(error);
      res.status(mapped.status).json({ detail: mapped.detail });
    }
  })();
});
router.get('/merlt/enrichment/pending', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/pending`));
router.post('/merlt/enrichment/validate-entity', (req, res) => validateAndProxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/validate-entity`, entityValidationSchema));
router.post('/merlt/enrichment/validate-relation', (req, res) => validateAndProxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/validate-relation`, relationValidationSchema));
router.post('/merlt/enrichment/propose-entity', (req, res) => validateAndProxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/propose-entity`, entityProposalSchema));
router.post('/merlt/enrichment/propose-relation', (req, res) => validateAndProxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/propose-relation`, relationProposalSchema));
router.post('/merlt/enrichment/check-duplicate', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/check-duplicate`));
router.post('/merlt/enrichment/check-relation-duplicate', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/check-relation-duplicate`));
router.post('/merlt/enrichment/report-issue', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/report-issue`));
router.post('/merlt/enrichment/vote-issue', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/vote-issue`));
router.get('/merlt/enrichment/entity-issues/:entityId', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/entity-issues/${encodeURIComponent(req.params.entityId)}`));
router.get('/merlt/enrichment/open-issues', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/open-issues`));
router.post('/merlt/enrichment/dossier-training-export', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/dossier-training-export`));
router.post('/merlt/enrichment/dossier-training-export-full', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/dossier-training-export-full`));
router.post('/merlt/enrichment/load-dossier-training', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/load-dossier-training`));
router.post('/merlt/enrichment/ner-feedback', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/ner-feedback`));
router.post('/merlt/enrichment/ner-feedback-confirm', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/enrichment/ner-feedback-confirm`));
router.get('/merlt/enrichment/ner-feedback/history', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/ner-feedback/history`));
router.get('/merlt/enrichment/ner-feedback/history/all', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/ner-feedback/history/all`));
router.get('/merlt/enrichment/ner-feedback/stats', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/enrichment/ner-feedback/stats`));

router.get('/merlt/graph/check-article', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/check-article`));
router.get('/merlt/graph/node/:nodeId', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/node/${encodeURIComponent(req.params.nodeId)}`));
router.get('/merlt/graph/article-entities', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/article-entities`));
router.get('/merlt/graph/article/:articleUrn/entities', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/article-entities?article_urn=${encodeURIComponent(req.params.articleUrn)}`));
router.get('/merlt/graph/article-relations', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/article-relations`));
router.get('/merlt/graph/article/:articleUrn/relations', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/article-relations?article_urn=${encodeURIComponent(req.params.articleUrn)}`));
router.get('/merlt/graph/entities/search', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/entities/search`));
router.post('/merlt/graph/resolve-norm', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/graph/resolve-norm`));
router.get('/merlt/graph/overview', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/overview`));
router.get('/merlt/graph/subgraph', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/graph/subgraph`));
router.post('/merlt/graph/search', (req, res) => validateAndProxyPost(req, res, `${MERLT_API_PREFIX}/graph/search`, graphSearchSchema, { injectUserId: false }));

router.get('/merlt/profile/me/full', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/full?user_id=${encodeURIComponent(req.user!.id)}`));
router.get('/merlt/profile/me/authority', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/authority/domains?user_id=${encodeURIComponent(req.user!.id)}`));
router.get('/merlt/profile/me/contributions', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/stats/detailed?user_id=${encodeURIComponent(req.user!.id)}`));
router.patch('/merlt/profile/me/qualification', (req, res) => proxyPatch(req, res, `${MERLT_API_PREFIX}/profile/qualification?user_id=${encodeURIComponent(req.user!.id)}`, { injectUserId: false }));
router.patch('/merlt/profile/me/notifications', (req, res) => proxyPatch(req, res, `${MERLT_API_PREFIX}/profile/notifications?user_id=${encodeURIComponent(req.user!.id)}`, { injectUserId: false }));
router.get('/merlt/profile/:userId/full', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/full?user_id=${encodeURIComponent(req.params.userId)}`));
router.get('/merlt/profile/:userId/authority', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/authority/domains?user_id=${encodeURIComponent(req.params.userId)}`));
router.get('/merlt/profile/:userId/contributions', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/profile/stats/detailed?user_id=${encodeURIComponent(req.params.userId)}`));

router.post('/merlt/documents/upload', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/documents/upload`, { injectUserId: true }));
router.get('/merlt/documents', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/documents`));
router.post('/merlt/documents/:documentId/parse', (req, res) => {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    res.status(400).json({ detail: 'A valid numeric document_id is required before parsing a MERLT document' });
    return;
  }
  void proxyPost(req, res, `${MERLT_API_PREFIX}/documents/${documentId}/parse`, { injectUserId: true });
});
router.get('/merlt/documents/:documentId', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/documents/${encodeURIComponent(req.params.documentId)}`));

router.get('/merlt/rlcf/status', async (req, res) => {
  try {
    const [training, buffer] = await Promise.all([
      callMerlt(req, `${MERLT_API_PREFIX}/rlcf/training/status`),
      callMerlt(req, `${MERLT_API_PREFIX}/rlcf/buffer/status`),
    ]);

    res.json({ training, buffer });
  } catch (error) {
    const mapped = mapGatewayError(error);
    res.status(mapped.status).json({ detail: mapped.detail });
  }
});

router.get('/merlt/ops/rlcf/training/status', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/rlcf/training/status`));
router.post('/merlt/ops/rlcf/training/start', requireAdmin, (req, res) => {
  if (!requireMerltAdminApiKey(res)) return;
  void proxyPost(req, res, `${MERLT_API_PREFIX}/rlcf/training/start`);
});
router.post('/merlt/ops/rlcf/training/stop', requireAdmin, (req, res) => {
  if (!requireMerltAdminApiKey(res)) return;
  void proxyPost(req, res, `${MERLT_API_PREFIX}/rlcf/training/stop`);
});
router.get('/merlt/ops/rlcf/buffer/status', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/rlcf/buffer/status`));
router.get('/merlt/ops/rlcf/policies/weights', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/rlcf/policies/weights`));
router.get('/merlt/ops/rlcf/policies/history', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/rlcf/policies/history`));
router.post('/merlt/ops/rlcf/aggregation/run', requireAdmin, (req, res) => {
  if (!requireMerltAdminApiKey(res)) return;
  void proxyPost(req, res, `${MERLT_API_PREFIX}/rlcf/aggregation/run`);
});
router.get('/merlt/ops/rlcf/aggregation/latest', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/rlcf/aggregation/latest`));
router.get('/merlt/ops/pipeline/runs', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/pipeline/runs`));
router.get('/merlt/ops/pipeline/run/:runId', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/pipeline/run/${encodeURIComponent(req.params.runId)}`));
router.get('/merlt/ops/pipeline/run/:runId/errors', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/pipeline/run/${encodeURIComponent(req.params.runId)}/errors`));
router.post('/merlt/ops/pipeline/run/:runId/retry', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/pipeline/run/${encodeURIComponent(req.params.runId)}/retry`));
router.post('/merlt/ops/pipeline/start', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/pipeline/start`));
router.get('/merlt/ops/pipeline/dataset/stats', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/pipeline/dataset/stats`));
router.post('/merlt/ops/pipeline/dataset/export', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/pipeline/dataset/export`));
router.get('/merlt/ops/dashboard/overview', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/dashboard/overview`));
router.get('/merlt/ops/dashboard/health', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/dashboard/health`));
router.get('/merlt/ops/dashboard/architecture', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/dashboard/architecture`));
router.get('/merlt/ops/dashboard/architecture/node/:nodeId', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/dashboard/architecture/node/${encodeURIComponent(req.params.nodeId)}`));
router.get('/merlt/ops/dashboard/activity', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/dashboard/activity`));
router.get('/merlt/ops/regression/baselines', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/regression/baselines`));
router.post('/merlt/ops/regression/run', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/regression/run`));
router.get('/merlt/ops/regression/status/:runId', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/regression/status/${encodeURIComponent(req.params.runId)}`));
router.get('/merlt/ops/regression/results/:runId', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/regression/results/${encodeURIComponent(req.params.runId)}`));
router.get('/merlt/ops/feedback/flagged', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/feedback/flagged`));
router.get('/merlt/ops/feedback/quarantined', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/feedback/quarantined`));
router.post('/merlt/ops/feedback/:feedbackId/flag', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/${encodeURIComponent(req.params.feedbackId)}/flag`));
router.post('/merlt/ops/feedback/:feedbackId/quarantine', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/${encodeURIComponent(req.params.feedbackId)}/quarantine`));
router.post('/merlt/ops/feedback/:feedbackId/approve', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/${encodeURIComponent(req.params.feedbackId)}/approve`));
router.post('/merlt/ops/feedback/auto-detect', requireAdmin, (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/feedback/auto-detect`));
router.get('/merlt/ops/export/feedback', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/export/feedback`));
router.get('/merlt/ops/export/traces', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/export/traces`));
router.get('/merlt/ops/export/aggregation', requireAdmin, (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/export/aggregation`));
router.post('/merlt/devils-advocate/check', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/devils-advocate/check`));
router.post('/merlt/devils-advocate/feedback', (req, res) => proxyPost(req, res, `${MERLT_API_PREFIX}/devils-advocate/feedback`));
router.get('/merlt/devils-advocate/effectiveness', (req, res) => proxyGet(req, res, `${MERLT_API_PREFIX}/devils-advocate/effectiveness`));

export default router;
