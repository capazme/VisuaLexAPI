import { Package, Share2 } from 'lucide-react';
import { SharedEnvironmentCard } from './SharedEnvironmentCard';
import type { SharedEnvironment } from '../../../types';

interface ForumMyEnvironmentsViewProps {
  environments: SharedEnvironment[];
  loading: boolean;
  likingIds: Set<string>;
  onLike: (id: string) => void;
  onImport: (env: SharedEnvironment) => void;
  onReport: (id: string) => void;
  onEdit: (env: SharedEnvironment) => void;
  onDelete: (env: SharedEnvironment) => void;
  onWithdraw: (env: SharedEnvironment) => void;
  onRepublish: (env: SharedEnvironment) => void;
  onPublishClick: () => void;
}

export function ForumMyEnvironmentsView({
  environments,
  loading,
  likingIds,
  onLike,
  onImport,
  onReport,
  onEdit,
  onDelete,
  onWithdraw,
  onRepublish,
  onPublishClick,
}: ForumMyEnvironmentsViewProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse"
          >
            <div className="h-10 bg-slate-100 dark:bg-slate-700" />
            <div className="p-4 space-y-3">
              <div className="h-5 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
              <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-full" />
              <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (environments.length === 0) {
    return (
      <div className="text-center py-12">
        <Package size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
          Nessun ambiente pubblicato
        </h3>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          Non hai ancora condiviso nessun ambiente con la community.
        </p>
        <button
          onClick={onPublishClick}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Share2 size={16} />
          Condividi un ambiente
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {environments.length} {environments.length === 1 ? 'ambiente pubblicato' : 'ambienti pubblicati'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {environments.map((env) => (
          <SharedEnvironmentCard
            key={env.id}
            environment={env}
            onLike={onLike}
            onImport={onImport}
            onReport={onReport}
            onEdit={onEdit}
            onDelete={onDelete}
            onWithdraw={onWithdraw}
            onRepublish={onRepublish}
            isLiking={likingIds.has(env.id)}
            showOwnerActions={true}
          />
        ))}
      </div>
    </>
  );
}
