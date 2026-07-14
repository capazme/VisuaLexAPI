import { z } from 'zod';

/**
 * Zod schemas for the MERL-T admin/ops MECHANICAL ingestion layer — the
 * deterministic, zero-LLM corpus→graph pipeline (VisuaLex article tree /
 * italia-corpus), governed by an admin review-and-promote gate.
 *
 * `created_by` / `reviewed_by` are NEVER part of the client-facing schema:
 * the route injects them server-side from req.user. Trusting a
 * client-supplied identity here would let a request forge attribution on an
 * irreversible graph-promotion action.
 *
 * Do not confuse with schemas/merlt/ingestion.ts — that one is the
 * INTERPRETIVE community ingestion pipeline, unrelated to this admin surface.
 */

export const runIngestionBodySchema = z.object({
  source: z.enum(['visualex_tree', 'italia_corpus']),
  source_ref: z.string().min(1),
  scope_label: z.string().min(1).max(300),
});
export type RunIngestionBody = z.infer<typeof runIngestionBodySchema>;

export const promoteBatchBodySchema = z.object({
  force: z.boolean().default(false),
  reason: z.string().optional(),
});
export type PromoteBatchBody = z.infer<typeof promoteBatchBodySchema>;

export const rejectBatchBodySchema = z.object({
  reason: z.string().min(1),
});
export type RejectBatchBody = z.infer<typeof rejectBatchBodySchema>;
