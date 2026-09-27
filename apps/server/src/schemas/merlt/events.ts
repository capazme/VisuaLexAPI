import { z } from 'zod';

/**
 * Zod schemas for the 5 RLCF events VisuaLex emits to MERL-T (Slice 1).
 *
 * Each `*RequestSchema` validates the JSON body that the frontend hook posts
 * to `POST /api/merlt/events/<name>`. The BFF then runs `eventMapper.toMerlt*`
 * to produce the MERL-T tracking payload (snake_case + user_id + authority).
 */

// 1. article:viewed
export const articleViewedRequestSchema = z.object({
  articleUrn: z.string().min(1, 'articleUrn is required'),
  normaVisitataId: z.string().uuid().optional(),
  dwellMs: z.number().int().nonnegative(),
  scrollMaxPct: z.number().min(0).max(100),
  sessionId: z.string().uuid(),
});
export type ArticleViewedRequest = z.infer<typeof articleViewedRequestSchema>;

// 2. highlight + annotation (discriminator field `kind`)
export const highlightAnnotationRequestSchema = z.object({
  kind: z.enum(['highlight', 'annotation']),
  anchorText: z.string().min(1).max(2000),
  startOffset: z.number().int().nonnegative(),
  articleUrn: z.string().min(1),
  color: z.string().max(50).optional(),
  noteText: z.string().max(5000).optional(),
});
export type HighlightAnnotationRequest = z.infer<typeof highlightAnnotationRequestSchema>;

// 3. dossier:item:added + bookmark:added (discriminator field `kind`)
export const dossierBookmarkRequestSchema = z.object({
  kind: z.enum(['dossier', 'bookmark']),
  articleUrn: z.string().min(1),
  dossierId: z.string().uuid().optional(),
  tags: z.array(z.string()).max(20).optional(),
});
export type DossierBookmarkRequest = z.infer<typeof dossierBookmarkRequestSchema>;

// 4. citation:clicked
export const citationClickedRequestSchema = z.object({
  sourceArticleUrn: z.string().min(1),
  targetArticleUrn: z.string().min(1).nullable(),
  citationText: z.string().min(1).max(1000),
});
export type CitationClickedRequest = z.infer<typeof citationClickedRequestSchema>;

// 5. forum signals (discriminator field `action`)
export const forumSignalRequestSchema = z.object({
  action: z.enum(['like', 'download', 'suggestion_accepted', 'suggestion_declined']),
  sharedEnvId: z.string().uuid(),
  originalAuthorId: z.string().uuid().nullable(),
});
export type ForumSignalRequest = z.infer<typeof forumSignalRequestSchema>;

/** Union of all request schemas — useful for typed dispatchers. */
export const eventRequestSchemas = {
  'article-viewed': articleViewedRequestSchema,
  'highlight-annotation': highlightAnnotationRequestSchema,
  'dossier-bookmark': dossierBookmarkRequestSchema,
  'citation-clicked': citationClickedRequestSchema,
  'forum-signal': forumSignalRequestSchema,
} as const;

export type EventName = keyof typeof eventRequestSchemas;
