import { Router } from 'express';
import * as annotationController from '../controllers/annotationController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All annotation routes require authentication
router.use(authenticate);

router.post('/annotations', annotationController.createAnnotation);
router.get('/annotations', annotationController.getAnnotations); // ?normaKey=...&type=...
router.delete('/annotations', annotationController.deleteAllAnnotations); // wipes every annotation owned by the current user
router.put('/annotations/:id', annotationController.updateAnnotation);
router.delete('/annotations/:id', annotationController.deleteAnnotation);

export default router;
