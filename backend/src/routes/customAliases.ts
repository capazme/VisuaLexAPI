import { Router } from 'express';
import * as customAliasController from '../controllers/customAliasController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/custom-aliases', customAliasController.listCustomAliases);
router.post('/custom-aliases', customAliasController.createCustomAlias);
// Atomic usage bump — fired on every alias resolution.
router.post('/custom-aliases/:id/use', customAliasController.useCustomAlias);
router.put('/custom-aliases/:id', customAliasController.updateCustomAlias);
router.delete('/custom-aliases/:id', customAliasController.deleteCustomAlias);

export default router;
