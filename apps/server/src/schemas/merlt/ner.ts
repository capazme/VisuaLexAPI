import { z } from 'zod';

/**
 * Zod schemas for the BFF /api/merlt/ner/* routes (Loop β #2 — NER via RLCF).
 * Client-facing camelCase; the route maps to MERL-T's snake_case + injects
 * user_id from the JWT. Privacy: contextWindow is hard-truncated route-side to
 * ~1200 chars (±500 around the citation) — never the raw query.
 */

/** The corrected/confirmed reference shape (open, but key fields are typed). */
export const nerCorrectReferenceSchema = z.object({
  actType: z.string().max(100).optional(),
  article: z.string().max(50).optional(),
  date: z.string().max(20).optional(),
  actNumber: z.string().max(50).optional(),
  annex: z.string().max(20).optional(),
  displayText: z.string().max(300).optional(),
});

export const nerFeedbackRequestSchema = z
  .object({
    surface: z.enum(['article_xref', 'qa_chip', 'implicit', 'search_mining']),
    feedbackType: z.enum(['confirmation', 'correction', 'false_positive', 'missed']),
    articleUrn: z.string().max(300).optional(),
    selectedText: z.string().max(500).optional(),
    startOffset: z.number().int().min(0).optional(),
    endOffset: z.number().int().min(0).optional(),
    contextWindow: z.string().max(5000).optional(),
    originalParsed: z.record(z.unknown()).optional(),
    correctReference: nerCorrectReferenceSchema.optional(),
    confidenceBefore: z.number().min(0).max(1).optional(),
  })
  .refine(
    (d) =>
      (d.feedbackType !== 'correction' && d.feedbackType !== 'missed') ||
      d.correctReference !== undefined,
    {
      message: 'correctReference is required for correction/missed feedback',
      path: ['correctReference'],
    }
  );

export type NerFeedbackRequest = z.infer<typeof nerFeedbackRequestSchema>;

export const nerTrainingStartRequestSchema = z.object({
  nIter: z.number().int().min(1).max(200).optional(),
  onlyUntrained: z.boolean().optional(),
});

export type NerTrainingStartRequest = z.infer<typeof nerTrainingStartRequestSchema>;
