import { Clock } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { VersionChip } from '../../../utils/versionDisplay';

/** The status's ink (R3: words, not a pill): neutral for the text in force, the tone of its banner for the others. */
const TONE: Record<VersionChip['tone'], string> = {
    current: 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
    historical: 'text-amber-800 hover:text-amber-950 dark:text-amber-300 dark:hover:text-amber-200',
    abrogated: 'text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-200',
    not_yet: 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
    // The text in force today, which a later text will change: informing, as the banner beside the text.
    upcoming: 'text-sky-800 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-200',
};

interface VersionStatusChipProps {
    chip: VersionChip;
    /** Opens the "Testo alla data" dialog. */
    onClick: () => void;
}

/**
 * The status of the text on screen, as the source states it, in words beside the text (R3): «In vigore dal 1° gennaio
 * 2005», «Testo storico · dal … al …», the clock before it. A button: it opens «Testo alla data». It replaces the
 * "Vigente" badge, which was a default and not a status, and the "Aggiornato al" echo of the typed date.
 */
export function VersionStatusChip({ chip, onClick }: VersionStatusChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={chip.title}
            aria-haspopup="dialog"
            className={cn(
                'inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-left text-sm transition-colors md:min-h-0',
                'underline-offset-4 hover:underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                TONE[chip.tone],
            )}
        >
            <Clock size={14} aria-hidden="true" className="shrink-0" />
            {chip.label}
        </button>
    );
}
