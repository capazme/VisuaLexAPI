import { apiClient } from '../../../services/api';

/** Typed BFF clients for the RLCF validation routes (Slice 2c #8). */

export type MerltVote = 'approve' | 'reject';

// The MERL-T `/enrichment/pending` response uses the short `id` / `nome` keys
// (not `entity_id` / `entity_text` like the DB model). The BFF passes the body
// through verbatim, so the FE types must match the `PendingEntityData` /
// `PendingRelationData` Pydantic models (merlt/api/models/enrichment_models.py).
export interface PendingEntityItem {
  id: string;
  nome?: string;
  tipo?: string;
  descrizione?: string;
  /** Related article URNs — the first one is the "source norm" link target. */
  articoli_correlati?: string[];
  ambito?: string;
  /** Provenance: which pipeline/source proposed it (e.g. "llm_extraction", "visualex"). */
  fonte?: string;
  votes_count?: number;
  approval_score?: number;
  rejection_score?: number;
  contributor_authority?: number;
  contributed_by?: string;
  /** ISO timestamp — the "quando" of the provenance line. */
  created_at?: string;
  [k: string]: unknown;
}

export interface PendingRelationItem {
  id: string;
  /** `relation_type` on the wire (RelationType enum serialized as string). */
  relation_type?: string;
  /** Source node URN — the "source norm" link target for a relation. */
  source_urn?: string;
  target_urn?: string;
  /** Textual evidence for the relation (used as the card body). */
  evidence?: string;
  ambito?: string;
  fonte?: string;
  votes_count?: number;
  approval_score?: number;
  rejection_score?: number;
  contributor_authority?: number;
  contributed_by?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface PendingQueue {
  pending_entities: PendingEntityItem[];
  pending_relations: PendingRelationItem[];
  total_entities: number;
  total_relations: number;
  user_can_vote: number;
}

export async function fetchPendingQueue(limit = 50): Promise<PendingQueue> {
  const res = await apiClient.get<PendingQueue>('/merlt/validate/pending', { params: { limit } });
  return res.data;
}

export async function voteEntity(entityId: string, vote: MerltVote, reason?: string): Promise<void> {
  await apiClient.post('/merlt/validate/entity', { entityId, vote, reason });
}

export async function voteRelation(relationId: string, vote: MerltVote, reason?: string): Promise<void> {
  await apiClient.post('/merlt/validate/relation', { relationId, vote, reason });
}

/**
 * Slice C wave 2: provisional graph nodes the hygiene sweep flagged for human
 * review (faded but with accumulated human signal). Unlike entity/relation
 * proposals, adjudication acts on the EXISTING node — approve promotes it in
 * place, reject deletes it (no new node, no consensus queue).
 */
export interface ProvisionalReviewItem {
  node_id: string;
  source_url: string | null;
  trust: number | null;
  usage_count: number | null;
  positive_feedback_count: number | null;
  has_confirmed_citation: boolean | null;
  review_reason: string | null;
  review_flagged_at: string | null;
  labels: string[];
  text_preview: string;
}

export interface ProvisionalReviewResponse {
  items: ProvisionalReviewItem[];
  count: number;
}

export async function fetchProvisionalReview(limit = 100): Promise<ProvisionalReviewResponse> {
  const res = await apiClient.get<ProvisionalReviewResponse>('/merlt/graph/provisional-review', {
    params: { limit },
  });
  return res.data;
}

export async function adjudicateProvisional(
  nodeId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  await apiClient.post(`/merlt/graph/provisional-review/${encodeURIComponent(nodeId)}`, { decision });
}
