import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/refresh', authController.refresh);

// Protected routes
router.get('/auth/me', authenticate, authController.getCurrentUser);
router.put('/auth/change-password', authenticate, authController.changePassword);

export default router;
