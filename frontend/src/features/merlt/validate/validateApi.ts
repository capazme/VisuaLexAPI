import { apiClient } from '../../../services/api';

/** Typed BFF clients for the RLCF validation routes (Slice 2c #8). */

export type MerltVote = 'approve' | 'reject';

export interface PendingEntityItem {
  entity_id: string;
  entity_text?: string;
  descrizione?: string;
  article_urn?: string;
  votes_count?: number;
  net_score?: number;
  [k: string]: unknown;
}

export interface PendingRelationItem {
  relation_id: string;
  relation_description?: string;
  relation_type?: string;
  source_node_urn?: string;
  target_entity_id?: string;
  votes_count?: number;
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
