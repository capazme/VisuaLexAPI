import { Router } from 'express';
import * as dossierController from '../controllers/dossierController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All dossier routes require authentication
router.use(authenticate);

// Dossier CRUD
router.get('/dossiers', dossierController.listDossiers);
router.post('/dossiers', dossierController.createDossier);
router.get('/dossiers/:id', dossierController.getDossier);
router.put('/dossiers/:id', dossierController.updateDossier);
router.delete('/dossiers/:id', dossierController.deleteDossier);

// Dossier items
router.post('/dossiers/:id/items', dossierController.addDossierItem);
router.put('/dossiers/:id/items/:itemId', dossierController.updateDossierItem);
router.delete('/dossiers/:id/items/:itemId', dossierController.deleteDossierItem);
router.post('/dossiers/:id/reorder', dossierController.reorderDossierItems);

export default router;
