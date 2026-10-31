import type { ArticleValidity, NormaVisitata } from '../types';
import type { NormCitation } from './citation';
import { formatDateItalianLong } from './dateUtils';
import { citeNorm } from './sources';
import { isEuropeanAct, requestIsHistorical, type VersionRequest } from './versionDisplay';

/**
 * «Copia link Normattiva»: the source's own address of the article, for the hyperlinks of a
 * filing (the citations linked to their sources). The address is the one the API returned
 * (`norma_data.urn`), never one rebuilt here: it already carries the code's annex and the
 * version marker (`!vig=` empty for the text in force, `!vig=<day>` for a past text,
 * `@originale`), which Normattiva opens as that text.
 * An act of the Union has the act's EUR-Lex address: EUR-Lex has none per article.
 */
export interface NormLink {
  href: string;
  /** The citation the link reads as: a past text's version, else the plain one. */
  label: string;
  european: boolean;
  /** The day an undated address was fixed to (the text in force on that day), for the toast. */
  pinnedDay?: string;
}

type LinkedNorma = Pick<NormaVisitata, 'tipo_atto' | 'numero_articolo'>
  & Partial<Pick<NormaVisitata, 'tipo_atto_reale' | 'numero_atto' | 'data' | 'allegato' | 'urn'>>;

// Only the two sources' own pages: a dossier can be imported or shared, and its stored norm
// must not put another address (a `javascript:` one) under a citation pasted into a filing.
const SOURCE_HOSTS: ReadonlySet<string> = new Set(['www.normattiva.it', 'normattiva.it', 'eur-lex.europa.eu']);

function sourceAddress(urn: string | undefined): string | null {
  const href = urn?.trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && SOURCE_HOSTS.has(url.hostname) ? href : null;
  } catch {
    return null;
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// A day (`!vig=2005-06-01`) or the original: the address already names its text.
const DATED = /!vig=\d|@originale/;

/**
 * The day an undated address must be fixed to, or undefined when undated is right. Normattiva
 * answers an undated URN with its latest version, also one not in force yet (G-355, as the
 * export's `pdf_urn_in_force`). A text served as today's whose window has closed (`historical`
 * with no day asked: the source's, or `citeAs` past the day of an announced change) is fixed
 * to a day of that window, its last (else its first), the text the citation names; any other
 * text in force is fixed to today (G-395): an act cites the norm as it reads when it is
 * written, and the link must stay faithful to that after an amendment. A request with a day
 * or for the original carries it already; EUR-Lex has no such marker.
 */
export function linkPinDay(
  norma: Pick<NormaVisitata, 'tipo_atto'> & VersionRequest,
  validity: ArticleValidity | undefined,
  today: string,
): string | undefined {
  if (isEuropeanAct(norma.tipo_atto) || requestIsHistorical(norma)) return undefined;
  if (validity?.state === 'historical') {
    const day = validity.valid_to ?? validity.valid_from;
    if (day) return day;
  }
  return today;
}

function pinned(href: string, day: string | undefined): string {
  if (!day || !ISO_DAY.test(day) || DATED.test(href)) return href;
  return href.includes('!vig=') ? href.replace('!vig=', `!vig=${day}`) : `${href}!vig=${day}`;
}

/**
 * The link of a norm, or null when it holds no address of its source. `pinDay` (`linkPinDay`)
 * fixes an undated address to the text on screen.
 */
export function normLink(norma: LinkedNorma, citation: NormCitation | null, pinDay?: string): NormLink | null {
  const href = sourceAddress(norma.urn);
  if (!href) return null;
  const fixed = pinned(href, pinDay);
  return {
    href: fixed,
    label: citation ? citation.short : citeNorm(norma),
    european: isEuropeanAct(norma.tipo_atto),
    ...(fixed !== href && pinDay ? { pinnedDay: pinDay } : {}),
  };
}

/** The menu's and the button's words: an act of the Union is not on Normattiva. */
export function normLinkActionLabel(norma: Pick<NormaVisitata, 'tipo_atto'>): string {
  return isEuropeanAct(norma.tipo_atto) ? 'Copia link EUR-Lex' : 'Copia link Normattiva';
}

export const EUROPEAN_LINK_NOTE = 'EUR-Lex non ha un indirizzo per articolo: si copia quello dell’atto';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The citation as a link, for a rich paste (Word, Pages, a mail). */
export function normLinkHtml(link: NormLink): string {
  return `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`;
}

/**
 * Writes the address as text and the citation as a link in one go, so a rich editor pastes the
 * linked citation and a plain field the address. A browser with no `ClipboardItem`, or one that
 * refuses it, gets the address alone. Throws when the clipboard refuses that too.
 */
export async function copyNormLink(link: NormLink): Promise<'rich' | 'plain'> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([link.href], { type: 'text/plain' }),
        'text/html': new Blob([normLinkHtml(link)], { type: 'text/html' }),
      })]);
      return 'rich';
    } catch {
      // the address alone, below
    }
  }
  await navigator.clipboard.writeText(link.href);
  return 'plain';
}

/** The toast after a copy, in the words of the other copy toasts. */
export function normLinkToast(link: NormLink): string {
  if (link.european) return 'Link EUR-Lex dell’atto copiato (EUR-Lex non ha un indirizzo per articolo)';
  return link.pinnedDay
    ? `Link Normattiva copiato (apre il testo in vigore al ${formatDateItalianLong(link.pinnedDay)})`
    : 'Link Normattiva copiato';
}
