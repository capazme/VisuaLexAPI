import { StatusChip, type StatusType } from '../../ui/StatusChip';
import { cn } from '../../../lib/utils';
import type { StatoScheda } from '../../../types/studia';
import { STATO_LABEL } from './studiaLabels';

// Draft slate, proposed primary, validated success, «da rivedere» warning, archived muted slate.
const TONE: Record<StatoScheda, StatusType> = {
  BOZZA_PERSONALE: 'unread',
  PROPOSTA_COMMUNITY: 'reading',
  VALIDATA: 'done',
  DA_RIVEDERE: 'important',
  ARCHIVIATA: 'unread',
};

/** A card's state in words, on `StatusChip`'s tones; an archived card is the draft's slate, outlined and quieter. */
export function StateChip({ stato, className }: { stato: StatoScheda; className?: string }) {
  return (
    <StatusChip
      status={TONE[stato]}
      size="sm"
      label={STATO_LABEL[stato]}
      showIcon={false}
      className={cn(
        stato === 'ARCHIVIATA' && 'bg-transparent text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-transparent dark:text-slate-400 dark:ring-slate-700',
        className,
      )}
    />
  );
}
