import { useMemo, useState, type ReactNode } from 'react';
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
 * The reader's popover (`AddToDossierPopover`) for a result: `open(anchor)` shows it beside the anchor on a computer,
 * as the bottom sheet with no anchor (a phone's «⋯»). Nothing is added until a dossier is chosen.
 */
export function useAddToDossier(target: DossierTarget | undefined): { open: (anchor: HTMLElement | null) => void; popover: ReactNode } {
  const [state, setState] = useState<{ anchor: HTMLElement | null } | null>(null);
  const added = target && 'sentenza' in target ? 'Aggiunta' : 'Aggiunto';
  const popover = target ? (
    <AddToDossierPopover
      isOpen={state !== null}
      anchorEl={state?.anchor ?? null}
      onClose={() => setState(null)}
      {...target}
      onAdded={(_id, title) => notify({ type: 'success', message: `${added} a «${title}»`, duration: 3000 })}
      onDuplicate={(title) => notify({ type: 'info', message: `Già presente in «${title}»`, duration: 3000 })}
    />
  ) : null;
  return { open: (anchor) => setState({ anchor }), popover };
}
