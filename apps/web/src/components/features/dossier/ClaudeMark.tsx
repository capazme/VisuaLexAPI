import { Sparkles } from 'lucide-react';
import type { DossierItem } from '../../../types';

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
  const sentence = createdBy.clientName?.trim()
    ? `scritta da ${name} (applicazione collegata)`
    : `scritta da ${name}`;
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
      title={sentence}
    >
      <Sparkles size={11} aria-hidden />
      {compact ? <span className="sr-only">{sentence}</span> : sentence}
      {compact && <span aria-hidden>{name}</span>}
    </span>
  );
}
