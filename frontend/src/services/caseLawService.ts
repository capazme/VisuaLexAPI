/**
 * Client for the case-law endpoints on the Python API
 * (`visualex_api/services/case_law/`, same origin as legalApi.ts).
 *
 * Three endpoints exist: `/fetch_case_law` (a norm -> decisions bearing on
 * it), `/search_case_law` (free text) and `/fetch_decision` (one decision by
 * source/numero/anno). Only `fetchCaseLaw` is wired into UI today — the
 * reading panel (CaseLawPanel.tsx), owner priority (a). `searchCaseLaw` and
 * `fetchDecision` are kept here, unused by any component, so a future search
 * page or citation-lookup form (priorities b/c) has a ready service layer
 * instead of a reason to duplicate this file.
 */

import { legalApiPost } from './legalApi';
import type { Decisione, NormaVisitata, SourceResult } from '../types';

export interface CaseLawResponse {
  fonti: SourceResult[];
}

export interface FetchCaseLawRequest {
  riferimento: string;
  limite?: number;
}

export function fetchCaseLaw(body: FetchCaseLawRequest): Promise<CaseLawResponse> {
  return legalApiPost<CaseLawResponse>('/fetch_case_law', body);
}

export interface SearchCaseLawRequest {
  testo: string;
  limite?: number;
}

/** Not called from any component yet — kept for the free-text search page (owner priority c). */
export function searchCaseLaw(body: SearchCaseLawRequest): Promise<CaseLawResponse> {
  return legalApiPost<CaseLawResponse>('/search_case_law', body);
}

export interface FetchDecisionRequest {
  /**
   * Named `organo` on the wire (`app.py:fetch_decision`), not `fonte`: the
   * backend resolves it case-insensitively against both the registry key
   * (`SourceResult.fonte` / `Decisione.fonte`, e.g. "cassazione") and the
   * human-readable label (`SourceResult.organo`, e.g. "Cassazione") — either
   * value this service's other calls hand back works here.
   */
  organo: string;
  numero: string;
  anno: number;
}

/** Not called from any component yet — kept for the citation-lookup form (owner priority b). */
export function fetchDecision(body: FetchDecisionRequest): Promise<Decisione> {
  return legalApiPost<Decisione>('/fetch_decision', body);
}

// ─── Reference building ───

const CODE_ABBREVIATIONS: Record<string, string> = {
  'codice civile': 'c.c.',
  'codice penale': 'c.p.',
  'codice di procedura civile': 'c.p.c.',
  'codice di procedura penale': 'c.p.p.',
  'costituzione': 'Cost.',
  'codice della strada': 'C.d.S.',
  'codice della navigazione': 'c.n.',
};

const EU_ACT_LABELS: Record<string, string> = {
  'regolamento ue': 'Regolamento UE',
  'direttiva ue': 'Direttiva UE',
};

type ReferenceNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo'>;

/**
 * The `riferimento` string sent to `/fetch_case_law`. Every adapter behind
 * that endpoint reads it as free text, not structured fields, so the shape
 * matters: `visualex_api/services/case_law/italgiure.py`'s `build_norma_query`
 * refuses to search a bare "art. N" (it would return case law about art. N of
 * every code) and needs the act name on one side of the article number, and
 * `cellar.py`'s CELEX regexes need the literal "Regolamento UE N/YYYY" /
 * "Direttiva UE N/YYYY" shape to resolve a CJEU act at all.
 *
 * `norma.tipo_atto` is used rather than `tipo_atto_reale`: for an aliased act
 * (e.g. "codice civile", whose real enactment is a regio decreto) the alias
 * is the name a court decision actually cites — nobody writes "art. 2043
 * regio decreto 16 marzo 1942, n. 262".
 */
export function buildCaseLawReference(norma: ReferenceNorma): string {
  const tipoLower = norma.tipo_atto.trim().toLowerCase();
  const articolo = `art. ${norma.numero_articolo}`;

  const euLabel = EU_ACT_LABELS[tipoLower];
  if (euLabel && norma.numero_atto) {
    const anno = norma.data ? norma.data.slice(0, 4) : '';
    const numeroAnno = anno ? `${norma.numero_atto}/${anno}` : norma.numero_atto;
    return `${articolo} ${euLabel} ${numeroAnno}`;
  }

  const abbreviazione = CODE_ABBREVIATIONS[tipoLower];
  if (abbreviazione) {
    return `${articolo} ${abbreviazione}`;
  }

  // Uncodified acts (leggi, decreti…): the act's own name and number are what
  // a court decision would cite, e.g. "art. 3 legge n. 241 del 1990".
  const parts = [articolo, norma.tipo_atto];
  if (norma.numero_atto) parts.push(`n. ${norma.numero_atto}`);
  if (norma.data) parts.push(`del ${norma.data}`);
  return parts.join(' ');
}
