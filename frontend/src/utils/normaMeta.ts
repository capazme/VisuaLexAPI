import type { Norma } from '../types';
import { abbreviateActType, formatDateItalianLong } from './dateUtils';

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

  const prefix =
    variant === 'card-mobile' ? 'Data: '
    : variant === 'card-desktop' ? 'Edizione del '
    : '';
  const fallback = variant === 'card-desktop' ? 'Data non disponibile' : 'Estremi non disponibili';

  let result = norma.data ? `${prefix}${formatDateItalianLong(norma.data)}` : fallback;
  if (articleCount !== undefined) result += ` · ${articleCount} articoli`;
  return result;
}
