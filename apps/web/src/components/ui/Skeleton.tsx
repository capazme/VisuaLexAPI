import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
import { CARD_RADIUS, CONTROL_RADIUS } from './controlStyles';
import { Card } from './Card';
import { CARD_GRID_COLUMNS } from '../layout/frame';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

/**
 * A place held at the size of what is coming (LC98): the flat Pietra ground of the app's placeholders, pulsing only
 * with motion allowed, unread by a screen reader (the page says «loading» once, in words). What arrives comes in
 * through `Arrive`.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ variant = 'rectangular', width, height, className, style, ...props }, ref) => {
    const baseStyles = 'bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800';

    const variantStyles = {
      text: 'h-4 rounded',
      circular: 'rounded-full',
      rectangular: CONTROL_RADIUS,
    };

    const dimensions = {
      width: width ? (typeof width === 'number' ? `${width}px` : width) : undefined,
      height: height ? (typeof height === 'number' ? `${height}px` : height) : undefined,
    };

    return (
      <div
        ref={ref}
        aria-hidden
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
 * Pratiche's cards while they are read (LC120): the list's own grid (`CARD_GRID_COLUMNS`, its gaps) and cards of the
 * real ones' height with nothing but a name and a foot (134 px from md): a title row as tall as the «⋯» beside it, the
 * counts and the date at the foot.
 */
export function DossierListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden className={cn('grid gap-4 md:gap-6', CARD_GRID_COLUMNS)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} data-skeleton-card className="flex flex-col p-4 md:p-5">
          <div className="flex h-10 items-center">
            <Skeleton variant="text" className="h-5 w-3/5" />
          </div>
          <div className="mt-auto pt-3">
            <div className="flex h-5 items-center"><Skeleton variant="text" className="h-3.5 w-2/5" /></div>
            <div className="mt-1 flex h-4 items-center"><Skeleton variant="text" className="h-3 w-1/3" /></div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Cronologia's rows while they are read (LC120): a day's heading, then the rows as the list draws them, cards on a
 * phone and rows with a rule under them (71 px) from md.
 */
export function HistoryListSkeleton({ count = 5 }: { count?: number }) {
  const rows = Array.from({ length: count });
  return (
    <div aria-hidden>
      <div className="mb-3 flex h-6 items-center md:mb-4 md:h-8"><Skeleton variant="text" className="h-3 w-16" /></div>
      <div className="space-y-2 md:hidden">
        {rows.map((_, i) => (
          <div key={i} data-skeleton-row className={cn('border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800', CARD_RADIUS)}>
            <div className="flex h-6 items-center"><Skeleton variant="text" className="w-2/5" /></div>
            <div className="mt-1 flex h-5 items-center"><Skeleton variant="text" className="h-3 w-3/5" /></div>
            <div className="mt-0.5 flex h-4 items-center"><Skeleton variant="text" className="h-2.5 w-1/4" /></div>
          </div>
        ))}
      </div>
      <div className="hidden border-t border-slate-200 md:block dark:border-slate-800">
        {rows.map((_, i) => (
          <div key={i} data-skeleton-row className="border-b border-slate-200 px-2 py-3 dark:border-slate-800">
            <div className="flex h-6 items-center"><Skeleton variant="text" className="w-40" /></div>
            <div className="mt-0.5 flex h-5 items-center"><Skeleton variant="text" className="h-3 w-72 max-w-full" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
