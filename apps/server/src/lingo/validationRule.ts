import type { LingoCardStato, LingoGiudizio } from '@prisma/client';

/**
 * The two thresholds of the community's validation. Their values are set by an
 * administrator and stored (`lingo_impostazioni`, lingo/validationSettings.ts);
 * these are the defaults, which the migration seeds and a missing row reads as.
 * Provisional (spec decision 14): to confirm with the other developer. RLCF's
 * weighted sum can replace this module later; the votes it reads are already
 * stored one by one (`LingoValidazioneCard`), so none is lost.
 */
export type Soglie = { approvazioni: number; errate: number };

export const SOGLIE_PREDEFINITE: Soglie = { approvazioni: 2, errate: 1 };

/**
 * The state a proposed card is in, given every vote cast on its current
 * proposal and the thresholds in force. Enough «errata» archives it, whatever
 * else was said; enough approvals (and not archived) validate it; anything else,
 * «migliorabile» included, leaves it proposed.
 */
export function stateAfterVotes(votes: readonly LingoGiudizio[], soglie: Soglie): LingoCardStato {
  if (votes.filter((v) => v === 'ERRATA').length >= soglie.errate) return 'ARCHIVIATA';
  if (votes.filter((v) => v === 'APPROVATA').length >= soglie.approvazioni) return 'VALIDATA';
  return 'PROPOSTA_COMMUNITY';
}
