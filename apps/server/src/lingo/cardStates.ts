import type { LingoCardStato } from '@prisma/client';

/**
 * The lifecycle of a study card, as the specification draws it:
 *
 *   BOZZA_PERSONALE ◀──▶ PROPOSTA_COMMUNITY ──▶ VALIDATA ◀──▶ DA_RIVEDERE
 *                              │
 *                              └──▶ ARCHIVIATA
 *
 * The way back from proposed to draft is the author's withdrawal (spec
 * decision 20): possible only while the card is proposed, never after it was
 * validated or archived. A draft cannot skip the community's validation, and
 * nothing leaves the archive. Two moves the diagram does not have, left out
 * on purpose and to be decided before the norm watcher is built: a person
 * archiving their own draft, and what happens to a *draft* whose norm changes
 * (only a validated card goes to review).
 */
const TRANSITIONS: Readonly<Record<LingoCardStato, readonly LingoCardStato[]>> = {
  BOZZA_PERSONALE: ['PROPOSTA_COMMUNITY'],
  PROPOSTA_COMMUNITY: ['VALIDATA', 'ARCHIVIATA', 'BOZZA_PERSONALE'],
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
