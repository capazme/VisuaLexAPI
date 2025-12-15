import { Request, Response, NextFunction } from 'express';

/**
 * Admin middleware - must be used after authenticate middleware
 * Checks if the authenticated user has admin privileges
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ detail: 'Authentication required' });
      return;
    }

    if (!req.user.isAdmin) {
      res.status(403).json({ detail: 'Admin access required' });
      return;
    }

    next();
  } catch (error) {
    res.status(403).json({ detail: 'Authorization failed' });
  }
};
