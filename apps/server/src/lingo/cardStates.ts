import type { LingoCardStato } from '@prisma/client';

/**
 * The lifecycle of a study card, as the specification draws it:
 *
 *   BOZZA_PERSONALE ──▶ PROPOSTA_COMMUNITY ──▶ VALIDATA ◀──▶ DA_RIVEDERE
 *                              │
 *                              └──▶ ARCHIVIATA
 *
 * A draft cannot skip the community's validation, and nothing leaves the
 * archive. Two moves the diagram does not have, left out on purpose and to be
 * decided before the norm watcher is built: a person archiving their own
 * draft, and what happens to a *draft* whose norm changes (only a validated
 * card goes to review).
 */
const TRANSITIONS: Readonly<Record<LingoCardStato, readonly LingoCardStato[]>> = {
  BOZZA_PERSONALE: ['PROPOSTA_COMMUNITY'],
  PROPOSTA_COMMUNITY: ['VALIDATA', 'ARCHIVIATA'],
  VALIDATA: ['DA_RIVEDERE'],
  DA_RIVEDERE: ['VALIDATA'],
  ARCHIVIATA: [],
};

export function allowedTransitions(from: LingoCardStato): readonly LingoCardStato[] {
  return TRANSITIONS[from];
}

export function canTransition(from: LingoCardStato, to: LingoCardStato): boolean {
  return TRANSITIONS[from].includes(to);
}
