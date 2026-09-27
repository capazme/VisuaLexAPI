import { Circle, BookOpen, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export type StatusType = 'unread' | 'reading' | 'important' | 'done';

export interface StatusChipProps {
  status: StatusType;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<StatusType, {
  label: string;
  icon: typeof Circle;
  containerClass: string;
  iconClass: string;
}> = {
  unread: {
    label: 'Non letto',
    icon: Circle,
    containerClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    iconClass: 'text-slate-400 dark:text-slate-500',
  },
  reading: {
    label: 'In lettura',
    icon: BookOpen,
    containerClass: 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
    iconClass: 'text-primary-500',
  },
  important: {
    label: 'Importante',
    icon: AlertTriangle,
    containerClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    iconClass: 'text-amber-500',
  },
  done: {
    label: 'Completato',
    icon: Check,
    containerClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    iconClass: 'text-emerald-500',
  },
};

export function StatusChip({
  status,
  size = 'md',
  showLabel = true,
  className,
}: StatusChipProps) {
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
      <Icon size={iconSize} className={config.iconClass} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
