import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { parseLegalCitation, isSearchReady, formatParsedCitation, toSearchParams, type ParsedCitation } from '../utils/citationParser';
import { parseItalianDate } from '../utils/dateUtils';
import type { SearchFilters, SearchParams } from '../types';
import { parseDecisionCitation } from '../utils/decisionCitationParser';
import type { DecisionReference } from '../types/decisions';
import { foldAlias } from './useAliasCatalog';
import { legalFetch } from '../services/legalFetch';

/** What the words typed in a search box name: one reading, shared by the palette and the search page's field. */
export interface SearchQueryReading {
  /** A court decision («Cass. civ. 10787/2024»): read first, only for words that start with a court. */
  decisionRef: DecisionReference | null;
  /** A norm, from the client's parser or, as a fallback, the server's resolver. */
  parsedCitation: ParsedCitation | null;
  /** The norm carries everything a search needs. */
  citationReady: boolean;
  /** The norm as the preview line writes it. */
  citationPreview: string;
  /** The server is still resolving the words as an act. */
  resolvingRemotely: boolean;
  /** Words that are neither a decision nor a norm: a topic for the Cassazione's decisions. */
  topic: string | null;
}

/**
 * Reads what a search box holds. The client's parser wins when its reading is already searchable;
 * otherwise the server's resolver (`/parse_query`, 387 act names against the client's ~40) fills in,
 * asked 250 ms after the typing stops.
 */
export function useSearchQuery(inputValue: string): SearchQueryReading {
  const customAliases = useAppStore((s) => s.customAliases);

  // A court decision ("Cass. civ. 10787/2024") is read first, but only an input that starts with a
  // court: the norm parser keeps everything else, and an alias trigger of the user's wins over it.
  const decisionRef = useMemo(
    () => (inputValue.length >= 4
      ? parseDecisionCitation(inputValue, { aliasTriggers: customAliases.map(a => a.trigger) })
      : null),
    [inputValue, customAliases],
  );

  // Include custom aliases for resolution: "art 5 gdpr" resolves "gdpr" into Regolamento UE 679/2016.
  const localCitation = useMemo<ParsedCitation | null>(() => {
    if (!inputValue || inputValue.length < 2 || decisionRef) return null;
    return parseLegalCitation(inputValue, customAliases);
  }, [inputValue, customAliases, decisionRef]);

  // Server-side fallback for act names the client does not carry.
  //
  // The parser above knows the ~40 acts in constants/actTypes.ts plus the
  // ABBREVIATION_MAP hand-copied from the backend's NORMATTIVA_SEARCH. The
  // backend resolver knows 387 names — "statuto dei lavoratori", "legge
  // fornero", "TUSL", "GDPR" — so a lawyer typing any of them got "Nessun
  // risultato trovato" and an Enter that could only autocomplete, because
  // isSearchReady needs an act_type the client had no way to produce.
  //
  // Rather than grow a second copy of those tables here (they would drift the
  // first time the backend gained a name), ask the endpoint that already
  // resolves them. Only as a FALLBACK: whatever the client recognises today
  // still wins, so nothing that works now changes.
  // The answer carries the query it answered, so "is this still current?" is
  // derived at render instead of reset by a synchronous setState in the effect
  // (CLAUDE.md gotcha 11 — derive, do not silence the rule).
  const [serverResult, setServerResult] = useState<{ query: string; citation: ParsedCitation | null } | null>(null);

  // Gated on "not search-ready", not merely "act unnamed". Both shapes reach
  // here: "statuto dei lavoratori" the client cannot name at all, and "gdpr"
  // it names as regolamento UE but without the number and year that
  // isSearchReady requires — so both left the palette on ENTER COMPLETA.
  const remoteQuery = useMemo(() => {
    const query = inputValue.trim();
    return query.length >= 3 && !decisionRef && !isSearchReady(localCitation) ? query : null;
  }, [inputValue, localCitation, decisionRef]);

  useEffect(() => {
    if (!remoteQuery) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      legalFetch('/parse_query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: remoteQuery }),
        signal: controller.signal,
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(payload => {
          const parsed = payload?.recognized ? payload.parsed : null;
          setServerResult({
            query: remoteQuery,
            citation: parsed?.act_type
              ? {
                  act_type: parsed.act_type,
                  act_number: parsed.act_number || undefined,
                  date: parsed.date || undefined,
                  article: parsed.article || undefined,
                  annex: parsed.annex || undefined,
                  // Named by the server's curated tables, not guessed.
                  confidence: 0.9,
                }
              : null,
          });
        })
        .catch(err => {
          if ((err as Error).name === 'AbortError') return;
          // Never swallowed (CLAUDE.md gotcha 18): the box degrades to
          // local-only matching, but a backend that stopped answering is
          // visible rather than silent.
          console.error('Error resolving query server-side:', remoteQuery, err);
          setServerResult({ query: remoteQuery, citation: null });
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [remoteQuery]);

  const serverCitation = useMemo(
    () => (remoteQuery && serverResult?.query === remoteQuery ? serverResult.citation : null),
    [remoteQuery, serverResult]
  );
  const resolvingRemotely = Boolean(remoteQuery) && serverResult?.query !== remoteQuery;

  // The client wins when its own parse is already searchable; otherwise the
  // server fills in. Nothing that resolves locally today changes.
  const parsedCitation = useMemo<ParsedCitation | null>(
    () => (decisionRef ? null : isSearchReady(localCitation) ? localCitation : serverCitation ?? localCitation),
    [localCitation, serverCitation, decisionRef]
  );

  const citationReady = useMemo(() => isSearchReady(parsedCitation), [parsedCitation]);
  const citationPreview = useMemo(() => parsedCitation ? formatParsedCitation(parsedCitation) : '', [parsedCitation]);

  // Words that are neither a decision nor a norm: a topic to look for in the Cassazione's decisions.
  // A custom alias as the first word is the user's own shortcut, not a topic.
  const topic = useMemo(() => {
    const words = inputValue.trim();
    if (words.length < 3 || !/[\p{L}\p{N}]/u.test(words) || decisionRef || parsedCitation || resolvingRemotely) return null;
    const first = foldAlias(words.split(/\s+/)[0]);
    return customAliases.some((a) => foldAlias(a.trigger) === first) ? null : words;
  }, [inputValue, decisionRef, parsedCitation, resolvingRemotely, customAliases]);

  return { decisionRef, parsedCitation, citationReady, citationPreview, resolvingRemotely, topic };
}

/** The search a ready norm runs: the text in force, the date as the API reads it. */
export function citationSearchParams(citation: ParsedCitation, options: { showBrocardi: boolean; filters: SearchFilters }): SearchParams {
  const params = toSearchParams(citation);
  return {
    ...params,
    date: params.date ? parseItalianDate(params.date) : '',
    version: 'vigente',
    version_date: '',
    show_brocardi_info: options.showBrocardi,
    filters: options.filters,
  };
}
