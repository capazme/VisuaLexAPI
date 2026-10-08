import { citeNorm, normFromUrn } from '../../../utils/sources';
import type { Materia, Scheda, StatoScheda, TipoScheda } from '../../../types/studia';

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
  const norm = anchor ? normFromUrn(anchor.urn) : null;
  return norm?.numero_articolo ? citeNorm(norm) : null;
}

/** «Risoluzione per inadempimento · art. 1453 c.c.»: the institute alone when the anchor cannot be named. */
export function cardTitle(card: Pick<Scheda, 'istituto' | 'ancore'>): string {
  const citation = anchorCitation(card);
  return citation ? `${card.istituto} · ${citation}` : card.istituto;
}
