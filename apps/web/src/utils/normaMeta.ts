import type { Norma, NormaVisitata } from '../types';
import { abbreviateActType, formatDateItalianLong, withPreposition } from './dateUtils';

/**
 * Visual context in which the meta line is rendered. The text differs
 * slightly by placement so the three historical strings keep their
 * existing phrasing — this helper is strictly a dedupe, not a rewrite.
 *
 * - `card-mobile`  — "Data: 7 agosto 1990" or "Estremi non disponibili"
 * - `card-desktop` — "Edizione del 7 agosto 1990" or "Data non disponibile"
 * - `block`        — "7 agosto 1990" (bare, count appended inline)
 */
export type NormaMetaVariant = 'card-mobile' | 'card-desktop' | 'block';

export interface FormatNormaMetaOptions {
  variant: NormaMetaVariant;
  /**
   * When set, appended as " · N articoli" at the end of the meta string.
   * Used by the workspace block variant where the count lives inline;
   * card variants surface the count through a separate badge and should
   * leave this undefined.
   */
  articleCount?: number;
}

/**
 * Build the meta/subtitle line for a Norma. Handles both the alias case
 * (tipo_atto_reale set — e.g. "codice civile" aliasing a regio decreto)
 * and the regular case, with the variant-specific prefix and fallback.
 */
export function formatNormaMeta(norma: Norma, options: FormatNormaMetaOptions): string {
  const { variant, articleCount } = options;

  if (norma.tipo_atto_reale) {
    let result = abbreviateActType(norma.tipo_atto_reale);
    if (norma.data) result += ` ${formatDateItalianLong(norma.data)}`;
    if (norma.numero_atto) result += `, n. ${norma.numero_atto}`;
    if (articleCount !== undefined) result += ` · ${articleCount} articoli`;
    return result;
  }

  const fallback = variant === 'card-desktop' ? 'Data non disponibile' : 'Estremi non disponibili';

  // "Edizione del 7 agosto" but "Edizione dell'8 marzo": the preposition elides before 8 and 11.
  const date = norma.data ? formatDateItalianLong(norma.data) : '';
  const dated =
    variant === 'card-mobile' ? `Data: ${date}`
    : variant === 'card-desktop' ? `Edizione ${withPreposition('del', date)}`
    : date;

  let result = norma.data ? dated : fallback;
  if (articleCount !== undefined) result += ` · ${articleCount} articoli`;
  return result;
}

/**
 * Canonical "copy to clipboard" citation string for a norm/article, e.g.
 * "codice civile n. 262 del 1942-03-16, Art. 2043 (Allegato 2)".
 * Single source of truth for the citation core used by the copy/export
 * handlers in ArticleTabContent (advanced copy, mobile copy, selection copy).
 */
export function formatCitation(
  norma: Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>,
): string {
  return `${norma.tipo_atto}${norma.numero_atto ? ` n. ${norma.numero_atto}` : ''}${norma.data ? ` del ${norma.data}` : ''}, Art. ${norma.numero_articolo}${norma.allegato ? ` (Allegato ${norma.allegato})` : ''}`;
}
