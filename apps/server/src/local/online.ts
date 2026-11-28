import { Router, type Request, type Response } from 'express';

/**
 * What the desktop app's local mode does not do (G-612, spec §6), answered before authentication and before any
 * route that reads the database. Mounted first in `app.ts` when LEXCRAFT_MODE=local.
 */

export const ONLINE_COPY = "Sezione online: in questa versione dell'app non è disponibile senza il server.";
export const SIGN_IN_COPY = "Nell'app sul computer non serve accedere.";

/** The online sections: the Forum and its moderation, Learn, the experts, OAuth and MCP, administration, feedback. */
export const ONLINE_SECTIONS = [
  '/api/forum',
  '/api/moderation',
  '/api/article-discussions',
  '/api/article-discussion-comments',
  '/api/shared-environments',
  '/api/shared-environments-suggestions',
  '/api/environments',
  '/api/lingo',
  '/api/merlt',
  '/api/admin',
  '/api/oauth',
  '/api/feedback',
  '/api/auth/verify',
  '/oauth',
  '/.well-known',
];

/** Signing in, out and the password: the local profile has none of them (G-514). */
export const SIGN_IN_ROUTES: Array<['post' | 'put' | 'delete', string]> = [
  ['post', '/api/auth/login'],
  ['post', '/api/auth/register'],
  ['post', '/api/auth/refresh'],
  ['post', '/api/auth/logout'],
  ['post', '/api/auth/logout-all'],
  ['put', '/api/auth/change-password'],
  ['delete', '/api/auth/account'],
  ['post', '/api/auth/contributions/remove'],
];

export function localSections(): Router {
  const router = Router();
  for (const [method, path] of SIGN_IN_ROUTES) {
    router[method](path, (_req: Request, res: Response) => void res.status(403).json({ detail: SIGN_IN_COPY, code: 'local_mode' }));
  }
  router.use(ONLINE_SECTIONS, (_req: Request, res: Response) => void res.status(503).json({ detail: ONLINE_COPY, code: 'online_section' }));
  return router;
}
