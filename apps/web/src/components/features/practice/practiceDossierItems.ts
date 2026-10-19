import type { ArticleData, Dossier, DossierSentenzaData, NormaVisitata } from '../../../types';
import { decisionOrder, type Practice, type PracticeAct } from '../../../utils/practice';
import { identityOf } from '../../../utils/decisionLinks';
import { normalizeArticleId } from '../../../utils/treeUtils';
import { versionKey } from '../../../utils/versionDisplay';
import { actKeyOf, shownAnnex } from '../dossier/dossierLayout';
import { dossierContainsArticle, normaForDossier, sentenzaFromDecision } from '../dossier/dossierUtils';

export interface PracticeDossierItems {
  norms: NormaVisitata[];
  decisions: DossierSentenzaData[];
  /** Decisions never identified (a citation that did not resolve, a candidate not chosen, a migrated entry not read since): not saved. */
  unidentified: number;
}

/**
 * Which article of which act a dossier item names, whatever copy it came from: the act by
 * `actKeyOf` (a code by its name, so with or without its decree's number and date), the annex as
 * shown (`shownAnnex`: none for a code, whose search copy carries «2» and index copy nothing), the
 * article id normalised (gotcha 9), and the version.
 */
export function dossierArticleKey(norma: NormaVisitata): string {
  const annex = shownAnnex(norma);
  const id = normalizeArticleId(annex ? `all${annex}:${norma.numero_articolo}` : norma.numero_articolo);
  return `${actKeyOf(norma)}#${id}#${versionKey(norma)}`;
}

/** Does the dossier hold this article already: as `dossierContainsArticle` says, or as another copy of a code's article. */
export function dossierHoldsArticle(dossier: Dossier, norma: NormaVisitata): boolean {
  if (dossierContainsArticle(dossier, norma)) return true;
  const key = dossierArticleKey(norma);
  return dossier.items.some((i) => i.type === 'norma' && dossierArticleKey(i.data as NormaVisitata) === key);
}

/** The item of one row, from the article's own `norma_data` (its act's number, date and annex): the
 *  act's `norma` is only the first copy that opened it, which for a code may be the index's, bare. */
function itemOf(act: PracticeAct, article: ArticleData): NormaVisitata {
  const own = article.norma_data;
  return normaForDossier(
    { tipo_atto: own.tipo_atto || act.norma.tipo_atto, numero_atto: own.numero_atto, data: own.data ?? '', urn: act.norma.urn },
    article,
  );
}

/**
 * What «Salva come dossier» stores (spec §7), in table order: the acts in order, each one's
 * articles in order (a past text is its own item, with its version), then the decisions in
 * `decisionOrder`. Each article is saved as its own `norma_data` names it; the two rows a code's
 * article can have (a search's copy and the index's, T2) are one item, the copy carrying the
 * decree's number and date. A decision is saved by its identity with the attributes the practice kept.
 */
export function practiceDossierItems(practice: Practice): PracticeDossierItems {
  const norms: NormaVisitata[] = [];
  const at = new Map<string, number>();
  for (const act of practice.acts) {
    for (const article of act.articles) {
      const item = itemOf(act, article);
      const key = dossierArticleKey(item);
      const seen = at.get(key);
      if (seen === undefined) {
        at.set(key, norms.length);
        norms.push(item);
      } else if (!norms[seen].numero_atto && item.numero_atto) {
        norms[seen] = item;
      }
    }
  }
  const decisions: DossierSentenzaData[] = [];
  let unidentified = 0;
  for (const d of decisionOrder(practice.decisions)) {
    if (!d.identified) {
      unidentified += 1;
      continue;
    }
    decisions.push(sentenzaFromDecision(
      identityOf(d.reference),
      { sezione: d.sezione ?? d.reference.sezione, tipo: d.tipo, data_deposito: d.depositDate },
    ));
  }
  return { norms, decisions, unidentified };
}
