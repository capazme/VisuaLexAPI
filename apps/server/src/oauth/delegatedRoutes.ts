import type { Request } from 'express';
import { DELETE_SCOPE } from './config';

/**
 * The only API routes an exchanged token may reach (spec section 5, default
 * deny): method, path under `/api`, the scope it needs, and what it costs
 * against the user's daily quota. Nothing here updates or moves, and nothing
 * deletes for good: the two trash routes move rows to a trash the user's
 * session alone restores or empties (second round, spec §4.3).
 * Adding a route is a security decision: every entry is reachable by any
 * MCP client the user connected.
 */
/** The named daily counters a route may also spend (middleware/delegated.ts sets their limits). */
export type DelegatedCounter = 'dossier_create' | 'note' | 'trash' | 'card' | 'passage' | 'text';

export interface DelegatedRoute {
  method: 'GET' | 'POST';
  /** Matched against the path under /api; `:id` is one path segment. */
  path: string;
  scope: string;
  /** Points charged; a function when the cost depends on the body. */
  weight: number | ((req: Request) => number);
  /** For a deletion: the read scope of what it deletes, which the grant must also hold (spec §4.2). */
  readScope?: string;
  /** A second scope the token must also carry (proposing glosses needs the texts too: D7b, §8.7). */
  alsoScope?: string;
  /** A named daily counter beside the points, if any. */
  counter?: DelegatedCounter;
  /** How much of the counter a call spends, when not one (cards: one per card). */
  counterAmount?: (req: Request) => number;
}

function cardCount(req: Request): number {
  const cards = (req.body as { cards?: unknown } | undefined)?.cards;
  return Array.isArray(cards) ? Math.max(1, Math.min(cards.length, 10)) : 1;
}

/** Two points per distinct anchor reference of the call (each is checked against the sources), at least two per card. */
function cardReferencesWeight(req: Request): number {
  const cards = (req.body as { cards?: unknown } | undefined)?.cards;
  if (!Array.isArray(cards)) return 2;
  const references = new Set<string>();
  for (const card of cards.slice(0, 10)) {
    const anchors = (card as { ancore?: unknown } | null)?.ancore;
    if (Array.isArray(anchors)) for (const a of anchors.slice(0, 10)) references.add(String((a as { riferimento?: unknown } | null)?.riferimento ?? ''));
  }
  return Math.max(references.size, cardCount(req)) * 2;
}

function glossCount(req: Request): number {
  const glosses = (req.body as { glosse?: unknown } | undefined)?.glosse;
  return Array.isArray(glosses) ? Math.max(1, Math.min(glosses.length, 10)) : 1;
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
  // Court decisions in words (design 2026-10-12 §2.3, allowed by the owner): each confirmed at its source,
  // two points apiece (1 to 10, refused above by the route). It only adds, like the norms.
  { method: 'POST', path: '/dossiers/:id/decisions', scope: 'dossier:write', weight: referencesWeight },
  // A note in the dossier, or about one of its articles: a write like any other, and at most 100 a day.
  { method: 'POST', path: '/dossiers/:id/notes', scope: 'dossier:write', weight: 2, counter: 'note' },
  // Into the trash, never deleted for good; content:delete is also read live from the grant (delegated.ts).
  { method: 'POST', path: '/dossiers/:id/trash', scope: DELETE_SCOPE, readScope: 'dossier:read', weight: 1, counter: 'trash' },
  { method: 'POST', path: '/dossiers/:id/trash-items', scope: DELETE_SCOPE, readScope: 'dossier:read', weight: 1, counter: 'trash' },
  // LingoLex study cards (spec §6): always the author's drafts; two points per reference checked, one of the day's hundred per card.
  { method: 'POST', path: '/lingo/cards', scope: 'lingo:cards:write', weight: cardReferencesWeight, counter: 'card', counterAmount: cardCount },
  { method: 'GET', path: '/lingo/cards', scope: 'lingo:cards:read', weight: 1 },
  { method: 'GET', path: '/lingo/cards/:id', scope: 'lingo:cards:read', weight: 1 },
  { method: 'POST', path: '/lingo/cards/trash', scope: DELETE_SCOPE, readScope: 'lingo:cards:read', weight: 1, counter: 'trash' },
  // Reading the quota costs nothing: the MCP server asks it to tell the user what is left.
  { method: 'GET', path: '/oauth/quota', scope: 'dossier:read', weight: 0 },
  // D7b (spec 2026-10-23 §8, allowed by the owners on 25 October 2026, G2 and G7): an entry's text, a page at a
  // time, as the dossier's reader reads it; it leaves through MCP for this route only, under its own scope.
  { method: 'GET', path: '/dossiers/:id/items/:id/text', scope: 'dossier:text', weight: 1, counter: 'text' },
  // D8 (G-383, 29 October 2026): glosses proposed on an entry's passages, which the user validates, edits or
  // removes. It only adds. It needs the texts too: «non trovato» and «compare N volte» would otherwise let a
  // connection probe them. Two points and one of the day's hundred passages per gloss, the refused ones given back.
  {
    method: 'POST', path: '/dossiers/:id/items/:id/glosses', scope: 'dossier:write', alsoScope: 'dossier:text',
    weight: (req) => glossCount(req) * 2, counter: 'passage', counterAmount: glossCount,
  },
  // Coloured passages are no longer proposed (D8): kept in the table so an application still asking is told so
  // in words (410, its point given back) rather than with a bare 403.
  { method: 'POST', path: '/dossiers/:id/items/:id/passages', scope: 'dossier:write', weight: 1 },
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
