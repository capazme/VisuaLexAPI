import { Router } from 'express';
import consentRouter from './consent';
import eventsRouter from './events';
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
 */
const router = Router();

// Mounted at /api/merlt in app.ts — no extra prefix here.
router.use('/', healthRouter);
router.use('/', consentRouter);
router.use('/', profileRouter);
router.use('/', eventsRouter);

export default router;
