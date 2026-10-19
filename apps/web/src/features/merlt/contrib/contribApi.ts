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

/** Owner-scoped: the current user's recent extraction jobs (newest first). */
export interface MyContribJob {
  id: string;
  documentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  candidatesCreated: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function fetchMyContribJobs(): Promise<{ jobs: MyContribJob[] }> {
  const res = await apiClient.get<{ jobs: MyContribJob[] }>('/merlt/contrib/me/jobs');
  return res.data;
}

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
  // axios 1.x hangs (ERR_TIMED_OUT) on multipart with File parts: the XHR
  // adapter drops the binary body during serialization, the fetch adapter
  // doesn't fix it reliably either. Native `fetch()` to the same endpoint —
  // proved empirically — succeeds with status 201. We bypass axios just for
  // this one upload and reconstruct the auth header from localStorage. The
  // refresh interceptor is foregone here; if the token is expired the server
  // returns 401 and the caller surfaces it (the dropzone flow re-prompts).
  const token = localStorage.getItem('access_token');
  const baseURL = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  // Dev: Vite's `/api` proxy hangs on multipart uploads larger than a few KB
  // (small files succeed, multi-MB PDFs ERR_TIMED_OUT mid-stream). The BFF is
  // reachable directly on :3001 with CORS already allowing :5173, so we go
  // around the proxy here. In production the static bundle is served from the
  // same origin as the BFF — no proxy, no override.
  const uploadURL =
    import.meta.env.DEV && baseURL.startsWith('/')
      ? `http://localhost:3001${baseURL}/merlt/contrib/documents`
      : `${baseURL}/merlt/contrib/documents`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LONG_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(uploadURL, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: ac.signal,
      credentials: 'include',
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`upload failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as { documentId: number; duplicate?: boolean };
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
