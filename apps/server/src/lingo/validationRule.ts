import type { LingoCardStato, LingoGiudizio } from '@prisma/client';

/**
 * Provisional (spec decision 14): to confirm with the other developer.
 * RLCF's weighted sum can replace this module later; the votes it reads are
 * already stored one by one (`LingoValidazioneCard`), so none is lost.
 */
export const APPROVALS_TO_VALIDATE = 2;
export const ERRATA_TO_ARCHIVE = 1;

/**
 * The state a proposed card is in, given every vote cast on its current
 * proposal. One «errata» archives it, whatever else was said; enough approvals
 * (and no «errata») validate it; anything else, «migliorabile» included, leaves
 * it proposed.
 */
export function stateAfterVotes(votes: readonly LingoGiudizio[]): LingoCardStato {
  if (votes.filter((v) => v === 'ERRATA').length >= ERRATA_TO_ARCHIVE) return 'ARCHIVIATA';
  if (votes.filter((v) => v === 'APPROVATA').length >= APPROVALS_TO_VALIDATE) return 'VALIDATA';
  return 'PROPOSTA_COMMUNITY';
}
