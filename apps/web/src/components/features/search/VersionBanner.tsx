import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { formatDateForCitation, withPreposition } from '../../../utils/dateUtils';
import type { BannerAction, VersionBanner as BannerData } from '../../../utils/versionDisplay';

const TONE: Record<BannerData['kind'], string> = {
    historical: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200',
    unreliable: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200',
    not_yet: 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
    current_in_window: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-200',
};

function labelOf(action: BannerAction, banner: BannerData): string {
    switch (action) {
        case 'go_current': return 'Vai al testo attuale';
        case 'copy_citation': return 'Copia citazione';
        case 'pick_date': return 'Scegli un’altra data';
        case 'open_next_day':
            return banner.nextDay ? `Vai al testo ${withPreposition('del', formatDateForCitation(banner.nextDay))}` : 'Vai al testo successivo';
    }
}

interface VersionBannerProps {
    banner: BannerData;
    /** Absent: the banner only informs (the dossier reader). */
    onAction?: (action: BannerAction) => void;
    /** `state`: it stands where the text would be (an article that did not exist yet). */
    variant?: 'banner' | 'state';
}

/**
 * Says which version of the text is on screen and what that does and does not
 * mean. It sits beside the text, never inside it: the text root holds nothing
 * but `article_text` (root CLAUDE.md, rule 23).
 */
export function VersionBanner({ banner, onAction, variant = 'banner' }: VersionBannerProps) {
    const Icon = banner.kind === 'unreliable' ? AlertTriangle : Info;
    return (
        <div
            role={banner.kind === 'unreliable' ? 'alert' : 'status'}
            className={cn(
                'mb-4 flex gap-3 rounded-lg border p-3 text-sm',
                variant === 'state' && 'py-8 flex-col items-center gap-2 text-center',
                TONE[banner.kind],
            )}
        >
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-1.5">
                {banner.title && <p className="font-semibold">{banner.title}</p>}
                <p className="leading-relaxed">{banner.body}</p>
                {banner.note && <p className="text-xs opacity-80">{banner.note}</p>}
                {onAction && banner.actions.length > 0 && (
                    <div className={cn('flex flex-wrap gap-2 pt-1', variant === 'state' && 'justify-center')}>
                        {banner.actions.map((action) => (
                            <Button key={action} variant="secondary" size="sm" className="min-h-[44px] md:min-h-0" onClick={() => onAction(action)}>
                                {labelOf(action, banner)}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
