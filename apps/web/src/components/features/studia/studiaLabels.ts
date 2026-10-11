import { actHeading, citeNorm, normFromUrn } from '../../../utils/sources';
import type { NormaVisitata, SearchParams } from '../../../types';
import type { AncoraScheda, Materia, Scheda, StatoScheda, TipoScheda } from '../../../types/studia';
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

/** What the workspace's search needs to open an anchor's article in the reader; null when its address names no article. */
export function searchParamsFromAnchor(anchor: Pick<AncoraScheda, 'urn'>): SearchParams | null {
  const norm = normFromUrn(anchor.urn);
  if (!norm?.tipo_atto || !norm.numero_articolo) return null;
  const norma: NormaVisitata = {
    tipo_atto: norm.tipo_atto,
    data: norm.data ?? '',
    numero_articolo: norm.numero_articolo,
    ...(norm.numero_atto ? { numero_atto: norm.numero_atto } : {}),
    ...(norm.allegato ? { allegato: norm.allegato } : {}),
  };
  return searchParamsFromNorma(norma);
}
