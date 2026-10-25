import { useEffect, useId, useRef, useState } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { ExternalLink, FolderPlus } from 'lucide-react';
import type { NormaVisitata } from '../../../types';
import { formatCitationLabel, type ParsedCitationData } from '../../../utils/citationMatcher';
import { fetchArticleForNorma } from '../../../utils/articleFetchCache';
import { Z_INDEX } from '../../../constants/zIndex';
import { cn } from '../../../lib/utils';
import { FOCUS_RING } from '../studia/progress/tokens';
import { AddToDossierPopover } from './AddToDossierPopover';

interface Props {
  citation: ParsedCitationData;
  /** The link clicked in the decision's text. */
  link: HTMLElement;
  onClose: () => void;
  onOpenOnDashboard: (citation: ParsedCitationData) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const CHOICE = cn(
  'flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 aria-disabled:cursor-wait aria-disabled:text-slate-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-disabled:text-slate-400',
  FOCUS_RING,
);

/**
 * A norm a dossier's decision cites that the dossier does not hold (D7d): nothing opens by itself; by the link, the two
 * ways the reader already has — Dashboard, as before, or «Aggiungi al dossier» (`AddToDossierPopover`, on the norm as
 * the source answers it, so the row is the one a search would have added).
 */
export function CitedNormChoice({ citation, link, onClose, onOpenOnDashboard, showToast }: Props) {
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [norma, setNorma] = useState<NormaVisitata | null>(null);
  const headingId = useId();
  // An answer after the choice closed is dropped.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (next) => { if (!next) onClose(); },
    placement: 'bottom-start',
    // The anchor from the first render, so the first position is right (gotcha 13).
    elements: { reference: link },
    middleware: [offset(8), flip({ fallbackPlacements: ['top-start', 'bottom', 'top'] }), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const addToDossier = async () => {
    if (reading) return;
    setReading(true);
    setFailed(false);
    try {
      const article = await fetchArticleForNorma({
        tipo_atto: citation.act_type,
        numero_atto: citation.act_number || '',
        data: citation.date || '',
        numero_articolo: citation.article,
      });
      if (open.current) setNorma(article.norma_data);
    } catch (error) {
      console.error('reading the cited norm failed', error);
      if (open.current) setFailed(true);
    } finally {
      if (open.current) setReading(false);
    }
  };

  if (norma) {
    return (
      <AddToDossierPopover
        isOpen
        anchorEl={link}
        onClose={onClose}
        norma={norma}
        onAdded={(_dossierId, title) => showToast(`Aggiunto a «${title}»`, 'success')}
        onDuplicate={(title) => showToast(`Già presente in «${title}»`, 'info')}
      />
    );
  }

  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          aria-labelledby={headingId}
          className={Z_INDEX.citationPreview}
        >
          <div className="w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-md dark:border-slate-700 dark:bg-slate-900">
            <p id={headingId} className="px-2 pb-1 pt-1.5 text-sm text-slate-700 dark:text-slate-200">
              <span className="font-medium text-slate-900 dark:text-slate-50">{formatCitationLabel(citation)}</span> non è in questo dossier.
            </p>
            <button type="button" onClick={() => onOpenOnDashboard(citation)} className={CHOICE}>
              <ExternalLink size={16} aria-hidden className="shrink-0" />
              Apri su Dashboard
            </button>
            {/* `aria-disabled`, not `disabled`, while the norm is read: the focus stays on the button. */}
            <button type="button" onClick={() => void addToDossier()} aria-disabled={reading} aria-busy={reading} className={CHOICE}>
              <FolderPlus size={16} aria-hidden className="shrink-0" />
              {reading ? 'Cerco la norma…' : 'Aggiungi al dossier'}
            </button>
            {failed && (
              <p role="alert" className="px-2 pt-1 text-[13px] leading-snug text-red-700 dark:text-red-300">
                Non riesco a leggere la norma citata: riprova, o aprila su Dashboard.
              </p>
            )}
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
