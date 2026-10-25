import { useState } from 'react';
import { Package, Upload } from 'lucide-react';
import { CARD_GRID, SharedEnvironmentCard } from './SharedEnvironmentCard';
import { VersionHistoryModal } from './VersionHistoryModal';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
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
  // Version history is owned here: BulletinBoardPage wires every other owner
  // action but not onViewVersions, and the parent file is out of scope, so the
  // modal state + restored-env overrides live locally. The override map keeps a
  // restored environment fresh until the parent refetches on the next tab visit.
  const [versionsEnv, setVersionsEnv] = useState<SharedEnvironment | null>(null);
  const [restored, setRestored] = useState<Record<string, SharedEnvironment>>({});

  if (loading) {
    return (
      <div className={CARD_GRID}>
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
          Nessun dossier pubblicato
        </h3>
        <p className="text-slate-600 dark:text-slate-400 mb-4">
          Non hai ancora pubblicato un dossier nel Forum.
        </p>
        <button
          onClick={onPublishClick}
          className={`inline-flex ${TOUCH_TARGET_RESPONSIVE} items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors`}
        >
          <Upload size={16} />
          Pubblica un dossier
        </button>
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {environments.length} {environments.length === 1 ? 'dossier pubblicato' : 'dossier pubblicati'}
      </p>
      <div className={CARD_GRID}>
        {environments.map((env) => {
          const current = restored[env.id] ?? env;
          return (
            <SharedEnvironmentCard
              key={current.id}
              environment={current}
              onLike={onLike}
              onImport={onImport}
              onReport={onReport}
              onEdit={onEdit}
              onDelete={onDelete}
              onWithdraw={onWithdraw}
              onRepublish={onRepublish}
              onViewVersions={setVersionsEnv}
              isLiking={likingIds.has(current.id)}
              showOwnerActions={true}
            />
          );
        })}
      </div>

      {versionsEnv && (
        <VersionHistoryModal
          environment={restored[versionsEnv.id] ?? versionsEnv}
          onClose={() => setVersionsEnv(null)}
          onRestored={(updated) => {
            setRestored((prev) => ({ ...prev, [updated.id]: updated }));
            setVersionsEnv(null);
          }}
        />
      )}
    </>
  );
}
