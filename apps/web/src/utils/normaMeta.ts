import type { Norma } from '../types';
import { actSubtitle, isNamedAct } from './sources';

/**
 * The line under an act's heading (`actHeading`, utils/sources: «l. 7 agosto 1990, n. 241»,
 * «Codice civile») in the source convention: it says what the heading does not — the decree a code
 * is («r.d. 16 marzo 1942, n. 262»), an aliased code's name — and nothing for any other act.
 */

/**
 * The line under the title; empty when the title already says everything. An act known by
 * its type alone (no date, no number, not a code) says so, rather than leaving a bare «legge».
 * `articleCount`, when given (an act's block), ends it: " · 3 articoli", "1 articolo".
 */
export function formatNormaMeta(norma: Norma, articleCount?: number): string {
  const bare = !isNamedAct(norma) && !norma.data?.trim() && !norma.numero_atto?.trim();
  const parts = [actSubtitle(norma) || (bare ? 'Estremi non disponibili' : '')];
  if (articleCount !== undefined) parts.push(`${articleCount} ${articleCount === 1 ? 'articolo' : 'articoli'}`);
  return parts.filter(Boolean).join(' · ');
}
