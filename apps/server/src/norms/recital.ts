/**
 * A recital's identity and labels (spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §2):
 * the identity `celex:32016R0679~rct26` (EUR-Lex's own name for it, `div#rct_26`); the citation
 * «considerando 26, reg. (UE) 2016/679», the short label «considerando 26 reg. (UE) 2016/679» and
 * the unit «Considerando 26». The word is always written out, never «cons.» and never «art.». The
 * act half is the act's citation (`citeAct`). The API's `sources.eu_identity` and `cite_recital`
 * and the web's `utils/sources/recital.ts` are pinned with this file to
 * `conventions/sources/golden.json` (`recitals`).
 */
import { citeAct } from './citation';
import type { RecitalEntry } from '../schemas/recitalEntry';

type RecitalRef = Pick<RecitalEntry, 'tipo_atto' | 'numero_atto' | 'data' | 'considerando'>;

const SECTOR: Readonly<Record<string, string>> = { 'regolamento ue': 'R', 'direttiva ue': 'L' };

/** The act's CELEX: «32016R0679». */
export function actCelex(e: Omit<RecitalRef, 'considerando'>): string {
  const sector = SECTOR[e.tipo_atto.trim().toLowerCase()];
  const year = e.data.slice(0, 4);
  if (!sector || !/^[0-9]{4}$/.test(year) || !/^[0-9]+$/.test(e.numero_atto)) {
    throw new Error('Not a regulation or a directive of the Union with its year and number');
  }
  return `3${year}${sector}${e.numero_atto.padStart(4, '0')}`;
}

export function recitalIdentity(e: RecitalRef): string {
  return `celex:${actCelex(e)}~rct${e.considerando}`;
}

export function citeRecital(e: RecitalRef): string {
  return `considerando ${e.considerando}, ${citeAct(e)}`;
}

export function shortRecital(e: RecitalRef): string {
  return `considerando ${e.considerando} ${citeAct(e)}`;
}

export function recitalUnitLabel(e: RecitalRef): string {
  return `Considerando ${e.considerando}`;
}
