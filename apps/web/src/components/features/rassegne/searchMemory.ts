import type { RassegnaRisultato } from './types';

/**
 * The page «Rassegne»'s last search, kept in memory for the session so that coming back from an
 * article finds the list as it was: not in the address (access logs would keep the words), not in
 * the browser's storage. Cleared at logout with the panel's cache (`clearRassegneCache`).
 */
export interface RememberedSearch {
  /** what the field says */
  text: string;
  /** the words sent (`searchWords`) */
  q: string;
  archivio: 'civile' | 'penale' | null;
  total: number;
  archivi: { archivio: string; passi: number }[];
  items: RassegnaRisultato[];
  next: string | null;
}

let remembered: RememberedSearch | null = null;

export function rememberedSearch(): RememberedSearch | null {
  return remembered;
}

export function rememberSearch(search: RememberedSearch | null): void {
  remembered = search;
}
