import { z } from 'zod';

/**
 * Zod schemas for the MERL-T consent API (Slice 1).
 *
 * Mirror of the Prisma enum `MerltConsentLevel` (none | basic | full).
 * The three preference toggles (contribution/validation/graph) live in
 * MerltUserPreference but are *outputs* of consent state, not inputs:
 *  - none  → all toggles forced off
 *  - basic → contribution/validation off, graph on
 *  - full  → all on
 * The route handler applies these defaults; the client only POSTs the level.
 */

export const merltConsentLevelSchema = z.enum(['none', 'basic', 'full']);
export type MerltConsentLevelSchema = z.infer<typeof merltConsentLevelSchema>;

/**
 * POST /api/merlt/consent — choose a level, under the version of the MERL-T notice the person
 * had before them (`noticeId`): a version that is no longer the current one is a 409 with the
 * current one, nothing written.
 */
export const consentSetRequestSchema = z.object({
  level: merltConsentLevelSchema,
  noticeId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type ConsentSetRequest = z.infer<typeof consentSetRequestSchema>;

/**
 * DELETE /api/merlt/consent — revoke (sets level to 'none'). With `deleteData`, what MERL-T
 * collected so far is erased too (`services/merlt/userData.ts`).
 */
export const consentRevokeRequestSchema = z.object({
  reason: z.string().max(500).optional(),
  deleteData: z.boolean().optional(),
});
export type ConsentRevokeRequest = z.infer<typeof consentRevokeRequestSchema>;

/** The current MERL-T notice, as the consent answer carries it (plain text, blank lines between paragraphs). */
export const consentNoticeSchema = z.object({
  id: z.string(),
  versione: z.number().int(),
  titolo: z.string(),
  corpo: z.string(),
  conferma: z.string(),
  azione: z.string(),
});

/**
 * GET /api/merlt/consent — response shape. `level` is what MERL-T may collect now
 * (`effectiveConsent`: `none` until the current notice is answered); `storedLevel` is the
 * person's last choice, which the consent screen offers again when a new notice asks them anew.
 */
export const consentResponseSchema = z.object({
  level: merltConsentLevelSchema,
  storedLevel: merltConsentLevelSchema,
  noticeAnswered: z.boolean(),
  notice: consentNoticeSchema.nullable(),
  contributionEnabled: z.boolean(),
  validationEnabled: z.boolean(),
  graphEnabled: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
  lastAuditAt: z.string().datetime().nullable(),
});
export type ConsentResponse = z.infer<typeof consentResponseSchema>;

/**
 * Helper: derive the three preference toggles from a consent level.
 * Pure function — reused by both the consent route (DB write) and the
 * consentGuard middleware (MERLT-1.4).
 */
export function preferencesForLevel(level: MerltConsentLevelSchema): {
  contributionEnabled: boolean;
  validationEnabled: boolean;
  graphEnabled: boolean;
} {
  switch (level) {
    case 'none':
      return { contributionEnabled: false, validationEnabled: false, graphEnabled: false };
    case 'basic':
      return { contributionEnabled: false, validationEnabled: false, graphEnabled: true };
    case 'full':
      return { contributionEnabled: true, validationEnabled: true, graphEnabled: true };
  }
}
