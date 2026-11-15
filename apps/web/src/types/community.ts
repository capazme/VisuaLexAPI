/**
 * The Forum's Community as the server sends it (`apps/server/src/controllers/communityController.ts`): the feed of
 * every discussion (`GET /article-discussions/feed`) and one discussion with its replies (`GET /article-discussions/:id`).
 * The server calls a discussion a «glossa»; the page says «discussione».
 */
import type { ThreadPassage } from './index';
import type { Materia } from './studia';

/** An author; `id` null for a deleted account (username «utente cancellato») or an emptied item (username ''). */
export interface CommunityAuthor {
  id: string | null;
  username: string;
}

export type CommunityTarget = { kind: 'article' } | { kind: 'decision'; key: string };

export interface CommunityFeedItem {
  id: string;
  title: string;
  excerpt: string;
  normaKey: string;
  articleId: string;
  articleLabel: string | null;
  version: string | null;
  articleUrn: string | null;
  target: CommunityTarget;
  decisionLabel: string | null;
  passage: { quote: string | null; withheld: boolean } | null;
  user: CommunityAuthor;
  materia: Materia | null;
  voteCount: number;
  userVoted: boolean;
  replyCount: number;
  acceptedCommentId: string | null;
  createdAt: string;
  lastActivityAt: string;
  editedAt: string | null;
  deleted: boolean;
  locked: boolean;
  isOwner: boolean;
}

export interface CommunityFeedResponse {
  data: CommunityFeedItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/** A reply or a comment under it. `removed`: hidden by moderation, shown as a bare place; `hidden`: the author's or a moderator's view of it. */
export interface CommunityItem {
  id: string;
  parentId: string | null;
  body: string;
  user: CommunityAuthor;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  removed: boolean;
  hidden: { category: string | null } | null;
  voteCount: number;
  userVoted: boolean;
  isOwner: boolean;
}

/** A reply: the accepted one first, then by votes, then the oldest (the server's order); its comments one level under it. */
export interface CommunityReply extends CommunityItem {
  accepted: boolean;
  comments: CommunityItem[];
}

export interface CommunityThread {
  id: string;
  normaKey: string;
  articleId: string;
  articleLabel: string | null;
  version: string | null;
  target: CommunityTarget;
  decisionLabel: string | null;
  title: string;
  body: string;
  passage: ThreadPassage | null;
  passageWithheld: boolean;
  passageReleased: boolean;
  articleUrn: string | null;
  textHash: string | null;
  user: CommunityAuthor;
  materia: Materia | null;
  createdAt: string;
  lastActivityAt: string;
  editedAt: string | null;
  deleted: boolean;
  locked: boolean;
  hidden: { category: string | null } | null;
  acceptedCommentId: string | null;
  voteCount: number;
  userVoted: boolean;
  replyCount: number;
  isOwner: boolean;
  replies: CommunityReply[];
}
