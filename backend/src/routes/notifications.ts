import { Router } from 'express';
import * as controller from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/notifications/forum-unread-count', controller.getForumUnreadCount);
router.post('/notifications/mark-read', controller.markForumRead);
router.get('/notifications/normas', controller.getNormaNotifications);
router.get('/notifications/normas/unread-count', controller.getNormaUnreadCount);
router.post('/notifications/normas/check', controller.checkNorma);
router.post('/notifications/normas/mark-read', controller.markNormaNotificationsRead);

export default router;
