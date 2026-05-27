import { apiClient } from '../../../services/api';
import type {
  ExtractDocumentResponse,
  ExtractionJobStatusResponse,
  ListCandidatesResponse,
  PromoteCandidatePayload,
  PromoteResponse,
} from './types';

/** Typed BFF clients for the MERL-T contribution routes (Slice 2c). */

const LONG_TIMEOUT_MS = 120000;

/** POST /api/merlt/contrib/documents (multipart). Returns the MERL-T document id. */
export async function uploadContribDocument(
  file: File,
  meta?: { documentType?: string; legalDomain?: string; title?: string },
): Promise<{ documentId: number; duplicate?: boolean }> {
  const form = new FormData();
  form.append('file', file);
  if (meta?.documentType) form.append('documentType', meta.documentType);
  if (meta?.legalDomain) form.append('legalDomain', meta.legalDomain);
  if (meta?.title) form.append('title', meta.title);
  const res = await apiClient.post<{ documentId: number; duplicate?: boolean }>(
    '/merlt/contrib/documents',
    form,
    { timeout: LONG_TIMEOUT_MS },
  );
  return res.data;
}

/** POST /api/merlt/contrib/documents/:id/extract — enqueue async extraction. */
export async function extractContribDocument(documentId: number): Promise<ExtractDocumentResponse> {
  const res = await apiClient.post<ExtractDocumentResponse>(
    `/merlt/contrib/documents/${documentId}/extract`,
  );
  return res.data;
}

/** GET /api/merlt/contrib/jobs/:jobId/status */
export async function fetchExtractionJobStatus(
  jobId: string,
): Promise<ExtractionJobStatusResponse> {
  const res = await apiClient.get<ExtractionJobStatusResponse>(
    `/merlt/contrib/jobs/${jobId}/status`,
  );
  return res.data;
}

/** GET /api/merlt/contrib/documents/:id/candidates */
export async function fetchContribCandidates(documentId: number): Promise<ListCandidatesResponse> {
  const res = await apiClient.get<ListCandidatesResponse>(
    `/merlt/contrib/documents/${documentId}/candidates`,
  );
  return res.data;
}

/** POST /api/merlt/contrib/candidates/:id/promote */
export async function promoteCandidate(
  candidateId: number,
  payload: PromoteCandidatePayload,
): Promise<PromoteResponse> {
  const res = await apiClient.post<PromoteResponse>(
    `/merlt/contrib/candidates/${candidateId}/promote`,
    payload,
  );
  return res.data;
}
