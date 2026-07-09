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

/** Minimal node shape {@link resolveCenterNodeId} needs — decoupled from GraphNode. */
export interface CenterCandidateNode {
  id: string;
  urn?: string | null;
}

/**
 * Audit item 3 — resolve the node the deliberation canon corona anchors to.
 * Returns `null` (a floating corona — `buildDeliberationOverlay` already
 * supports an unanchored center) when the page urn matches NO node, even
 * after stripping the NIR version marker (`!vig=`, gotcha #6), instead of
 * falling back to `nodes[0]` — an arbitrary, unrelated node the corona would
 * otherwise orbit. With no urn at all there is no center concept to resolve
 * against, so the first node stays the (pre-existing) best-effort anchor.
 */
export function resolveCenterNodeId(
  nodes: readonly CenterCandidateNode[],
  urn: string | null | undefined,
  stripVersionMarker: (u: string) => string
): string | null {
  if (nodes.length === 0) return null;
  if (!urn) return nodes[0].id;
  const exact = nodes.find((n) => n.urn === urn);
  if (exact) return exact.id;
  const bare = stripVersionMarker(urn);
  const byBare = nodes.find((n) => n.urn && stripVersionMarker(n.urn) === bare);
  return byBare ? byBare.id : null;
}
