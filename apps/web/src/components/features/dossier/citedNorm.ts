import type { DossierItem } from '../../../types';
import type { ParsedCitationData } from '../../../utils/citationMatcher';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { requestIsHistorical } from '../../../utils/versionDisplay';
import { scrollParentOf } from '../practice/practiceView';
import { actKeyOf, codeName, shownAnnex } from './dossierLayout';

type NormaItem = Extract<DossierItem, { type: 'norma' }>;

/** An act's year, from a full date («1990-08-07») or the year alone, as a citation gives it. */
function yearOf(date: string | undefined): string {
  return /(?:^|\D)(\d{4})(?:\D|$)/.exec(date ?? '')?.[1] ?? '';
}

/**
 * The dossier's article a decision's text cites (D7d), or null when the dossier does not hold it. The act is matched as
 * the page groups it (`actKeyOf`: a code by its name), else by type, number and year, the year being all a citation
 * gives of the date; the article by its number in any spelling («2-bis», «2 bis»), outside any annex, since a citation
 * names an annex's article in words the matcher does not read. The text in force first: a citation opens it, and a past
 * text the dossier also holds is a second row.
 */
export function citedArticleOf(items: DossierItem[], citation: ParsedCitationData): NormaItem | null {
  const type = citation.act_type.trim().toLowerCase();
  const article = normalizeArticleId(citation.article);
  const code = codeName(type) ? actKeyOf({ tipo_atto: type }) : null;
  const sameAct = (norma: NormaItem['data']) => (code
    ? actKeyOf(norma) === code
    : (norma.tipo_atto || '').trim().toLowerCase() === type
      && (norma.numero_atto || '') === (citation.act_number || '')
      && (!citation.date || yearOf(norma.data) === yearOf(citation.date)));
  const held = items.filter((item): item is NormaItem => item.type === 'norma'
    && sameAct(item.data)
    && shownAnnex(item.data) === ''
    && normalizeArticleId(item.data.numero_articolo) === article);
  return held.find((item) => !requestIsHistorical(item.data)) ?? held[0] ?? null;
}

/**
 * Brings a row of the norms' column into view without moving the decision beside it. From `lg` the column scrolls on
 * its own: only it moves, the row to its top, and the page only if the row is still off the window (a page scrolled
 * past the columns' top). Stacked below `lg`, the page scrolls to the row, under its scroll padding (the phone's bar).
 * Each scroller is moved alone, never through `scrollIntoView` (gotcha 34). At once, as «Vai al passo»: the focus goes
 * there next.
 */
export function bringRowIntoView(row: HTMLElement, column: HTMLElement | null): void {
  if (column && getComputedStyle(column).overflowY === 'auto') {
    // 8 px of air over the row, as under a heading.
    const top = row.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop - 8;
    column.scrollTo({ top: Math.max(0, top) });
    // A row taller than the window is not a reason to move the page: only its top has to be in sight.
    const rowTop = row.getBoundingClientRect().top;
    if (rowTop >= 0 && rowTop <= window.innerHeight - ROW_IN_SIGHT) return;
  }
  const page = scrollParentOf(column && getComputedStyle(column).overflowY === 'auto' ? column : row);
  if (!page) return;
  const padding = parseFloat(getComputedStyle(page).scrollPaddingTop) || 0;
  page.scrollTo({ top: Math.max(0, row.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - padding) });
}

/** How much of a row must show above the window's bottom edge: its first line, 44 px. */
const ROW_IN_SIGHT = 44;

/**
 * Puts a link back at the height it had (`top`, from `getBoundingClientRect`) by moving the scroller it reads in: the
 * decision's column, or the page. A search cleared to open a norm turns the decision's column into a scroller of its
 * own again, back at its top; the reader stays at the words clicked.
 */
export function keepLinkAt(link: HTMLElement, top: number): void {
  if (!link.isConnected) return;
  const scroller = scrollParentOf(link);
  const moved = link.getBoundingClientRect().top - top;
  if (scroller && moved !== 0) scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + moved) });
}
