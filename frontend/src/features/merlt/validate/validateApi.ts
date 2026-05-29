import { apiClient } from '../../../services/api';

/** Typed BFF clients for the RLCF validation routes (Slice 2c #8). */

export type MerltVote = 'approve' | 'reject';

// The MERL-T `/enrichment/pending/list` response uses the short `id` /
// `nome` keys (not `entity_id` / `entity_text` like the DB model). The BFF
// passes the body through verbatim, so the FE types must match the API shape.
export interface PendingEntityItem {
  id: string;
  nome?: string;
  tipo?: string;
  descrizione?: string;
  articoli_correlati?: string[];
  ambito?: string;
  fonte?: string;
  votes_count?: number;
  approval_score?: number;
  rejection_score?: number;
  contributor_authority?: number;
  contributed_by?: string;
  [k: string]: unknown;
}

export interface PendingRelationItem {
  id: string;
  tipo_relazione?: string;
  source_urn?: string;
  target_entity_id?: string;
  descrizione?: string;
  votes_count?: number;
  approval_score?: number;
  rejection_score?: number;
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
