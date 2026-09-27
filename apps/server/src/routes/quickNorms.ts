import { Router } from 'express';
import * as quickNormController from '../controllers/quickNormController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/quick-norms', quickNormController.listQuickNorms);
router.post('/quick-norms', quickNormController.createQuickNorm);
// Atomic usage bump — used on every pick from the QuickNorms panel.
router.post('/quick-norms/:id/use', quickNormController.useQuickNorm);
router.put('/quick-norms/:id', quickNormController.updateQuickNorm);
router.delete('/quick-norms/:id', quickNormController.deleteQuickNorm);

export default router;
