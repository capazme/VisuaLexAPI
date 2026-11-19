import { useMemo, useState } from 'react';
import type { DossierItem } from '../../../types';
import { formatDateItalianLong } from '../../../utils/dateUtils';
import { cn } from '../../../lib/utils';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { buildChronology, type ChronologyEntry } from './chronology';
import { ROW, ROW_LINE, ROW_TITLE, SECTION_COUNT, SECTION_HEADING } from './dossierStyles';

interface Props {
  items: DossierItem[];
  /** Shows the entry in «Fonti». */
  onOpen: (entry: ChronologyEntry) => void;
}

const SOURCE_LABEL = { nota: 'Nota', sentenza: 'Sentenza' } as const;

/** «Cronologia» (LC137): the dossier's dated facts by year, each row opening its entry in «Fonti». */
export function DossierChronology({ items, onOpen }: Props) {
  const [newestFirst, setNewestFirst] = useState(false);
  const { years, undatedNotes } = useMemo(() => buildChronology(items, newestFirst), [items, newestFirst]);
  const undatedCount = undatedNotes === 1 ? '1 nota senza data non compare' : `${undatedNotes} note senza data non compaiono`;
  if (years.length === 0) {
    return (
      <div className="space-y-2">
        <p className={ROW_TITLE}>Le note che iniziano con una data, come 12/03/2025, e le sentenze con la data di deposito compaiono qui.</p>
        {undatedNotes > 0 && <p className={ROW_LINE}>{undatedCount}.</p>}
      </div>
    );
  }
  const undated = undatedNotes > 0 && (
    <p className={ROW_LINE}>{undatedCount}: una nota entra nella cronologia se inizia con la data, come 12/03/2025.</p>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {undated || <span />}
        <Button variant="secondary" size="sm" aria-pressed={newestFirst} onClick={() => setNewestFirst((v) => !v)}>
          Dal più recente
        </Button>
      </div>
      {years.map(({ year, entries }) => (
        <Card key={year} role="region" aria-labelledby={`chronology-${year}`} className="px-3 pb-1 pt-3 md:px-4">
          <h2 id={`chronology-${year}`} className={SECTION_HEADING}>
            {year} <span className={SECTION_COUNT}>({entries.length})</span>
          </h2>
          <ol className="mt-1">
            {entries.map((entry) => (
              <li key={entry.id} className={cn(ROW, 'py-2.5')}>
                <p className={cn(ROW_LINE, 'font-medium')}>
                  <time dateTime={entry.date}>{formatDateItalianLong(entry.date)}</time> · {SOURCE_LABEL[entry.source]}
                </p>
                <p className={cn(ROW_TITLE, 'mt-0.5 line-clamp-2 break-words')}>{entry.text || 'Nota senza testo dopo la data'}</p>
                <Button variant="link" className="-ml-1 min-h-11 px-1 text-[13px] md:min-h-8" onClick={() => onOpen(entry)}>
                  Apri nella pratica
                </Button>
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
