import { Router } from 'express';
import * as controller from '../controllers/articleDiscussionController';
import * as community from '../controllers/communityController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
router.use(authenticate);

router.get('/article-discussions', controller.listThreads);
router.get('/article-discussions/passages', controller.listPassages);
// The Community (spec 2026-10-20-forum-community-glosse-design): before `/:threadId`, which would take «feed».
router.get('/article-discussions/feed', community.listFeed);
router.get('/article-discussions/:threadId', community.getThread);
router.post('/article-discussions', controller.createThread);
router.patch('/article-discussions/:threadId', community.editThread);
router.delete('/article-discussions/:threadId', community.deleteThread);
router.post('/article-discussions/:threadId/comments', controller.createComment);
router.post('/article-discussions/:threadId/accept', community.acceptReply);
router.post('/article-discussions/:threadId/vote', controller.toggleThreadVote);
router.post('/article-discussions/:threadId/report', controller.reportThread);
router.patch('/article-discussion-comments/:commentId', community.editComment);
router.delete('/article-discussion-comments/:commentId', community.deleteComment);
router.post('/article-discussion-comments/:commentId/vote', controller.toggleCommentVote);
router.post('/article-discussion-comments/:commentId/report', community.reportComment);
router.patch('/admin/article-discussions/:threadId', requireAdmin, controller.moderateThread);

export default router;
