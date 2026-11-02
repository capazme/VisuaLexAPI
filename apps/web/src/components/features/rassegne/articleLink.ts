import type { SearchParams } from '../../../types';
import { normFromUrn, shortNorm } from '../../../utils/sources/normLabels';
import { searchParamsFromAnchor } from '../studia/studiaLabels';
import type { RassegnaArticolo } from './types';

/**
 * An article a passage cites, as the page «Rassegne» offers it: its label by the source
 * convention («art. 2043 c.c.», «art. 2 l. 241/1990»), the passage's own words when the URN names
 * no act we can write; and the search that opens it in the reader (`normFromUrn`, as a card's
 * anchor opens), or null when the URN names no article (the link is then plain text, never a dead
 * control).
 */
export function articleLink(articolo: RassegnaArticolo): { label: string; params: SearchParams | null } {
  const norm = normFromUrn(articolo.urn);
  const label = norm?.numero_articolo ? shortNorm(norm) : articolo.citazione;
  return { label, params: searchParamsFromAnchor({ urn: articolo.urn }) };
}
