import { Router } from 'express';
import * as controller from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/notifications/forum-unread-count', controller.getForumUnreadCount);
router.post('/notifications/mark-read', controller.markForumRead);

export default router;
