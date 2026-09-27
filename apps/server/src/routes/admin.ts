import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as feedbackController from '../controllers/feedbackController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// All admin routes require authentication + admin privileges
// Use path prefix to ensure middleware only runs for /admin/* routes
router.use('/admin', authenticate, requireAdmin);

// User management
router.get('/admin/users', adminController.listUsers);
router.post('/admin/users', adminController.createUser);
router.get('/admin/users/:id', adminController.getUser);
router.put('/admin/users/:id', adminController.updateUser);
router.delete('/admin/users/:id', adminController.deleteUser);
router.post('/admin/users/:id/reset-password', adminController.resetPassword);

// Feedback management
router.get('/admin/feedbacks', feedbackController.listFeedbacks);
router.get('/admin/feedbacks/stats', feedbackController.getFeedbackStats);
router.put('/admin/feedbacks/:id', feedbackController.updateFeedbackStatus);
router.delete('/admin/feedbacks/:id', feedbackController.deleteFeedback);

export default router;
