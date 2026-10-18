import { Router } from 'express';
import * as environmentController from '../controllers/environmentController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All personal-environment routes require authentication.
router.use(authenticate);

router.get('/environments', environmentController.listEnvironments);
router.post('/environments', environmentController.createEnvironment);
router.get('/environments/:id', environmentController.getEnvironment);
router.put('/environments/:id', environmentController.updateEnvironment);
router.delete('/environments/:id', environmentController.deleteEnvironment);
// «Recupera i dossier»: an archived environment's dossiers become study dossiers.
router.post('/environments/:id/recover', environmentController.recoverEnvironment);

export default router;
