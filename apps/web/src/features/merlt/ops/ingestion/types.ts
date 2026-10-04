/**
 * Frontend types for the admin-governed MECHANICAL ingestion pipeline
 * (piece 3/4 — deterministic corpus→graph batches, staged and reviewed
 * before promotion).
 *
 * The BFF proxies MERL-T's `/api/v1/ingestion/mechanical/*` responses
 * VERBATIM (routes/merlt/opsIngestion.ts) — these types mirror the contract
 * in snake_case exactly as MERL-T emits it. Never invent camelCase fields;
 * that would silently desync from what the network actually returns.
 */

export type IngestionSource = 'visualex_tree' | 'italia_corpus' | 'massimario';

export type IngestionBatchStatus =
  | 'parsing'
  | 'pending_review'
  | 'promoting'
  | 'promoted'
  | 'rejected'
  | 'failed';

/** Batch statuses that are mid-transition — the poller keeps refetching while in this set. */
export const TRANSIENT_BATCH_STATUSES: ReadonlySet<IngestionBatchStatus> = new Set([
  'parsing',
  'promoting',
]);

export interface BatchStats {
  nodes_total?: number;
  nodes_new?: number;
  nodes_update?: number;
  edges_total?: number;
  edges_new?: number;
  edges_orphan?: number;
  duplicates?: number;
  coverage_pct?: number | null;
  [key: string]: unknown;
}

export interface BatchSummary {
  id: string;
  source: IngestionSource;
  scope_label: string;
  status: IngestionBatchStatus;
  stats: BatchStats | null;
  created_at: string;
  created_by: string | null;
  reviewed_by: string | null;
  promoted_at: string | null;
  rejected_at: string | null;
  expires_at: string | null;
  error: string | null;
}

export interface UrnConflictEstremi {
  estremi?: string;
  tipo_documento?: string;
  [key: string]: unknown;
}

export interface UrnConflict {
  urn: string;
  batch: UrnConflictEstremi;
  graph: UrnConflictEstremi;
}

export interface OrphanEdge {
  start: string;
  end: string;
  type: string;
}

export interface ConflictReportStats {
  nodes_total: number;
  nodes_new: number;
  nodes_update: number;
  edges_total: number;
  edges_new: number;
  edges_orphan: number;
  duplicates: number;
  coverage_pct: number | null;
}

export interface ConflictReport {
  urn_conflicts: UrnConflict[];
  node_updates: string[];
  node_new: string[];
  orphan_edges: OrphanEdge[];
  duplicates: string[];
  coverage: { expected: number; extracted: number; coverage_pct: number } | null;
  stats: ConflictReportStats;
  massimario?: MassimarioReport;
}

/** `conflict_report.massimario` of a Massimario batch (MERL-T pipeline/massimario/volume.py). */
export interface MassimarioReport {
  volume: { id: number; titolo: string; anno: number; archivio: string; numero: number | null };
  paragrafi: number;
  frammenti: number;
  citazioni: {
    rv_totali: number;
    rv_riconosciute: number;
    copertura_pct: number | null;
    per_forma: Record<string, number>;
    senza_identita: Record<string, number>;
    non_riconosciute: string[];
  };
  pronunce: {
    totali: number;
    anno_implicito: number;
    chiavi_con_piu_sezioni: { key: string; sezioni: string[] }[];
    gia_nel_grafo: number | null;
  };
  norme: {
    riferimenti: number;
    articoli: number;
    atti: number;
    stub: number;
    date_completate: number;
    non_risolte: number;
    partizioni: number;
    campioni_non_risolti: string[];
    gia_nel_grafo: number | null;
    /** links the portal wrote as laws whose anchor is a Cassazione section letter ("Sez. L, n. …") */
    link_a_pronunce?: number;
  };
  sezioni_fuori_capitolo: number;
}

/** `stats.vectors` of a promoted Massimario batch. */
export interface VectorProgress {
  done: number;
  total: number;
  error?: string;
}

export interface BatchDetail extends BatchSummary {
  conflict_report: ConflictReport | null;
  nodes_sample: Record<string, unknown>[];
  edges_sample: Record<string, unknown>[];
  nodes_total: number;
  edges_total: number;
}

export interface RunIngestionInput {
  source: IngestionSource;
  source_ref: string;
  scope_label: string;
}

export interface RunIngestionResponse {
  batch_id: string;
  job_id: string;
}

export interface ListBatchesResponse {
  batches: BatchSummary[];
}

export interface PromoteBatchInput {
  force?: boolean;
  reason?: string;
}

export interface PromoteBatchResponse {
  batch_id: string;
  job_id: string;
  status: 'promoting';
}

export interface RejectBatchInput {
  reason: string;
}

export interface RejectBatchResponse {
  batch_id: string;
  status: 'rejected';
}

/** Structured 409 body MERL-T returns when promotion is blocked by unresolved URN conflicts. */
export interface UrnConflictsBlockError {
  error: 'urn_conflicts_block_promotion';
  urn_conflicts: UrnConflict[];
}
