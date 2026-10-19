/**
 * Server-side copyright/grounding gate for promoting an extracted candidate to
 * a canonical RLCF proposal (Slice 2c, decision C5).
 *
 * Enforced on the BFF — NOT just in the UI — so a user cannot push raw,
 * potentially copyrighted verbatim text into the shared graph. Requires:
 *   1. a non-empty citable `fonte`,
 *   2. proposed text that differs from the raw extract (reformulation), and
 *   3. an explicit attestation flag.
 *
 * It cannot detect plagiarism; it forces awareness + provenance and keeps the
 * verbatim out of the shared pipeline.
 */

export interface PromotionGateInput {
  fonte: string;
  reformulatedText: string;
  verbatimExcerpt: string;
  attested: boolean;
}

export type PromotionGateResult =
  | { ok: true }
  | { ok: false; reason: 'missing_fonte' | 'not_reformulated' | 'not_attested' };

/** Collapse whitespace, trim and lowercase for a tolerant "is it different?" check. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function validatePromotionGate(input: PromotionGateInput): PromotionGateResult {
  if (!input.fonte || input.fonte.trim().length === 0) {
    return { ok: false, reason: 'missing_fonte' };
  }
  if (!input.attested) {
    return { ok: false, reason: 'not_attested' };
  }
  const proposed = normalize(input.reformulatedText);
  if (proposed.length === 0 || proposed === normalize(input.verbatimExcerpt)) {
    return { ok: false, reason: 'not_reformulated' };
  }
  return { ok: true };
}
