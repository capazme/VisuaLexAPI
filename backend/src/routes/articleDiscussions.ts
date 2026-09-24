import { Router } from 'express';
import * as controller from '../controllers/articleDiscussionController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(authenticate);

router.get('/article-discussions', controller.listThreads);
router.post('/article-discussions', controller.createThread);
router.post('/article-discussions/:threadId/comments', controller.createComment);
router.post('/article-discussions/:threadId/vote', controller.toggleThreadVote);
router.post('/article-discussion-comments/:commentId/vote', controller.toggleCommentVote);
router.post('/article-discussions/:threadId/report', controller.reportThread);
router.patch('/admin/article-discussions/:threadId', requireAdmin, controller.moderateThread);

export default router;
