import type { Materia } from '../../../types/studia';

/**
 * The subject of the five acts the spec names (design 2026-10-07 D4). Keys are lower case with
 * single spaces: the palette spells `Codice Civile`, the resolver `codice civile` (gotcha 28);
 * the two spellings of the procedural codes are the ones `NAMED_ACTS` knows.
 */
const MATERIA_BY_ACT: Readonly<Record<string, Materia>> = {
  'codice civile': 'DIRITTO_CIVILE',
  'codice penale': 'DIRITTO_PENALE',
  'codice di procedura civile': 'DIRITTO_PROCESSUALE_CIVILE',
  'codice procedura civile': 'DIRITTO_PROCESSUALE_CIVILE',
  'codice di procedura penale': 'DIRITTO_PROCESSUALE_PENALE',
  'codice procedura penale': 'DIRITTO_PROCESSUALE_PENALE',
  'codice del processo amministrativo': 'DIRITTO_AMMINISTRATIVO',
};

// The same fold the source convention applies to an act's name (`key` in utils/sources/normLabels.ts, not exported).
const fold = (name?: string | null): string => (name ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** The subject an act implies, or null for any other act: the form then asks for it. */
export function inferMateria(norma: { tipo_atto: string; tipo_atto_reale?: string | null }): Materia | null {
  return MATERIA_BY_ACT[fold(norma.tipo_atto)] ?? MATERIA_BY_ACT[fold(norma.tipo_atto_reale)] ?? null;
}
