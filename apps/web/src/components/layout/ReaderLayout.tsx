import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ReaderLayoutProps {
  children: ReactNode;
  className?: string;
  maxWidth?: 'narrow' | 'normal' | 'wide' | 'full';
}

const maxWidthClasses = {
  narrow: 'max-w-3xl',   // 768px - ottimo per lettura
  normal: 'max-w-5xl',   // 1024px - default
  wide: 'max-w-7xl',     // 1280px - per confronti
  full: 'max-w-none'     // full width
};

export function ReaderLayout({ children, className, maxWidth = 'normal' }: ReaderLayoutProps) {
  return (
    <div className={cn(
      // No padding of its own below `md` (R3b): the layout's 16 px are the reader's edge on a phone.
      'w-full mx-auto md:px-6 lg:px-8',
      maxWidthClasses[maxWidth],
      className
    )}>
      {children}
    </div>
  );
}
