import { Router } from 'express';
import * as highlightController from '../controllers/highlightController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All highlight routes require authentication
router.use(authenticate);

router.post('/highlights', highlightController.createHighlight);
router.get('/highlights', highlightController.getHighlights); // ?normaKey=...
router.put('/highlights/:id', highlightController.updateHighlight);
router.delete('/highlights/:id', highlightController.deleteHighlight);

export default router;
