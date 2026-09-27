import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface ProgressBarProps {
  value?: number;
  max?: number;
  variant?: 'default' | 'success' | 'warning' | 'brocardi';
  size?: 'sm' | 'md';
  indeterminate?: boolean;
  label?: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({
  value = 0,
  max = 100,
  variant = 'default',
  size = 'md',
  indeterminate = false,
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeStyles = {
    sm: 'h-1',
    md: 'h-2',
  };

  const fillVariants = {
    default: 'bg-primary-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    brocardi: 'bg-brocardi',
  };

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {label}
            </span>
          )}
          {showValue && !indeterminate && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}

      <div
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className={cn(
          'w-full rounded-full overflow-hidden',
          'bg-slate-100 dark:bg-slate-800',
          sizeStyles[size]
        )}
      >
        {indeterminate ? (
          <motion.div
            className={cn('h-full rounded-full w-1/3', fillVariants[variant])}
            animate={{ x: ['-100%', '400%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <motion.div
            className={cn('h-full rounded-full', fillVariants[variant])}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        )}
      </div>
    </div>
  );
}
