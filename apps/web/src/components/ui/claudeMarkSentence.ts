import type { DossierItem } from '../../types';

/**
 * «scritta da Claude Code (applicazione collegata)»: who wrote an entry, on screen (`ClaudeMark`) and in the dossier's PDF.
 * `verb` for an entry the application only filed: a decision is «aggiunta», never written by it (D7a).
 */
export function claudeMarkSentence(createdBy: NonNullable<DossierItem['createdBy']>, verb = 'scritta'): string {
  const name = createdBy.clientName?.trim();
  return name ? `${verb} da ${name} (applicazione collegata)` : `${verb} da un'applicazione collegata`;
}
