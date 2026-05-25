import { Router } from 'express';
import consentRouter from './consent';
import eventsRouter from './events';
import graphRouter from './graph';
import healthRouter from './health';
import profileRouter from './profile';

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
 * graphRouter MUST be registered BEFORE every router that applies a pathless
 * `router.use(authenticate)` (consent, profile, events all do). A sub-router
 * mounted on '/' runs its pathless middleware for ANY request flowing through
 * it, so if graphRouter came later the worker callback (/internal/job-callback,
 * which intentionally skips JWT) would be 401'd by an earlier router's
 * authenticate. Mount order wins in Express (gotcha #1). graphRouter applies
 * auth per-route, so it is safe to place first (after the no-auth health
 * router). Its own routes 404 cleanly when the path doesn't match.
 */
const router = Router();

// Mounted at /api/merlt in app.ts — no extra prefix here.
router.use('/', healthRouter);
router.use('/', graphRouter);
router.use('/', consentRouter);
router.use('/', profileRouter);
router.use('/', eventsRouter);

export default router;
