// apps/web/src/features/merlt/rassegne/rassegneApi.ts
import { getMerlt } from '../../../services/merltService';
import type { RassegneQuery, RassegneResponse } from './types';

export function fetchRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const params: Record<string, string | number> = { urn: query.urn };
  if (query.anno !== undefined) params.anno = query.anno;
  if (query.archivio) params.archivio = query.archivio;
  if (query.cursor) params.cursor = query.cursor;
  return getMerlt<RassegneResponse>('/merlt/rassegne', params);
}
