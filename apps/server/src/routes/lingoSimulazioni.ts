import { Router } from 'express';
import * as lingoTracceController from '../controllers/lingoTracceController';
import { authenticate } from '../middleware/auth';

// Mounted at /api/lingo/simulazioni. Read-only for now: the bank of traces the
// simulations will draw on. Starting a simulation, the timer and the drafts come
// with their own routes.
const router = Router();

router.use(authenticate);

router.get('/tracce', lingoTracceController.listTracce);
router.get('/tracce/:id', lingoTracceController.getTraccia);

export default router;
