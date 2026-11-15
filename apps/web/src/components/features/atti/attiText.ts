import type { DossierApi } from '../../../services/dossierService';

/** How long the editor waits after the last keystroke before it saves. */
export const SAVE_DELAY_MS = 800;

/** «15 novembre» this year, «15 novembre 2025» before. */
export function changedOn(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** What «Cita» writes for an entry of the dossier: the server's citation of a norm, else the entry's title. */
export function citationOf(item: DossierApi['items'][number]): string {
  return (item.citation ?? item.title).trim();
}
