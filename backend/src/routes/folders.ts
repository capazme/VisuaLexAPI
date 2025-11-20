import { Router } from 'express';
import * as folderController from '../controllers/folderController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All folder routes require authentication
router.use(authenticate);

router.post('/folders', folderController.createFolder);
router.get('/folders', folderController.getFolders);
router.get('/folders/tree', folderController.getFolderTree);
router.get('/folders/:id', folderController.getFolder);
router.put('/folders/:id', folderController.updateFolder);
router.patch('/folders/:id/move', folderController.moveFolder);
router.delete('/folders/:id', folderController.deleteFolder);
router.post('/folders/bulk/delete', folderController.bulkDeleteFolders);
router.post('/folders/bulk/move', folderController.bulkMoveFolders);

export default router;
