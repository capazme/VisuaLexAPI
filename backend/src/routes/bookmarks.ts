import { Router } from 'express';
import * as bookmarkController from '../controllers/bookmarkController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All bookmark routes require authentication
router.use(authenticate);

router.post('/bookmarks', bookmarkController.createBookmark);
router.get('/bookmarks', bookmarkController.getBookmarks);
router.get('/bookmarks/:id', bookmarkController.getBookmark);
router.put('/bookmarks/:id', bookmarkController.updateBookmark);
router.patch('/bookmarks/:id/move', bookmarkController.moveBookmark);
router.delete('/bookmarks/:id', bookmarkController.deleteBookmark);
router.post('/bookmarks/bulk/delete', bookmarkController.bulkDeleteBookmarks);
router.post('/bookmarks/bulk/move', bookmarkController.bulkMoveBookmarks);

export default router;
