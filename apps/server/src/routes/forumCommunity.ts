import { Router } from 'express';
import * as moderation from '../controllers/forumModerationController';
import * as notifications from '../controllers/forumNotificationController';
import * as profiles from '../controllers/forumProfileController';
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
router.post('/forum/profiles/:profileId/report', profiles.reportProfile);
router.get('/moderation/profile-reports', profiles.listProfileReports);
router.post('/moderation/profile-reports/:profileId/resolve', profiles.resolveProfileReports);
router.post('/moderation/profile-reports/:profileId/restore', profiles.restoreProfileName);
router.post('/forum/notifications/read', notifications.markNotificationsRead);

export default router;
