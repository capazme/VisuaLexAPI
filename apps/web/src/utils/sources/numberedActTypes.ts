/**
 * When a reading names an act: the one predicate (design 2026-10-29-document-analysis §4.4).
 *
 * The web's copy of `conventions/sources/numbered-act-types.json`; the API keeps its own
 * (`services/visualex/visualex_api/tools/act_identity.py`). `numberedActTypes.test.ts` fails when this
 * list and the convention's differ. Before it the web kept `ACT_TYPES_REQUIRING_DETAILS`, which lacked the
 * decreto ministeriale and the DPCM and spelled «Regolamento UE» where the server answers «regolamento ue»,
 * so the server's reading of «art. 2 d.m.» passed as searchable though nothing could be opened.
 */

/** The types that name an act only with their number and date, case folded. */
export const NUMBERED_ACT_TYPES: readonly string[] = [
  'legge',
  'legge costituzionale',
  'decreto legge',
  'decreto legislativo',
  'decreto legislativo luogotenenziale',
  'decreto del presidente della repubblica',
  'decreto del presidente del consiglio dei ministri',
  'decreto ministeriale',
  'regio decreto',
  'regio decreto legge',
  'regolamento ue',
  'direttiva ue',
];

const NUMBERED = new Set(NUMBERED_ACT_TYPES);

/** «legge», «Regolamento UE», «regolamento ue»: a type that names an act only with its number and date. */
export function isNumberedActType(actType: string | undefined | null): boolean {
  return NUMBERED.has((actType ?? '').trim().toLowerCase());
}

/**
 * A reading names an act: a type that needs no number (a code, the Costituzione, a Treaty), or a type with its
 * number and its date. «art. 2 d.m.» reads as a decreto ministeriale and names none. The API answers the same
 * verdict as `identifies_act`.
 */
export function identifiesAct(reading: { act_type?: string | null; act_number?: string | null; date?: string | null } | null | undefined): boolean {
  if (!reading?.act_type?.trim()) return false;
  if (!isNumberedActType(reading.act_type)) return true;
  return Boolean(reading.act_number?.trim() && reading.date?.trim());
}
