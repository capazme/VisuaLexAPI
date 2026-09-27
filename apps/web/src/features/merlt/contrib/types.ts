/** Types for the "Apprendi dai miei appunti" contribution flow (Slice 2c). */

export type ExtractionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export const TERMINAL_EXTRACTION_STATUSES = new Set<ExtractionJobStatus>([
  'completed',
  'failed',
  'timeout',
]);

export interface ExtractionCandidate {
  id: number;
  candidate_type: 'entity' | 'relation';
  article_urn?: string;
  entity_text?: string;
  relation_type?: string;
  source_node_urn?: string;
  target_entity_id?: string;
  descrizione?: string;
  verbatim_excerpt?: string;
  llm_confidence?: number;
  potential_duplicate_of?: string | null;
  /** LLM-assigned entity type (concetto | principio | definizione). */
  entity_type?: string | null;
  status?: string;
  /** MERL-T user_documents id the candidate was extracted from. */
  document_id?: number | null;
  /**
   * B1 relation endpoints: the names the extractor wrote, and whether the
   * staging parser already resolved `source_node_urn` / `target_entity_id` to
   * a graph identifier. A missing flag means unresolved: the card asks.
   */
  source_text?: string | null;
  target_text?: string | null;
  source_resolved?: boolean | null;
  target_resolved?: boolean | null;
}

export interface ExtractDocumentResponse {
  jobId: string;
  status: ExtractionJobStatus;
}

export interface ExtractionJobStatusResponse {
  jobId: string;
  status: ExtractionJobStatus;
  candidatesCreated: number | null;
  error: string | null;
}

export interface ListCandidatesResponse {
  candidates: ExtractionCandidate[];
}

/** Promote payload (entity or relation), carrying the reformulation + attestation. */
export type PromoteCandidatePayload =
  | {
      candidateType: 'entity';
      articleUrn: string;
      nome: string;
      tipo: string;
      descrizione: string;
      fonte: string;
      attested: boolean;
      skipDuplicateCheck?: boolean;
      acknowledgedDuplicateOf?: string;
    }
  | {
      candidateType: 'relation';
      articleUrn: string;
      sourceUrn: string;
      targetEntityId: string;
      tipoRelazione: string;
      descrizione: string;
      fonte: string;
      attested: boolean;
      skipDuplicateCheck?: boolean;
      acknowledgedDuplicateOf?: string;
    };

export interface PromoteDuplicate {
  id: string;
  text: string;
}

/**
 * A 200 is not a success: `created` says whether a pending_* row exists.
 * `duplicateActionRequired` asks the user to confirm or drop; any other
 * non-created answer carries MERL-T's reason in `message`.
 */
export interface PromoteResponse {
  pendingId: string | null;
  created?: boolean;
  hasDuplicates?: boolean;
  duplicateActionRequired?: boolean;
  message?: string | null;
  duplicates?: PromoteDuplicate[];
}
