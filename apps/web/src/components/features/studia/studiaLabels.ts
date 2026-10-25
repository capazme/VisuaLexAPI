import { actHeading, citeNorm, normFromUrn } from '../../../utils/sources';
import type { NormaVisitata, SearchParams } from '../../../types';
import type { AncoraScheda, Materia, Scheda, StatoScheda, TipoScheda } from '../../../types/studia';
import { todayInRome } from '../../../utils/dateUtils';
import { searchParamsFromNorma } from '../dossier/dossierUtils';

export const MATERIA_LABEL: Record<Materia, string> = {
  DIRITTO_CIVILE: 'Diritto civile',
  DIRITTO_PENALE: 'Diritto penale',
  DIRITTO_AMMINISTRATIVO: 'Diritto amministrativo',
  DIRITTO_PROCESSUALE_CIVILE: 'Diritto processuale civile',
  DIRITTO_PROCESSUALE_PENALE: 'Diritto processuale penale',
};

export const STATO_LABEL: Record<StatoScheda, string> = {
  BOZZA_PERSONALE: 'Bozza',
  PROPOSTA_COMMUNITY: 'Proposta',
  VALIDATA: 'Validata',
  DA_RIVEDERE: 'Da rivedere',
  ARCHIVIATA: 'Archiviata',
};

export const TIPO_LABEL: Record<TipoScheda, string> = {
  ISTITUTO_DEFINIZIONE: 'Definizione',
  DISTINZIONE_CONCETTUALE: 'Distinzione',
  CASO_APPLICATIVO: 'Caso',
  REQUISITO_FORMA_ATTO: 'Requisito di forma',
};

/**
 * The citation of the article a card rests on (its primary anchor, else the first), by the source
 * convention; null when the address names no article.
 */
export function anchorCitation(card: Pick<Scheda, 'ancore'>): string | null {
  const anchor = card.ancore.find((a) => a.isPrimary) ?? card.ancore[0];
  return anchor ? anchorLabel(anchor) : null;
}

/** «Risoluzione per inadempimento · art. 1453 c.c.»: the institute alone when the anchor cannot be named. */
export function cardTitle(card: Pick<Scheda, 'istituto' | 'ancore'>): string {
  const citation = anchorCitation(card);
  return citation ? `${card.istituto} · ${citation}` : card.istituto;
}

/** «art. 1453 c.c.»: the article an anchor rests on, by the source convention; null when its address names no article. */
export function anchorLabel(anchor: Pick<AncoraScheda, 'urn'>): string | null {
  const norm = normFromUrn(anchor.urn);
  return norm?.numero_articolo ? citeNorm(norm) : null;
}

/** «Codice civile», «l. 7 agosto 1990, n. 241»: the act an anchor rests on, as a heading; null when its address names no act. */
export function anchorActLabel(anchor: Pick<AncoraScheda, 'urn'>): string | null {
  const norm = normFromUrn(anchor.urn);
  return norm?.tipo_atto ? actHeading(norm) : null;
}

/** The norm an anchor rests on, as the reader asks for it; null when its address names no article. */
export function normaFromAnchor(anchor: Pick<AncoraScheda, 'urn'>): NormaVisitata | null {
  const norm = normFromUrn(anchor.urn);
  if (!norm?.tipo_atto || !norm.numero_articolo) return null;
  return {
    tipo_atto: norm.tipo_atto,
    data: norm.data ?? '',
    numero_articolo: norm.numero_articolo,
    ...(norm.numero_atto ? { numero_atto: norm.numero_atto } : {}),
    ...(norm.allegato ? { allegato: norm.allegato } : {}),
  };
}

/** What the workspace's search needs to open an anchor's article in the reader; null when its address names no article. */
export function searchParamsFromAnchor(anchor: Pick<AncoraScheda, 'urn'>): SearchParams | null {
  const norma = normaFromAnchor(anchor);
  return norma ? searchParamsFromNorma(norma) : null;
}

/**
 * The seconds a card is guessed to take, behind the home's «circa N minuti» (Gymnasium spec §5.1, open
 * decision 1): an estimate, never a promise, until the server can give the user's own average.
 */
export const SECONDS_PER_CARD = 20;

/** The minutes `cards` cards are guessed to take: `ceil(cards × SECONDS_PER_CARD / 60)`; 0 for none. */
export function estimatedMinutes(cards: number): number {
  return cards > 0 ? Math.ceil((cards * SECONDS_PER_CARD) / 60) : 0;
}

/** «circa 9 minuti», «circa 1 minuto»; null when there is no card. */
export function estimateLabel(cards: number): string | null {
  const minutes = estimatedMinutes(cards);
  if (minutes === 0) return null;
  return `circa ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`;
}

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/**
 * When a card is next reviewed, as a row says it: «Da ripassare oggi» from today on, else
 * «Prossimo ripasso: 12 ottobre» (with the year when it is not this one). Read from the parts of
 * the 'YYYY-MM-DD' day, never through `Date`, which would read it as UTC; null when the card has no date.
 * `todayInRome()` only words the label: whether a card is due is the server's decision (spec D18).
 */
export function nextReviewLabel(day: string | null | undefined, today: string = todayInRome()): string | null {
  if (!day) return null;
  if (day <= today) return 'Da ripassare oggi';
  const [year, month, date] = day.split('-').map(Number);
  const monthName = MONTHS[month - 1];
  if (!year || !monthName || !date) return null;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return `Prossimo ripasso: ${date} ${monthName}${sameYear ? '' : ` ${year}`}`;
}
