import { HIDDEN_SCROLLBAR } from '../../../../constants/interactions';
import { cn } from '../../../../lib/utils';
import type { Materia } from '../../../../types/studia';
import { SegmentedTabs } from '../../../ui/SegmentedTabs';
import { MATERIA_LABEL } from '../studiaLabels';
import { subjectHue } from './tokens';

export interface SubjectChipsProps {
  selected: Materia | undefined;
  onSelect: (materia: Materia | undefined) => void;
}

const ALL = 'tutte';

/**
 * The subject filter of the dashboard and of the session it starts (Studia progress spec §6.2): «Tutte le materie» and
 * the five subjects, one chosen at a time — the common choice in a row (LC112, `SegmentedTabs size="sm"`, a radiogroup),
 * one scrolling row where the page is narrower than the six.
 */
export function SubjectChips({ selected, onSelect }: SubjectChipsProps) {
  const tabs = [
    { id: ALL, label: 'Tutte le materie' },
    ...(Object.entries(MATERIA_LABEL) as Array<[Materia, string]>).map(([materia, label]) => ({
      id: materia,
      label: (
        <>
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: subjectHue(materia) }} />
          {label}
        </>
      ),
    })),
  ];
  return (
    // The track's own room for its focus ring, its bar not drawn.
    <div className={cn('relative -mx-1 overflow-x-auto px-1 py-1', HIDDEN_SCROLLBAR)}>
      <SegmentedTabs
        size="sm"
        label="Materia"
        tabs={tabs}
        value={selected ?? ALL}
        onChange={(id) => onSelect(id === ALL ? undefined : (id as Materia))}
        className="w-max"
        // 44 px at every width, as before (the `sm` row's segments are 40 on a phone, 32 from md); never squeezed in the
        // scrolling row.
        tabClassName="min-h-11 shrink-0 whitespace-nowrap"
      />
    </div>
  );
}
