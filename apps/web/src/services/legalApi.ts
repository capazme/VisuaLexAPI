/**
 * Minimal client for the Python legal-data backend (port 5000 in dev via Vite proxy).
 *
 * Separate from services/api.ts (which targets the Node platform backend on 3001
 * with Bearer auth + refresh flow). Spike 2 will consolidate all /fetch_* and
 * /stream_* call sites into a single normaService.
 */

import type { SearchParams } from '../types';

export class LegalApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LegalApiError';
    this.status = status;
  }
}

async function legalApiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new LegalApiError(response.status, `${path} failed: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export interface FetchNormaDataRequest {
  act_type: string;
  act_number?: string;
  date?: string;
  article?: string;
  version?: SearchParams['version'];
  version_date?: string;
  annex?: string;
}

export interface FetchNormaDataResponse {
  norma_data?: Array<{
    urn?: string;
    url?: string;
    tipo_atto?: string;
    numero_atto?: string;
    data?: string;
    [key: string]: unknown;
  }>;
}

export function fetchNormaData(body: FetchNormaDataRequest): Promise<FetchNormaDataResponse> {
  return legalApiPost<FetchNormaDataResponse>('/fetch_norma_data', body);
}

export interface FetchTreeRequest {
  urn: string;
  link?: boolean;
  details?: boolean;
}

export type FetchTreeResponse = { articles?: unknown } | unknown[];

export function fetchArticleTree(body: FetchTreeRequest): Promise<FetchTreeResponse> {
  return legalApiPost<FetchTreeResponse>('/fetch_tree', body);
}
