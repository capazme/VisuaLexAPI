import { User } from 'lucide-react';
import type { OriginalAuthor } from '../../../types';

interface AttributionChipProps {
  author: OriginalAuthor | null | undefined;
  size?: 'xs' | 'sm';
  className?: string;
}

export function AttributionChip({ author, size = 'xs', className = '' }: AttributionChipProps) {
  const label = author ? `@${author.username}` : '@utente-rimosso';
  const sizeClass = size === 'xs' ? 'text-xs' : 'text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1 ${sizeClass} text-slate-500 dark:text-slate-400 ${className}`}
      title={author ? `Suggerita da @${author.username}` : 'Autore rimosso'}
    >
      <User size={size === 'xs' ? 10 : 12} />
      da {label}
    </span>
  );
}
