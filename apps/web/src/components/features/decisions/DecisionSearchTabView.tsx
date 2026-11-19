import { useState } from 'react';
import { Button } from '../../ui/Button';
import type { DecisionSearchQuery } from '../../../types/decisions';
import { DecisionResultList } from './DecisionResultList';

/**
 * A decision search in its window (or the phone's reader): a topic, optionally narrowed to an article. «Solo il
 * tema» drops the article for this copy of the view (the window's query stays as it was opened).
 * A decision opened from the list sits beside this window; a results list is not an article, so
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
        <Button variant={topicOnly ? 'primary' : 'secondary'} size="sm" aria-pressed={topicOnly} onClick={() => setTopicOnly((v) => !v)}>
          Solo il tema
        </Button>
      )}
      <DecisionResultList query={shown} besideId={tabId} />
    </div>
  );
}
