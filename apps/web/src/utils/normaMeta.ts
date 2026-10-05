import type { Norma } from '../types';
import { actHeading, actSubtitle, isNamedAct } from './sources';

/**
 * The title and the line under it for a norm's card and workspace block, in the source
 * convention (utils/sources): the title is the act's heading («l. 7 agosto 1990, n. 241»,
 * «Codice civile»), the line says what the title does not — the decree a code is
 * («r.d. 16 marzo 1942, n. 262»), an aliased code's name — and nothing for any other act.
 */

/** The title of a norm's card or block: the act's heading. */
export function formatNormaTitle(norma: Norma): string {
  return actHeading(norma);
}

/**
 * The line under the title; empty when the title already says everything. An act known by
 * its type alone (no date, no number, not a code) says so, rather than leaving a bare «legge».
 * `articleCount`, when given (the workspace block), ends it: " · 3 articoli", "1 articolo".
 */
export function formatNormaMeta(norma: Norma, articleCount?: number): string {
  const bare = !isNamedAct(norma) && !norma.data?.trim() && !norma.numero_atto?.trim();
  const parts = [actSubtitle(norma) || (bare ? 'Estremi non disponibili' : '')];
  if (articleCount !== undefined) parts.push(`${articleCount} ${articleCount === 1 ? 'articolo' : 'articoli'}`);
  return parts.filter(Boolean).join(' · ');
}
