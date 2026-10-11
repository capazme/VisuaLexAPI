import { useEffect } from 'react';
import { Gavel, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { SearchHistoryItem } from '../../../services/historyService';
import { formatDecisionShort, identityFromKey } from '../../../utils/decisionLinks';

/**
 * A decision in the Cronologia: its short citation, a fixed slate stripe (no act type to colour it),
 * and a click that reopens it in the workspace. A key that no longer reads is shown as "Sentenza",
 * logged, and not clickable: there is nothing to open.
 */
export function DecisionHistoryRow({ item, variant, onDelete, id }: {
  item: SearchHistoryItem;
  variant: 'mobile' | 'desktop';
  onDelete: (e: React.MouseEvent, id: string) => void;
  id?: string;
}) {
  const navigate = useNavigate();
  const openDecisionTab = useAppStore((s) => s.openDecisionTab);
  const key = item.decision_key ?? '';
  const identity = identityFromKey(key);

  useEffect(() => {
    if (!identity) console.error('history: unreadable decision key', { id: item.id, decision_key: item.decision_key });
  }, [identity, item.id, item.decision_key]);

  const open = () => {
    if (!identity) return;
    openDecisionTab(identity);
    navigate('/');
  };
  const when = item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it }) : null;
  const label = identity ? formatDecisionShort(identity) : 'Sentenza';

  return (
    <div id={id} data-history-decision className={cn('relative group', variant === 'desktop' && 'md:block')}>
      <div className={cn(
        'relative flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700',
        variant === 'desktop' ? 'rounded-xl border-2 p-2 pl-5' : 'rounded-lg p-1 pl-4',
      )}>
        <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-slate-400" />
        {identity ? (
          <button
            type="button"
            onClick={open}
            className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 text-left rounded-lg hover:text-blue-700 dark:hover:text-blue-300"
          >
            <Gavel size={16} aria-hidden className="text-slate-500 flex-shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold text-sm text-slate-900 dark:text-white truncate">{label}</span>
              {when && <span className="block text-[10px] text-slate-400 dark:text-slate-500" title={new Date(item.created_at).toLocaleString('it-IT')}>{when}</span>}
            </span>
          </button>
        ) : (
          <div className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 text-slate-500">
            <Gavel size={16} aria-hidden className="flex-shrink-0" />
            <span className="font-semibold text-sm truncate">{label}</span>
          </div>
        )}
        <button
          type="button"
          aria-label={`Elimina ${label} dalla cronologia`}
          onClick={(e) => onDelete(e, item.id)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
