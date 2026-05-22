import { Router } from 'express';
import consentRouter from './consent';

/**
 * Mount point for all MERL-T BFF routes.
 *
 * Slice 1 endpoints:
 *  - /consent  → GET / POST / DELETE (MERLT-1.4)
 *  - /events/* → POST per event-name (MERLT-1.5)
 *  - /health   → GET (MERLT-1.5)
 *  - /profile  → GET (MERLT-1.5)
 */
const router = Router();

router.use('/merlt', consentRouter);

export default router;
