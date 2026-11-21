import { Gavel, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import type { SearchHistoryItem } from '../../../services/historyService';
import { decisionHistoryLabel, decisionPath, identityFromKey } from '../../../utils/decisionLinks';
import { IconButton } from '../../ui/IconButton';
import { DecisionPreviewDialog } from '../decisions/DecisionPreviewDialog';
import { useListDecisionPreview } from '../decisions/useListDecisionPreview';

/**
 * A decision in the Cronologia: its short citation, drawn as the norms' rows,
 * and a click that opens its preview, whose «Apri la sentenza» reopens it in the workspace. A key that no longer reads is shown as "Sentenza",
 * logged, and not clickable: there is nothing to open.
 */
export function DecisionHistoryRow({ item, variant, onDelete, id }: {
  item: SearchHistoryItem;
  variant: 'mobile' | 'desktop';
  onDelete: (e: React.MouseEvent, id: string) => void;
  id?: string;
}) {
  const navigate = useNavigate();
  const openDecision = useAppStore((s) => s.openDecision);
  const key = item.decision_key ?? '';
  const identity = identityFromKey(key);
  const { preview, anchorRef, toggle } = useListDecisionPreview();

  const open = () => {
    if (!identity) return;
    openDecision(identity, { fromLink: true });
    navigate('/');
  };
  const when = item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: it }) : null;
  const label = decisionHistoryLabel(item.decision_key);

  return (
    <div id={id} data-history-decision className="relative group">
      {/* LC117: drawn as the norms' rows beside it — a row with a rule on a computer, a card on a phone — not a card of its own. */}
      <div className={cn(
        'relative flex items-center gap-2',
        variant === 'desktop'
          ? 'border-b border-slate-200 px-2 py-1 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900'
          : 'rounded-[8px] border border-slate-200 bg-white p-1 pl-3 dark:border-slate-700 dark:bg-slate-800',
      )}>
        {identity ? (
          // bare-button: the row's title, a whole entry that opens its preview.
          <button
            type="button"
            onClick={(e) => toggle(e.currentTarget, identity, decisionPath(identity))}
            aria-haspopup="dialog"
            aria-expanded={preview.isVisible}
            className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:text-primary-700 focus-visible:outline-none dark:hover:text-primary-300"
          >
            <Gavel size={16} aria-hidden className="text-slate-500 flex-shrink-0" />
            <span className="min-w-0">
              <span className={cn('block truncate font-serif text-slate-900 dark:text-slate-50', variant === 'desktop' ? 'text-lg leading-snug' : 'text-base')}>{label}</span>
              {when && <span className="block text-xs text-slate-600 dark:text-slate-400" title={new Date(item.created_at).toLocaleString('it-IT')}>{when}</span>}
            </span>
          </button>
        ) : (
          <div className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 text-slate-500">
            <Gavel size={16} aria-hidden className="flex-shrink-0" />
            <span className="font-serif text-base truncate">{label}</span>
          </div>
        )}
        <IconButton
          aria-label={`Elimina ${label} dalla cronologia`}
          onClick={(e) => onDelete(e, item.id)}
          icon={<Trash2 aria-hidden />}
          className="text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        />
      </div>
      {preview.isVisible && (
        <DecisionPreviewDialog preview={preview} anchorRef={anchorRef} onOpen={open} openLabel="Apri la sentenza" />
      )}
    </div>
  );
}
