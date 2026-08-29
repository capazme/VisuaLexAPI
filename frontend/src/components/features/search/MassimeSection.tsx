import { useState, useMemo } from 'react';
import { Search, Scale, ChevronDown, Filter } from 'lucide-react';
import type { MassimaStructured } from '../../../types';
import { cn } from '../../../lib/utils';
import { LinkKindBadge } from './LinkKindBadge';

interface MassimeSectionProps {
  massime: (string | MassimaStructured)[] | null;
}

// Type guard to check if massima is structured
function isStructuredMassima(m: string | MassimaStructured): m is MassimaStructured {
  return typeof m === 'object' && m !== null && 'massima' in m;
}

// Normalize massima to structured format
function normalizeMassima(m: string | MassimaStructured, index: number): MassimaStructured & { id: string } {
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

// Map authority abbreviations to colors
function getAuthorityColor(autorita: string | null): string {
  if (!autorita) return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';

  const auth = autorita.toLowerCase();
  if (auth.includes('cost') || auth.includes('costituzionale')) {
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300';
  }
  if (auth.includes('cass')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
  }
  if (auth.includes('cons') && auth.includes('st')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
  }
  if (auth.includes('tar')) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300';
  }
  if (auth.includes('appello') || auth.includes('app')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300';
  }
  if (auth.includes('trib')) {
    return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300';
  }
  if (auth.includes('cgue') || auth.includes('giust')) {
    return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300';
  }
  if (auth.includes('cedu') || auth.includes('edu')) {
    return 'bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300';
  }
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
}

export function MassimeSection({ massime }: MassimeSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Normalize all massime to structured format
  const normalizedMassime = useMemo(() => {
    if (!massime || massime.length === 0) return [];
    return massime.map((m, i) => normalizeMassima(m, i));
  }, [massime]);

  // Extract unique years for filter dropdown
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    normalizedMassime.forEach(m => {
      if (m.anno) years.add(m.anno);
    });
    return Array.from(years).sort((a, b) => parseInt(b) - parseInt(a));
  }, [normalizedMassime]);

  // Filter massime based on search and year
  const filteredMassime = useMemo(() => {
    return normalizedMassime.filter(m => {
      // Year filter
      if (selectedYear !== 'all' && m.anno !== selectedYear) {
        return false;
      }
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const searchIn = [
          m.massima,
          m.autorita || '',
          m.numero || '',
          m.anno || ''
        ].join(' ').toLowerCase();
        return searchIn.includes(query);
      }
      return true;
    });
  }, [normalizedMassime, searchQuery, selectedYear]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!massime || massime.length === 0) return null;

  const hasStructuredData = normalizedMassime.some(m => m.autorita || m.numero || m.anno);

  return (
    <div className="card bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl overflow-hidden transition-all hover:shadow-md">
      {/* Header with collapse button — same chrome as the other cards in the
          Giurisprudenza block (BrocardiSectionContent's shape). */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
      >
        <strong className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-2.5">
          <Scale size={16} className="text-blue-600" />
          Massime ({filteredMassime.length}/{normalizedMassime.length})
        </strong>
        <ChevronDown
          size={16}
          className={cn("text-slate-400 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <>
          {/* Filters */}
          <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Filtra:</span>
              </div>

          <div className="flex-1 flex flex-col sm:flex-row gap-2">
            {/* Search input */}
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cerca nelle massime..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Year filter dropdown */}
            {availableYears.length > 0 && (
              <div className="relative">
                <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="pl-8 pr-8 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer"
                >
                  <option value="all">Tutti gli anni</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Massime list — no inner scroller: this card now lives full-width in
          the Giurisprudenza section, not inside a fixed-height popover, so it
          grows with its content and the page itself scrolls. */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {filteredMassime.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">
            Nessuna massima trovata con i filtri selezionati
          </div>
        ) : (
          filteredMassime.map((m, idx) => {
            const isExpanded = expandedIds.has(m.id);
            const isLongText = m.massima.length > 300;
            const displayText = isLongText && !isExpanded
              ? m.massima.slice(0, 300) + '...'
              : m.massima;

            return (
              <div
                key={m.id}
                className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex gap-3">
                  {/* Index number */}
                  <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-500">
                    {idx + 1}
                  </span>

                  <div className="flex-1 min-w-0">
                    {/* Header: authority/case number on the left, provenance
                        badge on the right — a massima is always "curated"
                        (a Brocardi editor chose it for this article), the
                        same badge the court cards use for "cited"/"matched"
                        so the three provenances stay visually distinct at a
                        glance wherever a decision appears in this block. */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {hasStructuredData && m.autorita && (
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            getAuthorityColor(m.autorita)
                          )}>
                            {m.autorita}
                          </span>
                        )}
                        {hasStructuredData && m.numero && m.anno && (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            n. {m.numero}/{m.anno}
                          </span>
                        )}
                      </div>
                      <LinkKindBadge kind="curated" />
                    </div>

                    {/* Massima text */}
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {displayText}
                    </p>

                    {/* Expand/collapse button for long text */}
                    {isLongText && (
                      <button
                        onClick={() => toggleExpand(m.id)}
                        className="mt-2 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {isExpanded ? 'Mostra meno' : 'Mostra tutto'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
}
