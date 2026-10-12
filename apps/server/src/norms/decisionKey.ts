// The server twin of the web's `identityFromKey` (apps/web/src/utils/decisionLinks.ts): the key
// of a court decision read back to its identity. Same shapes, same bounds; keep the two in step
// (both are pinned to conventions/sources/decision-keys.json).

import { ADMIN_FIRST_YEAR, isSeat } from './adminCourts';

export interface DecisionKeyIdentity {
  corte: 'cassazione' | 'corte_costituzionale' | 'corte_giustizia_ue' | 'tribunale_ue' | 'consiglio_di_stato' | 'cgars' | 'tar';
  sede?: string;
  provvedimento?: string;
  archivio?: 'civile' | 'penale';
  numero: number;
  anno: number;
}

// The courts of the Union are named by their case: a number of at most four digits (design 2026-10-12 §3.1).
const KEY = /^(?:cassazione:(civile|penale):([1-9]\d{0,5}):(\d{4})|corte_costituzionale:([1-9]\d{0,5}):(\d{4})|(corte_giustizia_ue|tribunale_ue):([1-9]\d{0,3}):(\d{4}))$/;
const FIRST_YEAR = { cassazione: 1900, corte_costituzionale: 1956, corte_giustizia_ue: 1953, tribunale_ue: 1989 } as const;

/** True for a key in the decision key space, valid or not (a norm's key never starts so). */
export function inDecisionKeySpace(key: string): boolean {
  return ['cassazione:', 'corte_costituzionale:', 'corte_giustizia_ue:', 'tribunale_ue:', 'consiglio_di_stato:', 'cgars:', 'tar:']
    .some((p) => key.startsWith(p));
}

// The administrative courts: the kind, and a TAR's seat (design 2026-10-12-administrative-courts §2).
const ADMIN_KEY = /^(?:(consiglio_di_stato|cgars):([a-z]{3,6})|tar:([a-z-]{3,20}):([a-z]{3,6})):([1-9]\d{0,4}):(\d{4})$/;

export function readDecisionKey(key: string, now: Date = new Date()): DecisionKeyIdentity | null {
  const admin = ADMIN_KEY.exec(key);
  if (admin) {
    const anno = Number(admin[6]);
    if (anno < ADMIN_FIRST_YEAR || anno > now.getFullYear()) return null;
    if (admin[3] !== undefined && !isSeat(admin[3])) return null;
    return admin[1]
      ? { corte: admin[1] as 'consiglio_di_stato' | 'cgars', provvedimento: admin[2], numero: Number(admin[5]), anno }
      : { corte: 'tar', sede: admin[3], provvedimento: admin[4], numero: Number(admin[5]), anno };
  }
  const m = KEY.exec(key);
  if (!m) return null;
  const corte: DecisionKeyIdentity['corte'] = m[1] ? 'cassazione'
    : m[6] ? (m[6] as 'corte_giustizia_ue' | 'tribunale_ue') : 'corte_costituzionale';
  const numero = Number(m[2] ?? m[4] ?? m[7]);
  const anno = Number(m[3] ?? m[5] ?? m[8]);
  if (anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  return corte === 'cassazione' ? { corte, archivio: m[1] as 'civile' | 'penale', numero, anno } : { corte, numero, anno };
}
