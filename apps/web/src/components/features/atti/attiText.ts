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

/** A dossier note's text: the app stores a note's content as the string itself. */
export function noteTextOf(item: DossierApi['items'][number]): string {
  return typeof item.content === 'string' ? item.content.trim() : '';
}

/** The act's title from a file's name: «Atto di appello v3.docx» → «Atto di appello v3». */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim().slice(0, 300) || 'Atto';
}

/** The files an act is loaded from: what «Analizza documento» reads in the browser, the PDF aside. */
export const ATTO_FILE_ACCEPT = '.docx,.txt,.md,.markdown,.html,.htm';
