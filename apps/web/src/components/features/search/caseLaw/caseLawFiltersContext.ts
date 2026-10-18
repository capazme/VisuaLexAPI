import { createContext, useContext, useEffect } from 'react';
import { NO_FILTERS, type CaseLawFilters } from './caseLawFilter';
import type { YearCount } from './caseLawYears';

export interface CaseLawFiltersValue {
  filters: CaseLawFilters;
  /** A source tells the section its years with how many rows each has (`null`: it has none now). */
  reportYears: (source: string, counts: YearCount[] | null) => void;
}

const noop = () => {};

/**
 * What `CaseLawSection`'s controls say, handed to the blocks under it, the Massimario's plugin
 * panel included (its slot props are a contract, so the filters come this way). Outside a section
 * the default says nothing: a block used alone shows all its rows.
 */
export const CaseLawFiltersContext = createContext<CaseLawFiltersValue>({ filters: NO_FILTERS, reportYears: noop });

export function useCaseLawFilters(): CaseLawFilters {
  return useContext(CaseLawFiltersContext).filters;
}

/**
 * Report the years of a block, with how many rows each has, for the section's chips: those of the
 * rows loaded, or the source's own counts. `counts` must keep its identity until the rows change
 * (memoise it): the report is repeated whenever it changes.
 */
export function useReportCaseLawYears(source: string, counts: YearCount[]): void {
  const { reportYears } = useContext(CaseLawFiltersContext);
  useEffect(() => {
    reportYears(source, counts);
    return () => reportYears(source, null);
  }, [reportYears, source, counts]);
}
