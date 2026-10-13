/**
 * The Union's courts under an article (case-law section spec, D1): which act and article to ask
 * `/search_eu_case_law` for, and where a decision that VisuaLex does not read opens.
 */
import type { NormaVisitata } from '../types';

export interface EuCaseLawQuery {
  /** The act's CELEX, «32016R0679». */
  celex: string;
  /** The article as digits, «6». */
  articolo: string;
}

const SECTOR_3: Record<string, string> = { 'regolamento ue': 'R', 'direttiva ue': 'L' };

/**
 * The CELEX of a regulation or a directive of the Union and the article, as the route takes them,
 * or null: a Treaty (the route lists decisions for regulations and directives only), an act whose
 * year or number is not known, an article that is not a plain number. Derived as the API derives it
 * (`sources.eu_identity`): `3`, the year of the act, `R` or `L`, the number on four digits. The norm
 * carries no CELEX of its own.
 */
export function euCaseLawQuery(norma: Pick<NormaVisitata, 'tipo_atto' | 'data' | 'numero_atto' | 'numero_articolo'>): EuCaseLawQuery | null {
  const letter = SECTOR_3[(norma.tipo_atto || '').trim().toLowerCase()];
  if (!letter) return null;
  // «2016» and «679», or a number written with its year, «2016/679»
  const written = /^(\d{4})\/(\d{1,4})$/.exec((norma.numero_atto ?? '').trim());
  const year = written ? written[1] : (norma.data ?? '').slice(0, 4);
  const number = written ? written[2] : (norma.numero_atto ?? '').trim();
  if (!/^\d{4}$/.test(year) || !/^\d{1,4}$/.test(number) || Number(number) < 1) return null;
  const articolo = (norma.numero_articolo ?? '').trim();
  if (!/^[1-9]\d{0,3}$/.test(articolo)) return null;
  return { celex: `3${year}${letter}${String(Number(number)).padStart(4, '0')}`, articolo };
}

/** A decision's own CELEX: 6, the year, the court's letter, the kind of document, the number. */
const DECISION_CELEX = /^6\d{4}[CT][A-Z]\d{4}$/;

/** The decision on EUR-Lex, in Italian; null for a CELEX that is not a decision's (never a link from data we did not check). */
export function eurLexDecisionUrl(celex: string): string | null {
  return DECISION_CELEX.test(celex) ? `https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:${celex}` : null;
}

/**
 * InfoCuria's search page. Its search by cited provision has no address we can rely on (the form
 * is a JSF page that keeps its state on the server), so the link opens the search, not the result.
 */
export const INFOCURIA_SEARCH_URL = 'https://curia.europa.eu/juris/recherche.jsf?language=it';
