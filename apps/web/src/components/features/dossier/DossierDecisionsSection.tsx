import type { DossierItem } from '../../../types';
import { cn } from '../../../lib/utils';
import { DossierDecisionRow } from './DossierDecisionRow';
import { COLUMN_HEADING, SECTION_COUNT, SECTION_TILE } from './dossierStyles';
import type { SentenzaItem } from './dossierLayout';

interface Props {
  decisions: SentenzaItem[];
  expandedIds: Set<string>;
  onToggleExpand: (itemId: string) => void;
  selectedIds: Set<string>;
  showCheckbox: boolean;
  onToggleSelect: (itemId: string) => void;
  onRemove: (item: DossierItem) => void;
  onToggleImportant: (item: DossierItem) => void;
  /** The column's own scrolling, beside the norms (D7d): its classes, and a tab stop so the keyboard scrolls it. */
  className?: string;
  tabIndex?: number;
}

/**
 * «Giurisprudenza», the dossier's right column from `lg` (D7a), after the acts below it: its title, then one tile of
 * rows, one per decision in stored order, each opened in place as an article is (`DossierDecisionRow`). It took the
 * place of the list of links to a preview (Sentenze PR C), which read no decision in the dossier.
 */
export function DossierDecisionsSection({
  decisions, expandedIds, onToggleExpand, selectedIds, showCheckbox, onToggleSelect, onRemove, onToggleImportant,
  className, tabIndex,
}: Props) {
  if (decisions.length === 0) return null;
  return (
    <section aria-labelledby="dossier-decisions-heading" tabIndex={tabIndex} className={cn('min-w-0', className)}>
      <h2 id="dossier-decisions-heading" className={COLUMN_HEADING}>
        Giurisprudenza <span className={SECTION_COUNT}>({decisions.length})</span>
      </h2>
      <div className={cn(SECTION_TILE, 'py-1')}>
        {decisions.map((item) => (
          <DossierDecisionRow
            key={item.id}
            item={item}
            isSelected={selectedIds.has(item.id)}
            showCheckbox={showCheckbox}
            onToggleSelect={() => onToggleSelect(item.id)}
            isExpanded={expandedIds.has(item.id)}
            onToggleExpand={() => onToggleExpand(item.id)}
            onRemove={() => onRemove(item)}
            onToggleImportant={() => onToggleImportant(item)}
          />
        ))}
      </div>
    </section>
  );
}
