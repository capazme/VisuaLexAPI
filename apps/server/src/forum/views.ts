import type { Prisma } from '@prisma/client';
import { readDecisionKey } from '../norms/decisionKey';
import { shortDecision } from '../norms/decisionCitation';

/** What every view says for a contribution whose author deleted their account (G-307). */
export const DELETED_AUTHOR = 'utente cancellato';

type Author = { id: string; username: string } | null;

/** A contribution outlives its author's account: the author is then null, and nobody's own. */
export function userView(user: Author) {
  return user ? { id: user.id, username: user.username } : { id: null, username: DELETED_AUTHOR };
}

/** What its author emptied shows without the author's name (spec 2026-10-20 §5.5). */
export function authorView(item: { deletedAt: Date | null; user: Author }) {
  return item.deletedAt ? { id: null, username: '' } : userView(item.user);
}

export function isOwn(authorId: string | null, userId: string) {
  return authorId !== null && authorId === userId;
}

/** Visible: not hidden by moderation, not emptied by its author (§5.2). */
export const VISIBLE = { isHidden: false, deletedAt: null } satisfies Prisma.ArticleCommentWhereInput;
/** A reply is a top-level comment; a visible one answers the glossa. */
export const VISIBLE_REPLY = { ...VISIBLE, parentId: null } satisfies Prisma.ArticleCommentWhereInput;

export function isVisible(item: { isHidden: boolean; deletedAt: Date | null }) {
  return !item.isHidden && item.deletedAt === null;
}

/**
 * The glosse a list shows: not hidden, and not emptied unless a visible reply or comment still hangs on
 * them (§6.2). The per-article lists of the reader's panel read the same rule.
 */
export const LISTED_THREAD = {
  isHidden: false,
  OR: [{ deletedAt: null }, { comments: { some: VISIBLE } }],
} satisfies Prisma.ArticleThreadWhereInput;

/** The accepted reply counts only while it is visible: hidden or emptied, it stops counting (§5.3). */
export function acceptedId(thread: { acceptedCommentId: string | null; acceptedComment: { isHidden: boolean; deletedAt: Date | null } | null }) {
  return thread.acceptedCommentId && thread.acceptedComment && isVisible(thread.acceptedComment) ? thread.acceptedCommentId : null;
}

export const ACCEPTED_SELECT = { select: { isHidden: true, deletedAt: true } } as const;

const EXCERPT = 280;

/** The first words of a body, for a list; the whole body is on the glossa's own route. */
export function excerpt(body: string): string {
  if (body.length <= EXCERPT) return body;
  const cut = body.slice(0, EXCERPT);
  const space = cut.lastIndexOf(' ');
  return `${(space > EXCERPT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** «Cass. civ., n. 31310/2024»: a decision named from its key; null for an article's glossa. */
export function decisionLabel(thread: { targetKind: string; decisionKey: string | null }): string | null {
  if (thread.targetKind !== 'decision' || !thread.decisionKey) return null;
  const identity = readDecisionKey(thread.decisionKey);
  return identity ? shortDecision(identity) : null;
}

export type Viewer = { id: string; isAdmin: boolean };

/**
 * The quotation as a view away from the text shows it (G-291). A decision's quotation may be words the
 * court has since withdrawn; the reader's panel decides that against the text it holds and fails
 * closed. A Community read holds no text, so a decision's quotation is withheld unless an admin
 * released it, or the reader wrote it or is an admin. A moderator reads it in the reports' queue.
 */
export function isPassageWithheld(
  thread: { targetKind: string; passageQuote: string | null; passageReleasedAt: Date | null; userId: string | null },
  viewer: Viewer,
) {
  return thread.passageQuote !== null && thread.targetKind === 'decision' && thread.passageReleasedAt === null
    && !isOwn(thread.userId, viewer.id) && !viewer.isAdmin;
}
