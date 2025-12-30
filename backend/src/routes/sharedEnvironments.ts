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
router.put('/shared-environments/:id', controller.updateEnvironmentWithVersion);
router.delete('/shared-environments/:id', controller.deleteSharedEnvironment);

// Owner Management
router.post('/shared-environments/:id/withdraw', controller.withdrawEnvironment);
router.post('/shared-environments/:id/republish', controller.republishEnvironment);

// Versioning
router.get('/shared-environments/:id/versions', controller.getVersions);
router.post('/shared-environments/:id/versions/:versionId/restore', controller.restoreVersion);

// Engagement
router.post('/shared-environments/:id/like', controller.toggleLike);
router.post('/shared-environments/:id/download', controller.recordDownload);

// Suggestions (general routes - must be before :id routes to avoid conflicts)
router.get('/shared-environments-suggestions/received', controller.getReceivedSuggestions);
router.get('/shared-environments-suggestions/sent', controller.getSentSuggestions);
router.get('/shared-environments-suggestions/pending-count', controller.getPendingSuggestionsCount);
router.post('/shared-environments-suggestions/:suggestionId/approve', controller.approveSuggestion);
router.post('/shared-environments-suggestions/:suggestionId/reject', controller.rejectSuggestion);

// Suggestions (environment-specific)
router.post('/shared-environments/:id/suggestions', controller.createSuggestion);

// Reporting
router.post('/shared-environments/:id/report', controller.reportEnvironment);

// Admin routes
router.get('/admin/shared-environment-reports', requireAdmin, controller.getReports);
router.put('/admin/shared-environment-reports/:id', requireAdmin, controller.updateReportStatus);
router.get('/admin/shared-environments', requireAdmin, controller.adminListEnvironments);
router.post('/admin/shared-environments/:id/withdraw', requireAdmin, controller.adminWithdrawEnvironment);
router.post('/admin/shared-environments/:id/republish', requireAdmin, controller.adminRepublishEnvironment);
router.delete('/admin/shared-environments/:id', requireAdmin, controller.adminDeleteEnvironment);

export default router;
