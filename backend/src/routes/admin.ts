import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// All admin routes require authentication + admin privileges
router.use(authenticate);
router.use(requireAdmin);

// User management
router.get('/admin/users', adminController.listUsers);
router.post('/admin/users', adminController.createUser);
router.get('/admin/users/:id', adminController.getUser);
router.put('/admin/users/:id', adminController.updateUser);
router.delete('/admin/users/:id', adminController.deleteUser);
router.post('/admin/users/:id/reset-password', adminController.resetPassword);

export default router;
