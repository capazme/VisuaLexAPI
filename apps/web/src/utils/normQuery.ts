/**
 * A norm typed as a lawyer types it, read as the search reads it — one function for the search box
 * (`useSearchQuery`) and for «Analizza documento» (`documentCandidates.ts`), so the same words name the same norm
 * in both (design 2026-10-29-document-analysis §4.4). The client's parser first, with the user's aliases; the
 * server's resolver (`/parse_query`, `/parse_query_batch`) for what the client cannot make searchable.
 */
import type { CustomAlias } from '../types';
import { isSearchReady, parseLegalCitation, type ParsedCitation } from './citationParser';

export interface NormQueryReading {
  /** The client parser's reading, with the user's aliases; null when it reads nothing. */
  citation: ParsedCitation | null;
  /** The reading names an act and an article: the search can run on it as it is. */
  ready: boolean;
  /** The words to ask the server about (trimmed), or null: the reading is ready, or the words are too short. */
  askServer: string | null;
}

/** The client half of the search's reading: pure, no request. */
export function readNormQuery(query: string, customAliases: CustomAlias[] = []): NormQueryReading {
  const citation = query && query.length >= 2 ? parseLegalCitation(query, customAliases) : null;
  const ready = isSearchReady(citation);
  const trimmed = (query ?? '').trim();
  return { citation, ready, askServer: !ready && trimmed.length >= 3 ? trimmed : null };
}

/** One answer of `/parse_query` or of `/parse_query_batch`, as far as the reading goes. */
export interface ServerNormReading {
  recognized?: boolean;
  parsed?: {
    act_type?: string | null;
    act_number?: string | null;
    date?: string | null;
    article?: string | null;
    annex?: string | null;
  } | null;
}

/** The server's reading as the client's shape; null when it names no act type. */
export function citationFromServer(answer: ServerNormReading | null | undefined): ParsedCitation | null {
  const parsed = answer?.recognized ? answer.parsed : null;
  if (!parsed?.act_type) return null;
  return {
    act_type: parsed.act_type,
    act_number: parsed.act_number || undefined,
    date: parsed.date || undefined,
    article: parsed.article || undefined,
    annex: parsed.annex || undefined,
    // Named by the server's curated tables, not guessed.
    confidence: 0.9,
  };
}

/** The client wins when its own reading is already searchable; otherwise the server fills in. */
export function preferredReading(local: ParsedCitation | null, server: ParsedCitation | null): ParsedCitation | null {
  return isSearchReady(local) ? local : server ?? local;
}
