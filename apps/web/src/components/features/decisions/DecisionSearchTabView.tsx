import { useState } from 'react';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import type { DecisionSearchQuery } from '../../../types/decisions';
import { DecisionResultList } from './DecisionResultList';

/**
 * A decision search in its workspace tab: a topic, optionally narrowed to an article. «Solo il
 * tema» drops the article for this copy of the view (the tab's query stays as it was opened).
 * A decision opened from the list sits beside this tab; a results list is not an article, so
 * there is no way back to give it.
 */
export function DecisionSearchTabView({ tabId, query }: { tabId: string; query: DecisionSearchQuery }) {
  const [topicOnly, setTopicOnly] = useState(false);
  const canWiden = Boolean(query.tema && query.norma);
  const shown: DecisionSearchQuery = topicOnly
    ? { tema: query.tema }
    : query;
  const heading = query.tema ? `Tema: ${query.tema}` : query.normaLabel ?? 'Sentenze';

  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{heading}</h4>
        {query.tema && !topicOnly && query.normaLabel && (
          <p className="text-sm text-slate-600 dark:text-slate-300">e {query.normaLabel}</p>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Solo la Cassazione, ultimi cinque anni; le parole come sono scritte.
        </p>
      </header>
      {canWiden && (
        <button
          type="button"
          aria-pressed={topicOnly}
          onClick={() => setTopicOnly((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-sm ${TOUCH_TARGET_RESPONSIVE} ${
            topicOnly
              ? 'border-primary-600 bg-primary-600 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          Solo il tema
        </button>
      )}
      <DecisionResultList query={shown} besideTabId={tabId} />
    </div>
  );
}
