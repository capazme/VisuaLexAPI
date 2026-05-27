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
    };

export interface PromoteResponse {
  pendingId: string;
}
