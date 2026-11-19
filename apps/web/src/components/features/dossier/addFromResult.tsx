import { useId, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { DossierSentenzaData, NormaVisitata } from '../../../types';
import { notify } from '../../ui/notifications/notifications';
import { AddToDossierPopover } from './AddToDossierPopover';
import { dossierContainsArticle, dossierContainsDecision } from './dossierUtils';

/** What a result of the Ricerca adds to a dossier: an article or a decision. */
export type DossierTarget = { norma: NormaVisitata } | { sentenza: DossierSentenzaData };

/**
 * «Nel dossier «X»», «In 2 dossier», or null (LC59): read from the store's dossiers with the popover's own rules
 * (`dossierContainsArticle` knows the version), so the mark and the popover's «già presente» never disagree.
 */
export function useHeldInLabel(target: DossierTarget | undefined): string | null {
  const dossiers = useAppStore((s) => s.dossiers);
  return useMemo(() => {
    if (!target) return null;
    const held = dossiers.filter((d) => ('norma' in target ? dossierContainsArticle(d, target.norma) : dossierContainsDecision(d, target.sentenza)));
    if (held.length === 0) return null;
    return held.length === 1 ? `Nella pratica «${held[0].title}»` : `In ${held.length} pratiche`;
  }, [dossiers, target]);
}

/**
 * The reader's «Aggiungi alla pratica» (`AddToDossierPopover`) for a result: `open()` opens it in the page, where the
 * host draws `popover`, right under the command (LC125, L-73). The command carries `isOpen` as `aria-expanded` and `id`
 * as `aria-controls`. Nothing is added until a dossier is chosen.
 */
export function useAddToDossier(target: DossierTarget | undefined): { open: () => void; isOpen: boolean; id: string; popover: ReactNode } {
  const [isOpen, setOpen] = useState(false);
  const id = useId();
  const added = target && 'sentenza' in target ? 'Aggiunta' : 'Aggiunto';
  const popover = target ? (
    <AddToDossierPopover
      id={id}
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      {...target}
      onAdded={(_id, title) => notify({ type: 'success', message: `${added} a «${title}»`, duration: 3000 })}
      onDuplicate={(title) => notify({ type: 'info', message: `Già presente in «${title}»`, duration: 3000 })}
    />
  ) : null;
  return { open: () => setOpen(true), isOpen, id, popover };
}
