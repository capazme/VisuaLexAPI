import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth';
import { consentGuard } from '../../services/merlt/consentGuard';
import { contributionGuard } from '../../services/merlt/contributionGuard';
import {
  expertQueryRequestSchema,
  inlineFeedbackRequestSchema,
  sourceFeedbackRequestSchema,
  detailedFeedbackRequestSchema,
  preferenceFeedbackRequestSchema,
  relationFeedbackRequestSchema,
  refineRequestSchema,
  confirmSourceRequestSchema,
} from '../../schemas/merlt/experts';
import { getExpertsClient } from '../../services/merlt/expertsClient';
import { MerltClientError, MerltBadRequestError } from '../../services/merlt/merltClient';

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Dedupe + drop empties from an optional string list (order-preserving). */
function uniqueStrings(list: string[] | undefined): string[] {
  if (!list || list.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * MERL-T expert Q&A routes (Loop β Phase F). Thin proxy: authenticate + a
 * consent guard, inject user_id, map consent, forward to MERL-T :8000.
 * Consent ladder (Slice 3 D2 "leggere è libero, insegnare richiede consenso"):
 *   - ASK is consumption → consentGuard (basic OR full): /query, /refine, /history
 *   - TEACH writes to the shared model → contributionGuard (full): all
 *     /feedback/* channels + /confirm-source
 * Registered in routes/merlt/index.ts BEFORE the catch-all auth routers
 * (per-route auth → order-safe; gotcha #1).
 */

const router = Router();

export function mapConsentLevel(
  level: string | null | undefined
): 'anonymous' | 'basic' | 'full' {
  if (level === 'full') return 'full';
  if (level === 'basic') return 'basic';
  return 'anonymous';
}

function handleMerltError(err: unknown, res: Response): void {
  if (err instanceof MerltBadRequestError) {
    res
      .status(err.status ?? 400)
      .json(typeof err.body === 'object' && err.body ? err.body : { detail: 'merlt_bad_request' });
    return;
  }
  if (err instanceof MerltClientError) {
    res.status(503).json({ detail: 'merlt_unavailable' });
    return;
  }
  throw err;
}

// --- Steer idempotency (Wave 2 P2.7) -------------------------------------
// In-memory dedupe on the 3 TEACHING channels (preference / relation /
// confirm-source): the FE steer buttons are optimistic and re-armable across
// remounts, so a duplicate POST for the same (user, trace, channel, target)
// within the TTL is acknowledged with `{ success: true, deduped: true }`
// WITHOUT forwarding upstream — one jurist's click must count once in the
// RLCF training buffer. In-memory per-instance (same trade-off as the
// circuit-breaker registry): single-instance deployment only.
const STEER_DEDUPE_TTL_MS = 10 * 60 * 1000;
const STEER_DEDUPE_MAX_ENTRIES = 5000;
const steerSeen = new Map<string, number>(); // key → expiry (epoch ms)

function steerKey(userId: string, channel: string, traceId: string, target: string): string {
  return `${userId}|${channel}|${traceId}|${target}`;
}

function isSteerDuplicate(key: string): boolean {
  const expiry = steerSeen.get(key);
  if (expiry === undefined) return false;
  if (expiry > Date.now()) return true;
  steerSeen.delete(key);
  return false;
}

/** Record ONLY after upstream success — a failed forward must stay retryable. */
function markSteerSeen(key: string): void {
  const now = Date.now();
  if (steerSeen.size >= STEER_DEDUPE_MAX_ENTRIES) {
    for (const [k, expiry] of steerSeen) {
      if (expiry <= now) steerSeen.delete(k);
    }
    // Still saturated after purging expired entries → drop everything rather
    // than grow unbounded (dedupe is spam protection, not correctness).
    if (steerSeen.size >= STEER_DEDUPE_MAX_ENTRIES) steerSeen.clear();
  }
  steerSeen.set(key, now + STEER_DEDUPE_TTL_MS);
}

export function _resetSteerDedupeForTests(): void {
  steerSeen.clear();
}

router.post('/experts/query', authenticate, consentGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = expertQueryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  const pref = await prisma.merltUserPreference.findUnique({
    where: { userId: req.user.id },
    select: { consentLevel: true },
  });
  // The context basket → MERL-T `context.entities`, the channel the orchestrator
  // actually consumes (norm_references seed graph exploration + the expert prompt;
  // legal_concepts feed the prompt). `mode` and the legacy `context_urn` ride in
  // the same opaque `context` dict (Dict[str, Any] on the Pydantic side — extra
  // keys are fine); `context_urn` stays for backward compatibility only.
  const normReferences = uniqueStrings(parsed.data.context?.normReferences);
  const legalConcepts = uniqueStrings(parsed.data.context?.legalConcepts);
  const entities: Record<string, string[]> = {};
  if (normReferences.length) entities.norm_references = normReferences;
  if (legalConcepts.length) entities.legal_concepts = legalConcepts;
  const hasEntities = Object.keys(entities).length > 0;
  const context =
    parsed.data.mode || parsed.data.contextUrn || hasEntities
      ? {
          ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
          ...(parsed.data.contextUrn ? { context_urn: parsed.data.contextUrn } : {}),
          ...(hasEntities ? { entities } : {}),
        }
      : undefined;
  try {
    const result = await getExpertsClient().query({
      query: parsed.data.query,
      user_id: req.user.id,
      consent_level: mapConsentLevel(pref?.consentLevel),
      max_experts: parsed.data.maxExperts,
      context,
      include_trace: true,
    });
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.get('/experts/history', authenticate, consentGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const limit = clampInt(req.query.limit, 20, 1, 100);
  try {
    res.status(200).json(await getExpertsClient().history(req.user.id, limit));
  } catch (err) {
    handleMerltError(err, res);
  }
});

// Wave 2 (history completeness, review P2.6): the history DTO is slim (no
// retrieved_sources / expert_contributions / disagreement), so reopening a
// past deliberation lost the canvas overlay and the sources panel. This proxy
// returns the FULL stored pipeline trace; the FE parses it back into the
// deliberation details. READ → consentGuard (basic OR full), like /history.
// 404 from MERL-T (unknown/expired trace, or asked without include_trace)
// passes through — the FE keeps the slim turn and notes the missing details.
router.get('/experts/trace/:traceId', authenticate, consentGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const traceId = req.params.traceId;
  if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(traceId)) {
    res.status(400).json({ detail: 'invalid_trace_id' });
    return;
  }
  // Redaction follows the CURRENT consent level (a downgrade after the ask
  // must redact), mirroring the /query consent mapping.
  const pref = await prisma.merltUserPreference.findUnique({
    where: { userId: req.user.id },
    select: { consentLevel: true },
  });
  try {
    res.status(200).json(await getExpertsClient().getTrace(traceId, mapConsentLevel(pref?.consentLevel)));
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/inline', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = inlineFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackInline({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        rating: parsed.data.rating,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/source', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = sourceFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackSource({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        source_id: parsed.data.sourceId,
        relevance: parsed.data.relevance,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/detailed', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = detailedFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().feedbackDetailed({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        retrieval_score: parsed.data.retrievalScore,
        reasoning_score: parsed.data.reasoningScore,
        synthesis_score: parsed.data.synthesisScore,
        comment: parsed.data.comment,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/feedback/preference', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = preferenceFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  // Wave 2 P2.7: one canon steer per (user, trace, canon) within the TTL.
  const dedupeKey = steerKey(req.user.id, 'preference', parsed.data.traceId, parsed.data.preferredExpert);
  if (isSteerDuplicate(dedupeKey)) {
    res.status(200).json({ success: true, deduped: true });
    return;
  }
  try {
    const result = await getExpertsClient().feedbackPreference({
      trace_id: parsed.data.traceId,
      user_id: req.user.id,
      preferred_expert: parsed.data.preferredExpert,
      comment: parsed.data.comment,
    });
    markSteerSeen(dedupeKey);
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

// Slice 4 L3 "privilegia questa relazione": per-relation traversal steer.
// TEACH channel (trains the TraversalPolicy) → contributionGuard (full),
// exactly like the sibling /feedback/* channels.
router.post('/experts/feedback/relation', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = relationFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  // Wave 2 P2.7: one relation steer per (user, trace, relation) within the TTL.
  const dedupeKey = steerKey(req.user.id, 'relation', parsed.data.traceId, parsed.data.relationType);
  if (isSteerDuplicate(dedupeKey)) {
    res.status(200).json({ success: true, deduped: true });
    return;
  }
  try {
    const result = await getExpertsClient().feedbackRelation({
      trace_id: parsed.data.traceId,
      user_id: req.user.id,
      relation_type: parsed.data.relationType,
      comment: parsed.data.comment,
    });
    markSteerSeen(dedupeKey);
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/refine', authenticate, consentGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = refineRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(
      await getExpertsClient().refine({
        trace_id: parsed.data.traceId,
        user_id: req.user.id,
        follow_up_query: parsed.data.followUpQuery,
      })
    );
  } catch (err) {
    handleMerltError(err, res);
  }
});

router.post('/experts/confirm-source', authenticate, contributionGuard, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required' });
    return;
  }
  const parsed = confirmSourceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ detail: 'invalid_body', issues: parsed.error.flatten() });
    return;
  }
  // Wave 2 P2.7: confirm-source has no traceId — the node id IS the target.
  const dedupeKey = steerKey(req.user.id, 'confirm-source', '', parsed.data.nodeId);
  if (isSteerDuplicate(dedupeKey)) {
    res.status(200).json({ success: true, deduped: true });
    return;
  }
  try {
    const result = await getExpertsClient().confirmSource({
      node_id: parsed.data.nodeId,
      user_id: req.user.id,
      entity_text: parsed.data.entityText,
      entity_type: parsed.data.entityType,
      ambito: parsed.data.ambito,
    });
    markSteerSeen(dedupeKey);
    res.status(200).json(result);
  } catch (err) {
    handleMerltError(err, res);
  }
});

export default router;
