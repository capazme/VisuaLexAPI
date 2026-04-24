import { Inbox, Send, Check, X as XIcon, AlertCircle } from 'lucide-react';
import type { EnvironmentSuggestion } from '../../../types';

interface ForumSuggestionsViewProps {
  receivedSuggestions: EnvironmentSuggestion[];
  sentSuggestions: EnvironmentSuggestion[];
  loading: boolean;
  suggestionTab: 'received' | 'sent';
  setSuggestionTab: (tab: 'received' | 'sent') => void;
  pendingCount: number;
  onApprove: (suggestion: EnvironmentSuggestion) => void;
  onReject: (suggestion: EnvironmentSuggestion) => void;
}

export function ForumSuggestionsView({
  receivedSuggestions,
  sentSuggestions,
  loading,
  suggestionTab,
  setSuggestionTab,
  pendingCount,
  onApprove,
  onReject,
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
            {receivedSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        suggestion.status === 'pending'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : suggestion.status === 'approved'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      }`}>
                        {suggestion.status === 'pending' ? 'In attesa' : suggestion.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        da @{suggestion.suggester.username}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                      Suggerimento per "{suggestion.sharedEnvironment?.title}"
                    </p>
                    {suggestion.message && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        "{suggestion.message}"
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>{suggestion.content.dossiers.length} dossier</span>
                      <span>{suggestion.content.quickNorms.length} norme veloci</span>
                      <span>{suggestion.content.customAliases.length} alias</span>
                    </div>
                  </div>
                  {suggestion.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onApprove(suggestion)}
                        className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                        title="Approva"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => onReject(suggestion)}
                        className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                        title="Rifiuta"
                      >
                        <XIcon size={18} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
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
            {sentSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        suggestion.status === 'pending'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                          : suggestion.status === 'approved'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      }`}>
                        {suggestion.status === 'pending' ? 'In attesa' : suggestion.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                      A "{suggestion.sharedEnvironment?.title}" di @{suggestion.sharedEnvironment?.user.username}
                    </p>
                    {suggestion.message && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        "{suggestion.message}"
                      </p>
                    )}
                    {suggestion.reviewNote && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                        Risposta: "{suggestion.reviewNote}"
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-2">
                      <span>{suggestion.content.dossiers.length} dossier</span>
                      <span>{suggestion.content.quickNorms.length} norme veloci</span>
                      <span>{suggestion.content.customAliases.length} alias</span>
                    </div>
                  </div>
                  {suggestion.status === 'pending' && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertCircle size={14} />
                      In attesa
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
