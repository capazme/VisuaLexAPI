import { Sparkles } from 'lucide-react';
import type { DossierItem } from '../../types';
import { claudeMarkSentence } from './claudeMarkSentence';

interface Props {
  createdBy: DossierItem['createdBy'];
  /** A short form for the collapsed row, where room is tight. */
  compact?: boolean;
}

/**
 * Who wrote an entry, when a connected application did (MCP second round). The
 * name is the one the application registered with, unverified: the sentence
 * says «applicazione collegata» so it reads as a label, not a guarantee.
 */
export function ClaudeMark({ createdBy, compact = false }: Props) {
  if (!createdBy) return null;
  const name = createdBy.clientName?.trim() || "un'applicazione collegata";
  const sentence = claudeMarkSentence(createdBy);
  return (
    // Never wider than its row: an application's name can be long, and a mark that would not shrink pushed a phone's
    // page sideways in «Le mie schede» (G8b); its words wrap instead.
    <span
      className="inline-flex max-w-full items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
      title={sentence}
    >
      <Sparkles size={11} aria-hidden className="shrink-0" />
      {compact ? <span className="sr-only">{sentence}</span> : <span className="min-w-0 [overflow-wrap:anywhere]">{sentence}</span>}
      {compact && <span aria-hidden className="min-w-0 [overflow-wrap:anywhere]">{name}</span>}
    </span>
  );
}
