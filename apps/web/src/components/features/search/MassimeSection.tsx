import { useState, useMemo } from 'react';
import { Scale } from 'lucide-react';
import type { MassimaStructured } from '../../../types';
import { cn } from '../../../lib/utils';
import type { ReadingBackEntry } from '../../../utils/readingBackStack';
import { brocardiDecisionRef } from '../../../utils/decisionLinks';
import { CaseLawRow } from './caseLaw/CaseLawRow';
import { useCaseLawFilters, useReportCaseLawYears } from './caseLaw/caseLawFiltersContext';
import { applyCaseLawFilters } from './caseLaw/caseLawFilter';
import { rowYear, yearList, type YearsOf } from './caseLaw/caseLawYears';

interface MassimeSectionProps {
  massime: (string | MassimaStructured)[] | null;
  /** The place the article is read in (a practice or one of its windows): a decision opens beside it. */
  besideId?: string;
  /** The way back to the article, recorded when a decision is opened from here. */
  backEntry?: ReadingBackEntry;
}

type Massima = MassimaStructured & { id: string };

// Type guard to check if massima is structured
function isStructuredMassima(m: string | MassimaStructured): m is MassimaStructured {
  return typeof m === 'object' && m !== null && 'massima' in m;
}

// Normalize massima to structured format
function normalizeMassima(m: string | MassimaStructured, index: number): Massima {
  if (isStructuredMassima(m)) {
    return { ...m, id: `${m.autorita || 'unknown'}-${m.numero || index}-${m.anno || 'na'}` };
  }
  // Legacy string format
  return {
    id: `legacy-${index}`,
    autorita: null,
    numero: null,
    anno: null,
    massima: m
  };
}

/** Brocardi gives the decision's year, nothing finer (the «n./YYYY» of its heading). */
const yearsOfMassima: YearsOf<Massima> = (m) => rowYear({ year: m.anno });
const textOfMassima = (m: Massima): string => [m.massima, m.autorita ?? '', m.numero ?? '', m.anno ?? ''].join(' ');

/**
 * Brocardi's massime under an article, each as the section's `CaseLawRow`. Narrowed and ordered by
 * the section's controls (the year, the text); outside a section it shows them all.
 */
export function MassimeSection({ massime, besideId, backEntry }: MassimeSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const filters = useCaseLawFilters();

  // Normalize all massime to structured format
  const normalizedMassime = useMemo(() => {
    if (!massime || massime.length === 0) return [];
    return massime.map((m, i) => normalizeMassima(m, i));
  }, [massime]);

  const years = useMemo(() => yearList(normalizedMassime, yearsOfMassima), [normalizedMassime]);
  useReportCaseLawYears('massime', years);

  const filteredMassime = useMemo(
    () => applyCaseLawFilters(normalizedMassime, { yearsOf: yearsOfMassima, textOf: textOfMassima }, filters),
    [normalizedMassime, filters],
  );

  if (!massime || massime.length === 0) return null;

  return (
    <div className="card border border-slate-200 dark:border-slate-700 shadow-sm rounded-md overflow-hidden">
      {/* Header with collapse button */}
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full min-h-[44px] md:min-h-0 flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <strong className="text-xs font-bold text-slate-500 flex items-center gap-2">
          <Scale size={14} className="text-blue-600" />
          {filteredMassime.length} di {normalizedMassime.length} {normalizedMassime.length === 1 ? 'massima' : 'massime'}
        </strong>
        <span aria-hidden="true" className={cn("transition-transform text-slate-400", isOpen ? "rotate-180" : "")}>
          ▼
        </span>
      </button>

      {isOpen && (
        filteredMassime.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">
            Nessuna massima trovata con i filtri selezionati
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
            {filteredMassime.map((m) => {
              const decision = brocardiDecisionRef(m.autorita, m.numero, m.anno);
              const year = yearsOfMassima(m)[0]?.year ?? null;
              return (
                <CaseLawRow
                  key={m.id}
                  decision={decision}
                  // a decision of another court is written as its source writes it
                  label={decision ? undefined : m.autorita ?? undefined}
                  detail={!decision && m.numero && m.anno ? `n. ${m.numero}/${m.anno}` : undefined}
                  authority={m.autorita}
                  year={year}
                  source="Brocardi"
                  besideId={besideId}
                  backEntry={backEntry}
                >
                  {m.massima}
                </CaseLawRow>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
