import { getMerlt, postMerlt } from '../../../../services/merltService';
import type {
  BatchDetail,
  IngestionBatchStatus,
  ListBatchesResponse,
  PromoteBatchInput,
  PromoteBatchResponse,
  RejectBatchInput,
  RejectBatchResponse,
  RunIngestionInput,
  RunIngestionResponse,
  UrnConflict,
} from './types';

/**
 * Typed BFF client for the admin governed ingestion pipeline (piece 4,
 * consumes the piece-3 BFF routes under /api/merlt/ops/ingestion/*). Mirrors
 * opsConfigApi.ts / graphApi.ts: uses the shared getMerlt/postMerlt helpers
 * (JWT attaches via the apiClient interceptor) — never fetch/axios directly.
 * URL paths passed WITHOUT `/api` (already in the axios baseURL).
 */

/** POST /api/merlt/ops/ingestion/run — 202, kicks off an async batch (starts in "parsing"). */
export function runIngestion(input: RunIngestionInput): Promise<RunIngestionResponse> {
  return postMerlt<RunIngestionResponse>('/merlt/ops/ingestion/run', input);
}

export interface ListBatchesParams {
  status?: IngestionBatchStatus;
  limit?: number;
  offset?: number;
}

/** GET /api/merlt/ops/ingestion/batches — optionally filtered by a single status. */
export function listBatches(params: ListBatchesParams = {}): Promise<ListBatchesResponse> {
  const query: Record<string, string | number> = {};
  if (params.status) query.status = params.status;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.offset !== undefined) query.offset = params.offset;
  return getMerlt<ListBatchesResponse>('/merlt/ops/ingestion/batches', query);
}

export interface GetBatchParams {
  nodeLimit?: number;
  edgeLimit?: number;
}

/** GET /api/merlt/ops/ingestion/batches/:batchId — full detail incl. conflict report + samples. */
export function getBatch(batchId: string, params: GetBatchParams = {}): Promise<BatchDetail> {
  const query: Record<string, number> = {};
  if (params.nodeLimit !== undefined) query.node_limit = params.nodeLimit;
  if (params.edgeLimit !== undefined) query.edge_limit = params.edgeLimit;
  return getMerlt<BatchDetail>(
    `/merlt/ops/ingestion/batches/${encodeURIComponent(batchId)}`,
    query
  );
}

/** POST /api/merlt/ops/ingestion/batches/:batchId/promote — 200 async (status becomes "promoting"); 409 if urn_conflicts and no force. */
export function promoteBatch(
  batchId: string,
  input: PromoteBatchInput = {}
): Promise<PromoteBatchResponse> {
  return postMerlt<PromoteBatchResponse>(
    `/merlt/ops/ingestion/batches/${encodeURIComponent(batchId)}/promote`,
    input
  );
}

/** POST /api/merlt/ops/ingestion/batches/:batchId/reject — synchronous, reason required. */
export function rejectBatch(
  batchId: string,
  input: RejectBatchInput
): Promise<RejectBatchResponse> {
  return postMerlt<RejectBatchResponse>(
    `/merlt/ops/ingestion/batches/${encodeURIComponent(batchId)}/reject`,
    input
  );
}

/**
 * Extracts the structured `urn_conflicts_block_promotion` 409 body from a
 * failed promote() call, if that's what happened. `apiClient`'s response
 * interceptor rejects with a plain `{ status, message, data }` object
 * (services/api.ts), NOT the raw AxiosError — same shape relied on across
 * the MERL-T FE clients (see graphApi.classifyIngestionTriggerError).
 * Returns null for any other error shape (network error, 503, etc.).
 */
export function extractUrnConflictsError(err: unknown): UrnConflict[] | null {
  if (typeof err !== 'object' || err === null) return null;
  const data = (err as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail !== 'object' || detail === null) return null;
  if ((detail as { error?: unknown }).error !== 'urn_conflicts_block_promotion') return null;
  const conflicts = (detail as { urn_conflicts?: unknown }).urn_conflicts;
  return Array.isArray(conflicts) ? (conflicts as UrnConflict[]) : null;
}
