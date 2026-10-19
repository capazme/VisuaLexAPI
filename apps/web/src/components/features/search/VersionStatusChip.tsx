import { Clock } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { VersionChip } from '../../../utils/versionDisplay';

const TONE: Record<VersionChip['tone'], string> = {
    current: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    historical: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    abrogated: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    not_yet: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

interface VersionStatusChipProps {
    chip: VersionChip;
    /** Opens the "Testo alla data" dialog. */
    onClick: () => void;
}

/**
 * The status of the text on screen, as the source states it ("In vigore dal …",
 * "Testo storico · dal … al …"). It replaces the "Vigente" badge, which was a
 * default and not a status, and the "Aggiornato al" echo of the typed date.
 */
export function VersionStatusChip({ chip, onClick }: VersionStatusChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={chip.title}
            aria-haspopup="dialog"
            className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                'min-h-[44px] md:min-h-0 hover:brightness-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                TONE[chip.tone],
            )}
        >
            <Clock size={12} aria-hidden="true" />
            {chip.label}
        </button>
    );
}
