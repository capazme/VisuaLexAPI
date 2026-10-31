import { Router } from 'express';
import * as moderation from '../controllers/forumModerationController';
import * as notifications from '../controllers/forumNotificationController';
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
router.post('/forum/notifications/read', notifications.markNotificationsRead);

export default router;
