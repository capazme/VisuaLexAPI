import type { ArticleData } from '../../../types';
import type { DecisionReference, DecisionSearchQuery } from '../../../types/decisions';
import { practiceArticleKey, type BesideRef, type Practice } from '../../../utils/practice';
import { citeNorm } from '../../../utils/sources';
import { versionTabSuffix } from '../../../utils/versionDisplay';

/** Whether a practice holds nothing to draw: no act, no decision, no topic search. */
export function isEmptyPractice(practice: Practice): boolean {
  return practice.acts.length === 0 && practice.decisions.length === 0 &&
    !practice.beside.some((b) => b.kind === 'decision-search');
}

/**
 * A practice's id and name as one string, and back: a `useShallow` selector of a list of practices
 * compares strings by value, so a component re-renders only when an id or a name changes. The
 * separator is a character no id or name holds.
 */
export function practicePair(practice: Pick<Practice, 'id' | 'label'>): string {
  return `${practice.id}\u0000${practice.label}`;
}

export function fromPracticePair(pair: string): { id: string; label: string } {
  const at = pair.indexOf('\u0000');
  return { id: pair.slice(0, at), label: pair.slice(at + 1) };
}

/** What a window shows, found again in its practice: an article of an act, a decision entry, or a
 *  topic search (which holds its own query). Null when the practice no longer holds the subject. */
export type Subject =
  | { kind: 'article'; actId: string; article: ArticleData }
  | { kind: 'decision'; decisionId: string; reference: DecisionReference; label: string }
  | { kind: 'decision-search'; query: DecisionSearchQuery; label: string };

export function subjectOf(practice: Practice | undefined, ref: BesideRef): Subject | null {
  if (ref.kind === 'decision-search') return { kind: 'decision-search', query: ref.query, label: ref.label };
  if (!practice) return null;
  if (ref.kind === 'decision') {
    const entry = practice.decisions.find((d) => d.id === ref.decisionId);
    return entry ? { kind: 'decision', decisionId: entry.id, reference: entry.reference, label: entry.label } : null;
  }
  const article = practice.acts.find((a) => a.id === ref.actId)?.articles.find((a) => practiceArticleKey(a) === ref.articleKey);
  return article ? { kind: 'article', actId: ref.actId, article } : null;
}

/** The window's title: an article's citation (and the text it asks for, if past), a decision's
 *  label, a topic search's label (spec §4.1). */
export function titleOf(subject: Subject | null): string {
  if (!subject) return 'Testo non più sul tavolo';
  if (subject.kind !== 'article') return subject.label;
  const { norma_data } = subject.article;
  return `${citeNorm(norma_data)}${versionTabSuffix({ version: norma_data.versione, versionDate: norma_data.data_versione })}`;
}

/** The nearest ancestor that scrolls (`utils/scrollParent.ts`): the page's content scroller, which the results area sits in. */
export { scrollParentOf } from '../../../utils/scrollParent';
