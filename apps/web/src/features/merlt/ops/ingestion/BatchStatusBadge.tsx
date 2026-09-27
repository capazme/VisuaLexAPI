import { Loader2, Clock, UploadCloud, CheckCircle2, XCircle, AlertOctagon } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { IngestionBatchStatus } from './types';

export interface BatchStatusBadgeProps {
  status: IngestionBatchStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Status badge for a mechanical-ingestion batch. Modeled on
 * components/ui/StatusChip.tsx's STATUS_CONFIG record pattern, with keys for
 * this pipeline's 6-state lifecycle instead of the dossier status set.
 */
const STATUS_CONFIG: Record<
  IngestionBatchStatus,
  { label: string; icon: typeof Clock; containerClass: string; iconClass: string; spin?: boolean }
> = {
  parsing: {
    label: 'Analisi in corso',
    icon: Loader2,
    containerClass: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    iconClass: 'text-primary-500',
    spin: true,
  },
  pending_review: {
    label: 'Da revisionare',
    icon: Clock,
    containerClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    iconClass: 'text-amber-500',
  },
  promoting: {
    label: 'Promozione in corso',
    icon: UploadCloud,
    containerClass: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    iconClass: 'text-primary-500',
    spin: true,
  },
  promoted: {
    label: 'Promosso',
    icon: CheckCircle2,
    containerClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    iconClass: 'text-emerald-500',
  },
  rejected: {
    label: 'Rifiutato',
    icon: XCircle,
    containerClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    iconClass: 'text-slate-400 dark:text-slate-500',
  },
  failed: {
    label: 'Fallito',
    icon: AlertOctagon,
    containerClass: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    iconClass: 'text-red-500',
  },
};

export function BatchStatusBadge({ status, size = 'md', className }: BatchStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const sizeStyles = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
  };
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-md',
        config.containerClass,
        sizeStyles[size],
        className
      )}
      title={config.label}
    >
      <Icon size={iconSize} className={cn(config.iconClass, config.spin && 'animate-spin')} />
      <span>{config.label}</span>
    </span>
  );
}
