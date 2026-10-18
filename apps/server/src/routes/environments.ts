import { Router } from 'express';
import * as environmentController from '../controllers/environmentController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All personal-environment routes require authentication.
router.use(authenticate);

// Read-only since the Forum absorbed «Ambienti»: no create or edit route (see environmentsWriteRoutesRemoved.test.ts).
router.get('/environments', environmentController.listEnvironments);
router.get('/environments/:id', environmentController.getEnvironment);
router.delete('/environments/:id', environmentController.deleteEnvironment);
// «Recupera i dossier»: an archived environment's dossiers become study dossiers.
router.post('/environments/:id/recover', environmentController.recoverEnvironment);

export default router;
