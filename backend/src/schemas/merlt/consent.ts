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

/** POST /api/merlt/consent — set or upgrade consent level. */
export const consentSetRequestSchema = z.object({
  level: merltConsentLevelSchema,
  reason: z.string().max(500).optional(),
});
export type ConsentSetRequest = z.infer<typeof consentSetRequestSchema>;

/** DELETE /api/merlt/consent — revoke (sets level to 'none'). */
export const consentRevokeRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ConsentRevokeRequest = z.infer<typeof consentRevokeRequestSchema>;

/** GET /api/merlt/consent — response shape. */
export const consentResponseSchema = z.object({
  level: merltConsentLevelSchema,
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
