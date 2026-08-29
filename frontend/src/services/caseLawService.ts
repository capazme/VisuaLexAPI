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

// `norma.tipo_atto` for an uncodified act takes one of two shapes, and a
// court decision cites each of them completely differently — measured live
// against Italgiure (`visualex_api/services/case_law/italgiure.py`), not
// assumed:
//
// - A GENERIC act-type descriptor ("legge", "decreto legislativo", …) names
//   no act by itself; the citation is the type plus number and year. For the
//   decree family, the type is always abbreviated in the OCR text —
//   "decreto legislativo n. 231 del 2001" scores 0/10 live,
//   "d.lgs. n. 231 del 2001" 10/10; same gap for "decreto del presidente
//   della repubblica" (D.P.R., "d.P.R. n. 445 del 2000" 5/5 vs the spelled
//   form 0/5) and "decreto legge"/"decreto-legge" (D.L., "d.l. n. 34 del
//   2020" 5/5 vs 0/5 spelled). "legge" is the one exception: spelled out it
//   already matches ("legge n. 241 del 1990" 10/10 live), so it is left
//   alone rather than abbreviated to "l." on no evidence it helps.
//   "regio decreto" stays in this bucket too, but unabbreviated: neither
//   "regio decreto n. 267 del 1942" nor "R.D. n. 267 del 1942" matched
//   anything live (0/5 each) — old regio decreto acts are cited by a popular
//   name ("legge fallimentare") this API has no field for, a gap noted in
//   the report rather than guessed at here.
// - Everything else already reads as the act's OWN name, the same way
//   "codice civile" does (every "codice …" alias in
//   `visualex_api/tools/map.py`'s `NORMATTIVA_URN_CODICI`, plus
//   "costituzione", handled above): a decision cites the name alone, never
//   the enacting decree's number and date — "codice del consumo n. 206 del
//   2005" scores 0/10 live, bare "codice del consumo" 5/5.
const GENERIC_ACT_TYPES = new Set([
  'legge',
  'decreto legislativo',
  'decreto legge',
  'decreto-legge',
  'decreto del presidente della repubblica',
  'regio decreto',
]);

const GENERIC_ACT_ABBREVIATIONS: Record<string, string> = {
  'decreto legislativo': 'D.lgs.',
  'decreto legge': 'D.L.',
  'decreto-legge': 'D.L.',
  'decreto del presidente della repubblica': 'D.P.R.',
};

// `regio decreto` is the one entry in `GENERIC_ACT_TYPES` that stays
// unabbreviated on purpose (see the block comment above): "regio decreto n.
// 267 del 1942" and "R.D. n. 267 del 1942" both scored 0/5 live. That is not
// a phrasing gap this module can close — old regio decreto acts (the legge
// fallimentare, the T.U.L.P.S.) are cited by a popular name that isn't
// derivable from `tipo_atto`/`numero_atto`/`data`, the only fields this API
// has. `buildCaseLawReference` still returns a string for one (the type plus
// number and year), but a caller that queries every source with it gets four
// honest-looking empty sections that never verified anything — the same
// shape `italgiure.build_norma_query` and `cerdef.cerca_per_norma` refuse
// server-side for their own unsafe cases, via a `coverage` note instead of a
// silent empty. This is the same posture, one level up: the query itself
// should never be sent.
const POPULAR_NAME_ONLY_ACT_TYPES = new Set(['regio decreto']);

/**
 * True when `norma.tipo_atto` names an act this module cannot build a
 * searchable case-law reference for — see `POPULAR_NAME_ONLY_ACT_TYPES`.
 * `CaseLawPanel` checks this before calling `/fetch_case_law` at all: for
 * these acts, four "Nessuna decisione trovata." sections would assert an
 * absence nobody verified.
 */
export function isUnsearchableActType(tipoAtto: string): boolean {
  return POPULAR_NAME_ONLY_ACT_TYPES.has(tipoAtto.trim().toLowerCase());
}

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
 *
 * Never an ISO date (`norma.data`, e.g. "1990-08-07"): no decision cites a
 * day and month, so a full ISO date can never appear verbatim in one and every
 * exact-phrase source (Italgiure, CeRDEF) returns nothing for it. Only the
 * year — see `GENERIC_ACT_TYPES` below.
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

  if (GENERIC_ACT_TYPES.has(tipoLower)) {
    const nomeAtto = GENERIC_ACT_ABBREVIATIONS[tipoLower] ?? norma.tipo_atto;
    const parts = [articolo, nomeAtto];
    if (norma.numero_atto) parts.push(`n. ${norma.numero_atto}`);
    if (norma.data) parts.push(`del ${norma.data.slice(0, 4)}`);
    return parts.join(' ');
  }

  // A named act Normattiva resolves directly by its own title (every
  // "codice …" alias, "preleggi", …): cited by that name alone, exactly like
  // the abbreviated codes above — see the block comment.
  return `${articolo} ${norma.tipo_atto}`;
}
