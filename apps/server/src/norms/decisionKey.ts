// The server twin of the web's `identityFromKey` (apps/web/src/utils/decisionLinks.ts): the key
// of a court decision read back to its identity. Same shapes, same bounds; keep the two in step
// (both are pinned to conventions/sources/decision-keys.json).

export interface DecisionKeyIdentity {
  corte: 'cassazione' | 'corte_costituzionale';
  archivio?: 'civile' | 'penale';
  numero: number;
  anno: number;
}

const KEY = /^(?:cassazione:(civile|penale):([1-9]\d{0,5}):(\d{4})|corte_costituzionale:([1-9]\d{0,5}):(\d{4}))$/;
const FIRST_YEAR = { cassazione: 1900, corte_costituzionale: 1956 } as const;

/** True for a key in the decision key space, valid or not (a norm's key never starts so). */
export function inDecisionKeySpace(key: string): boolean {
  return key.startsWith('cassazione:') || key.startsWith('corte_costituzionale:');
}

export function readDecisionKey(key: string, now: Date = new Date()): DecisionKeyIdentity | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const corte = m[1] ? 'cassazione' : 'corte_costituzionale';
  const numero = Number(m[2] ?? m[4]);
  const anno = Number(m[3] ?? m[5]);
  if (anno < FIRST_YEAR[corte] || anno > now.getFullYear()) return null;
  return corte === 'cassazione' ? { corte, archivio: m[1] as 'civile' | 'penale', numero, anno } : { corte, numero, anno };
}
