import { Router } from 'express';
import consentRouter from './consent';
import eventsRouter from './events';
import graphRouter from './graph';
import contribRouter from './contrib';
import validateRouter from './validate';
import ingestionRouter from './ingestion';
import opsRouter from './ops';
import opsIngestionRouter from './opsIngestion';
import expertsRouter from './experts';
import nerRouter from './ner';
import healthRouter from './health';
import profileRouter from './profile';
import { featureGate } from '../../middleware/merlt/featureGate';

/**
 * Mount point for all MERL-T BFF routes.
 *
 * Slice 1 endpoints:
 *  - /consent           → GET / POST / DELETE (MERLT-1.4)
 *  - /events/<name>     → POST per event-name (MERLT-1.5 onward)
 *  - /health            → GET (MERLT-1.5, no auth)
 *  - /profile           → GET (MERLT-1.5, with authority cache)
 *
 * Slice 2a endpoints (graphRouter):
 *  - /graph/article/:urn, /graph/ingest, /graph/jobs/:jobId/status (auth)
 *  - /internal/job-callback (internalAuth, NO JWT)
 *
 * Phase 2 endpoints (ingestionRouter): VisuaLex user knowledge → MERL-T
 * ExternalIngestionPipeline.
 *  - /ingestion/preview, /ingestion/process, /ingestion/validate (auth + contributionGuard)
 *  - /ingestion/pending (auth only, read)
 *
 * Admin mechanical ingestion endpoints (opsIngestionRouter) — deterministic,
 * zero-LLM corpus→graph batches, admin-reviewed before promotion. NOT the
 * same pipeline as ingestionRouter above (that one is community/interpretive).
 *  - /ops/ingestion/run, /ops/ingestion/batches[/:batchId][/promote|/reject]
 *    (auth + requireAdmin)
 *
 * graphRouter MUST be registered BEFORE every router that applies a pathless
 * `router.use(authenticate)` (consent, profile, events all do). A sub-router
 * mounted on '/' runs its pathless middleware for ANY request flowing through
 * it, so if graphRouter came later the worker callback (/internal/job-callback,
 * which intentionally skips JWT) would be 401'd by an earlier router's
 * authenticate. Mount order wins in Express (gotcha #1). graphRouter applies
 * auth per-route, so it is safe to place first (after the no-auth health
 * router). Its own routes 404 cleanly when the path doesn't match.
 *
 * Wave 1 cleanup — per-group feature flags (config.merlt.flags.*, see
 * middleware/merlt/featureGate.ts): each flag gates a whole router group by
 * the path prefixes that group owns. health/consent/profile/events are base
 * infrastructure and stay ungated (only the global MERLT_ENABLED kill switch
 * in app.ts applies to them). expertsRouter (Q&A) is likewise left ungated —
 * no sub-flag was designated for it.
 *  - flags.graph          → graphRouter (/graph, /internal/job-callback)
 *  - flags.contribution   → contribRouter (/contrib, /internal/extraction-callback)
 *                            + ingestionRouter (/ingestion, community/interpretive)
 *  - flags.validation     → validateRouter (/validate)
 *  - flags.ops            → opsRouter (/ops) + opsIngestionRouter (/ops, mechanical
 *                            ingestion) + nerRouter (/ner)
 */
const router = Router();

// Mounted at /api/merlt in app.ts — no extra prefix here.
router.use('/', healthRouter);
router.use('/', featureGate('graph', ['/graph', '/internal/job-callback']), graphRouter);
router.use('/', featureGate('contribution', ['/contrib', '/internal/extraction-callback']), contribRouter);
router.use('/', featureGate('validation', ['/validate']), validateRouter);
router.use('/', featureGate('contribution', ['/ingestion']), ingestionRouter);
router.use('/', featureGate('ops', ['/ops']), opsRouter);
router.use('/', featureGate('ops', ['/ops']), opsIngestionRouter);
// Loop β Phase F — experts Q&A. Per-route auth → order-safe; before the
// catch-all auth routers (gotcha #1).
router.use('/', expertsRouter);
// Loop β #2 — NER feedback. Per-route auth → order-safe; before catch-all (gotcha #1).
router.use('/', featureGate('ops', ['/ner']), nerRouter);
router.use('/', consentRouter);
router.use('/', profileRouter);
router.use('/', eventsRouter);

export default router;
