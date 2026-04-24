import { Inbox, Send } from 'lucide-react';
import type { EnvironmentSuggestion } from '../../../types';

interface ForumSuggestionsViewProps {
  receivedSuggestions: EnvironmentSuggestion[];
  sentSuggestions: EnvironmentSuggestion[];
  loading: boolean;
  suggestionTab: 'received' | 'sent';
  setSuggestionTab: (tab: 'received' | 'sent') => void;
  pendingCount: number;
  onOpenReview: (suggestion: EnvironmentSuggestion) => void;
  onOpenEdit: (suggestion: EnvironmentSuggestion) => void;
}

export function ForumSuggestionsView({
  receivedSuggestions,
  sentSuggestions,
  loading,
  suggestionTab,
  setSuggestionTab,
  pendingCount,
  onOpenReview,
  onOpenEdit,
}: ForumSuggestionsViewProps) {
  return (
    <>
      {/* Sub-tabs for received/sent */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSuggestionTab('received')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            suggestionTab === 'received'
              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <Inbox size={16} />
          Ricevuti
          {pendingCount > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-primary-600 text-white rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSuggestionTab('sent')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            suggestionTab === 'sent'
              ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <Send size={16} />
          Inviati
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 animate-pulse"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/3" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : suggestionTab === 'received' ? (
        receivedSuggestions.length === 0 ? (
          <div className="text-center py-12">
            <Inbox size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Nessun suggerimento ricevuto
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              Quando qualcuno suggerirà contenuti per i tuoi ambienti, li vedrai qui.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {receivedSuggestions.map((suggestion) => {
              const { counts, aggregateStatus } = suggestion;
              return (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => onOpenReview(suggestion)}
                  className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-600 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBreakdownChip counts={counts} aggregate={aggregateStatus} />
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          da @{suggestion.suggester.username}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                        per "{suggestion.sharedEnvironment?.title}"
                      </p>
                      {suggestion.message && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                          "{suggestion.message}"
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        sentSuggestions.length === 0 ? (
          <div className="text-center py-12">
            <Send size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Nessun suggerimento inviato
            </h3>
            <p className="text-slate-600 dark:text-slate-400">
              Esplora gli ambienti della community e suggerisci contenuti!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sentSuggestions.map((suggestion) => {
              const { counts, aggregateStatus } = suggestion;
              const canEdit = aggregateStatus === 'open' || aggregateStatus === 'revoked';
              return (
                <button
                  key={suggestion.id}
                  type="button"
                  onClick={() => canEdit && onOpenEdit(suggestion)}
                  disabled={!canEdit}
                  className="w-full text-left bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 transition-colors disabled:cursor-default enabled:hover:border-primary-400 dark:enabled:hover:border-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBreakdownChip counts={counts} aggregate={aggregateStatus} />
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                        a "{suggestion.sharedEnvironment?.title}" di @{suggestion.sharedEnvironment?.user.username}
                      </p>
                      {suggestion.message && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">"{suggestion.message}"</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}
    </>
  );
}

function StatusBreakdownChip({ counts, aggregate }: {
  counts: { pending: number; taken: number; declined: number };
  aggregate: 'open' | 'closed' | 'revoked';
}) {
  if (aggregate === 'revoked') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">
        Revocato
      </span>
    );
  }
  const parts: string[] = [];
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.taken > 0) parts.push(`${counts.taken} prese`);
  if (counts.declined > 0) parts.push(`${counts.declined} rifiutate`);
  const classes =
    aggregate === 'open'
      ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${classes}`}>{parts.join(' · ') || 'Nessun item'}</span>;
}
