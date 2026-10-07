import type { NormaVisitata } from '../types';
import type { DecisionSearchNorma } from '../types/decisions';

/** The four fields `/search_decisions` reads; the others of an article are ignored there. */
export function searchNorma(norma: NormaVisitata): DecisionSearchNorma {
  return {
    tipo_atto: norma.tipo_atto,
    numero_articolo: norma.numero_articolo,
    ...(norma.numero_atto ? { numero_atto: norma.numero_atto } : {}),
    ...(norma.data ? { data: norma.data } : {}),
  };
}
