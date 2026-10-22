import type { NormaVisitata, SearchParams } from '../types';

/**
 * The search a quick norm saves for an article: its act, its number and the text in force. One definition for the
 * reader's «Aggiungi alle norme rapide» and the row's sign that says the article is among them (R3b).
 */
export function quickNormParamsOf(norma: Pick<NormaVisitata, 'tipo_atto' | 'numero_atto' | 'data' | 'numero_articolo' | 'allegato'>): SearchParams {
  return {
    act_type: norma.tipo_atto,
    act_number: norma.numero_atto || '',
    date: norma.data || '',
    article: norma.numero_articolo,
    annex: norma.allegato,
    version: 'vigente',
  };
}
