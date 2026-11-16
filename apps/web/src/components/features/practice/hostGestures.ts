import { appStore } from '../../../store/useAppStore';
import { isDesktopViewport } from '../../../hooks/useIsDesktop';
import { legalFetch } from '../../../services/legalFetch';
import type { ArticleData, SearchParams } from '../../../types';
import { besideRefFor, findPracticeArticle, practiceArticleKey, type Practice } from '../../../utils/practice';
import { requestIsHistorical } from '../../../utils/versionDisplay';
import { actKeyOf } from '../dossier/dossierLayout';

/**
 * What every host of a reading does with the same gestures (LC54: `SearchPanel` in Ricerca, `DossierReadingView` in a
 * dossier): a norm of the same act, opened beside the window it was cited in; the act's PDF.
 */

/** The practice whose light window or, on a phone, full-screen reader `askerId` names: where a norm
 *  cited in its text is searched and opened. */
export function askerPracticeOf(askerId: string | undefined): Practice | undefined {
  if (!askerId) return undefined;
  const { practices, phoneReader } = appStore.getState();
  return practices.find((p) => p.beside.some((b) => b.id === askerId)) ??
    (phoneReader?.ref.id === askerId ? practices.find((p) => p.id === phoneReader.practiceId) : undefined);
}

/** A subject opened from a light window or from the phone's reader: beside the window, or in the reader. */
export function openFromAsker(practiceId: string, ref: ReturnType<typeof besideRefFor>, askerId: string): void {
  const { openBeside, openPhoneReader } = appStore.getState();
  if (isDesktopViewport()) openBeside(practiceId, ref, askerId);
  else openPhoneReader(practiceId, ref);
}

/** The search a norm of the same act asks for (its annex kept). */
export function crossReferenceParams(articleNumber: string, normaData: ArticleData['norma_data']): SearchParams {
  return {
    act_type: normaData.tipo_atto,
    act_number: normaData.numero_atto || '',
    date: normaData.data || '',
    article: articleNumber,
    version: (normaData.versione as 'vigente' | 'originale') || 'vigente',
    version_date: normaData.data_versione || '',
    annex: normaData.allegato || undefined,  // Preserve annex when navigating via cross-reference
  };
}

/**
 * The text in force of an article of the same act already on `practice`'s table is revealed, not searched again (T2);
 * a past text of it never stands in for it, and a past text's jump asks for its own version. Cited from a light window
 * (`askerId`), the row opens beside that window instead (spec §4.5). True when it was there.
 */
export function revealHeldCitation(
  practice: Practice, articleNumber: string, normaData: ArticleData['norma_data'], askerId?: string,
): boolean {
  if (requestIsHistorical(normaData)) return false;
  const act = practice.acts.find((a) => a.key === actKeyOf(normaData));
  const articleId = normaData.allegato ? `all${normaData.allegato}:${articleNumber}` : articleNumber;
  const inForce = act && findPracticeArticle(
    { ...act, articles: act.articles.filter((a) => !requestIsHistorical(a.norma_data)) }, articleId);
  if (!act || !inForce) return false;
  if (askerId) {
    openFromAsker(practice.id, besideRefFor({ kind: 'article', actId: act.id, articleKey: practiceArticleKey(inForce) }), askerId);
    return true;
  }
  return appStore.getState().revealPracticeRow(practice.id, act.id, practiceArticleKey(inForce));
}

/** The act's PDF, as an address the viewer opens. */
export async function fetchActPdfUrl(urn: string): Promise<string> {
  const response = await legalFetch('/export_pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urn }),
  });
  if (!response.ok) throw new Error('Errore generazione PDF');
  return window.URL.createObjectURL(await response.blob());
}
