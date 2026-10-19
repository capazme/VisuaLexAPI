import type { GlossaFeedItem, SearchParams } from '../../../types';
import { decisionPath, identityFromKey } from '../../../utils/decisionLinks';
import { anchorLabel, searchParamsFromAnchor } from '../studia/studiaLabels';

/** Where «Apri nel testo» takes a glossa: an article through the search, a decision by its address. */
export type GlossaDestination =
  | { kind: 'article'; params: SearchParams }
  | { kind: 'decision'; path: string };

/**
 * An article's glossa opens from the URN it recorded (threads opened before the URN was stored
 * have none, and cannot be opened from the Forum); a decision's from its key.
 */
export function glossaDestination(item: Pick<GlossaFeedItem, 'target' | 'articleUrn'>): GlossaDestination | null {
  if (item.target.kind === 'decision') {
    const identity = identityFromKey(item.target.key);
    return identity ? { kind: 'decision', path: decisionPath(identity) } : null;
  }
  const params = item.articleUrn ? searchParamsFromAnchor({ urn: item.articleUrn }) : null;
  return params ? { kind: 'article', params } : null;
}

/** «art. 2043 c.c.», «Cass. civ., n. 31310/2024»: what the glossa is on, by the source convention. */
export function glossaTargetLabel(
  item: Pick<GlossaFeedItem, 'target' | 'articleUrn' | 'articleLabel' | 'articleId' | 'decisionLabel'>,
): string {
  if (item.target.kind === 'decision') return item.decisionLabel ?? 'Decisione';
  return (item.articleUrn ? anchorLabel({ urn: item.articleUrn }) : null) ?? `art. ${item.articleLabel ?? item.articleId}`;
}
