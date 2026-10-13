import { rowYear, type YearsOf } from '../../../components/features/search/caseLaw/caseLawYears';
import { formatDecisionShort } from '../../../utils/decisionLinks';
import type { RassegnePasso } from './types';

/** Where a passage comes from: «Rassegna civile 2024 · vol. 1 › CAPITOLO I › § 2 Il danno.». */
export function provenance(p: RassegnePasso): string {
  const head = p.archivio === 'civile' || p.archivio === 'penale' ? `Rassegna ${p.archivio} ${p.anno}` : `Rassegna ${p.anno}`;
  return [
    head + (p.volume.numero ? ` · vol. ${p.volume.numero}` : ''),
    p.capitolo?.nome,
    `§ ${p.sezione.numero} ${p.sezione.titolo}`.trim(),
  ].filter(Boolean).join(' › ');
}

/**
 * The years a passage answers to for the section's year control: those of the decisions it cites
 * (the review's own year is its provenance, not a decision's). A passage citing none with a year
 * has none, and is kept only while no range is set.
 */
export const yearsOfPassage: YearsOf<RassegnePasso> = (passo) =>
  passo.pronunce.flatMap((pronuncia) => rowYear({ year: pronuncia.anno }));

/** What the section's text filter reads of a passage: its text, its provenance and the decisions it cites, as shown. */
export const textOfPassage = (passo: RassegnePasso): string =>
  [passo.testo, provenance(passo), ...passo.autori, ...passo.pronunce.map((p) => formatDecisionShort(p, p.rv))].join(' ');
