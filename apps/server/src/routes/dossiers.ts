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
// Norms from references in free text, checked for existence (MCP spike).
router.post('/dossiers/:id/norms', dossierController.addDossierNorms);
// A note, or a note about one of the dossier's articles (MCP second round); the web app uses it too.
router.post('/dossiers/:id/notes', dossierController.addDossierNote);
router.put('/dossiers/:id/items/:itemId', dossierController.updateDossierItem);
router.delete('/dossiers/:id/items/:itemId', dossierController.deleteDossierItem);
// Moves the row itself to another dossier of the same user (see moveDossierItem).
router.post('/dossiers/:id/items/:itemId/move', dossierController.moveDossierItem);
router.post('/dossiers/:id/reorder', dossierController.reorderDossierItems);
router.post('/dossiers/:id/snapshots', dossierController.createDossierSnapshot);
router.get('/dossiers/:id/snapshots', dossierController.listDossierSnapshots);

export default router;
