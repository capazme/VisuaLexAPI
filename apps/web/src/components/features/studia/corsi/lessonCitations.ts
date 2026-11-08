import type { NormaVisitata } from '../../../../types';
import type { DecisionIdentity } from '../../../../types/decisions';
import type { CitazioneLezione } from '../../../../types/corsi';
import { identityOf } from '../../../../utils/decisionLinks';
import { parseSentenzaContent } from '../../dossier/dossierUtils';

/**
 * A lesson's citation (courses spec §10.3) as the readers take it: the copy of the dossier entry the server stored with
 * the block, read as untrusted data — a norm needs its act and article as text, a decision passes the dossier's own
 * check (`parseSentenzaContent`, the server's schema mirrored). What does not read opens nothing and says so.
 */

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** A cited norm as the article reader takes it; null when the copy names no act and article. */
export function normaOfCitation(citation: CitazioneLezione): NormaVisitata | null {
  if (citation.tipo !== 'norm') return null;
  const r = citation.riferimento;
  const tipo = text(r.tipo_atto);
  const articolo = text(r.numero_articolo);
  if (!tipo || !articolo) return null;
  const optional = ['numero_atto', 'tipo_atto_reale', 'allegato', 'versione', 'data_versione', 'urn', 'url'] as const;
  const norma: NormaVisitata = { tipo_atto: tipo, numero_articolo: articolo, data: text(r.data) ?? '' };
  for (const key of optional) {
    const value = text(r[key]);
    if (value) norma[key] = value;
  }
  return norma;
}

/** A cited decision as its reader takes it; null when the copy is not a decision the dossier would hold. */
export function decisionOfCitation(citation: CitazioneLezione): DecisionIdentity | null {
  if (citation.tipo !== 'sentenza') return null;
  const data = parseSentenzaContent(citation.riferimento);
  return data ? identityOf(data) : null;
}

/** The words a citation is named by: the server's citation, else what it is. */
export function citationLabel(citation: CitazioneLezione): string {
  return citation.citation ?? (citation.tipo === 'norm' ? 'La norma citata' : 'La sentenza citata');
}
