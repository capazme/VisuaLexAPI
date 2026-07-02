import type { GraphSearchItem } from '../shared/types';

/**
 * Center-classification + search-result gating helpers for the graph explorer.
 *
 * Kept in a non-component module (react-refresh/only-export-components boundary,
 * same split pattern as the graph's PluginSlot / consent context) so both
 * GraphExplorerPage and GraphSearchBox can import them and they stay unit-testable.
 */

/**
 * C1/C2: decide whether the graph center is a Norma/article (lazy-ingestable)
 * or a concept. An empty subgraph on a concept means "no neighbours / not
 * found", NOT "ingest an article".
 *
 * Primary signal is the node type from the search result (`Norma`); we also
 * treat any center whose urn carries the `~art<N>` article marker as an
 * article, so a direct deeplink (which only has the urn, not the search-result
 * type) is still classified correctly. Everything else — ConcettoGiuridico,
 * DefinizioneLegale, PrincipioGiuridico, … — is a concept.
 */
export function isArticleCenter(
  type: string | null | undefined,
  urn: string | null | undefined
): boolean {
  if (type && type.toLowerCase() === 'norma') return true;
  if (urn && /~art\d+/i.test(urn)) return true;
  return false;
}

/**
 * C4: a `live:<id>` result is a leaked node id (an un-materialised entity that
 * never grounded to a real graph node) — it is not openable in the explorer, so
 * it must never appear as a selectable search option.
 */
export function isOpenableResult(item: GraphSearchItem): boolean {
  return !(item.id ?? '').toLowerCase().startsWith('live:');
}
