import { Router } from 'express';
import * as controller from '../controllers/sharedEnvironmentController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Browse & Search
router.get('/shared-environments', controller.listSharedEnvironments);
router.get('/shared-environments/my', controller.getMySharedEnvironments);
router.get('/shared-environments/:id', controller.getSharedEnvironmentDetail);

// CRUD
router.post('/shared-environments', controller.publishEnvironment);
router.put('/shared-environments/:id', controller.updateSharedEnvironment);
router.delete('/shared-environments/:id', controller.deleteSharedEnvironment);

// Engagement
router.post('/shared-environments/:id/like', controller.toggleLike);
router.post('/shared-environments/:id/download', controller.recordDownload);

// Reporting
router.post('/shared-environments/:id/report', controller.reportEnvironment);

// Admin routes
router.get('/admin/shared-environment-reports', requireAdmin, controller.getReports);
router.put('/admin/shared-environment-reports/:id', requireAdmin, controller.updateReportStatus);
router.delete('/admin/shared-environments/:id', requireAdmin, controller.adminDeleteEnvironment);

export default router;
