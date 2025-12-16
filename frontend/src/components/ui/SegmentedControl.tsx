import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  return (
    <div className={cn(
      'bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex gap-1',
      className
    )}>
      {options.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 relative flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all',
              isActive
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            {/* Animated background pill */}
            {isActive && (
              <motion.div
                layoutId="active-pill"
                className="absolute inset-0 bg-white dark:bg-gray-700 rounded-lg shadow-sm"
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              />
            )}

            {/* Content */}
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
