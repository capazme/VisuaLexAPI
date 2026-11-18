import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { requestIsHistorical } from '../../../utils/versionDisplay';
import { actKeyOf, codeName, shownAnnex } from './dossierLayout';

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

/** An act's year, from a full date («1990-08-07») or the year alone, as a citation gives it. */
function yearOf(date: string | undefined): string {
  return /(?:^|\D)(\d{4})(?:\D|$)/.exec(date ?? '')?.[1] ?? '';
}

/**
 * The dossier's article a decision's text cites (D7d), or null when the dossier does not hold it. The act is matched as
 * the page groups it (`actKeyOf`: a code of `CODE_NAMES` by its name), any other by its type, then by its number and
 * year only where both sides give one: a code the page does not name («art. 141 c.d.s.», «art. 1 cod. nav.») is cited
 * with neither, while its entry may carry them (285, added through MCP), and an entry may carry no date at all. The year
 * is all a citation gives of a date. The article by its number in any spelling («2-bis», «2 bis»), outside any annex,
 * since a citation names an annex's article in words the matcher does not read. The text in force first: a citation
 * opens it, and a past text the dossier also holds is a second row.
 */
export function citedArticleOf(items: DossierItem[], citation: ParsedCitationData): NormaItem | null {
  const type = citation.act_type.trim().toLowerCase();
  const article = normalizeArticleId(citation.article);
  const code = codeName(type) ? actKeyOf({ tipo_atto: type }) : null;
  const both = (a: string, b: string) => a === '' || b === '' || a === b;
  const sameAct = (norma: NormaItem['data']) => (code
    ? actKeyOf(norma) === code
    : (norma.tipo_atto || '').trim().toLowerCase() === type
      && both((norma.numero_atto || '').trim(), (citation.act_number || '').trim())
      && both(yearOf(norma.data), yearOf(citation.date)));
  const held = items.filter((item): item is NormaItem => item.type === 'norma'
    && sameAct(item.data)
    && shownAnnex(item.data) === ''
    && normalizeArticleId(item.data.numero_articolo) === article);
  return held.find((item) => !requestIsHistorical(item.data)) ?? held[0] ?? null;
}
