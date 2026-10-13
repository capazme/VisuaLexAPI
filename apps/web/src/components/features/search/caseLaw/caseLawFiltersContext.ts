import { createContext, useContext, useEffect } from 'react';
import { NO_FILTERS, type CaseLawFilters } from './caseLawFilter';

export interface CaseLawFiltersValue {
  filters: CaseLawFilters;
  /** A source tells the section the years of the rows it has loaded (`null`: it has none now). */
  reportYears: (source: string, years: number[] | null) => void;
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
 * Report the years of the rows a block has loaded, for the section's chips. `years` must keep its
 * identity until the rows change (memoise it): the report is repeated whenever it changes.
 */
export function useReportCaseLawYears(source: string, years: number[]): void {
  const { reportYears } = useContext(CaseLawFiltersContext);
  useEffect(() => {
    reportYears(source, years);
    return () => reportYears(source, null);
  }, [reportYears, source, years]);
}
