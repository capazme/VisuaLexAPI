// The server twin of the web's `identityFromKey` (apps/web/src/utils/decisionLinks.ts): the key
// of a court decision read back to its identity. Same shapes, same bounds; keep the two in step
// (both are pinned to conventions/sources/decision-keys.json).

export interface DecisionKeyIdentity {
  corte: 'cassazione' | 'corte_costituzionale' | 'corte_giustizia_ue' | 'tribunale_ue';
  archivio?: 'civile' | 'penale';
  numero: number;
  anno: number;
}

// The courts of the Union are named by their case: a number of at most four digits (design 2026-10-12 §3.1).
const KEY = /^(?:cassazione:(civile|penale):([1-9]\d{0,5}):(\d{4})|corte_costituzionale:([1-9]\d{0,5}):(\d{4})|(corte_giustizia_ue|tribunale_ue):([1-9]\d{0,3}):(\d{4}))$/;
const FIRST_YEAR = { cassazione: 1900, corte_costituzionale: 1956, corte_giustizia_ue: 1953, tribunale_ue: 1989 } as const;

/** True for a key in the decision key space, valid or not (a norm's key never starts so). */
export function inDecisionKeySpace(key: string): boolean {
  return ['cassazione:', 'corte_costituzionale:', 'corte_giustizia_ue:', 'tribunale_ue:'].some((p) => key.startsWith(p));
}

export function readDecisionKey(key: string, now: Date = new Date()): DecisionKeyIdentity | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const corte: DecisionKeyIdentity['corte'] = m[1] ? 'cassazione'
    : m[6] ? (m[6] as 'corte_giustizia_ue' | 'tribunale_ue') : 'corte_costituzionale';
  const numero = Number(m[2] ?? m[4] ?? m[7]);
  const anno = Number(m[3] ?? m[5] ?? m[8]);
  if (anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  return corte === 'cassazione' ? { corte, archivio: m[1] as 'civile' | 'penale', numero, anno } : { corte, numero, anno };
}
