import { Router } from 'express';
import * as feedbackController from '../controllers/feedbackController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All feedback routes require authentication
router.use(authenticate);

// User endpoint - create feedback
router.post('/feedback', feedbackController.createFeedback);

export default router;
