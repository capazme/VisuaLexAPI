import type { DossierSentenzaData, NormaVisitata } from '../../../types';
import { decisionOrder, type Practice } from '../../../utils/practice';
import { normaForDossier, sentenzaFromDecision } from '../dossier/dossierUtils';

export interface PracticeDossierItems {
  norms: NormaVisitata[];
  decisions: DossierSentenzaData[];
  /** Decisions never identified (a citation that did not resolve, a candidate not chosen, a migrated entry not read since): not saved. */
  unidentified: number;
}

/**
 * What «Salva come dossier» stores (spec §7), in table order: the acts in order, each one's
 * articles in order (a past text is its own item, with its version), then the decisions in
 * `decisionOrder`. A decision is saved by its identity with the attributes the practice kept.
 */
export function practiceDossierItems(practice: Practice): PracticeDossierItems {
  const norms = practice.acts.flatMap((act) => act.articles.map((article) => normaForDossier(act.norma, article)));
  const decisions: DossierSentenzaData[] = [];
  let unidentified = 0;
  for (const d of decisionOrder(practice.decisions)) {
    if (!d.identified) {
      unidentified += 1;
      continue;
    }
    const { corte, numero, anno, archivio } = d.reference;
    decisions.push(sentenzaFromDecision(
      { corte, numero, anno, ...(archivio ? { archivio } : {}) },
      { sezione: d.sezione ?? d.reference.sezione, tipo: d.tipo, data_deposito: d.depositDate },
    ));
  }
  return { norms, decisions, unidentified };
}
