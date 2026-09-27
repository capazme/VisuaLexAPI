import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  variant?: 'default' | 'outline';
  layoutId?: string;
  className?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  variant = 'default',
  layoutId = 'active-pill',
  className,
}: SegmentedControlProps) {
  const containerVariants = {
    default: 'bg-slate-100 dark:bg-slate-900',
    outline: 'bg-transparent border border-slate-200 dark:border-slate-700',
  };

  const sizeStyles = {
    sm: 'p-0.5 gap-0.5 rounded-lg',
    md: 'p-1 gap-1 rounded-xl',
  };

  const buttonSizeStyles = {
    sm: 'py-1 px-2.5 rounded-md text-xs',
    md: 'py-1.5 px-3 rounded-lg text-sm',
  };

  return (
    <div
      role="tablist"
      className={cn(
        'flex',
        containerVariants[variant],
        sizeStyles[size],
        className
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={isActive}
            disabled={option.disabled}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              'flex-1 relative flex items-center justify-center gap-2 font-medium',
              'transition-colors duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary/50',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              buttonSizeStyles[size],
              isActive
                ? 'text-slate-900 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            )}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-white dark:bg-slate-700 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-600"
                transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              />
            )}

            <span className="relative z-10 flex items-center gap-2">
              {option.icon && <span className="shrink-0">{option.icon}</span>}
              <span>{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
