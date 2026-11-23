import { Router } from 'express';
import * as moderation from '../controllers/forumModerationController';
import * as notifications from '../controllers/forumNotificationController';
import * as profiles from '../controllers/forumProfileController';
import * as communities from '../controllers/forumCommunitiesController';
import { authenticate } from '../middleware/auth';

// The Community's moderation and notifications (spec 2026-10-20-forum-community-glosse-design §5.7,
// §6.5). The moderators' rights are read from the database inside each handler. None of these routes is
// reachable by a connected application (`oauth/delegatedRoutes.ts` names none of them).
const router = Router();
router.use(authenticate);

router.get('/moderation/reports', moderation.listReports);
router.post('/moderation/reports/:kind/:itemId/resolve', moderation.resolveReports);
router.patch('/moderation/threads/:threadId', moderation.moderateThread);
router.patch('/moderation/comments/:commentId', moderation.moderateComment);
router.post('/moderation/:kind/:itemId/empty', moderation.emptyContribution);
router.get('/forum/notifications', notifications.listNotifications);
// The Forum's profile (spec 2026-11-14-forum-community-server-design §B) and the owners' reports «non è chi
// dice di essere» (G-479).
router.get('/forum/profile', profiles.getOwnProfile);
router.put('/forum/profile', profiles.putOwnProfile);
router.get('/forum/profiles/:profileId', profiles.getPublicProfile);
router.get('/forum/profiles/:profileId/validated', profiles.listValidatedContributions);
router.post('/forum/profiles/:profileId/report', profiles.reportProfile);
router.get('/moderation/profile-reports', profiles.listProfileReports);
router.post('/moderation/profile-reports/:profileId/resolve', profiles.resolveProfileReports);
router.post('/moderation/profile-reports/:profileId/restore', profiles.restoreProfileName);
// Communities by subject, validation and the appeal to the owners (spec 2026-11-14 §C). The admin paths also
// pass the admin router's own check (`routes/admin.ts`, mounted before this one).
router.get('/forum/communities', communities.listCommunities);
router.post('/forum/validations/:kind/:itemId', communities.validateItem);
router.delete('/forum/validations/:kind/:itemId', communities.withdrawValidation);
router.post('/forum/appeals', communities.createAppeal);
router.get('/moderation/appeals', communities.listAppeals);
router.post('/moderation/appeals/:id/decide', communities.decideAppeal);
router.put('/admin/users/:id/forum-roles', communities.setSubjectRole);
router.get('/admin/forum/validation-threshold', communities.getValidationThreshold);
router.put('/admin/forum/validation-threshold', communities.putValidationThreshold);
router.post('/forum/notifications/read', notifications.markNotificationsRead);

export default router;
