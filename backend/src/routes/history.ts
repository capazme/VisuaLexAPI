import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getHistory,
  addHistory,
  deleteHistoryItem,
  clearHistory,
} from '../controllers/historyController';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /history - List user's search history
router.get('/', getHistory);

// POST /history - Add item to history
router.post('/', addHistory);

// DELETE /history/:id - Delete single item
router.delete('/:id', deleteHistoryItem);

// DELETE /history - Clear all history
router.delete('/', clearHistory);

export default router;
