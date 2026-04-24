import { Heart, Download, Eye, MoreHorizontal, Flag, User, Edit, EyeOff, History, Lightbulb, MessageSquare, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { SharedEnvironment, EnvironmentCategory } from '../../../types';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';

interface SharedEnvironmentCardProps {
  environment: SharedEnvironment;
  onLike: (id: string) => void;
  onImport: (env: SharedEnvironment) => void;
  onReport: (id: string) => void;
  onSuggest?: (env: SharedEnvironment) => void;
  onEdit?: (env: SharedEnvironment) => void;
  onDelete?: (env: SharedEnvironment) => void;
  onWithdraw?: (env: SharedEnvironment) => void;
  onRepublish?: (env: SharedEnvironment) => void;
  onViewVersions?: (env: SharedEnvironment) => void;
  isLiking?: boolean;
  showOwnerActions?: boolean;
}

// Category text color (used for the micro-header label).
const CATEGORY_TEXT: Record<EnvironmentCategory, string> = {
  compliance: 'text-purple-700 dark:text-purple-300',
  civil: 'text-blue-700 dark:text-blue-300',
  penal: 'text-red-700 dark:text-red-300',
  administrative: 'text-amber-700 dark:text-amber-300',
  eu: 'text-indigo-700 dark:text-indigo-300',
  other: 'text-slate-600 dark:text-slate-300',
};

// Tailwind-500 hex per category — drives the 4px leading-edge stripe via
// inline style. Mirrors the environments polish pattern (56e3205) where
// the stripe color came from an HSL CSS variable; here we map directly
// because EnvironmentCategory doesn't carry a CSS variable.
const CATEGORY_STRIPE: Record<EnvironmentCategory, string> = {
  compliance: '#a855f7',
  civil: '#3b82f6',
  penal: '#ef4444',
  administrative: '#f59e0b',
  eu: '#6366f1',
  other: '#64748b',
};

const CATEGORY_LABELS: Record<EnvironmentCategory, string> = {
  compliance: 'Compliance',
  civil: 'Civile',
  penal: 'Penale',
  administrative: 'Amministrativo',
  eu: 'Europeo',
  other: 'Altro',
};

export function SharedEnvironmentCard({
  environment,
  onLike,
  onImport,
  onReport,
  onSuggest,
  onEdit,
  onDelete,
  onWithdraw,
  onRepublish,
  onViewVersions,
  isLiking = false,
  showOwnerActions = false,
}: SharedEnvironmentCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const categoryTextClass = CATEGORY_TEXT[environment.category];
  const stripeColor = CATEGORY_STRIPE[environment.category];
  const isWithdrawn = !environment.isActive;
  const hasPendingSuggestions = (environment.pendingSuggestionsCount ?? 0) > 0;

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const timeAgo = formatDistanceToNow(new Date(environment.createdAt), {
    addSuffix: true,
    locale: it,
  });

  return (
    <div className={`group relative bg-white dark:bg-slate-800 rounded-xl border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden ${
      isWithdrawn
        ? 'border-slate-300 dark:border-slate-600 opacity-75'
        : 'border-slate-200 dark:border-slate-700'
    }`}>
      {/* Category Stripe (4px leading edge) — same pattern as EnvironmentCard
          and SortableDossierItem. Replaces the former horizontal category
          banner that duplicated bg/border colour signals. */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ backgroundColor: stripeColor }}
      />

      {/* Content */}
      <div className="p-4 pl-5">
        {/* Micro-header: category label + version + status badges + 3-dot menu */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`text-xs font-semibold uppercase tracking-wide ${categoryTextClass}`}>
              {CATEGORY_LABELS[environment.category]}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
              v{environment.currentVersion}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Withdrawn badge */}
            {isWithdrawn && (
              <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full flex items-center gap-1">
                <EyeOff size={10} />
                Ritirato
              </span>
            )}
            {/* Pending suggestions badge */}
            {hasPendingSuggestions && environment.isOwner && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full flex items-center gap-1">
                <MessageSquare size={10} />
                {environment.pendingSuggestionsCount}
              </span>
            )}
            {/* Owner badge (only when the card is in the Explore grid — the My tab hides it since the whole column is already "your" environments) */}
            {environment.isOwner && !showOwnerActions && (
              <span className="px-2 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
                Tuo
              </span>
            )}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <MoreHorizontal size={16} className="text-slate-500" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-10 min-w-[160px]">
                  {/* Owner actions */}
                  {environment.isOwner && showOwnerActions && (
                    <>
                      {onEdit && (
                        <button
                          onClick={() => {
                            onEdit(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        >
                          <Edit size={14} />
                          Modifica
                        </button>
                      )}
                      {onViewVersions && (
                        <button
                          onClick={() => {
                            onViewVersions(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        >
                          <History size={14} />
                          Versioni
                        </button>
                      )}
                      {isWithdrawn && onRepublish && (
                        <button
                          onClick={() => {
                            onRepublish(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 flex items-center gap-2"
                        >
                          <Eye size={14} />
                          Ripubblica
                        </button>
                      )}
                      {!isWithdrawn && onWithdraw && (
                        <button
                          onClick={() => {
                            onWithdraw(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-2"
                        >
                          <EyeOff size={14} />
                          Ritira
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => {
                            onDelete(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Elimina
                        </button>
                      )}
                      <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                    </>
                  )}
                  {/* Non-owner actions */}
                  {!environment.isOwner && (
                    <>
                      {onSuggest && (
                        <button
                          onClick={() => {
                            onSuggest(environment);
                            setShowMenu(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                        >
                          <Lightbulb size={14} />
                          Suggerisci contenuto
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onReport(environment.id);
                          setShowMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                      >
                        <Flag size={14} />
                        Segnala
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <h3 className="font-semibold text-slate-900 dark:text-white mb-1 line-clamp-1">
          {environment.title}
        </h3>
        {environment.description && (
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 line-clamp-2">
            {environment.description}
          </p>
        )}

        {/* Tags */}
        {environment.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {environment.tags.slice(0, 3).map((tag, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full"
              >
                {tag}
              </span>
            ))}
            {environment.tags.length > 3 && (
              <span className="px-2 py-0.5 text-xs text-slate-500 dark:text-slate-500">
                +{environment.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mb-3">
          <span className="flex items-center gap-1">
            <Heart size={12} className={environment.userLiked ? 'fill-red-500 text-red-500' : ''} />
            {environment.likeCount}
          </span>
          <span className="flex items-center gap-1">
            <Download size={12} />
            {environment.downloadCount}
          </span>
          <span className="flex items-center gap-1">
            <Eye size={12} />
            {environment.viewCount}
          </span>
        </div>

        {/* Author & Time */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-4">
          <span className="flex items-center gap-1">
            <User size={12} />
            {environment.user.username}
          </span>
          <span>{timeAgo}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onLike(environment.id)}
            disabled={isLiking}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
              environment.userLiked
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            } disabled:opacity-50`}
          >
            <Heart size={16} className={environment.userLiked ? 'fill-current' : ''} />
            {environment.userLiked ? 'Piaciuto' : 'Mi piace'}
          </button>
          <button
            onClick={() => onImport(environment)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <Download size={16} />
            Importa
          </button>
        </div>
      </div>

    </div>
  );
}
