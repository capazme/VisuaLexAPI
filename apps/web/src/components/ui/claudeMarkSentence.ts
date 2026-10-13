import type { DossierItem } from '../../types';

/** «scritta da Claude Code (applicazione collegata)»: who wrote an entry, on screen (`ClaudeMark`) and in the dossier's PDF. */
export function claudeMarkSentence(createdBy: NonNullable<DossierItem['createdBy']>): string {
  const name = createdBy.clientName?.trim();
  return name ? `scritta da ${name} (applicazione collegata)` : "scritta da un'applicazione collegata";
}
