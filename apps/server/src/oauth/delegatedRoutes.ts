import type { Request } from 'express';

/**
 * The only API routes an exchanged token may reach (spec section 5, default
 * deny): method, path under `/api`, the scope it needs, and what it costs
 * against the user's daily quota. Nothing here updates, moves or deletes.
 * Adding a route is a security decision: every entry is reachable by any
 * MCP client the user connected.
 */
export interface DelegatedRoute {
  method: 'GET' | 'POST';
  /** Matched against the path under /api; `:id` is one path segment. */
  path: string;
  scope: string;
  /** Points charged; a function when the cost depends on the body. */
  weight: number | ((req: Request) => number);
  /** A named daily counter beside the points, if any. */
  counter?: 'dossier_create';
}

function referencesWeight(req: Request): number {
  const references = (req.body as { references?: unknown } | undefined)?.references;
  const count = Array.isArray(references) ? Math.min(references.length, 50) : 0;
  return Math.max(1, count) * 2;
}

export const DELEGATED_ROUTES: DelegatedRoute[] = [
  { method: 'GET', path: '/dossiers', scope: 'dossier:read', weight: 1 },
  { method: 'GET', path: '/dossiers/:id', scope: 'dossier:read', weight: 1 },
  { method: 'POST', path: '/dossiers', scope: 'dossier:write', weight: 2, counter: 'dossier_create' },
  // Each reference is checked against the sources: two points apiece (1 to 50).
  { method: 'POST', path: '/dossiers/:id/norms', scope: 'dossier:write', weight: referencesWeight },
  // Reading the quota costs nothing: the MCP server asks it to tell the user what is left.
  { method: 'GET', path: '/oauth/quota', scope: 'dossier:read', weight: 0 },
];

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function matches(pattern: string, path: string): boolean {
  const want = pattern.split('/');
  const got = path.replace(/\/+$/, '').split('/');
  if (want.length !== got.length) return false;
  return want.every((part, i) => (part === ':id' ? SEGMENT.test(got[i]) : part === got[i]));
}

/** The table entry for this request, or undefined: then the answer is 403. */
export function findDelegatedRoute(method: string, path: string): DelegatedRoute | undefined {
  return DELEGATED_ROUTES.find((route) => route.method === method && matches(route.path, path));
}
