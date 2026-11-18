import { createContext, useContext } from 'react';

/**
 * The collection's tools on a dossier's «Fonti» (LC88): the filter and the selection the page holds over the reading.
 * Absent in the Corpus and anywhere else the table is drawn: rows then show all and carry no checkbox.
 */
export interface FontiTools {
  /** The filter, trimmed and lower-cased; '' shows every row. */
  query: string;
  /** «Seleziona» is on: the rows of the dossier carry a checkbox, the Space ticks the focused one. */
  selecting: boolean;
  /** The dossier entries ticked (their ids, every copy of an article). */
  selected: ReadonlySet<string>;
  /** Ticks the entries if any of them is not ticked yet, else unticks them all. */
  toggle: (itemIds: string[]) => void;
  /** A group of rows (an act by its id, the decisions) says which dossier entries it shows, for «N di M»: one rule,
   *  the dossier's entries, as the tab «Fonti» counts them; a row only on the table counts for nothing. */
  report: (group: string, itemIds: string[]) => void;
  /** Empties the filter: an act it closed opens again on a click. */
  clear: () => void;
}

export const FontiToolsContext = createContext<FontiTools | null>(null);

export function useFontiTools(): FontiTools | null {
  return useContext(FontiToolsContext);
}

/** Whether any of the texts holds the query (already lower-cased); an empty query matches everything. */
export function matchesQuery(query: string, ...texts: (string | null | undefined)[]): boolean {
  return query === '' || texts.some((t) => !!t && t.toLowerCase().includes(query));
}
