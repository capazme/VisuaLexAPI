import type { QaRetrievedSource } from '../../qa/types';

/**
 * Cited-source chips for the /grafo empty state (audit item 2). Kept in a
 * non-component module (react-refresh boundary, same split pattern as
 * graphCenter.ts) so GraphExplorerPage's derivation stays unit-testable.
 */

/** Cap on the chips shown — keeps the empty state tidy even after a 10+ source answer. */
export const MAX_EMPTY_STATE_SOURCES = 6;

/**
 * Dedupe + cap the latest answer's retrieved sources for the empty-state chip
 * row. Dedupes on the same join key the canvas sources-as-nodes highlight uses
 * (node_id preferred, else urn) so a source cited twice never duplicates a chip.
 */
export function pickEmptyStateSources(
  sources: QaRetrievedSource[],
  max: number = MAX_EMPTY_STATE_SOURCES
): QaRetrievedSource[] {
  const seen = new Set<string>();
  const picked: QaRetrievedSource[] = [];
  for (const s of sources) {
    const key = s.node_id ?? s.urn;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s);
    if (picked.length >= max) break;
  }
  return picked;
}
