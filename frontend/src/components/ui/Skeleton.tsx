import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = 'rectangular', width, height, className, style, ...props }, ref) => {
    const baseStyles = 'animate-shimmer bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800';

    const variantStyles = {
      text: 'h-4 rounded',
      circular: 'rounded-full',
      rectangular: 'rounded-lg',
    };

    const dimensions = {
      width: width ? (typeof width === 'number' ? `${width}px` : width) : undefined,
      height: height ? (typeof height === 'number' ? `${height}px` : height) : undefined,
    };

    return (
      <div
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], className)}
        style={{ ...dimensions, ...style }}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

// Convenience components for common skeleton patterns
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          style={{ width: i === lines - 1 ? '70%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('p-4 space-y-3', className)}>
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/**
 * Skeleton for article content loading
 */
export function ArticleSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-6 space-y-4', className)}>
      {/* Article header */}
      <div className="flex items-center justify-between">
        <Skeleton variant="text" width="40%" height={24} />
        <div className="flex gap-2">
          <Skeleton variant="rectangular" width={32} height={32} />
          <Skeleton variant="rectangular" width={32} height={32} />
        </div>
      </div>

      {/* Article meta */}
      <div className="flex gap-4">
        <Skeleton variant="text" width={100} />
        <Skeleton variant="text" width={80} />
      </div>

      {/* Article content paragraphs */}
      <div className="space-y-3 pt-4">
        <SkeletonText lines={4} />
        <div className="h-2" />
        <SkeletonText lines={3} />
        <div className="h-2" />
        <SkeletonText lines={5} />
      </div>
    </div>
  );
}

/**
 * Skeleton for dossier list items
 */
export function DossierListSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="flex items-start gap-3">
            {/* Icon */}
            <Skeleton variant="rectangular" width={40} height={40} className="rounded-lg" />

            {/* Content */}
            <div className="flex-1 space-y-2">
              <Skeleton variant="text" width="50%" height={18} />
              <Skeleton variant="text" width="80%" height={14} />
              <div className="flex gap-2 pt-1">
                <Skeleton variant="rectangular" width={60} height={20} className="rounded-full" />
                <Skeleton variant="rectangular" width={80} height={20} className="rounded-full" />
              </div>
            </div>

            {/* Actions */}
            <Skeleton variant="rectangular" width={24} height={24} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for history list items
 */
export function HistoryListSkeleton({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="flex items-center gap-3">
            {/* Icon */}
            <Skeleton variant="circular" width={32} height={32} />

            {/* Content */}
            <div className="flex-1 space-y-1.5">
              <Skeleton variant="text" width="60%" height={16} />
              <Skeleton variant="text" width="30%" height={12} />
            </div>

            {/* Timestamp */}
            <Skeleton variant="text" width={60} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for NormaCard loading state
 */
export function NormaCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden', className)}>
      {/* Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton variant="rectangular" width={36} height={36} className="rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton variant="text" width={180} height={18} />
              <Skeleton variant="text" width={120} height={14} />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton variant="rectangular" width={28} height={28} />
            <Skeleton variant="rectangular" width={28} height={28} />
            <Skeleton variant="rectangular" width={28} height={28} />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex gap-2">
        <Skeleton variant="rectangular" width={80} height={28} className="rounded-lg" />
        <Skeleton variant="rectangular" width={80} height={28} className="rounded-lg" />
        <Skeleton variant="rectangular" width={80} height={28} className="rounded-lg" />
      </div>

      {/* Content */}
      <ArticleSkeleton />
    </div>
  );
}
