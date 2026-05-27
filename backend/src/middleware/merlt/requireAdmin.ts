import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware that restricts a route to admin users (Slice 2b).
 *
 * Must run AFTER `authenticate` (which populates req.user from the JWT). The
 * MERL-T ops surfaces (Slice 2c / Phase 4) are admin-only; relying on the
 * client to hide them is not access control (OWASP A01) — this is the server
 * gate. `req.user.isAdmin` mirrors the Prisma User.is_admin column.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ detail: 'admin_required' });
    return;
  }
  next();
}
