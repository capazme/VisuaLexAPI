import type { ReactNode } from 'react';
import { Check, X as XIcon, Clock, FileText, Highlighter, Folder, Zap, Link2 } from 'lucide-react';
import type { SuggestionItem, SuggestionItemType } from '../../../types';

const HIGHLIGHT_SWATCH_BG: Record<string, string> = {
  yellow: 'bg-yellow-300',
  green: 'bg-green-300',
  red: 'bg-red-300',
  blue: 'bg-blue-300',
};

const ITEM_TYPE_META: Record<SuggestionItemType, { icon: typeof FileText; label: string; colorClass: string }> = {
  annotation: { icon: FileText, label: 'Nota', colorClass: 'text-amber-600 dark:text-amber-400' },
  highlight: { icon: Highlighter, label: 'Evidenziazione', colorClass: 'text-yellow-600 dark:text-yellow-400' },
  dossier: { icon: Folder, label: 'Dossier', colorClass: 'text-indigo-600 dark:text-indigo-400' },
  quickNorm: { icon: Zap, label: 'Norma veloce', colorClass: 'text-emerald-600 dark:text-emerald-400' },
  alias: { icon: Link2, label: 'Alias', colorClass: 'text-purple-600 dark:text-purple-400' },
};

interface SuggestionItemCardProps {
  item: SuggestionItem;
  /** Right-side actions, rendered only when item.status === 'pending'. */
  actions?: ReactNode;
  /** Extra children rendered after the preview (e.g. reviewNote for declined). */
  footer?: ReactNode;
}

export function SuggestionItemCard({ item, actions, footer }: SuggestionItemCardProps) {
  const meta = ITEM_TYPE_META[item.itemType];
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${meta.colorClass}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{meta.label}</span>
            <StatusChip status={item.status} reviewedAt={item.reviewedAt ?? undefined} />
          </div>
          <ItemPreview item={item} />
          {footer}
        </div>
        {item.status === 'pending' && actions && (
          <div className="flex items-center gap-1 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status, reviewedAt }: { status: SuggestionItem['status']; reviewedAt?: string }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        <Clock size={10} /> In attesa
      </span>
    );
  }
  const dateLabel = reviewedAt ? new Date(reviewedAt).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
  if (status === 'taken') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
        <Check size={10} /> Presa{dateLabel && ` il ${dateLabel}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
      <XIcon size={10} /> Rifiutata{dateLabel && ` il ${dateLabel}`}
    </span>
  );
}

function ItemPreview({ item }: { item: SuggestionItem }) {
  const p = item.payload as Record<string, unknown>;
  switch (item.itemType) {
    case 'annotation': {
      const anchor = typeof p.anchorText === 'string' ? p.anchorText : undefined;
      const articleId = typeof p.articleId === 'string' ? p.articleId : '';
      const text = typeof p.text === 'string' ? p.text : '';
      return (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
            {articleId}{anchor && ` • "${anchor}"`}
          </p>
          <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-3">{text}</p>
        </div>
      );
    }
    case 'highlight': {
      const color = typeof p.colorVar === 'string' ? p.colorVar : 'yellow';
      const swatchBg = HIGHLIGHT_SWATCH_BG[color] ?? HIGHLIGHT_SWATCH_BG.yellow;
      const anchor = typeof p.anchorText === 'string' ? p.anchorText : '';
      const articleId = typeof p.articleId === 'string' ? p.articleId : '';
      return (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{articleId}</p>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-sm ${swatchBg}`} />
            <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-2">"{anchor}"</p>
          </div>
        </div>
      );
    }
    case 'dossier': {
      const title = typeof p.title === 'string' ? p.title : 'Dossier';
      const entries = Array.isArray(p.entries) ? p.entries.length : 0;
      const desc = typeof p.description === 'string' ? p.description : '';
      return (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>
          {desc && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{desc}</p>}
          <p className="text-xs text-slate-500 dark:text-slate-400">{entries} elementi</p>
        </div>
      );
    }
    case 'quickNorm': {
      const label = typeof p.label === 'string' ? p.label : '';
      const sp = (p.searchParams ?? {}) as Record<string, string>;
      return (
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {sp.act_type}{sp.article && ` art. ${sp.article}`}
          </p>
        </div>
      );
    }
    case 'alias': {
      const trigger = typeof p.trigger === 'string' ? p.trigger : '';
      const expand = typeof p.expandTo === 'string' ? p.expandTo : '';
      const aliasType = typeof p.aliasType === 'string' ? p.aliasType : '';
      return (
        <div>
          <p className="text-sm text-slate-900 dark:text-slate-100">
            <code className="font-mono text-xs px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">{trigger}</code>
            {' → '}{expand}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{aliasType}</p>
        </div>
      );
    }
  }
}
